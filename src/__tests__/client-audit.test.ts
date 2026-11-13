import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { auditClaudeCode } from "../audit/client-audit.js";

const server = { name: "demo", url: "http://127.0.0.1:8100/mcp" };
const entry = { command: "npx", args: ["-y", "mcp-remote", "http://127.0.0.1:8100/mcp"] };

let home: string;
let cwd: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mcp-probe-home-"));
  cwd = mkdtempSync(join(tmpdir(), "mcp-probe-cwd-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const writeJson = (path: string, v: unknown) => writeFileSync(path, JSON.stringify(v));

describe("auditClaudeCode", () => {
  it("reports not configured when no Claude Code MCP config exists", () => {
    const r = auditClaudeCode(server, cwd, home);
    expect(r.configured).toBe(false);
    expect(r.issues[0]).toContain("~/.claude.json");
  });

  it("finds a server in user scope (~/.claude.json mcpServers)", () => {
    writeJson(join(home, ".claude.json"), { mcpServers: { demo: entry } });
    expect(auditClaudeCode(server, cwd, home).configured).toBe(true);
  });

  it("finds a server in local scope (~/.claude.json projects[cwd])", () => {
    writeJson(join(home, ".claude.json"), { projects: { [cwd]: { mcpServers: { demo: entry } } } });
    expect(auditClaudeCode(server, cwd, home).configured).toBe(true);
  });

  it("does not match local-scope servers of a different project", () => {
    writeJson(join(home, ".claude.json"), { projects: { "/some/other/project": { mcpServers: { demo: entry } } } });
    expect(auditClaudeCode(server, cwd, home).configured).toBe(false);
  });

  it("finds a server in project scope (./.mcp.json)", () => {
    writeJson(join(cwd, ".mcp.json"), { mcpServers: { demo: entry } });
    expect(auditClaudeCode(server, cwd, home).configured).toBe(true);
  });

  it("ignores ~/.claude/settings.json, which does not hold MCP servers", () => {
    writeJson(join(home, ".claude.json"), { mcpServers: {} });
    expect(auditClaudeCode(server, cwd, home).configured).toBe(false);
  });

  it("points suggestions at ~/.claude.json when the server is missing", () => {
    writeJson(join(home, ".claude.json"), { mcpServers: { other: entry } });
    const r = auditClaudeCode(server, cwd, home);
    expect(r.configured).toBe(false);
    expect(r.suggestions.join(" ")).toContain("~/.claude.json");
    expect(r.suggestions.join(" ")).not.toContain("settings.json");
  });

  it("flags invalid JSON instead of crashing", () => {
    writeFileSync(join(home, ".claude.json"), "{ not json");
    const r = auditClaudeCode(server, cwd, home);
    expect(r.configured).toBe(false);
    expect(r.issues.join(" ")).toContain("invalid JSON");
  });
});
