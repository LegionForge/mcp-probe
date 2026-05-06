import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { homedir } from "os";
import { join } from "path";
import type {
  ClientAuditResult,
  ClientId,
  ServerConfig,
  WiringStatus,
} from "../types.js";
import { discoverClients, getAllClientDefs } from "../discovery/client-discovery.js";

// ─────────────────────────────────────────────────────────────────────────────
// Client wiring audit — checks each installed client's config and process health
// ─────────────────────────────────────────────────────────────────────────────

function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasMcpServer(config: Record<string, unknown>, serverName: string): boolean {
  const servers =
    (config["mcpServers"] as Record<string, unknown>) ??
    (config["mcp"] as Record<string, unknown>)?.["servers"] ??
    {};
  return serverName in (servers as object);
}

function portFromUrl(url: string): string | null {
  try {
    return new URL(url).port || null;
  } catch {
    return null;
  }
}

function isMcpRemoteRunning(portHint: string): boolean {
  try {
    const out = execSync("ps aux", { stdio: "pipe" }).toString();
    // Match lines where mcp-remote AND the port appear together on the same line
    return out.split("\n").some(
      (line) => line.includes("mcp-remote") && line.includes(portHint)
    );
  } catch {
    return false;
  }
}

function claudeLogHealthy(serverName: string): boolean | null {
  const logPath = join(homedir(), "Library", "Logs", "Claude", `mcp-server-${serverName}.log`);
  if (!existsSync(logPath)) return null;
  try {
    const content = readFileSync(logPath, "utf-8");
    return content.includes("connected successfully") || content.includes("Server started");
  } catch {
    return null;
  }
}

// ── Per-client config file locations ─────────────────────────────────────────

const CLAUDE_LOG_DIR = join(homedir(), "Library", "Logs", "Claude");

function auditClaudeDesktop(server: ServerConfig): WiringStatus {
  const issues: string[] = [];
  const suggestions: string[] = [];
  const configPath = join(
    homedir(),
    "Library",
    "Application Support",
    "Claude",
    "claude_desktop_config.json"
  );

  if (!existsSync(configPath)) {
    return { configured: false, processRunning: false, logHealthy: null, issues: ["Config file not found"], suggestions: ["Install Claude Desktop App"] };
  }

  const config = readJsonSafe(configPath);
  if (!config) {
    return { configured: false, processRunning: false, logHealthy: null, issues: ["Config file is invalid JSON"], suggestions: ["Fix JSON syntax in claude_desktop_config.json"] };
  }

  const configured = hasMcpServer(config, server.name);
  if (!configured) {
    issues.push(`Server "${server.name}" not in mcpServers`);
    suggestions.push(`Add "${server.name}" to ~/Library/Application Support/Claude/claude_desktop_config.json`);
  }

  const port = portFromUrl(server.url);
  const processRunning = port ? isMcpRemoteRunning(port) : false;
  if (configured && !processRunning) {
    suggestions.push("Restart Claude Desktop App to start the mcp-remote proxy");
  }

  const logHealthy = claudeLogHealthy(server.name);
  if (configured && logHealthy === null) {
    issues.push("No log file — Desktop App hasn't started this server yet");
    suggestions.push("Restart Claude Desktop App after adding server to config");
  } else if (configured && logHealthy === false) {
    issues.push("Log file exists but shows no successful connection");
  }

  return { configured, processRunning, logHealthy, issues, suggestions };
}

function auditClaudeCode(server: ServerConfig): WiringStatus {
  const issues: string[] = [];
  const suggestions: string[] = [];
  const configPath = join(homedir(), ".claude", "settings.json");

  if (!existsSync(configPath)) {
    return { configured: false, processRunning: false, logHealthy: null, issues: ["~/.claude/settings.json not found"], suggestions: [] };
  }

  const config = readJsonSafe(configPath);
  if (!config) {
    return { configured: false, processRunning: false, logHealthy: null, issues: ["settings.json is invalid JSON"], suggestions: [] };
  }

  const configured = hasMcpServer(config, server.name);
  if (!configured) {
    issues.push(`Server "${server.name}" not in mcpServers`);
    suggestions.push(`Add "${server.name}" to ~/.claude/settings.json`);
    suggestions.push(
      `Also check claude_desktop_config.json — VSCode extension (including SSH sessions) reads that file, not settings.json`
    );
  }

  return { configured, processRunning: false, logHealthy: null, issues, suggestions };
}

function auditGenericJsonClient(
  configPath: string,
  server: ServerConfig,
  _clientId: ClientId
): WiringStatus {
  const issues: string[] = [];
  const suggestions: string[] = [];

  if (!existsSync(configPath)) {
    return { configured: false, processRunning: false, logHealthy: null, issues: ["Config file not found"], suggestions: [`Create ${configPath} with mcpServers entry`] };
  }

  const config = readJsonSafe(configPath);
  if (!config) {
    return { configured: false, processRunning: false, logHealthy: null, issues: ["Config file is invalid JSON"], suggestions: [] };
  }

  const configured = hasMcpServer(config, server.name);
  if (!configured) {
    issues.push(`Server "${server.name}" not found in config`);
    suggestions.push(`Add "${server.name}" to ${configPath}`);
  }

  return { configured, processRunning: false, logHealthy: null, issues, suggestions };
}

// ─────────────────────────────────────────────────────────────────────────────

export async function auditClients(servers: ServerConfig[]): Promise<ClientAuditResult[]> {
  const installedClients = discoverClients();
  const allDefs = getAllClientDefs();
  const results: ClientAuditResult[] = [];

  for (const client of allDefs) {
    const isInstalled = installedClients.some((c) => c.id === client.id);
    const serverWiring: Record<string, WiringStatus> = {};

    for (const server of servers) {
      if (!isInstalled) {
        serverWiring[server.name] = {
          configured: false,
          processRunning: false,
          logHealthy: null,
          issues: [],
          suggestions: [],
        };
        continue;
      }

      const configPath = client.configPath[process.platform as NodeJS.Platform] ?? "";

      switch (client.id) {
        case "claude-desktop":
          serverWiring[server.name] = auditClaudeDesktop(server);
          break;
        case "claude-code":
          serverWiring[server.name] = auditClaudeCode(server);
          break;
        default:
          serverWiring[server.name] = auditGenericJsonClient(configPath, server, client.id);
      }
    }

    results.push({
      clientId: client.id,
      displayName: client.displayName,
      installed: isInstalled,
      configPath: client.configPath[process.platform as NodeJS.Platform] || undefined,
      serverWiring,
    });
  }

  return results;
}
