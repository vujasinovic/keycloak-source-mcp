import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/live-dev/index.ts",
        // Tools that require a live Keycloak instance or network access to test
        "src/tools/keycloak_admin.ts",
        "src/tools/visualize_auth_flow.ts",
        "src/tools/detect_breaking_changes.ts",
        "src/tools/trace_dependencies.ts",
        "src/tools/upgrade_assistant.ts",
        "src/tools/check_security_advisories.ts",
        "src/tools/generate_spi_boilerplate.ts",
      ],
      thresholds: {
        statements: 75,
        branches: 50,
        functions: 75,
        lines: 75,
      },
    },
  },
});
