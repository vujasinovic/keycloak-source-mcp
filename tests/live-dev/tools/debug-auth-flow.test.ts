/**
 * Tests for the debug_auth_flow tool wrapper.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { debugAuthFlow } from "../../../src/live-dev/tools/debug_auth_flow.js";
import { setupMockEnv, cleanupEnv } from "../../test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "logs");
const AUTH_FLOW_LOG = path.join(FIXTURES, "keycloak-auth-flow.log");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KC_DEV_URL;
  delete process.env.KC_DEV_LOG_PATH;
  cleanupEnv();
});

describe("debug_auth_flow", () => {
  it("returns instructions when KC_DEV_LOG_PATH not set", async () => {
    delete process.env.KC_DEV_LOG_PATH;
    delete process.env.KC_DEV_URL;
    const result = await debugAuthFlow("start");
    expect(result).toContain("KC_DEV_LOG_PATH");
  });

  it("start phase captures snapshot and returns instructions", async () => {
    process.env.KC_DEV_LOG_PATH = AUTH_FLOW_LOG;
    const result = await debugAuthFlow("start", "master", "browser login test");
    expect(result).toContain("Snapshot Captured");
    expect(result).toContain("SNAPSHOT:");
    expect(result).toContain("browser login test");
  });

  it("start phase works without KC_DEV_URL", async () => {
    process.env.KC_DEV_LOG_PATH = AUTH_FLOW_LOG;
    delete process.env.KC_DEV_URL;
    const result = await debugAuthFlow("start");
    expect(result).toContain("Snapshot Captured");
    expect(result).toContain("Trigger the flow");
  });

  it("analyze phase requires snapshot parameter", async () => {
    const result = await debugAuthFlow("analyze");
    expect(result).toContain("snapshot parameter is required");
  });

  it("analyze phase with valid snapshot produces diagnosis", async () => {
    setupMockEnv();
    const snapshot = JSON.stringify({
      logPath: AUTH_FLOW_LOG,
      lineCount: 0,
      takenAt: new Date().toISOString(),
    });
    const result = await debugAuthFlow("analyze", "test-realm", undefined, snapshot);
    expect(result).toContain("Authentication Flow Debug Trace");
    expect(result).toContain("test-realm");
  });

  it("analyze phase handles invalid JSON gracefully", async () => {
    const result = await debugAuthFlow("analyze", "master", undefined, "not-json");
    expect(result).toContain("Invalid snapshot JSON");
  });

  it("start phase with KC_DEV_URL includes realm login URL", async () => {
    process.env.KC_DEV_LOG_PATH = AUTH_FLOW_LOG;
    process.env.KC_DEV_URL = "http://localhost:8080";
    const result = await debugAuthFlow("start", "testrealm");
    expect(result).toContain("http://localhost:8080/realms/testrealm/account");
  });
});
