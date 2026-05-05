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
    ? `["-y", "mcp-remote", "${server.url}"${authArgs}${transportArgs}]`
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
