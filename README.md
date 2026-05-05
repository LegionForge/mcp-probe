# mcp-probe

**Connectivity and configuration advisor for MCP services you own or operate.**

`mcp-probe` helps developers and operators configure, connect, diagnose, and improve connectivity between AI clients and MCP servers they own or operate. Given a service endpoint, it tests the full connection stack — transport negotiation, authentication, protocol handshake, tool discovery, and client wiring — and tells you exactly what to change and where.

```
npx @legionforge/mcp-probe probe http://localhost:8100/mcp
npx @legionforge/mcp-probe discover
npx @legionforge/mcp-probe audit
npx @legionforge/mcp-probe ui
```

---

## Scope

This is an operational diagnostic tool, not a security testing tool. Every target endpoint must be explicitly specified by URL. `mcp-probe` does not perform network scanning, port discovery, or any form of unauthorized reconnaissance. It is intended for use with MCP services you own, deploy, or have been explicitly authorized to access.

---

## What it does

### 1. Probe — protocol compliance testing

Tests an MCP server through every layer of the connection stack:

| Check | What it verifies |
|-------|-----------------|
| Reachability | Server is responding on the given URL |
| Authentication | Auth gate rejects bad keys, accepts valid ones |
| Transport detection | Auto-detects Streamable HTTP vs legacy SSE |
| MCP handshake | Server returns a valid `initialize` response |
| Tool discovery | `tools/list` returns one or more tools |
| Expected tools | All declared tools are present |
| Tool invocation | A read-only tool call succeeds end-to-end |

### 2. Discover — system inventory

Detects which AI clients and MCP runtimes are installed on the current machine:

- **AI clients:** Claude Desktop App, Claude Code CLI, VS Code (native MCP), Cursor, Windsurf, Continue
- **Runtimes:** Node.js/npx, Deno, Python, uvx, Docker, Bun

### 3. Audit — client wiring check

For each installed AI client, checks whether each configured MCP server is:
- Present in the client's config file
- Actively running via mcp-remote (where applicable)
- Showing a healthy connection in the client's log files

### 4. Recommend — actionable configuration advice

Generates specific, ready-to-paste configuration snippets for every client that is missing a server, with the correct format per client (Claude Desktop, Claude Code, VS Code, Cursor, Windsurf).

### 5. UI — web dashboard

Starts a local web dashboard showing all servers, client wiring, and recommendations in a single view.

---

## Installation

```bash
# Zero-install (recommended)
npx @legionforge/mcp-probe --help

# Global install
npm install -g @legionforge/mcp-probe
```

Requires Node.js 20+.

---

## Configuration

Create `.mcp-probe.json` in your project root (see `mcp-probe.example.json`):

```json
{
  "servers": [
    {
      "name": "my-server",
      "displayName": "My MCP Server",
      "url": "http://localhost:8100/mcp",
      "auth": {
        "header": "x-api-key",
        "keyFrom": "env",
        "envVar": "MY_MCP_KEY"
      },
      "expectedTools": ["search", "list"],
      "testTool": {
        "name": "search",
        "args": { "query": "test", "limit": 1 }
      }
    }
  ],
  "ui": { "port": 4242 }
}
```

### Auth options

| Method | Config |
|--------|--------|
| Literal key | `"key": "your-key-here"` |
| Environment variable | `"keyFrom": "env", "envVar": "MY_KEY"` |
| macOS Keychain | `"keyFrom": "keychain", "keychainService": "...", "keychainAccount": "..."` |

---

## CLI reference

```
mcp-probe probe [url]           Test an MCP server's protocol compliance
  --auth-header <header>          Auth header name (e.g. x-brain-key)
  --server <name>                 Server name from config to probe
  --timeout <ms>                  Timeout in milliseconds (default: 8000)

mcp-probe audit                 Check client wiring for all configured servers
mcp-probe discover              Detect installed AI clients and runtimes
mcp-probe recommend             Show configuration recommendations
mcp-probe ui [--port 4242]      Start the web dashboard

Global flags:
  --config <path>                 Path to config file
  --json                          Output as JSON (for CI/scripting)
```

---

## AI client config locations

| Client | Config file |
|--------|-------------|
| Claude Desktop App / Cowork / Dispatch | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Code CLI | `~/.claude/settings.json` |
| VS Code native MCP (1.99+) | `.vscode/mcp.json` or user `settings.json` |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Continue | `~/.continue/config.json` |

> **Important:** Claude Desktop App and Claude Code CLI use different config files. The VS Code extension inherits MCP servers from the Desktop App — not from `settings.json`. If a server is only in `settings.json`, it will be unavailable in VS Code sessions.

---

## MCP transport quick reference

| Transport | How clients connect | mcp-remote flag |
|-----------|--------------------|----|
| Streamable HTTP | POST to `/mcp` with JSON-RPC body | `--transport http-only` |
| Legacy SSE | GET to `/sse`, then POST to session endpoint | `--transport sse-only` |
| STDIO | Subprocess via stdin/stdout | Direct (no mcp-remote needed) |

---

## Using as a library

```typescript
import { probeServer, auditClients, generateRecommendations } from "@legionforge/mcp-probe";

const result = await probeServer({
  name: "my-server",
  url: "http://localhost:8100/mcp",
  auth: { header: "x-api-key", key: process.env.MY_KEY },
});

console.log(result.passed, "checks passed,", result.failed, "failed");
```

---

## License

MIT — © JP Cruz / [LegionForge](https://github.com/legionforge)

`mcp-probe` is intended for use with MCP services you own or are authorized to access. It is not a penetration testing tool and performs no network scanning or unauthorized probing.
