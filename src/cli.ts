#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { probeServer } from "./probe/server-probe.js";
import { auditClients } from "./audit/client-audit.js";
import { discoverClients } from "./discovery/client-discovery.js";
import { detectRuntimes } from "./discovery/framework-detection.js";
import { generateRecommendations } from "./advisor/recommendations.js";
import { startUI } from "./ui/server.js";
import { loadConfig, defaultConfig } from "./config.js";
import type { ServerProbeResult, CheckResult } from "./types.js";

const program = new Command();

program
  .name("mcp-probe")
  .description("MCP server analysis, configuration advisor, and connectivity tool")
  .version("0.1.0")
  .option("--config <path>", "Path to config file (.mcp-probe.json)")
  .option("--json", "Output as JSON");

// ── probe command ─────────────────────────────────────────────────────────────
program
  .command("probe [url]")
  .description("Test an MCP server's protocol compliance and connectivity")
  .option("--auth-header <header>", "Auth header name (e.g. x-brain-key)")
  .option("--auth-key <key>", "Auth key value")
  .option("--server <name>", "Server name from config to probe")
  .option("--timeout <ms>", "Timeout in milliseconds", "8000")
  .action(async (url, opts, _cmd) => {
    // In Commander v12, opts is the subcommand options, not program opts
    const globalOpts = program.opts();
    // Also check opts directly in case Commander merged them
    const authHeader: string | undefined = opts.authHeader ?? opts["auth-header"];
    const authKey: string | undefined = opts.authKey ?? opts["auth-key"] ?? process.env["MCP_AUTH_KEY"];
    const config = loadConfig(globalOpts.config);

    let servers = config.servers;

    if (url) {
      // Ad-hoc probe
      servers = [{ name: "probe", url, auth: authHeader ? { header: authHeader, key: authKey } : undefined }];
    } else if (opts.server) {
      servers = config.servers.filter((s) => s.name === opts.server);
      if (!servers.length) {
        console.error(chalk.red(`Server "${opts.server}" not found in config`));
        process.exit(1);
      }
    } else if (!servers.length) {
      console.error(chalk.red("No servers configured. Pass a URL or add servers to .mcp-probe.json"));
      process.exit(1);
    }

    const timeout = Math.min(Math.max(parseInt(opts.timeout, 10) || 8000, 100), 300_000);
    const results = await Promise.all(servers.map((s) => probeServer(s, timeout)));

    if (globalOpts.json) {
      console.log(JSON.stringify(results, null, 2));
      process.exit(results.some((r) => r.failed > 0) ? 1 : 0);
    }

    let allPassed = true;
    for (const result of results) {
      printProbeResult(result);
      if (result.failed > 0) allPassed = false;
    }
    process.exit(allPassed ? 0 : 1);
  });

// ── audit command ─────────────────────────────────────────────────────────────
program
  .command("audit")
  .description("Audit which AI clients have each MCP server configured and running")
  .action(async () => {
    const globalOpts = program.opts();
    const config = loadConfig(globalOpts.config);

    if (!config.servers.length) {
      console.error(chalk.red("No servers in config. Add servers to .mcp-probe.json"));
      process.exit(1);
    }

    const results = await auditClients(config.servers);

    if (globalOpts.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    console.log(chalk.bold("\n  Client Wiring Audit\n"));
    for (const client of results) {
      const installed = client.installed;
      const icon = installed ? chalk.green("✓") : chalk.dim("─");
      console.log(`${icon} ${chalk.bold(client.displayName)}`);

      if (!installed) {
        console.log(chalk.dim("    not installed\n"));
        continue;
      }

      for (const [serverName, wiring] of Object.entries(client.serverWiring)) {
        const dot = wiring.configured ? chalk.green("●") : chalk.red("○");
        const status = wiring.configured
          ? wiring.processRunning ? chalk.green("configured + running") : chalk.yellow("configured (not running)")
          : chalk.red("NOT CONFIGURED");
        console.log(`    ${dot} ${serverName}: ${status}`);
        for (const issue of wiring.issues) {
          console.log(chalk.dim(`      ↳ ${issue}`));
        }
        for (const sug of wiring.suggestions) {
          console.log(chalk.cyan(`      → ${sug}`));
        }
      }
      console.log();
    }
  });

// ── recommend command ─────────────────────────────────────────────────────────
program
  .command("recommend")
  .description("Show configuration recommendations for all installed clients")
  .action(async () => {
    const globalOpts = program.opts();
    const config = loadConfig(globalOpts.config);

    const [probes, auditResults, runtimes] = await Promise.all([
      Promise.all(config.servers.map((s) => probeServer(s))),
      auditClients(config.servers),
      detectRuntimes(),
    ]);

    const recs = generateRecommendations(config.servers, probes, auditResults, runtimes);

    if (globalOpts.json) {
      console.log(JSON.stringify(recs, null, 2));
      return;
    }

    if (!recs.length) {
      console.log(chalk.green("\n  ✓ No issues found — all clients are properly configured\n"));
      return;
    }

    console.log(chalk.bold(`\n  ${recs.length} recommendation(s)\n`));
    for (const rec of recs) {
      const sev = rec.severity === "required" ? chalk.red(rec.severity.toUpperCase()) : chalk.yellow(rec.severity.toUpperCase());
      console.log(`${sev}  ${chalk.bold(rec.title)}`);
      console.log(chalk.dim(`  ${rec.description}`));
      if (rec.configSnippet) {
        console.log(chalk.dim("\n  Config:"));
        rec.configSnippet.split("\n").forEach((line) =>
          console.log(chalk.dim(`    ${line}`))
        );
      }
      console.log();
    }
  });

// ── discover command ──────────────────────────────────────────────────────────
program
  .command("discover")
  .description("Detect installed AI clients and available MCP runtimes")
  .action(async () => {
    const globalOpts = program.opts();
    const clients = discoverClients();
    const runtimes = detectRuntimes();

    if (globalOpts.json) {
      console.log(JSON.stringify({ clients, runtimes, platform: process.platform }, null, 2));
      return;
    }

    console.log(chalk.bold("\n  Installed AI Clients\n"));
    if (!clients.length) {
      console.log(chalk.dim("  None detected\n"));
    } else {
      for (const c of clients) {
        console.log(`  ${chalk.green("✓")} ${chalk.bold(c.displayName)}`);
        console.log(chalk.dim(`    Config: ${c.configPath}\n`));
      }
    }

    console.log(chalk.bold("  Runtime Availability\n"));
    for (const r of runtimes) {
      const icon = r.available ? chalk.green("✓") : chalk.dim("─");
      const ver = r.available ? chalk.green(r.version.split("\n")[0]) : chalk.dim("not found");
      console.log(`  ${icon} ${chalk.bold(r.name)}  ${ver}`);
      console.log(chalk.dim(`    ${r.mcpRelevance}\n`));
    }
  });

// ── ui command ────────────────────────────────────────────────────────────────
program
  .command("ui")
  .description("Start the web dashboard")
  .option("--port <port>", "Port to listen on", "4242")
  .option("--host <host>", "Host to bind to", "localhost")
  .action(async (opts) => {
    const globalOpts = program.opts();
    const config = { ...defaultConfig(), ...loadConfig(globalOpts.config) };
    config.ui = { port: parseInt(opts.port, 10), host: opts.host };

    if (!config.servers.length) {
      console.log(chalk.yellow("  No servers in config — add servers to .mcp-probe.json for full analysis\n"));
    }

    await startUI(config);
  });

// ── Default (no subcommand) — run everything ──────────────────────────────────
program
  .command("run", { isDefault: true, hidden: true })
  .description("Run probe + audit + recommendations")
  .action(async () => {
    const globalOpts = program.opts();
    const config = loadConfig(globalOpts.config);

    if (!config.servers.length) {
      console.log(chalk.dim("\n  No servers configured. Create .mcp-probe.json or use: mcp-probe probe <url>\n"));
      program.help();
      return;
    }

    const [probes, auditResults, runtimes] = await Promise.all([
      Promise.all(config.servers.map((s) => probeServer(s))),
      auditClients(config.servers),
      detectRuntimes(),
    ]);
    const recs = generateRecommendations(config.servers, probes, auditResults, runtimes);

    if (globalOpts.json) {
      console.log(JSON.stringify({ probes, audit: auditResults, recommendations: recs }, null, 2));
      process.exit(probes.some((p) => p.failed > 0) ? 1 : 0);
    }

    for (const probe of probes) printProbeResult(probe);

    const reqRecs = recs.filter((r) => r.severity === "required");
    if (reqRecs.length) {
      console.log(chalk.bold(`\n  ${reqRecs.length} required action(s):`));
      for (const r of reqRecs) {
        console.log(`  ${chalk.red("→")} ${r.title}`);
      }
    }
    console.log();
    process.exit(probes.some((p) => p.failed > 0) || reqRecs.length > 0 ? 1 : 0);
  });

// ─────────────────────────────────────────────────────────────────────────────
function printProbeResult(result: ServerProbeResult) {
  const border = "─".repeat(60);
  console.log(chalk.bold(`\n  ${border}`));
  console.log(chalk.bold(`  Server: ${result.server}  ${chalk.dim(result.url)}`));
  console.log(chalk.bold(`  Transport: ${result.transport}`));
  console.log(chalk.bold(`  ${border}\n`));

  for (const c of result.checks) {
    const icon = statusIcon(c);
    const msg = c.status === "fail" ? chalk.red(c.message) : c.status === "warn" ? chalk.yellow(c.message) : c.message;
    console.log(`  ${icon}  ${msg}`);
    if (c.detail) console.log(chalk.dim(`       ${c.detail}`));
  }

  const summary = [
    chalk.green(`${result.passed} passed`),
    result.failed ? chalk.red(`${result.failed} failed`) : chalk.dim(`0 failed`),
    result.warned ? chalk.yellow(`${result.warned} warnings`) : null,
    result.skipped ? chalk.dim(`${result.skipped} skipped`) : null,
  ].filter(Boolean).join("  ");

  console.log(`\n  ${summary}\n`);
}

function statusIcon(c: CheckResult): string {
  switch (c.status) {
    case "pass": return chalk.green("✓");
    case "fail": return chalk.red("✗");
    case "warn": return chalk.yellow("⚠");
    case "skip": return chalk.dim("─");
    default: return "?";
  }
}

program.parse();
