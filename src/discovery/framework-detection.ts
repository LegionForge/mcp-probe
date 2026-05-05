import { execSync } from "child_process";
import type { RuntimeInfo } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Detect runtimes and package managers relevant to MCP server hosting
// ─────────────────────────────────────────────────────────────────────────────

interface RuntimeDef {
  name: string;
  command: string;
  versionArg: string;
  mcpRelevance: string;
}

const RUNTIMES: RuntimeDef[] = [
  {
    name: "Node.js / npx",
    command: "node",
    versionArg: "--version",
    mcpRelevance: "Primary runtime for MCP servers. npx enables zero-install server launch (e.g. npx mcp-remote).",
  },
  {
    name: "Deno",
    command: "deno",
    versionArg: "--version",
    mcpRelevance: "Used by some MCP servers (e.g. OB1/OpenBrain). Supports deno run without npm install.",
  },
  {
    name: "Python / uvx",
    command: "python3",
    versionArg: "--version",
    mcpRelevance: "Required for Python-based MCP servers. uvx provides zero-install launch like npx.",
  },
  {
    name: "uvx (uv)",
    command: "uvx",
    versionArg: "--version",
    mcpRelevance: "Preferred Python MCP launcher — runs Python MCP servers without a venv. Analogous to npx.",
  },
  {
    name: "Docker",
    command: "docker",
    versionArg: "--version",
    mcpRelevance: "Some MCP servers are distributed as containers. Required for Docker-based server entries.",
  },
  {
    name: "Bun",
    command: "bun",
    versionArg: "--version",
    mcpRelevance: "Alternative JS runtime. Some MCP servers support Bun for faster startup.",
  },
];

function tryVersion(command: string, versionArg: string): string | null {
  try {
    return execSync(`${command} ${versionArg} 2>/dev/null`, { stdio: "pipe" })
      .toString()
      .trim()
      .split("\n")[0];
  } catch {
    return null;
  }
}

export function detectRuntimes(): RuntimeInfo[] {
  return RUNTIMES.map((r) => {
    const version = tryVersion(r.command, r.versionArg);
    return {
      name: r.name,
      command: r.command,
      version: version ?? "",
      available: version !== null,
      mcpRelevance: r.mcpRelevance,
    };
  });
}

export function bestLaunchStrategy(serverUrl: string, runtimes: RuntimeInfo[]): string {
  const hasNode = runtimes.find((r) => r.command === "node")?.available;
  const hasDeno = runtimes.find((r) => r.command === "deno")?.available;

  if (serverUrl.startsWith("http")) {
    if (hasNode) {
      return `npx -y mcp-remote "${serverUrl}"`;
    } else if (hasDeno) {
      return `# mcp-remote requires Node.js — install Node.js 20+ to connect to HTTP MCP servers`;
    }
    return `# Install Node.js 20+ then: npx -y mcp-remote "${serverUrl}"`;
  }

  return "# STDIO server — run the server command directly in client config";
}
