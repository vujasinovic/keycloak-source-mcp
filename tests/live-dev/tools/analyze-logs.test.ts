/**
 * Tests for the analyze_logs tool.
 *
 * Verifies log analysis works with fixture log files and handles
 * missing configuration gracefully.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeLogs } from "../../../src/live-dev/tools/analyze_logs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "logs");

afterEach(() => {
  delete process.env.KC_DEV_URL;
  delete process.env.KC_DEV_LOG_PATH;
});

describe("analyze_logs", () => {
  // Without KC_DEV_URL, should return setup instructions
  it("returns setup instructions when KC_DEV_URL not set", async () => {
    delete process.env.KC_DEV_URL;
    const result = await analyzeLogs();
    expect(result).toContain("KC_DEV_URL");
  });

  // Without KC_DEV_LOG_PATH, should explain how to set it up
  it("returns log path instructions when KC_DEV_LOG_PATH not set", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    delete process.env.KC_DEV_LOG_PATH;
    const result = await analyzeLogs();
    expect(result).toContain("KC_DEV_LOG_PATH");
  });

  // With valid log file, should return structured analysis
  it("analyzes normal log file successfully", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    process.env.KC_DEV_LOG_PATH = path.join(FIXTURES, "keycloak-normal.log");

    const result = await analyzeLogs();
    expect(result).toContain("Log Analysis");
    expect(result).toContain("Recent Activity");
  });

  // With error log, should detect errors
  it("detects errors in error log", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    process.env.KC_DEV_LOG_PATH = path.join(FIXTURES, "keycloak-error.log");

    const result = await analyzeLogs();
    expect(result).toContain("ERROR");
  });

  // With auth flow log, should extract flow steps
  it("extracts auth flow from auth log", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    process.env.KC_DEV_LOG_PATH = path.join(FIXTURES, "keycloak-auth-flow.log");

    const result = await analyzeLogs(500, undefined, true);
    expect(result).toContain("Authentication Flow");
  });

  // Filter should narrow results
  it("respects class name filter", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    process.env.KC_DEV_LOG_PATH = path.join(FIXTURES, "keycloak-normal.log");

    const result = await analyzeLogs(200, "AuthenticationProcessor");
    expect(result).toContain("Log Analysis");
  });

  // Non-matching filter should say so
  it("reports when filter matches nothing", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    process.env.KC_DEV_LOG_PATH = path.join(FIXTURES, "keycloak-normal.log");

    const result = await analyzeLogs(200, "NonExistentClass99999");
    expect(result).toContain("No log entries matching");
  });
});
