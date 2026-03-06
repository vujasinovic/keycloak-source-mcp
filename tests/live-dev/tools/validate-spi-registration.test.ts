/**
 * Tests for the validate_spi_registration tool.
 *
 * Verifies validation works with mocked HTTP client and handles
 * missing configuration gracefully.
 */

import { describe, it, expect, afterEach } from "vitest";
import { validateSpiRegistration } from "../../../src/live-dev/tools/validate_spi_registration.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KC_DEV_URL;
  delete process.env.KC_DEV_ADMIN_USERNAME;
  delete process.env.KC_DEV_ADMIN_PASSWORD;
});

describe("validate_spi_registration", () => {
  // Without KC_DEV_URL, should return setup instructions
  it("returns setup instructions when KC_DEV_URL not set", async () => {
    delete process.env.KC_DEV_URL;
    const result = await validateSpiRegistration();
    expect(result).toContain("KC_DEV_URL");
  });

  // When instance is down, should report it
  it("reports unreachable instance", async () => {
    process.env.KC_DEV_URL = "http://localhost:9999";
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const result = await validateSpiRegistration();
    expect(result).toContain("not reachable");
  });

  // When no custom providers found, should say so
  it("reports no custom providers when all are built-in", async () => {
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
              authenticator: {
                internal: false,
                providers: {
                  "auth-cookie": { order: 0, factoryClass: "org.keycloak.authentication.CookieAuthenticatorFactory" },
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;

    const result = await validateSpiRegistration();
    expect(result).toContain("No custom providers");
  });
});
