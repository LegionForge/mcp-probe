import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Test the pure parsing helpers by extracting logic ────────────────────────
// We test the parsing functions that drive probe decisions without needing
// a real MCP server. Integration tests live in __tests__/integration/.

// Re-expose internal parsing helpers via the module (they're currently
// inline in server-probe.ts — we test their behaviour through the observable
// outputs of the exported probeServer function with a mocked fetch).

const INIT_RESPONSE_SSE = `event: message
data: {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"test-server","version":"1.2.3"}},"jsonrpc":"2.0","id":1}
`;

const TOOLS_RESPONSE = `event: message
data: {"result":{"tools":[{"name":"search_thoughts","description":"Search"},{"name":"list_thoughts","description":"List"},{"name":"capture_thought","description":"Capture"}]},"jsonrpc":"2.0","id":2}
`;

const ERROR_RESPONSE = `event: message
data: {"error":{"code":-32700,"message":"Parse error","data":"Unexpected token"},"jsonrpc":"2.0","id":null}
`;

// ── Mock fetch globally ───────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function _mockResponse(body: string, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  } as unknown as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
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
    // Reachability GET → 401
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve("") } as unknown as Response)
      // No auth configured, so skip auth checks; go straight to transport POST
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(INIT_RESPONSE_SSE) } as unknown as Response)
      // tools/list
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(TOOLS_RESPONSE) } as unknown as Response)
      // tool invocation (search_thoughts)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('data: {"result":{"content":[{"type":"text","text":"Found 1 result"}]}}') } as unknown as Response);

    const probe = await getProbe();
    const result = await probe({
      name: "test",
      url: "http://localhost:8100/mcp",
      expectedTools: ["search_thoughts"],
      testTool: { name: "search_thoughts", args: { query: "test" } },
    });

    expect(result.transport).toBe("streamable-http");
    const transport = result.checks.find((c) => c.name === "transport");
    expect(transport?.status).toBe("pass");
  });

  it("discovers tools from tools/list response", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve("") } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(INIT_RESPONSE_SSE) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(TOOLS_RESPONSE) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('data: {"result":{"content":[]}}') } as unknown as Response);

    const probe = await getProbe();
    const result = await probe({ name: "test", url: "http://localhost:8100/mcp" });

    expect(result.tools).toContain("search_thoughts");
    expect(result.tools).toContain("list_thoughts");
    expect(result.tools).toContain("capture_thought");
    expect(result.tools).toHaveLength(3);
  });

  it("fails expected tool check when tool is missing", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve("") } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(INIT_RESPONSE_SSE) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(TOOLS_RESPONSE) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('data: {"result":{"content":[]}}') } as unknown as Response);

    const probe = await getProbe();
    const result = await probe({
      name: "test",
      url: "http://localhost:8100/mcp",
      expectedTools: ["search_thoughts", "nonexistent_tool"],
    });

    const missingCheck = result.checks.find((c) => c.name === "tool:nonexistent_tool");
    expect(missingCheck?.status).toBe("fail");
    const presentCheck = result.checks.find((c) => c.name === "tool:search_thoughts");
    expect(presentCheck?.status).toBe("pass");
  });

  it("rejects bad auth key", async () => {
    // GET without auth → 401
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve("") } as unknown as Response)
      // Bad key check → 401
      .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve("") } as unknown as Response)
      // Good key check → 406 (auth passed, wrong accept)
      .mockResolvedValueOnce({ ok: false, status: 406, text: () => Promise.resolve("") } as unknown as Response)
      // Transport POST → valid MCP response
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(INIT_RESPONSE_SSE) } as unknown as Response)
      // tools/list
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(TOOLS_RESPONSE) } as unknown as Response)
      // invocation
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('data: {"result":{"content":[]}}') } as unknown as Response);

    const probe = await getProbe();
    const result = await probe({
      name: "test",
      url: "http://localhost:8100/mcp",
      auth: { header: "x-api-key", key: "valid-key" },
    });

    const rejection = result.checks.find((c) => c.name === "auth-rejection");
    expect(rejection?.status).toBe("pass");
    const acceptance = result.checks.find((c) => c.name === "auth-acceptance");
    expect(acceptance?.status).toBe("pass");
  });

  it("detects legacy SSE transport and skips protocol tests", async () => {
    // GET without auth → 200
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve("") } as unknown as Response)
      // Transport: POST → no MCP response (not streamable HTTP)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve("not json") } as unknown as Response)
      // SSE GET → endpoint event
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve("event: endpoint\ndata: /messages?session_id=abc123\n"),
      } as unknown as Response);

    const probe = await getProbe();
    const result = await probe({ name: "obs", url: "http://localhost:22360/sse" });

    expect(result.transport).toBe("sse");
    const transport = result.checks.find((c) => c.name === "transport");
    expect(transport?.status).toBe("pass");
    // Protocol tests should be skipped for SSE
    const handshake = result.checks.find((c) => c.name === "handshake");
    expect(handshake?.status).toBe("skip");
  });

  it("handles server-returned MCP error gracefully", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve("") } as unknown as Response)
      // Transport POST → MCP error response
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(ERROR_RESPONSE) } as unknown as Response)
      // SSE fallback → no SSE stream
      .mockResolvedValueOnce({ ok: false, status: 405, text: () => Promise.resolve("") } as unknown as Response);

    const probe = await getProbe();
    const result = await probe({ name: "broken", url: "http://localhost:8100/mcp" });

    expect(result.transport).toBe("unknown");
    expect(result.failed).toBeGreaterThan(0);
  });
});
