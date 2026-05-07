// ─────────────────────────────────────────────────────────────────────────────
// Shared types for mcp-probe
// ─────────────────────────────────────────────────────────────────────────────

export type Transport = "streamable-http" | "sse" | "stdio" | "unknown";
export type Status = "pass" | "fail" | "warn" | "skip" | "pending";

// ── Server config (from .mcp-probe.json) ──────────────────────────────────────

export interface ServerAuth {
  header: string;
  /** Literal key value. Use keyFrom for secure sources. */
  key?: string;
  /** "env" | "keychain" */
  keyFrom?: "env" | "keychain";
  envVar?: string;
  /** macOS Keychain service name */
  keychainService?: string;
  /** macOS Keychain account name */
  keychainAccount?: string;
}

export interface TestTool {
  name: string;
  args?: Record<string, unknown>;
}

export interface ServerConfig {
  name: string;
  displayName?: string;
  url: string;
  transport?: Transport;
  auth?: ServerAuth;
  expectedTools?: string[];
  testTool?: TestTool;
  tags?: string[];
}

export interface ProbeConfig {
  servers: ServerConfig[];
  ui?: { port?: number; host?: string };
  defaults?: { timeout?: number };
}

// ── Probe results ──────────────────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  status: Status;
  message: string;
  detail?: string;
}

export interface ServerProbeResult {
  server: string;
  url: string;
  timestamp: string;
  transport: Transport;
  checks: CheckResult[];
  tools: string[];
  passed: number;
  failed: number;
  warned: number;
  skipped: number;
}

// ── Client audit results ───────────────────────────────────────────────────────

export type ClientId =
  | "claude-desktop"
  | "claude-code"
  | "vscode-native"
  | "cursor"
  | "windsurf"
  | "continue"
  | "jetbrains";

export interface ClientAuditResult {
  clientId: ClientId;
  displayName: string;
  installed: boolean;
  configPath?: string;
  serverWiring: Record<string, WiringStatus>;
}

export interface WiringStatus {
  configured: boolean;
  processRunning: boolean;
  logHealthy: boolean | null;
  issues: string[];
  suggestions: string[];
}

// ── Discovery results ─────────────────────────────────────────────────────────

export interface InstalledClient {
  id: ClientId;
  displayName: string;
  configPath: string;
  version?: string;
}

export interface RuntimeInfo {
  name: string;
  command: string;
  version: string;
  available: boolean;
  mcpRelevance: string;
  /** For Node.js: warning if version < 20 */
  warning?: string;
  /** For Node.js: detected version manager (nvm, asdf, fnm, volta) */
  versionManager?: "nvm" | "asdf" | "fnm" | "volta" | null;
  /** For Node.js: available versions from manager (e.g. ["v20.11.0", "v18.19.0"]) */
  availableVersions?: string[];
  /** For Node.js: suggestion for switching versions */
  suggestion?: string;
}

export interface DiscoveryResult {
  clients: InstalledClient[];
  runtimes: RuntimeInfo[];
  platform: NodeJS.Platform;
}

// ── Recommendations ───────────────────────────────────────────────────────────

export type RecommendationSeverity = "required" | "suggested" | "optional";

export interface Recommendation {
  id: string;
  severity: RecommendationSeverity;
  client: ClientId;
  server: string;
  title: string;
  description: string;
  configSnippet?: string;
  actionLabel?: string;
  action?: "add-to-config" | "restart-client" | "install-runtime" | "manual";
}

// ── Full analysis result ──────────────────────────────────────────────────────

export interface AnalysisResult {
  timestamp: string;
  discovery: DiscoveryResult;
  probes: ServerProbeResult[];
  audit: ClientAuditResult[];
  recommendations: Recommendation[];
}
