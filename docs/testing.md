# mcp-probe Testing Protocol

**Version:** 0.1.0-beta (post-alpha UAT)  
**Date:** 2026-05-06  
**Status:** Pre-release validation — feature-complete, iterating based on user testing

---

## Test Environment Setup

### Prerequisites
- Node.js 20+
- macOS (primary platform; Windows/Linux paths are stubs)
- Installed AI clients (Claude Desktop, Claude Code, VS Code recommended)

### Installation for Testing

**Setup (one-time, from project root):**

```bash
cd /Volumes/MAC_MINI_1TB/mcp-probe
npm run build
npm link
```

This registers the package globally (simulates `npm install -g`).

**Testing (from any directory, e.g. your home directory):**

```bash
cd ~  # or any other directory
mcp-probe --version
mcp-probe --help
mcp-probe discover
```

**Rebuilding after changes (when resuming):**

```bash
cd /Volumes/MAC_MINI_1TB/mcp-probe
npm run build
# npm link not needed again; the symlink stays active
cd ~
mcp-probe --version  # uses rebuilt version
```

**Key points:**
- Build and link steps → run from project root only
- All test commands → run from any directory (e.g. `~`), never from project root
- This validates the package works independently, like a real user would experience

---

## Test Suite 1: Discovery & Environment Detection

### Purpose
Validate that mcp-probe correctly detects installed clients and available runtimes.

### Test Cases

#### T1.1 — Client Discovery
**Command:**
```bash
mcp-probe discover
```

**Expected Output:**
- Lists all installed AI clients with config file paths
- Shows status (✓ installed or – not found)
- For this Mac: Claude Desktop, Claude Code, VS Code should be ✓

**Validation:**
- [ ] All installed clients listed
- [ ] Config paths are correct
- [ ] Non-installed clients marked with –

#### T1.2 — Runtime Detection
**Command:**
```bash
mcp-probe discover
```

**Expected Output (Runtime Availability section):**
- Node.js version listed
- Deno version (if installed)
- Python version
- Docker version (if installed)
- Missing runtimes noted gracefully

**Validation:**
- [ ] Node.js detected (always present on this machine)
- [ ] All available runtimes shown
- [ ] No errors for missing runtimes

---

## Test Suite 2: Configuration Audit

### Purpose
Validate that mcp-probe correctly audits MCP server configuration across clients.

### Setup

Create a test config file in a separate test directory (not in the project root):

```bash
mkdir -p ~/mcp-probe-tests
cd ~/mcp-probe-tests

cat > config.json <<'EOF'
{
  "servers": [
    {
      "name": "test-server-1",
      "url": "http://localhost:3000/mcp",
      "description": "Local test server"
    },
    {
      "name": "test-server-2",
      "url": "http://localhost:3001/mcp",
      "description": "Another test server"
    }
  ]
}
EOF
```

All test artifacts stay in `~/mcp-probe-tests/` — keeps the project root clean.

### Test Cases

#### T2.1 — Audit Unconfigured Servers
**Command:**
```bash
cd ~/mcp-probe-tests
mcp-probe audit --config config.json
```

**Expected Output:**
- Shows each installed client
- For each server: NOT CONFIGURED (since we haven't added them to client configs)
- Provides suggestions for adding servers to each client config

**Validation:**
- [ ] All installed clients listed
- [ ] Each server marked NOT CONFIGURED
- [ ] Suggestions provided for Claude Desktop, Claude Code, VS Code
- [ ] Non-installed clients (Cursor, Windsurf) shown as "not installed"

#### T2.2 — Audit with JSON Output
**Command:**
```bash
cd ~/mcp-probe-tests
mcp-probe audit --config config.json --json
```

**Expected Output:**
- Valid JSON structure
- Can be parsed without errors

**Validation:**
- [ ] Output is valid JSON
- [ ] No parsing errors
- [ ] Contains audit results for all clients

---

## Test Suite 3: Server Connectivity Probing

### Purpose
Validate that mcp-probe correctly tests MCP server connectivity and reports results.

### Test Cases

#### T3.1 — Probe Unreachable Server (Error Handling)
**Command:**
```bash
mcp-probe probe http://localhost:3000/mcp
```

**Expected Output:**
- Server marked as unreachable
- Error message clearly states "fetch failed" or similar
- Exit code: 1 (failure)
- Shows: 0 passed, 1 failed

**Validation:**
- [ ] Error message is clear
- [ ] Exit code reflects failure
- [ ] Test counters correct

#### T3.2 — Probe with JSON Output
**Command:**
```bash
mcp-probe probe http://localhost:3000/mcp --json
```

**Expected Output:**
- Valid JSON with probe results
- Includes: name, url, transport, checks array, summary

**Validation:**
- [ ] Valid JSON
- [ ] All expected fields present
- [ ] Can be piped to other tools

#### T3.3 — Probe with Custom Name
**Command:**
```bash
mcp-probe probe http://localhost:3000/mcp --name my-test-server
```

**Expected Output:**
- Uses custom name "my-test-server" in output instead of "probe"

**Validation:**
- [ ] Custom name appears in results

---

## Test Suite 4: Web UI & API

### Purpose
Validate the web dashboard and REST API work correctly.

### Test Cases

#### T4.1 — UI Server Startup
**Command:**
```bash
# In one terminal:
mcp-probe ui

# In another terminal (after waiting ~2 seconds):
curl -s http://localhost:4242/ | head -20
```

**Expected Output:**
- Console shows: "mcp-probe UI running at http://localhost:4242"
- curl returns HTML with `<title>mcp-probe — LegionForge</title>`
- No errors in startup

**Validation:**
- [ ] Server starts without errors
- [ ] Dashboard HTML loads
- [ ] Default port is 4242

#### T4.2 — Custom Port
**Command:**
```bash
mcp-probe ui --port 5555
curl -s http://localhost:5555/ | grep -o '<title>[^<]*</title>'
```

**Expected Output:**
- Server runs on custom port 5555
- Dashboard loads on that port

**Validation:**
- [ ] Custom port respected
- [ ] No "EADDRINUSE" errors

#### T4.3 — API Analysis Endpoint
**Command:**
```bash
mcp-probe ui &
sleep 2
curl -s -X POST http://localhost:4242/api/analyze | jq 'keys'
```

**Expected Output:**
```json
[
  "audit",
  "discovery",
  "probes",
  "recommendations",
  "timestamp"
]
```

**Validation:**
- [ ] All expected fields in response
- [ ] Valid JSON
- [ ] Runs successfully (discovery data fetched)

#### T4.4 — CORS & Security Headers
**Command:**
```bash
curl -v -X POST http://localhost:4242/api/analyze 2>&1 | grep -E '^< |^> Host'
```

**Expected Output (check for these headers):**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Content-Security-Policy: ...`
- `Referrer-Policy: no-referrer`

**Validation:**
- [ ] Security headers present
- [ ] CORS works for localhost
- [ ] No "Forbidden" errors on requests from localhost

---

## Test Suite 5: CLI Options & Help

### Purpose
Validate CLI works correctly with various options.

### Test Cases

#### T5.1 — Version Output
**Command:**
```bash
mcp-probe --version
```

**Expected Output:**
- Shows version: 0.1.0 (or current version)

**Validation:**
- [ ] Version string matches package.json

#### T5.2 — Help Output
**Command:**
```bash
mcp-probe --help
```

**Expected Output:**
- Lists all commands: probe, audit, discover, recommend, ui
- Shows options: --config, --json, -V, -h

**Validation:**
- [ ] All commands listed
- [ ] Help text is clear and complete

#### T5.3 — Invalid Command
**Command:**
```bash
mcp-probe invalid-command 2>&1
```

**Expected Output:**
- Error message suggesting correct usage
- Shows available commands

**Validation:**
- [ ] Error message is helpful
- [ ] Exit code is non-zero

---

## Future Testing Scenarios

### After Installing Additional Clients

Once you install Cursor, Windsurf, or Continue.dev:

#### T6.1 — Multi-Client Audit
- Run `cd ~/mcp-probe-tests && mcp-probe audit --config config.json`
- Verify newly installed client appears with correct config path
- Check that suggestions are provided for that client

#### T6.2 — Real MCP Server Testing
- Set up a local MCP server (e.g., sqlite, weather, stock-prices)
- Add to config file
- Run `mcp-probe probe <server-url>`
- Verify successful connection and MCP handshake

#### T6.3 — SSH/Remote Session Testing
- Test from VS Code SSH session
- Verify mcp-probe detects SSH session context
- Test that config paths resolve correctly in remote environment

---

## Regression Test Checklist

Run this before each release:

- [ ] `npm run lint` — no ESLint errors
- [ ] `npm run typecheck` — TypeScript clean
- [ ] `npm test` — all 13+ tests passing
- [ ] `npm run build` — build succeeds, public/ copied to dist/
- [ ] `mcp-probe --help` — CLI works
- [ ] `mcp-probe discover` — detects clients and runtimes
- [ ] `mcp-probe ui` — dashboard loads and API works
- [ ] No console errors or warnings

---

## Known Limitations & Stubs

- **Windows/Linux paths:** Client detection paths are stubs; macOS is authoritative
- **STDIO MCP servers:** Only HTTP/fetch-based testing currently; STDIO coming in v0.2
- **Auto-config:** Shows config snippets only; no auto-apply
- **Persistent results:** Results ephemeral per run; no storage

---

## Reporting Test Results

When testing, note:
- **Machine:** Mac Mini, Windows, Linux, etc.
- **Clients installed:** (e.g., Claude Desktop, Cursor, VS Code)
- **Node version:** `node --version`
- **Test date:** YYYY-MM-DD
- **Pass/fail:** For each test case
- **Issues found:** Unexpected behavior, errors, suggestions

---

## Next Steps

- [ ] Test with Cursor installed
- [ ] Test with Windsurf installed
- [ ] Set up local MCP server for probe testing
- [ ] Test from VS Code SSH session
- [ ] Consider: v0.1.0-beta tag if satisfied, or continue iterating

