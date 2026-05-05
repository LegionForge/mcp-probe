import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { execSync } from "child_process";
import type { ProbeConfig, ServerConfig, ServerAuth } from "./types.js";

const CONFIG_NAMES = [".mcp-probe.json", "mcp-probe.json", "mcp-probe.config.json"];

export function loadConfig(configPath?: string): ProbeConfig {
  const candidates = configPath
    ? [configPath]
    : CONFIG_NAMES.map((n) => resolve(process.cwd(), n));

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, "utf-8");
        return JSON.parse(raw) as ProbeConfig;
      } catch (e) {
        throw new Error(`Failed to parse config at ${p}: ${(e as Error).message}`);
      }
    }
  }

  return { servers: [] };
}

export function resolveAuth(auth: ServerAuth): string | undefined {
  if (auth.key) return auth.key;

  if (auth.keyFrom === "env" && auth.envVar) {
    return process.env[auth.envVar];
  }

  if (auth.keyFrom === "keychain" && auth.keychainService && auth.keychainAccount) {
    try {
      const key = execSync(
        `security find-generic-password -s "${auth.keychainService}" -a "${auth.keychainAccount}" -w`,
        { stdio: ["pipe", "pipe", "pipe"] }
      )
        .toString()
        .trim();
      return key || undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function buildAuthHeaders(server: ServerConfig): Record<string, string> {
  if (!server.auth) return {};
  const key = resolveAuth(server.auth);
  if (!key) return {};
  return { [server.auth.header]: key };
}

export function defaultConfig(): ProbeConfig {
  return {
    servers: [],
    ui: { port: 4242, host: "localhost" },
    defaults: { timeout: 8000 },
  };
}
