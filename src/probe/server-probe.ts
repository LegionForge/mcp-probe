import type { ServerConfig, ServerProbeResult, CheckResult, Transport } from "../types.js";
import { buildAuthHeaders } from "../config.js";

// ─────────────────────────────────────────────────────────────────────────────
// MCP server protocol probe — transport-agnostic, no external deps beyond fetch
// ─────────────────────────────────────────────────────────────────────────────

function check(
  name: string,
  status: CheckResult["status"],
  message: string,
  detail?: string
): CheckResult {
  return { name, status, message, detail };
}

async function postRpc(
  url: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ ok: boolean; body: string; status: number }> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", ...headers },
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { ok: res.ok, body: text, status: res.status };
  } catch (e) {
    return { ok: false, body: String(e), status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function getSSE(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ ok: boolean; body: string; status: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 3000));
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/event-stream", ...headers },
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, body: text, status: res.status };
  } catch {
    return { ok: false, body: "", status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function extractJsonField(text: string, field: string): string | undefined {
  const m = text.match(new RegExp(`"${field}":\\s*"([^"]+)"`));
  return m?.[1];
}

function extractTools(text: string): string[] {
  const names: string[] = [];
  const re = /"name":\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) names.push(m[1]);
  return [...new Set(names)];
}

// ─────────────────────────────────────────────────────────────────────────────

export async function probeServer(
  server: ServerConfig,
  timeoutMs = 8000
): Promise<ServerProbeResult> {
  const checks: CheckResult[] = [];
  const authHeaders = buildAuthHeaders(server);
  let detectedTransport: Transport = "unknown";
  let discoveredTools: string[] = [];

  const ts = new Date().toISOString();

  // ── T01: Reachability ────────────────────────────────────────────────────────
  const reachRes = await (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(server.url, { method: "GET", signal: ctrl.signal });
      return { status: r.status, error: null };
    } catch (e) {
      return { status: 0, error: String(e) };
    } finally {
      clearTimeout(timer);
    }
  })();

  if (reachRes.status === 0) {
    checks.push(check("reachability", "fail", `Server unreachable at ${server.url}`, reachRes.error ?? undefined));
    return buildResult(server, ts, detectedTransport, checks, discoveredTools);
  }
  checks.push(check("reachability", "pass", `Server responding (HTTP ${reachRes.status})`));

  // ── T02: Authentication ──────────────────────────────────────────────────────
  if (server.auth?.header) {
    const authKey = authHeaders[server.auth.header];
    if (!authKey) {
      checks.push(check("auth-key", "warn", `Auth header "${server.auth.header}" configured but key could not be resolved`));
    } else {
      // Bad key should get 401/403
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const badRes = await fetch(server.url, {
        method: "GET",
        headers: { [server.auth.header]: "mcp-probe-bad-key-test" },
        signal: ctrl.signal,
      }).catch(() => null).finally(() => clearTimeout(t));

      if (badRes && (badRes.status === 401 || badRes.status === 403)) {
        checks.push(check("auth-rejection", "pass", `Rejects bad key (HTTP ${badRes.status})`));
      } else {
        checks.push(check("auth-rejection", "warn", `Bad key returned HTTP ${badRes?.status ?? 0} — auth may not be enforced`));
      }

      // Good key
      const ctrl2 = new AbortController();
      const t2 = setTimeout(() => ctrl2.abort(), timeoutMs);
      const goodRes = await fetch(server.url, {
        method: "GET",
        headers: { [server.auth.header]: authKey },
        signal: ctrl2.signal,
      }).catch(() => null).finally(() => clearTimeout(t2));

      if (goodRes && goodRes.status !== 401 && goodRes.status !== 403) {
        checks.push(check("auth-acceptance", "pass", `Accepts valid key (HTTP ${goodRes.status})`));
      } else {
        checks.push(check("auth-acceptance", "fail", `Valid key rejected (HTTP ${goodRes?.status ?? 0}) — check key value and header name`));
      }
    }
  } else {
    checks.push(check("auth", "skip", "No auth configured (open server)"));
  }

  // ── T03: Transport detection ─────────────────────────────────────────────────
  const initParams = {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "mcp-probe", version: "0.1.0" },
  };

  let initResponse = "";

  const httpProbe = await postRpc(server.url, "initialize", initParams, authHeaders, timeoutMs);
  if (httpProbe.body.includes('"protocolVersion"')) {
    detectedTransport = "streamable-http";
    initResponse = httpProbe.body;
  } else {
    const sseProbe = await getSSE(server.url, authHeaders, 3000);
    if (sseProbe.body.includes("event:") || sseProbe.body.includes("data:")) {
      detectedTransport = "sse";
    }
  }

  if (detectedTransport === "unknown") {
    checks.push(check("transport", "fail", "Cannot identify MCP transport — server not speaking MCP on this URL"));
    return buildResult(server, ts, detectedTransport, checks, discoveredTools);
  }

  const transportLabel =
    detectedTransport === "streamable-http"
      ? "Streamable HTTP (MCP 2024-11-05+, --transport http-only)"
      : "Legacy SSE (pre-2024-11-05, --transport sse-only)";
  checks.push(check("transport", "pass", `Transport: ${transportLabel}`));

  // SSE: cannot run full protocol tests without mcp-remote proxy
  if (detectedTransport === "sse") {
    checks.push(check("handshake", "skip", "SSE server — full protocol tests require mcp-remote proxy"));
    checks.push(check("tool-discovery", "skip", "SSE server — connect via mcp-remote to list tools"));
    return buildResult(server, ts, detectedTransport, checks, discoveredTools);
  }

  // ── T04: Handshake ───────────────────────────────────────────────────────────
  if (!initResponse) {
    const r = await postRpc(server.url, "initialize", initParams, authHeaders, timeoutMs);
    initResponse = r.body;
  }
  const proto = extractJsonField(initResponse, "protocolVersion");
  const srvName = extractJsonField(initResponse, "name");
  const srvVer = extractJsonField(initResponse, "version");

  if (proto) {
    checks.push(check("handshake", "pass", `Handshake OK — protocol ${proto}, server "${srvName}" ${srvVer}`));
  } else if (initResponse.includes('"error"')) {
    const errMsg = extractJsonField(initResponse, "message");
    checks.push(check("handshake", "fail", `Server error: ${errMsg ?? "unknown"}`));
    return buildResult(server, ts, detectedTransport, checks, discoveredTools);
  } else {
    checks.push(check("handshake", "fail", `No MCP response to initialize`));
    return buildResult(server, ts, detectedTransport, checks, discoveredTools);
  }

  // ── T05: Tool discovery ──────────────────────────────────────────────────────
  const toolsRes = await postRpc(server.url, "tools/list", {}, authHeaders, timeoutMs);
  discoveredTools = extractTools(toolsRes.body);

  if (discoveredTools.length > 0) {
    checks.push(check("tool-discovery", "pass", `Discovered ${discoveredTools.length} tool(s): ${discoveredTools.join(", ")}`));
  } else {
    checks.push(check("tool-discovery", "fail", "No tools returned from tools/list"));
  }

  // ── T06: Expected tools ──────────────────────────────────────────────────────
  if (server.expectedTools && server.expectedTools.length > 0) {
    for (const expected of server.expectedTools) {
      if (discoveredTools.includes(expected)) {
        checks.push(check(`tool:${expected}`, "pass", `Tool present: ${expected}`));
      } else {
        checks.push(check(`tool:${expected}`, "fail", `Tool missing: ${expected}`));
      }
    }
  }

  // ── T07: Tool invocation ─────────────────────────────────────────────────────
  const testTool = server.testTool ?? (discoveredTools.length > 0 ? { name: discoveredTools[0], args: {} } : null);
  if (testTool) {
    // Find a read-only tool to invoke — prefer tools with readOnlyHint
    const invokeParams = { name: testTool.name, arguments: testTool.args ?? {} };
    const invokeRes = await postRpc(server.url, "tools/call", invokeParams, authHeaders, timeoutMs);

    if (invokeRes.body.includes('"content"') || invokeRes.body.includes('"result"')) {
      const preview = invokeRes.body.match(/"text":\s*"([^"]{1,80})/)?.[1] ?? "";
      checks.push(check("tool-invocation", "pass", `Tool "${testTool.name}" invoked successfully`, preview || undefined));
    } else if (invokeRes.body.includes('"error"')) {
      const msg = extractJsonField(invokeRes.body, "message");
      checks.push(check("tool-invocation", "fail", `Tool error: ${msg ?? "unknown"}`));
    } else {
      checks.push(check("tool-invocation", "warn", `Tool "${testTool.name}" returned unexpected shape`));
    }
  } else {
    checks.push(check("tool-invocation", "skip", "No tools available to invoke"));
  }

  return buildResult(server, ts, detectedTransport, checks, discoveredTools);
}

function buildResult(
  server: ServerConfig,
  timestamp: string,
  transport: Transport,
  checks: CheckResult[],
  tools: string[]
): ServerProbeResult {
  return {
    server: server.name,
    url: server.url,
    timestamp,
    transport,
    checks,
    tools,
    passed: checks.filter((c) => c.status === "pass").length,
    failed: checks.filter((c) => c.status === "fail").length,
    warned: checks.filter((c) => c.status === "warn").length,
    skipped: checks.filter((c) => c.status === "skip").length,
  };
}
