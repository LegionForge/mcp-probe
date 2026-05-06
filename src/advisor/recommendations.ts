import type {
  ClientAuditResult,
  ServerProbeResult,
  ServerConfig,
  Recommendation,
  RuntimeInfo,
} from "../types.js";
import { bestLaunchStrategy } from "../discovery/framework-detection.js";

// ─────────────────────────────────────────────────────────────────────────────
// Generate actionable recommendations from probe + audit results
// ─────────────────────────────────────────────────────────────────────────────

export function generateRecommendations(
  servers: ServerConfig[],
  probes: ServerProbeResult[],
  auditResults: ClientAuditResult[],
  runtimes: RuntimeInfo[]
): Recommendation[] {
  const recs: Recommendation[] = [];
  let idSeq = 0;
  const id = () => `rec-${++idSeq}`;

  // ── Server-level issues ───────────────────────────────────────────────────
  for (const probe of probes) {
    if (probe.failed > 0) {
      const failedChecks = probe.checks.filter((c) => c.status === "fail");
      for (const fc of failedChecks) {
        if (fc.name === "reachability") {
          recs.push({
            id: id(),
            severity: "required",
            client: "claude-desktop",
            server: probe.server,
            title: `${probe.server}: Server unreachable`,
            description: `Cannot connect to ${probe.url}. Verify the server process is running.`,
            action: "manual",
            actionLabel: "Check server process",
          });
        } else if (fc.name === "auth-acceptance") {
          recs.push({
            id: id(),
            severity: "required",
            client: "claude-desktop",
            server: probe.server,
            title: `${probe.server}: Authentication failing`,
            description: `Valid key rejected. Check the auth header name and key value in your config.`,
            action: "manual",
            actionLabel: "Verify credentials",
          });
        }
      }
    }
  }

  // ── Client wiring issues ──────────────────────────────────────────────────
  for (const client of auditResults) {
    if (!client.installed) continue;

    for (const server of servers) {
      const wiring = client.serverWiring[server.name];
      if (!wiring) continue;

      if (!wiring.configured) {
        const configSnippet = buildConfigSnippet(server, client.clientId, runtimes);
        recs.push({
          id: id(),
          severity: "required",
          client: client.clientId,
          server: server.name,
          title: `Add "${server.name}" to ${client.displayName}`,
          description: `Server "${server.name}" is not configured in ${client.displayName}. All sessions in this client will be unable to use this MCP server.`,
          configSnippet,
          action: "add-to-config",
          actionLabel: `Add to ${client.displayName} config`,
        });
      } else if (wiring.logHealthy === false) {
        recs.push({
          id: id(),
          severity: "required",
          client: client.clientId,
          server: server.name,
          title: `${client.displayName}: "${server.name}" connection unhealthy`,
          description: `Server is configured but the connection log shows errors. Check the mcp-remote process and server health.`,
          action: "restart-client",
          actionLabel: "Restart client",
        });
      } else if (wiring.configured && !wiring.processRunning && client.clientId === "claude-desktop") {
        recs.push({
          id: id(),
          severity: "suggested",
          client: client.clientId,
          server: server.name,
          title: `${client.displayName}: Restart required for "${server.name}"`,
          description: `Server is in config but no mcp-remote process is running. Restart Claude Desktop App.`,
          action: "restart-client",
          actionLabel: "Restart Claude Desktop",
        });
      }
    }
  }

  // ── Dual-config cross-check ───────────────────────────────────────────────
  // claude_desktop_config.json and ~/.claude/settings.json are read by different
  // clients. The VSCode extension (including SSH sessions) inherits from
  // claude_desktop_config.json — NOT from settings.json. A server missing from
  // the Desktop config is invisible to all VSCode sessions regardless of what's
  // in settings.json. Always check both files.
  const desktopAudit = auditResults.find((c) => c.clientId === "claude-desktop");
  const codeAudit = auditResults.find((c) => c.clientId === "claude-code");

  if (desktopAudit?.installed && codeAudit?.installed) {
    for (const server of servers) {
      const inDesktop = desktopAudit.serverWiring[server.name]?.configured;
      const inCode = codeAudit.serverWiring[server.name]?.configured;

      if (inCode && !inDesktop) {
        recs.push({
          id: id(),
          severity: "required",
          client: "claude-desktop",
          server: server.name,
          title: `"${server.name}" in settings.json but missing from claude_desktop_config.json`,
          description:
            `Server is configured for Claude Code CLI (~/.claude/settings.json) but not for Claude Desktop App. ` +
            `The VSCode extension — including sessions over SSH — sources MCP servers from claude_desktop_config.json only. ` +
            `Add this server to both files so all client types can reach it.`,
          configSnippet: buildConfigSnippet(server, "claude-desktop", runtimes),
          action: "add-to-config",
          actionLabel: "Add to claude_desktop_config.json",
        });
      }

      if (inDesktop && !inCode) {
        recs.push({
          id: id(),
          severity: "suggested",
          client: "claude-code",
          server: server.name,
          title: `"${server.name}" in claude_desktop_config.json but missing from settings.json`,
          description:
            `Server is configured for Claude Desktop App but not for Claude Code CLI (~/.claude/settings.json). ` +
            `Terminal Claude Code sessions won't have access to this server.`,
          configSnippet: buildConfigSnippet(server, "claude-code", runtimes),
          action: "add-to-config",
          actionLabel: "Add to ~/.claude/settings.json",
        });
      }
    }
  }

  // ── Runtime recommendations ───────────────────────────────────────────────
  const hasNode = runtimes.find((r) => r.command === "node")?.available;
  if (!hasNode) {
    const needsHttpServer = servers.some((s) => s.url.startsWith("http"));
    if (needsHttpServer) {
      recs.push({
        id: id(),
        severity: "required",
        client: "claude-desktop",
        server: servers[0]?.name ?? "all",
        title: "Node.js not found — required for HTTP MCP servers",
        description: "HTTP MCP servers use mcp-remote as a proxy, which requires Node.js 20+. Install Node.js to connect to these servers.",
        action: "install-runtime",
        actionLabel: "Install Node.js",
      });
    }
  }

  return recs;
}

// ── Config snippet generators per client ──────────────────────────────────────

function buildConfigSnippet(
  server: ServerConfig,
  clientId: string,
  runtimes: RuntimeInfo[]
): string {
  const launchCmd = server.url.startsWith("http")
    ? bestLaunchStrategy(server.url, runtimes)
    : null;

  const authArgs = server.auth?.header
    ? `,\n        "--header", "${server.auth.header}:YOUR_KEY_HERE"`
    : "";

  const transportArgs = server.url.startsWith("http")
    ? `,\n        "--transport", "http-only"`
    : "";

  const npxArgs = launchCmd
    ? `["-y", "mcp-remote", ${JSON.stringify(server.url)}${authArgs}${transportArgs}]`
    : `["YOUR_SERVER_ARGS_HERE"]`;

  const cliEntry = `"${server.name}": {
    "command": "npx",
    "args": ${npxArgs}
  }`;

  switch (clientId) {
    case "claude-desktop":
      return `// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    ${cliEntry}
  }
}`;

    case "claude-code":
      return `// ~/.claude/settings.json
{
  "mcpServers": {
    ${cliEntry}
  }
}`;

    case "vscode-native":
      return `// .vscode/mcp.json (workspace) or settings.json (user)
{
  "mcp": {
    "servers": {
      ${cliEntry}
    }
  }
}`;

    case "cursor":
      return `// ~/.cursor/mcp.json
{
  "mcpServers": {
    ${cliEntry}
  }
}`;

    case "windsurf":
      return `// ~/.codeium/windsurf/mcp_config.json
{
  "mcpServers": {
    ${cliEntry}
  }
}`;

    default:
      return `// Add to your client's MCP config:\n{\n  "mcpServers": {\n    ${cliEntry}\n  }\n}`;
  }
}
