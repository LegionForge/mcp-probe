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
      exclude: ["src/__tests__/**", "src/cli.ts", "src/ui/**"],
      thresholds: { lines: 60, functions: 60, branches: 50 },
    },
  },
});
