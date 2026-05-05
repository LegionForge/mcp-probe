import { existsSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";
import type { InstalledClient, ClientId } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Detect which AI clients are installed on this machine
// ─────────────────────────────────────────────────────────────────────────────

interface ClientDef {
  id: ClientId;
  displayName: string;
  /** Paths to check for installation evidence (config file or app directory) */
  paths: Record<NodeJS.Platform, string[]>;
  /** The primary config file path for MCP servers */
  configPath: Record<NodeJS.Platform, string>;
}

const home = homedir();
const plat = platform();
const appSupport = join(home, "Library", "Application Support");

const CLIENT_DEFS: ClientDef[] = [
  {
    id: "claude-desktop",
    displayName: "Claude Desktop App",
    paths: {
      darwin: ["/Applications/Claude.app", join(appSupport, "Claude")],
      win32: [join(home, "AppData", "Roaming", "Claude")],
      linux: [join(home, ".config", "claude")],
      aix: [], android: [], freebsd: [], haiku: [], netbsd: [], openbsd: [], sunos: [], cygwin: [],
    },
    configPath: {
      darwin: join(appSupport, "Claude", "claude_desktop_config.json"),
      win32: join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json"),
      linux: join(home, ".config", "claude", "claude_desktop_config.json"),
      aix: "", android: "", freebsd: "", haiku: "", netbsd: "", openbsd: "", sunos: "", cygwin: "",
    },
  },
  {
    id: "claude-code",
    displayName: "Claude Code CLI",
    paths: {
      darwin: [join(home, ".claude")],
      win32: [join(home, ".claude")],
      linux: [join(home, ".claude")],
      aix: [], android: [], freebsd: [], haiku: [], netbsd: [], openbsd: [], sunos: [], cygwin: [],
    },
    configPath: {
      darwin: join(home, ".claude", "settings.json"),
      win32: join(home, ".claude", "settings.json"),
      linux: join(home, ".claude", "settings.json"),
      aix: "", android: "", freebsd: "", haiku: "", netbsd: "", openbsd: "", sunos: "", cygwin: "",
    },
  },
  {
    id: "vscode-native",
    displayName: "VS Code (native MCP, 1.99+)",
    paths: {
      darwin: ["/Applications/Visual Studio Code.app", join(appSupport, "Code")],
      win32: [join(home, "AppData", "Roaming", "Code")],
      linux: [join(home, ".config", "Code")],
      aix: [], android: [], freebsd: [], haiku: [], netbsd: [], openbsd: [], sunos: [], cygwin: [],
    },
    configPath: {
      darwin: join(appSupport, "Code", "User", "settings.json"),
      win32: join(home, "AppData", "Roaming", "Code", "User", "settings.json"),
      linux: join(home, ".config", "Code", "User", "settings.json"),
      aix: "", android: "", freebsd: "", haiku: "", netbsd: "", openbsd: "", sunos: "", cygwin: "",
    },
  },
  {
    id: "cursor",
    displayName: "Cursor",
    paths: {
      darwin: ["/Applications/Cursor.app", join(appSupport, "Cursor")],
      win32: [join(home, "AppData", "Roaming", "Cursor")],
      linux: [join(home, ".config", "Cursor")],
      aix: [], android: [], freebsd: [], haiku: [], netbsd: [], openbsd: [], sunos: [], cygwin: [],
    },
    configPath: {
      darwin: join(appSupport, "Cursor", "User", "globalStorage", "cursor.mcp", "mcp.json"),
      win32: join(home, "AppData", "Roaming", "Cursor", "User", "globalStorage", "cursor.mcp", "mcp.json"),
      linux: join(home, ".config", "Cursor", "User", "globalStorage", "cursor.mcp", "mcp.json"),
      aix: "", android: "", freebsd: "", haiku: "", netbsd: "", openbsd: "", sunos: "", cygwin: "",
    },
  },
  {
    id: "windsurf",
    displayName: "Windsurf (Codeium)",
    paths: {
      darwin: ["/Applications/Windsurf.app", join(home, ".codeium", "windsurf")],
      win32: [join(home, "AppData", "Roaming", "Windsurf")],
      linux: [join(home, ".codeium", "windsurf")],
      aix: [], android: [], freebsd: [], haiku: [], netbsd: [], openbsd: [], sunos: [], cygwin: [],
    },
    configPath: {
      darwin: join(home, ".codeium", "windsurf", "mcp_config.json"),
      win32: join(home, "AppData", "Roaming", "Windsurf", "mcp_config.json"),
      linux: join(home, ".codeium", "windsurf", "mcp_config.json"),
      aix: "", android: "", freebsd: "", haiku: "", netbsd: "", openbsd: "", sunos: "", cygwin: "",
    },
  },
  {
    id: "continue",
    displayName: "Continue.dev",
    paths: {
      darwin: [join(home, ".continue")],
      win32: [join(home, ".continue")],
      linux: [join(home, ".continue")],
      aix: [], android: [], freebsd: [], haiku: [], netbsd: [], openbsd: [], sunos: [], cygwin: [],
    },
    configPath: {
      darwin: join(home, ".continue", "config.json"),
      win32: join(home, ".continue", "config.json"),
      linux: join(home, ".continue", "config.json"),
      aix: "", android: "", freebsd: "", haiku: "", netbsd: "", openbsd: "", sunos: "", cygwin: "",
    },
  },
];

export function discoverClients(): InstalledClient[] {
  const installed: InstalledClient[] = [];

  for (const def of CLIENT_DEFS) {
    const paths = def.paths[plat] ?? [];
    const isInstalled = paths.some((p) => p && existsSync(p));
    if (!isInstalled) continue;

    const configPath = def.configPath[plat] ?? "";
    installed.push({ id: def.id, displayName: def.displayName, configPath });
  }

  return installed;
}

export function getConfigPathForClient(id: ClientId): string | undefined {
  const def = CLIENT_DEFS.find((d) => d.id === id);
  return def?.configPath[plat] || undefined;
}

export function getAllClientDefs(): typeof CLIENT_DEFS {
  return CLIENT_DEFS;
}
