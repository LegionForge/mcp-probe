import { describe, it, expect } from "vitest";
import { generateRecommendations } from "../advisor/recommendations.js";
import type { ServerConfig, ServerProbeResult, ClientAuditResult, RuntimeInfo } from "../types.js";

const server: ServerConfig = {
  name: "ob1",
  url: "http://localhost:8100/mcp",
  auth: { header: "x-brain-key", key: "test-key" },
};

const passingProbe: ServerProbeResult = {
  server: "ob1", url: server.url, timestamp: new Date().toISOString(),
  transport: "streamable-http",
  checks: [{ name: "reachability", status: "pass", message: "OK" }],
  tools: ["search_thoughts"], passed: 1, failed: 0, warned: 0, skipped: 0,
};

const nodeRuntime: RuntimeInfo = {
  name: "Node.js / npx", command: "node", version: "v20.0.0", available: true,
  mcpRelevance: "Primary runtime",
};

const noNodeRuntime: RuntimeInfo = {
  name: "Node.js / npx", command: "node", version: "", available: false,
  mcpRelevance: "Primary runtime",
};

function makeAudit(configured: boolean): ClientAuditResult {
  return {
    clientId: "claude-desktop",
    displayName: "Claude Desktop App",
    installed: true,
    serverWiring: {
      ob1: { configured, processRunning: configured, logHealthy: configured ? true : null, issues: [], suggestions: [] },
    },
  };
}

describe("generateRecommendations", () => {
  it("returns no recommendations when everything is configured", () => {
    const recs = generateRecommendations([server], [passingProbe], [makeAudit(true)], [nodeRuntime]);
    // No wiring issues, no runtime issues, no probe failures
    const required = recs.filter((r) => r.severity === "required");
    expect(required).toHaveLength(0);
  });

  it("generates a required recommendation when server missing from client config", () => {
    const audit = makeAudit(false);
    audit.serverWiring["ob1"].issues = ['Server "ob1" not in mcpServers'];

    const recs = generateRecommendations([server], [passingProbe], [audit], [nodeRuntime]);
    const wiring = recs.find((r) => r.client === "claude-desktop" && r.server === "ob1");

    expect(wiring).toBeDefined();
    expect(wiring?.severity).toBe("required");
    expect(wiring?.configSnippet).toContain("ob1");
    expect(wiring?.configSnippet).toContain("claude_desktop_config.json");
  });

  it("config snippet for claude-desktop uses npx mcp-remote", () => {
    const audit = makeAudit(false);
    const recs = generateRecommendations([server], [passingProbe], [audit], [nodeRuntime]);
    const rec = recs.find((r) => r.client === "claude-desktop");

    expect(rec?.configSnippet).toContain("npx");
    expect(rec?.configSnippet).toContain("mcp-remote");
    expect(rec?.configSnippet).toContain("http://localhost:8100/mcp");
  });

  it("generates a runtime recommendation when Node.js is missing", () => {
    const recs = generateRecommendations([server], [passingProbe], [makeAudit(true)], [noNodeRuntime]);
    const runtime = recs.find((r) => r.action === "install-runtime");

    expect(runtime).toBeDefined();
    expect(runtime?.severity).toBe("required");
    expect(runtime?.title).toMatch(/node/i);
  });

  it("generates a probe failure recommendation for unreachable server", () => {
    const failedProbe: ServerProbeResult = {
      ...passingProbe,
      checks: [{ name: "reachability", status: "fail", message: "Server unreachable" }],
      passed: 0, failed: 1,
    };
    const recs = generateRecommendations([server], [failedProbe], [makeAudit(true)], [nodeRuntime]);
    const reach = recs.find((r) => r.server === "ob1" && r.title.includes("unreachable"));

    expect(reach).toBeDefined();
    expect(reach?.severity).toBe("required");
  });

  it("skips recommendations for non-installed clients", () => {
    const notInstalled: ClientAuditResult = {
      clientId: "cursor",
      displayName: "Cursor",
      installed: false,
      serverWiring: { ob1: { configured: false, processRunning: false, logHealthy: null, issues: [], suggestions: [] } },
    };
    const recs = generateRecommendations([server], [passingProbe], [notInstalled], [nodeRuntime]);
    const cursorRecs = recs.filter((r) => r.client === "cursor");
    expect(cursorRecs).toHaveLength(0);
  });
});
