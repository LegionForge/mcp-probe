import { describe, it, expect, vi, beforeEach } from "vitest";

// probeServer is exercised through a mocked global fetch. The mock routes on
// the request (method + JSON-RPC method) instead of a fixed response order, so
// tests do not depend on how many requests the probe makes.

const INIT_RESPONSE_SSE = `event: message
data: {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"test-server","version":"1.2.3"}},"jsonrpc":"2.0","id":1}
`;

const TOOLS_RESPONSE = `event: message
data: {"result":{"tools":[{"name":"search_thoughts","description":"Search"},{"name":"list_thoughts","description":"List"},{"name":"capture_thought","description":"Capture"}]},"jsonrpc":"2.0","id":2}
`;

const ERROR_RESPONSE = `event: message
data: {"error":{"code":-32700,"message":"Parse error","data":"Unexpected token"},"jsonrpc":"2.0","id":null}
`;

const CALL_OK = 'data: {"result":{"content":[{"type":"text","text":"Found 1 result"}]}}';

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

type Handler = (req: { method: string; rpc?: { id?: number; method?: string }; headers: Headers }) => Response;

function res(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

// Never-closing stream, like a real SSE endpoint.
function openSse(firstChunk: string): Response {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(firstChunk));
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function serve(handler: Handler) {
  mockFetch.mockImplementation(async (_url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const rpc = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    return handler({ method: init.method ?? "GET", rpc, headers });
  });
}

// A well-behaved streamable-HTTP server; individual tests override parts of it.
function mcpServer(over: Partial<Record<string, (req: Parameters<Handler>[0]) => Response>> = {}): Handler {
  return (req) => {
    if (req.method === "GET") return over.get?.(req) ?? res("", 401);
    const h = over[req.rpc?.method ?? ""];
    if (h) return h(req);
    switch (req.rpc?.method) {
      case "initialize": return res(INIT_RESPONSE_SSE);
      case "notifications/initialized": return res("", 202);
      case "tools/list": return res(TOOLS_RESPONSE);
      case "tools/call": return res(CALL_OK);
      default: return res("", 404);
    }
  };
}

const rpcCalls = () =>
  mockFetch.mock.calls
    .map(([, init]) => (typeof init?.body === "string" ? (JSON.parse(init.body) as { id?: number; method: string }) : null))
    .filter((c): c is { id?: number; method: string } => c !== null);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("probeServer", () => {
  // Dynamic import so the global fetch mock is in place before the module loads
  const getProbe = () => import("../probe/server-probe.js").then((m) => m.probeServer);

  it("fails fast when server is unreachable", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed"));
    const probe = await getProbe();

    const result = await probe({ name: "dead", url: "http://localhost:19999/mcp" });

    expect(result.failed).toBeGreaterThan(0);
    const reach = result.checks.find((c) => c.name === "reachability");
    expect(reach?.status).toBe("fail");
  });

  it("detects Streamable HTTP transport from POST initialize response", async () => {
    serve(mcpServer());
    const probe = await getProbe();
    const result = await probe({
      name: "test",
      url: "http://localhost:8100/mcp",
      expectedTools: ["search_thoughts"],
      testTool: { name: "search_thoughts", args: { query: "test" } },
    });

    expect(result.transport).toBe("streamable-http");
    expect(result.checks.find((c) => c.name === "transport")?.status).toBe("pass");
    expect(result.checks.find((c) => c.name === "tool-invocation")?.status).toBe("pass");
  });

  it("discovers tools from tools/list response", async () => {
    serve(mcpServer());
    const probe = await getProbe();
    const result = await probe({ name: "test", url: "http://localhost:8100/mcp" });

    expect(result.tools).toEqual(["search_thoughts", "list_thoughts", "capture_thought"]);
  });

  it("does not count property names in input schemas as tools", async () => {
    const withSchema =
      'data: {"result":{"tools":[{"name":"only_tool","inputSchema":{"type":"object","properties":{"name":{"type":"string"}}}}]}}';
    serve(mcpServer({ "tools/list": () => res(withSchema) }));
    const probe = await getProbe();
    const result = await probe({ name: "test", url: "http://localhost:8100/mcp" });

    expect(result.tools).toEqual(["only_tool"]);
  });

  it("fails expected tool check when tool is missing", async () => {
    serve(mcpServer());
    const probe = await getProbe();
    const result = await probe({
      name: "test",
      url: "http://localhost:8100/mcp",
      expectedTools: ["search_thoughts", "nonexistent_tool"],
    });

    expect(result.checks.find((c) => c.name === "tool:nonexistent_tool")?.status).toBe("fail");
    expect(result.checks.find((c) => c.name === "tool:search_thoughts")?.status).toBe("pass");
  });

  it("rejects bad auth key", async () => {
    serve((req) => {
      if (req.method === "GET") {
        // no key / bad key -> 401; valid key -> 406 (auth passed, wrong accept)
        return res("", req.headers.get("x-api-key") === "valid-key" ? 406 : 401);
      }
      return mcpServer()(req);
    });
    const probe = await getProbe();
    const result = await probe({
      name: "test",
      url: "http://localhost:8100/mcp",
      auth: { header: "x-api-key", key: "valid-key" },
    });

    expect(result.checks.find((c) => c.name === "auth-rejection")?.status).toBe("pass");
    expect(result.checks.find((c) => c.name === "auth-acceptance")?.status).toBe("pass");
  });

  it("detects legacy SSE transport and skips protocol tests", async () => {
    serve((req) => {
      if (req.method === "POST") return res("not json");
      return req.headers.get("accept") === "text/event-stream"
        ? res("event: endpoint\ndata: /messages?session_id=abc123\n", 200, { "content-type": "text/event-stream" })
        : res("");
    });
    const probe = await getProbe();
    const result = await probe({ name: "obs", url: "http://localhost:22360/sse" });

    expect(result.transport).toBe("sse");
    expect(result.checks.find((c) => c.name === "transport")?.status).toBe("pass");
    expect(result.checks.find((c) => c.name === "handshake")?.status).toBe("skip");
  });

  it("detects a legacy SSE server whose stream never closes", async () => {
    serve((req) => {
      if (req.method === "POST") return res("not json");
      return req.headers.get("accept") === "text/event-stream" ? openSse("event: endpoint\ndata: /messages\n\n") : res("");
    });
    const probe = await getProbe();
    const started = Date.now();
    const result = await probe({ name: "obs", url: "http://localhost:22360/sse" });

    expect(result.transport).toBe("sse");
    expect(Date.now() - started).toBeLessThan(2000); // must not wait out the 3 s abort
  });

  it("handles server-returned MCP error gracefully", async () => {
    serve((req) => {
      if (req.method === "POST") return res(ERROR_RESPONSE);
      return req.headers.get("accept") === "text/event-stream" ? res("", 405) : res("", 401);
    });
    const probe = await getProbe();
    const result = await probe({ name: "broken", url: "http://localhost:8100/mcp" });

    expect(result.transport).toBe("unknown");
    expect(result.failed).toBeGreaterThan(0);
  });
});

describe("probeServer — stateful servers", () => {
  const getProbe = () => import("../probe/server-probe.js").then((m) => m.probeServer);

  // Rejects anything after initialize that lacks the session header, like the SDK's default transport.
  function stateful() {
    return mcpServer({
      initialize: () => res(INIT_RESPONSE_SSE, 200, { "mcp-session-id": "sess-1" }),
      "tools/list": (req) => (req.headers.get("mcp-session-id") === "sess-1" ? res(TOOLS_RESPONSE) : res("Bad Request", 400)),
      "tools/call": (req) => (req.headers.get("mcp-session-id") === "sess-1" ? res(CALL_OK) : res("Bad Request", 400)),
    });
  }

  it("sends Mcp-Session-Id on later requests", async () => {
    serve(stateful());
    const probe = await getProbe();
    const result = await probe({
      name: "s",
      url: "http://localhost:8100/mcp",
      testTool: { name: "search_thoughts", args: {} },
    });

    expect(result.checks.find((c) => c.name === "tool-discovery")?.status).toBe("pass");
    expect(result.checks.find((c) => c.name === "tool-invocation")?.status).toBe("pass");
  });

  it("sends notifications/initialized after initialize, without an id", async () => {
    serve(stateful());
    const probe = await getProbe();
    await probe({ name: "s", url: "http://localhost:8100/mcp" });

    const methods = rpcCalls().map((c) => c.method);
    expect(methods.indexOf("notifications/initialized")).toBe(methods.indexOf("initialize") + 1);
    expect(rpcCalls().find((c) => c.method === "notifications/initialized")).not.toHaveProperty("id");
  });

  it("uses a distinct id for each request", async () => {
    serve(stateful());
    const probe = await getProbe();
    await probe({ name: "s", url: "http://localhost:8100/mcp", testTool: { name: "search_thoughts", args: {} } });

    const ids = rpcCalls().filter((c) => c.id !== undefined).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("probeServer — tool invocation safety", () => {
  const getProbe = () => import("../probe/server-probe.js").then((m) => m.probeServer);
  const callsToTools = () => rpcCalls().filter((c) => c.method === "tools/call");

  it("does not call an unknown tool when no testTool is configured", async () => {
    serve(mcpServer());
    const probe = await getProbe();
    const result = await probe({ name: "t", url: "http://localhost:8100/mcp" });

    expect(callsToTools()).toHaveLength(0);
    expect(result.checks.find((c) => c.name === "tool-invocation")?.status).toBe("skip");
  });

  it("calls a tool that advertises readOnlyHint when no testTool is configured", async () => {
    const tools =
      'data: {"result":{"tools":[{"name":"delete_all"},{"name":"read_thing","annotations":{"readOnlyHint":true}}]}}';
    serve(mcpServer({ "tools/list": () => res(tools) }));
    const probe = await getProbe();
    const result = await probe({ name: "t", url: "http://localhost:8100/mcp" });

    expect(callsToTools()).toHaveLength(1);
    expect(result.checks.find((c) => c.name === "tool-invocation")?.status).toBe("pass");
    // the destructive tool was never the one called
    const sent = mockFetch.mock.calls
      .map(([, init]) => init?.body)
      .filter((b): b is string => typeof b === "string" && b.includes("tools/call"));
    expect(sent[0]).toContain("read_thing");
  });

  it("fails when the tool returns isError: true", async () => {
    const bad = 'data: {"result":{"isError":true,"content":[{"type":"text","text":"boom"}]}}';
    serve(mcpServer({ "tools/call": () => res(bad) }));
    const probe = await getProbe();
    const result = await probe({
      name: "t",
      url: "http://localhost:8100/mcp",
      testTool: { name: "search_thoughts", args: {} },
    });

    expect(result.checks.find((c) => c.name === "tool-invocation")?.status).toBe("fail");
  });

  it("fails on a JSON-RPC error from tools/call", async () => {
    serve(mcpServer({ "tools/call": () => res('data: {"error":{"code":-32602,"message":"bad args"}}') }));
    const probe = await getProbe();
    const result = await probe({
      name: "t",
      url: "http://localhost:8100/mcp",
      testTool: { name: "search_thoughts", args: {} },
    });

    const inv = result.checks.find((c) => c.name === "tool-invocation");
    expect(inv?.status).toBe("fail");
    expect(inv?.message).toContain("bad args");
  });
});
