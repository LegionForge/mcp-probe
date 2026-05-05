import express from "express";
import cors from "cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { probeServer } from "../probe/server-probe.js";
import { auditClients } from "../audit/client-audit.js";
import { discoverClients } from "../discovery/client-discovery.js";
import { detectRuntimes } from "../discovery/framework-detection.js";
import { generateRecommendations } from "../advisor/recommendations.js";
import type { ProbeConfig, AnalysisResult } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createServer(config: ProbeConfig) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(join(__dirname, "public")));

  // ── POST /api/analyze — run full analysis ──────────────────────────────────
  app.post("/api/analyze", async (_req, res) => {
    try {
      const timeout = config.defaults?.timeout ?? 8000;

      const [probes, auditResults, clients, runtimes] = await Promise.all([
        Promise.all(config.servers.map((s) => probeServer(s, timeout))),
        auditClients(config.servers),
        discoverClients(),
        detectRuntimes(),
      ]);

      const recommendations = generateRecommendations(config.servers, probes, auditResults, runtimes);

      const result: AnalysisResult = {
        timestamp: new Date().toISOString(),
        discovery: {
          clients: clients.map((c) => ({ ...c, installed: true })),
          runtimes,
          platform: process.platform,
        },
        probes,
        audit: auditResults,
        recommendations,
      };

      res.json(result);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // ── GET /api/servers — list configured servers ─────────────────────────────
  app.get("/api/servers", (_req, res) => {
    res.json(config.servers.map((s) => ({ name: s.name, url: s.url, displayName: s.displayName })));
  });

  // ── POST /api/probe/:name — probe single server ────────────────────────────
  app.post("/api/probe/:name", async (req, res) => {
    const server = config.servers.find((s) => s.name === req.params.name);
    if (!server) return res.status(404).json({ error: "Server not found" });
    const result = await probeServer(server, config.defaults?.timeout ?? 8000);
    res.json(result);
  });

  // ── GET /api/health ────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => res.json({ ok: true, version: "0.1.0" }));

  return app;
}

export async function startUI(config: ProbeConfig): Promise<void> {
  const port = config.ui?.port ?? 4242;
  const host = config.ui?.host ?? "localhost";
  const app = createServer(config);

  await new Promise<void>((resolve) => {
    app.listen(port, host, () => {
      console.log(`\n  mcp-probe UI running at http://${host}:${port}\n`);
      resolve();
    });
  });

  // Keep running
  await new Promise(() => {});
}
