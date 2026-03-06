/**
 * Tests for the connect_dev_instance tool.
 *
 * Verifies behavior in three scenarios:
 * 1. KC_DEV_URL not configured → returns setup instructions
 * 2. Instance not reachable → returns connection failure message
 * 3. Instance running → returns full status report (mocked)
 */

import { describe, it, expect, afterEach } from "vitest";
import { connectDevInstance } from "../../../src/live-dev/tools/connect_dev_instance.js";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KC_DEV_URL;
  delete process.env.KC_DEV_REALM;
  delete process.env.KC_DEV_ADMIN_USERNAME;
  delete process.env.KC_DEV_ADMIN_PASSWORD;
});

describe("connect_dev_instance", () => {
  // When KC_DEV_URL is not set, the tool should guide the user on setup
  it("returns setup instructions when KC_DEV_URL not set", async () => {
    delete process.env.KC_DEV_URL;
    const result = await connectDevInstance();
    expect(result).toContain("KC_DEV_URL");
    expect(result).toContain("environment variable");
  });

  // When the instance is down, the tool should explain what might be wrong
  it("returns not-reachable message when instance is down", async () => {
    process.env.KC_DEV_URL = "http://localhost:9999";
    mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });

    const result = await connectDevInstance();
    expect(result).toContain("Not Reachable");
    expect(result).toContain("localhost:9999");
  });

  // When the instance is healthy, the tool should report full status
  it("returns status report when instance is running", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    process.env.KC_DEV_ADMIN_USERNAME = "admin";
    process.env.KC_DEV_ADMIN_PASSWORD = "admin";

    mockFetch(async (url) => {
      if (url.includes("/q/health")) {
        return new Response(JSON.stringify({ status: "UP" }), { status: 200 });
      }
      if (url.includes("/q/info")) {
        return new Response(JSON.stringify({ "quarkus.version": "3.8.1" }), { status: 200 });
      }
      if (url.includes("/protocol/openid-connect/token")) {
        return new Response(
          JSON.stringify({ access_token: "test-token", expires_in: 300 }),
          { status: 200 }
        );
      }
      if (url.includes("/admin/serverinfo")) {
        return new Response(
          JSON.stringify({
            systemInfo: { version: "26.0.1" },
            providers: {
              authenticator: { internal: false, providers: { "auth-cookie": { order: 0 } } },
            },
          }),
          { status: 200 }
        );
      }
      // For extension listing (may fail gracefully)
      return new Response("Not Found", { status: 404 });
    });

    const result = await connectDevInstance();
    expect(result).toContain("Connected");
    expect(result).toContain("26.0.1");
    expect(result).toContain("Running");
  });
});
