import { spawnSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
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
    const result = spawnSync(command, [versionArg], { stdio: "pipe" });
    if (result.status !== 0 || result.error) return null;
    const out = result.stdout?.toString().trim().split("\n")[0] ?? "";
    return out || null;
  } catch {
    return null;
  }
}

function parseMajorVersion(versionString: string): number | null {
  const match = versionString.match(/v?(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// Detect Node version managers - requested by user who has experienced
// painful version switch bugs (forgetting to switch back after testing with older versions)
function detectNodeVersionManager(): "nvm" | "asdf" | "fnm" | "volta" | null {
  const home = homedir();
  if (existsSync(join(home, ".nvm", "versions", "node"))) return "nvm";
  if (existsSync(join(home, ".asdf", "installs", "nodejs"))) return "asdf";
  if (existsSync(join(home, ".fnm", "node-versions"))) return "fnm";
  if (existsSync(join(home, ".volta", "tools", "image", "node"))) return "volta";
  return null;
}

// Detect Python environment - prevents editing the wrong environment
// (system vs venv vs conda) which has caused real damage in the past
function detectPythonEnvironment(): { active: string; location: string; warnings: string[] } {
  const warnings: string[] = [];
  const home = homedir();

  // Check if in a venv
  const venvPath = process.env.VIRTUAL_ENV;
  if (venvPath) {
    return {
      active: `venv (${venvPath})`,
      location: venvPath,
      warnings,
    };
  }

  // Check if in conda environment
  const condaEnv = process.env.CONDA_PREFIX;
  const condaEnvName = process.env.CONDA_DEFAULT_ENV;
  if (condaEnv) {
    return {
      active: `conda (${condaEnvName || "base"})`,
      location: condaEnv,
      warnings,
    };
  }

  // No active venv or conda - using system or managed Python
  // Detect which managers are installed
  const pythonPath = tryVersion("python3", "-c 'import sys; print(sys.executable)'") ||
    spawnSync("which", ["python3"], { stdio: "pipe" }).stdout?.toString().trim();

  const managers: string[] = [];
  if (existsSync(join(home, ".pyenv", "versions"))) managers.push("pyenv");
  if (existsSync(join(home, ".asdf", "installs", "python"))) managers.push("asdf");
  if (existsSync(join(home, ".conda"))) managers.push("conda");
  if (existsSync(join(home, ".local", "bin", "uv"))) managers.push("uv");

  if (managers.length > 1) {
    warnings.push(`Multiple Python managers detected (${managers.join(", ")}) — verify correct one is active`);
  }

  return {
    active: pythonPath ? `system/managed (${pythonPath})` : "unknown",
    location: pythonPath || "unknown",
    warnings,
  };
}

function getAvailableNodeVersions(manager: "nvm" | "asdf" | "fnm" | "volta"): string[] {
  const home = homedir();
  try {
    let dir = "";
    switch (manager) {
      case "nvm":
        dir = join(home, ".nvm", "versions", "node");
        break;
      case "asdf":
        dir = join(home, ".asdf", "installs", "nodejs");
        break;
      case "fnm":
        dir = join(home, ".fnm", "node-versions");
        break;
      case "volta":
        dir = join(home, ".volta", "tools", "image", "node");
        break;
    }
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((v) => v.startsWith("v") || /^\d+/.test(v))
      .sort()
      .reverse()
      .slice(0, 5);
  } catch {
    return [];
  }
}

function tryVersionHybrid(command: string, versionArg: string, paths: string[]): string | null {
  // Try PATH first
  const fromPath = tryVersion(command, versionArg);
  if (fromPath) return fromPath;

  // Fall back to known install paths
  const home = homedir();
  for (const path of paths) {
    const expandedPath = path.replace("~", home);
    if (existsSync(expandedPath)) {
      const result = spawnSync(expandedPath, [versionArg], { stdio: "pipe" });
      if (result.status === 0 && !result.error) {
        const out = result.stdout?.toString().trim().split("\n")[0] ?? "";
        if (out) return out;
      }
    }
  }

  return null;
}

export function detectRuntimes(): RuntimeInfo[] {
  const commonPaths: Record<string, string[]> = {
    deno: ["~/.deno/bin/deno", "/usr/local/bin/deno", "/opt/deno"],
    python3: ["/usr/bin/python3", "/usr/local/bin/python3", "/opt/python/bin/python3"],
    uvx: ["~/.local/bin/uvx", "/usr/local/bin/uvx", "/opt/uv/bin/uvx"],
    docker: ["/usr/bin/docker", "/usr/local/bin/docker", "/Applications/Docker.app/Contents/Resources/bin/docker"],
    bun: ["~/.bun/bin/bun", "/usr/local/bin/bun", "/opt/bun/bin/bun"],
  };

  return RUNTIMES.map((r) => {
    // Use hybrid detection for optional runtimes
    const version = ["deno", "python3", "uvx", "docker", "bun"].includes(r.command)
      ? tryVersionHybrid(r.command, r.versionArg, commonPaths[r.command] || [])
      : tryVersion(r.command, r.versionArg);

    const result: RuntimeInfo = {
      name: r.name,
      command: r.command,
      version: version ?? "",
      available: version !== null,
      mcpRelevance: r.mcpRelevance,
    };

    // Special handling for Node.js: check version and detect manager
    if (r.command === "node" && version) {
      const majorVersion = parseMajorVersion(version);
      if (majorVersion !== null && majorVersion < 20) {
        result.warning = `Node ${majorVersion} detected, but mcp-probe requires Node 20+`;
        const manager = detectNodeVersionManager();
        if (manager) {
          result.versionManager = manager;
          result.availableVersions = getAvailableNodeVersions(manager);
          const v20 = result.availableVersions?.find((v) => v.startsWith("v20") || v.startsWith("20"));
          if (v20) {
            result.suggestion = `${manager} use ${v20.replace("v", "")}`;
          }
        }
      }
    }

    // Special handling for Python: detect active environment (venv, conda, system)
    if (r.command === "python3" && version) {
      const pythonEnv = detectPythonEnvironment();
      result.environment = {
        active: pythonEnv.active,
        location: pythonEnv.location,
      };
      if (pythonEnv.warnings.length > 0) {
        result.environmentWarnings = pythonEnv.warnings;
      }
    }

    return result;
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
