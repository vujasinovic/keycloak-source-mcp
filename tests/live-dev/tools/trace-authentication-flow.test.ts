/**
 * Tests for the trace_authentication_flow tool.
 *
 * Verifies guidance generation and log analysis when KC_DEV_URL is
 * configured with mocked HTTP endpoints.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { traceAuthenticationFlow } from "../../../src/live-dev/tools/trace_authentication_flow.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "..", "fixtures", "logs");
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KC_DEV_URL;
  delete process.env.KC_DEV_LOG_PATH;
});

describe("trace_authentication_flow", () => {
  // Without KC_DEV_URL, should return setup instructions
  it("returns setup instructions when KC_DEV_URL not set", async () => {
    delete process.env.KC_DEV_URL;
    const result = await traceAuthenticationFlow("master", "browser login");
    expect(result).toContain("KC_DEV_URL");
  });

  // Should provide guidance for browser login
  it("provides browser login guidance", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    globalThis.fetch = (async (url: string) => {
      const u = typeof url === "string" ? url : (url as Request).url;
      if (u.includes("/q/health")) {
        return new Response(JSON.stringify({ status: "UP" }), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const result = await traceAuthenticationFlow("master", "browser login with password");
    expect(result).toContain("Authentication Flow Trace");
    expect(result).toContain("browser");
    expect(result).toContain("Sign In");
  });

  // Should analyze logs when KC_DEV_LOG_PATH is set
  it("analyzes auth flow from log file", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    process.env.KC_DEV_LOG_PATH = path.join(FIXTURES, "keycloak-auth-flow.log");
    globalThis.fetch = (async (url: string) => {
      const u = typeof url === "string" ? url : (url as Request).url;
      if (u.includes("/q/health")) {
        return new Response(JSON.stringify({ status: "UP" }), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const result = await traceAuthenticationFlow("test-realm", "browser login");
    expect(result).toContain("Authentication Flow Trace");
  });

  // Validates required inputs
  it("returns error for empty realm", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    const result = await traceAuthenticationFlow("", "test");
    expect(result).toContain("Error");
  });

  // Validates required inputs
  it("returns error for empty description", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    const result = await traceAuthenticationFlow("master", "");
    expect(result).toContain("Error");
  });
});
