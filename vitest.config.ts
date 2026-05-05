import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["src/__tests__/integration/**"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/cli.ts",
        "src/ui/**",
        // Pure type definitions and barrel re-exports — no executable logic
        "src/types.ts",
        "src/index.ts",
        // OS-specific filesystem/process code; tested via integration tests, not unit tests
        "src/audit/client-audit.ts",
        "src/discovery/client-discovery.ts",
      ],
      // v0.1 baselines — raise as coverage improves
      thresholds: { lines: 55, functions: 60, branches: 50 },
    },
  },
});
