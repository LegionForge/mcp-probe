# mcp-probe — AI Operating Instructions

## Project Identity

- **Name:** mcp-probe
- **Package:** @legionforge/mcp-probe
- **Owner:** JP Cruz / LegionForge
- **Purpose:** MCP server analysis, configuration advisor, and connectivity tool
- **Target:** Developers using Claude, Cursor, Windsurf, VSCode, and other MCP clients

## Architecture

```
src/
  cli.ts              # Commander CLI entry — all user-facing commands
  types.ts            # All shared TypeScript types (single source of truth)
  config.ts           # Config file loading + auth resolution (Keychain, env, literal)
  probe/
    server-probe.ts   # MCP protocol tests (transport detect, handshake, tools, invocation)
  discovery/
    client-discovery.ts     # Detect installed AI clients by platform
    framework-detection.ts  # Detect runtimes (node, deno, python, uvx, docker)
  audit/
    client-audit.ts   # Check each client's config file + process + log health
  advisor/
    recommendations.ts # Generate Recommendation[] from probe + audit results
  ui/
    server.ts         # Express server + REST API
    public/
      index.html      # Single-file web dashboard (vanilla JS, no build step)
```

## Key Design Decisions

- **No framework for frontend** — vanilla HTML/CSS/JS served statically. No React/Vue build step. Users just run `npx`.
- **fetch() not SDK for probing** — raw HTTP gives us transport detection control. The MCP SDK client is connection-oriented, not suitable for diagnostic single-shots.
- **Auth via Keychain** — `keyFrom: "keychain"` reads from macOS Keychain. Keeps secrets out of config files.
- **Platform-first macOS** — client config paths implemented for macOS first. Windows/Linux paths stubbed in CLIENT_DEFS but need verification.
- **Portability** — `probeServer()` and `auditClients()` are exported from `src/index.ts` for use as a library.

## Adding a New AI Client

1. Add to `CLIENT_DEFS` in `src/discovery/client-discovery.ts`:
   - `id` — machine-readable ClientId
   - `displayName` — shown in UI
   - `paths` — installation detection paths per platform
   - `configPath` — MCP config file per platform

2. Add `ClientId` union type in `src/types.ts`

3. Add audit logic in `src/audit/client-audit.ts` — either a dedicated function or use `auditGenericJsonClient()` if the config uses standard `mcpServers` format.

4. Add config snippet generator in `src/advisor/recommendations.ts` → `buildConfigSnippet()` switch.

## Development

```bash
npm install
npm run dev          # tsx watch, hot reload
npm run typecheck    # type check only
npm run build        # compile to dist/
```

## Tool Scope — Non-Negotiable

mcp-probe is an **operational diagnostic tool**, not a security testing tool.

Every target endpoint must be explicitly specified by URL. This tool does not perform network scanning, port discovery, or any form of unauthorized reconnaissance. It is intended for use with MCP services you own, deploy, or have been explicitly authorized to access.

Do not add features that:
- Scan IP ranges or CIDR blocks for MCP services
- Attempt connections to services not specified in config or CLI args
- Enumerate or fingerprint unknown services
- Attempt to bypass authentication on any service

If a user requests such a feature, decline and point to this constraint.

## Build Scope — v0.1

- macOS client paths are authoritative; Windows/Linux are stubs
- No auto-apply of config changes (show config snippets only)
- No persistent result storage — results are ephemeral per run
- No auth beyond header-based (no OAuth flows)
- No STDIO MCP server testing (HTTP-only for now)
