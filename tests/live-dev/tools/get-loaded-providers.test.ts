/**
 * Tests for the get_loaded_providers tool.
 *
 * Verifies provider listing with mocked HTTP client, including
 * filtering by SPI type and custom-only mode.
 */

import { describe, it, expect, afterEach } from "vitest";
import { getLoadedProviders } from "../../../src/live-dev/tools/get_loaded_providers.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KC_DEV_URL;
  delete process.env.KC_DEV_ADMIN_USERNAME;
  delete process.env.KC_DEV_ADMIN_PASSWORD;
});

function setupMockServer() {
  process.env.KC_DEV_URL = "http://localhost:8080";
  process.env.KC_DEV_ADMIN_USERNAME = "admin";
  process.env.KC_DEV_ADMIN_PASSWORD = "admin";

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
            authenticator: {
              internal: false,
              providers: {
                "auth-cookie": { order: 0, factoryClass: "org.keycloak.authentication.CookieAuthenticatorFactory" },
                "custom-auth": { order: 1, factoryClass: "com.mycompany.CustomAuthFactory" },
              },
            },
            "event-listener": {
              internal: false,
              providers: {
                "jboss-logging": { order: 0, factoryClass: "org.keycloak.events.JBossLoggingFactory" },
              },
            },
          },
        }),
        { status: 200 }
      );
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;
}

describe("get_loaded_providers", () => {
  // Without KC_DEV_URL, should return setup instructions
  it("returns setup instructions when KC_DEV_URL not set", async () => {
    delete process.env.KC_DEV_URL;
    const result = await getLoadedProviders();
    expect(result).toContain("KC_DEV_URL");
  });

  // Should list all providers when no filter
  it("lists all providers when no filter", async () => {
    setupMockServer();
    const result = await getLoadedProviders();
    expect(result).toContain("auth-cookie");
    expect(result).toContain("custom-auth");
    expect(result).toContain("jboss-logging");
  });

  // Should filter by SPI type
  it("filters by SPI type", async () => {
    setupMockServer();
    const result = await getLoadedProviders("authenticator");
    expect(result).toContain("auth-cookie");
    expect(result).not.toContain("jboss-logging");
  });

  // Should show only custom providers when customOnly is true
  it("shows only custom providers with customOnly flag", async () => {
    setupMockServer();
    const result = await getLoadedProviders(undefined, true);
    expect(result).toContain("custom-auth");
    expect(result).not.toContain("auth-cookie");
    expect(result).not.toContain("jboss-logging");
  });
});
