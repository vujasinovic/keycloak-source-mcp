/**
 * Tests for the get_dev_instance_config tool.
 *
 * Verifies configuration retrieval and filtering with mocked HTTP endpoints.
 */

import { describe, it, expect, afterEach } from "vitest";
import { getDevInstanceConfig } from "../../../src/live-dev/tools/get_dev_instance_config.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KC_DEV_URL;
  delete process.env.KC_DEV_ADMIN_USERNAME;
  delete process.env.KC_DEV_ADMIN_PASSWORD;
});

describe("get_dev_instance_config", () => {
  // Without KC_DEV_URL, should return setup instructions
  it("returns setup instructions when KC_DEV_URL not set", async () => {
    delete process.env.KC_DEV_URL;
    const result = await getDevInstanceConfig();
    expect(result).toContain("KC_DEV_URL");
  });

  // When instance is unreachable, should report it
  it("reports unreachable instance", async () => {
    process.env.KC_DEV_URL = "http://localhost:9999";
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const result = await getDevInstanceConfig();
    expect(result).toContain("not reachable");
  });

  // Should fall back to admin API when Dev UI is unavailable
  it("falls back to admin API when Dev UI unavailable", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";

    globalThis.fetch = (async (url: string) => {
      const u = typeof url === "string" ? url : (url as Request).url;
      if (u.includes("/q/health")) {
        return new Response(JSON.stringify({ status: "UP" }), { status: 200 });
      }
      if (u.includes("/protocol/openid-connect/token")) {
        return new Response(
          JSON.stringify({ access_token: "token", expires_in: 300 }),
          { status: 200 }
        );
      }
      if (u.includes("/admin/serverinfo")) {
        return new Response(
          JSON.stringify({
            systemInfo: { version: "26.0.1" },
            providers: {
              authenticator: { internal: false, providers: { "auth-cookie": {} } },
            },
          }),
          { status: 200 }
        );
      }
      // Dev UI config endpoints return 404
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const result = await getDevInstanceConfig();
    expect(result).toContain("Configuration");
    expect(result).toContain("26.0.1");
  });
});
