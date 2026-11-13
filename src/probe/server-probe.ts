import type { ServerConfig, ServerProbeResult, CheckResult, Transport } from "../types.js";
import { buildAuthHeaders } from "../config.js";
import { VERSION } from "../version.js";

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

function validateServerUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `Not a valid URL: ${url}`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `URL must use http or https scheme, got: ${parsed.protocol}`;
  }
  return null;
}

interface RpcResult {
  ok: boolean;
  body: string;
  status: number;
  headers: Headers;
}

// Sends one JSON-RPC message. Pass `id: undefined` for a notification (no reply expected).
async function postRpc(
  url: string,
  method: string,
  params: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
  id?: number
): Promise<RpcResult> {
  const body = JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
  // codeql[js/file-access-to-http] mcp-probe reads server configs and probes them by design
    const res = await fetch(url, {
      method: "POST",
  // codeql[js/file-access-to-http] mcp-probe reads server configs and probes them by design
      headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream", ...headers },
  // codeql[js/file-access-to-http] mcp-probe reads server configs and probes them by design
      body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    return { ok: res.ok, body: text, status: res.status, headers: res.headers };
  } catch (e) {
    return { ok: false, body: String(e), status: 0, headers: new Headers() };
  } finally {
    clearTimeout(timer);
  }
}

// Opens the SSE stream and reads only the first chunk: a real SSE stream never
// closes, so awaiting the whole body would just run into the abort timeout.
async function getSSE(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ ok: boolean; body: string; status: number; contentType: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, 3000));
  try {
  // codeql[js/file-access-to-http] mcp-probe reads server configs and probes them by design
    const res = await fetch(url, {
      method: "GET",
  // codeql[js/file-access-to-http] mcp-probe reads server configs and probes them by design
      headers: { Accept: "text/event-stream", ...headers },
      signal: ctrl.signal,
    });
    const contentType = res.headers.get("content-type") ?? "";
    let body = "";
    if (res.body) {
      const reader = res.body.getReader();
      try {
        const { value } = await reader.read();
        if (value) body = new TextDecoder().decode(value);
      } catch {
        // aborted before the first chunk; the content-type alone can still identify SSE
      } finally {
        ctrl.abort();
        reader.cancel().catch(() => undefined);
      }
    }
    return { ok: res.ok, body, status: res.status, contentType };
  } catch {
    return { ok: false, body: "", status: 0, contentType: "" };
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

interface RpcMessage {
  result?: Record<string, unknown>;
  error?: { message?: string };
}

// A reply is either plain JSON or SSE ("data: {...}" lines); return the first JSON-RPC message.
function parseRpc(text: string): RpcMessage | null {
  const candidates = [text, ...text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5))];
  for (const c of candidates) {
    try {
      const v = JSON.parse(c.trim()) as RpcMessage;
      if (v && typeof v === "object" && ("result" in v || "error" in v)) return v;
    } catch {
      // not JSON; try the next candidate
    }
  }
  return null;
}

interface ToolInfo {
  name: string;
  readOnly: boolean;
}

function parseTools(text: string): ToolInfo[] {
  const list = parseRpc(text)?.result?.tools;
  if (Array.isArray(list)) {
    return list
      .filter((t): t is { name: string; annotations?: { readOnlyHint?: boolean } } => typeof t?.name === "string")
      .map((t) => ({ name: t.name, readOnly: t.annotations?.readOnlyHint === true }));
  }
  return extractTools(text).map((name) => ({ name, readOnly: false }));
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
  let toolInfo: ToolInfo[] = [];
  let sessionHeaders: Record<string, string> = {};

  const ts = new Date().toISOString();

  // ── URL validation ───────────────────────────────────────────────────────────
  const urlError = validateServerUrl(server.url);
  if (urlError) {
    checks.push(check("url-validation", "fail", urlError));
    return buildResult(server, ts, detectedTransport, checks, discoveredTools);
  }

  // ── T01: Reachability ────────────────────────────────────────────────────────
  const reachRes = await (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
  // codeql[js/file-access-to-http] mcp-probe reads server configs and probes them by design
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
  // codeql[js/file-access-to-http] mcp-probe reads server configs and probes them by design
      const badRes = await fetch(server.url, {
        method: "GET",
  // codeql[js/file-access-to-http] mcp-probe reads server configs and probes them by design
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
  // codeql[js/file-access-to-http] mcp-probe reads server configs and probes them by design
      const goodRes = await fetch(server.url, {
        method: "GET",
  // codeql[js/file-access-to-http] mcp-probe reads server configs and probes them by design
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
    clientInfo: { name: "mcp-probe", version: VERSION },
  };

  let initResponse = "";

  const httpProbe = await postRpc(server.url, "initialize", initParams, authHeaders, timeoutMs, 1);
  if (httpProbe.body.includes('"protocolVersion"')) {
    detectedTransport = "streamable-http";
    initResponse = httpProbe.body;
    // Stateful servers hand out a session id that every later request must carry.
    const sessionId = httpProbe.headers.get("mcp-session-id");
    if (sessionId) sessionHeaders = { "Mcp-Session-Id": sessionId };
  } else {
    const sseProbe = await getSSE(server.url, authHeaders, 3000);
    if (
      sseProbe.ok &&
      (sseProbe.contentType.includes("text/event-stream") ||
        sseProbe.body.includes("event:") ||
        sseProbe.body.includes("data:"))
    ) {
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
  const proto = extractJsonField(initResponse, "protocolVersion");
  const srvName = extractJsonField(initResponse, "name");
  const srvVer = extractJsonField(initResponse, "version");

  if (proto) {
    checks.push(check("handshake", "pass", `Handshake OK — protocol ${proto}, server "${srvName}" ${srvVer}`));
    // Complete the handshake, then send the negotiated version and session id on every request.
    const rpcHeaders = { ...authHeaders, ...sessionHeaders, "MCP-Protocol-Version": proto };
    await postRpc(server.url, "notifications/initialized", undefined, rpcHeaders, timeoutMs);
    sessionHeaders = { ...sessionHeaders, "MCP-Protocol-Version": proto };
  } else if (initResponse.includes('"error"')) {
    const errMsg = extractJsonField(initResponse, "message");
    checks.push(check("handshake", "fail", `Server error: ${errMsg ?? "unknown"}`));
    return buildResult(server, ts, detectedTransport, checks, discoveredTools);
  } else {
    checks.push(check("handshake", "fail", `No MCP response to initialize`));
    return buildResult(server, ts, detectedTransport, checks, discoveredTools);
  }

  // ── T05: Tool discovery ──────────────────────────────────────────────────────
  const rpcHeaders = { ...authHeaders, ...sessionHeaders };
  const toolsRes = await postRpc(server.url, "tools/list", {}, rpcHeaders, timeoutMs, 2);
  toolInfo = parseTools(toolsRes.body);
  discoveredTools = toolInfo.map((t) => t.name);

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
  // Only call a tool we know is safe to call: the configured testTool, or a tool
  // that advertises readOnlyHint. Never guess: the first tool could write or delete.
  const readOnlyTool = toolInfo.find((t) => t.readOnly);
  const testTool = server.testTool ?? (readOnlyTool ? { name: readOnlyTool.name, args: {} } : null);
  if (testTool) {
    const invokeParams = { name: testTool.name, arguments: testTool.args ?? {} };
    const invokeRes = await postRpc(server.url, "tools/call", invokeParams, rpcHeaders, timeoutMs, 3);
    const msg = parseRpc(invokeRes.body);
    const result = msg?.result as { isError?: boolean; content?: { text?: string }[] } | undefined;

    if (msg?.error) {
      checks.push(check("tool-invocation", "fail", `Tool error: ${msg.error.message ?? "unknown"}`));
    } else if (result?.isError === true) {
      const text = result.content?.find((c) => typeof c.text === "string")?.text;
      checks.push(check("tool-invocation", "fail", `Tool "${testTool.name}" returned an error result`, text?.slice(0, 80)));
    } else if (result) {
      const preview = result.content?.find((c) => typeof c.text === "string")?.text?.slice(0, 80);
      checks.push(check("tool-invocation", "pass", `Tool "${testTool.name}" invoked successfully`, preview));
    } else {
      checks.push(check("tool-invocation", "warn", `Tool "${testTool.name}" returned unexpected shape`));
    }
  } else if (discoveredTools.length > 0) {
    checks.push(check("tool-invocation", "skip", "No testTool configured and no tool advertises readOnlyHint — not calling an unknown tool (set testTool to enable)"));
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
