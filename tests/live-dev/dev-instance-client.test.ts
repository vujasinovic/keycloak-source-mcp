/**
 * Tests for DevInstanceClient — the core HTTP client for Keycloak dev instances.
 *
 * All HTTP calls are mocked using vi.fn() to replace global fetch.
 * This allows testing the client's logic without a real Keycloak instance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DevInstanceClient, getDevConfig, getSetupInstructions } from "../../src/live-dev/dev-instance-client.js";

// Mock fetch globally for all tests
const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = handler as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

const testConfig = {
  url: "http://localhost:8080",
  realm: "master",
  adminUsername: "admin",
  adminPassword: "admin",
};

describe("DevInstanceClient", () => {
  afterEach(() => {
    restoreFetch();
  });

  // Verify isRunning returns false when the health endpoint is unreachable
  it("isRunning returns false when instance not available", async () => {
    mockFetch(async () => {
      throw new Error("ECONNREFUSED");
    });

    const client = new DevInstanceClient(testConfig);
    expect(await client.isRunning()).toBe(false);
  });

  // Verify isRunning returns true when the health endpoint responds 200
  it("isRunning returns true when health endpoint responds", async () => {
    mockFetch(async (url) => {
      if (url.includes("/q/health")) {
        return new Response(JSON.stringify({ status: "UP" }), { status: 200 });
      }
      throw new Error("unexpected URL");
    });

    const client = new DevInstanceClient(testConfig);
    expect(await client.isRunning()).toBe(true);
  });

  // Verify isRunning returns false on non-200 health responses
  it("isRunning returns false on 503 status", async () => {
    mockFetch(async () => {
      return new Response("Service Unavailable", { status: 503 });
    });

    const client = new DevInstanceClient(testConfig);
    expect(await client.isRunning()).toBe(false);
  });

  // Verify token acquisition returns a JWT and caches it
  it("getAdminToken returns token and caches it", async () => {
    let tokenCalls = 0;
    mockFetch(async (url) => {
      if (url.includes("/protocol/openid-connect/token")) {
        tokenCalls++;
        return new Response(
          JSON.stringify({ access_token: "test-jwt-token", expires_in: 300 }),
          { status: 200 }
        );
      }
      throw new Error("unexpected URL");
    });

    const client = new DevInstanceClient(testConfig);
    const token1 = await client.getAdminToken();
    const token2 = await client.getAdminToken();

    // Token should be the same (cached)
    expect(token1).toBe("test-jwt-token");
    expect(token2).toBe("test-jwt-token");
    // Only one HTTP call should have been made (second is cached)
    expect(tokenCalls).toBe(1);
  });

  // Verify token error handling
  it("getAdminToken throws on authentication failure", async () => {
    mockFetch(async () => {
      return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
    });

    const client = new DevInstanceClient(testConfig);
    await expect(client.getAdminToken()).rejects.toThrow("Admin token acquisition failed");
  });

  // Verify getRegisteredProviders parses provider data correctly
  it("getRegisteredProviders correctly parses provider list", async () => {
    mockFetch(async (url) => {
      if (url.includes("/protocol/openid-connect/token")) {
        return new Response(
          JSON.stringify({ access_token: "token", expires_in: 300 }),
          { status: 200 }
        );
      }
      if (url.includes("/admin/serverinfo")) {
        return new Response(
          JSON.stringify({
            systemInfo: { version: "26.0.1" },
            providers: {
              authenticator: {
                internal: false,
                providers: {
                  "auth-cookie": { order: 0, factoryClass: "org.keycloak.authentication.authenticators.browser.CookieAuthenticatorFactory" },
                  "custom-auth": { order: 1, factoryClass: "com.mycompany.CustomAuthFactory" },
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      throw new Error("unexpected URL: " + url);
    });

    const client = new DevInstanceClient(testConfig);
    const providers = await client.getRegisteredProviders();

    expect(providers.length).toBe(2);
    expect(providers[0].spiType).toBe("authenticator");
    expect(providers[0].providerId).toBe("auth-cookie");
    expect(providers[0].isBuiltIn).toBe(true);
    expect(providers[1].providerId).toBe("custom-auth");
    expect(providers[1].isBuiltIn).toBe(false);
  });

  // Verify getRegisteredProviders filters by type
  it("getRegisteredProviders filters by spiType", async () => {
    mockFetch(async (url) => {
      if (url.includes("/protocol/openid-connect/token")) {
        return new Response(
          JSON.stringify({ access_token: "token", expires_in: 300 }),
          { status: 200 }
        );
      }
      if (url.includes("/admin/serverinfo")) {
        return new Response(
          JSON.stringify({
            systemInfo: { version: "26.0.1" },
            providers: {
              authenticator: { internal: false, providers: { "auth-cookie": { order: 0 } } },
              "event-listener": { internal: false, providers: { "jboss-logging": { order: 0 } } },
            },
          }),
          { status: 200 }
        );
      }
      throw new Error("unexpected URL");
    });

    const client = new DevInstanceClient(testConfig);
    const authOnly = await client.getRegisteredProviders("authenticator");
    expect(authOnly.length).toBe(1);
    expect(authOnly[0].spiType).toBe("authenticator");
  });

  // Verify getServerInfo parses version and counts
  it("getServerInfo returns version and counts", async () => {
    mockFetch(async (url) => {
      if (url.includes("/protocol/openid-connect/token")) {
        return new Response(
          JSON.stringify({ access_token: "token", expires_in: 300 }),
          { status: 200 }
        );
      }
      if (url.includes("/admin/serverinfo")) {
        return new Response(
          JSON.stringify({
            systemInfo: { version: "26.0.1" },
            providers: {
              authenticator: { internal: false, providers: { a: {}, b: {} } },
              "event-listener": { internal: false, providers: { c: {} } },
            },
          }),
          { status: 200 }
        );
      }
      throw new Error("unexpected URL");
    });

    const client = new DevInstanceClient(testConfig);
    const info = await client.getServerInfo();
    expect(info.keycloakVersion).toBe("26.0.1");
    expect(info.spiCount).toBe(2);
    expect(info.providerCount).toBe(3);
  });

  // Verify clearTokenCache forces re-authentication
  it("clearTokenCache forces re-authentication", async () => {
    let tokenCalls = 0;
    mockFetch(async (url) => {
      if (url.includes("/protocol/openid-connect/token")) {
        tokenCalls++;
        return new Response(
          JSON.stringify({ access_token: `token-${tokenCalls}`, expires_in: 300 }),
          { status: 200 }
        );
      }
      throw new Error("unexpected URL");
    });

    const client = new DevInstanceClient(testConfig);
    await client.getAdminToken();
    client.clearTokenCache();
    const token2 = await client.getAdminToken();

    expect(tokenCalls).toBe(2);
    expect(token2).toBe("token-2");
  });
});

describe("getDevConfig", () => {
  // Verify null returned when KC_DEV_URL not set
  it("returns null when KC_DEV_URL not set", () => {
    delete process.env.KC_DEV_URL;
    expect(getDevConfig()).toBeNull();
  });

  // Verify config is populated from env vars
  it("reads configuration from env vars", () => {
    process.env.KC_DEV_URL = "http://localhost:9090";
    process.env.KC_DEV_REALM = "test";
    process.env.KC_DEV_ADMIN_USERNAME = "testadmin";
    process.env.KC_DEV_ADMIN_PASSWORD = "testpass";
    process.env.KC_DEV_LOG_PATH = "/tmp/kc.log";

    const config = getDevConfig();
    expect(config).not.toBeNull();
    expect(config!.url).toBe("http://localhost:9090");
    expect(config!.realm).toBe("test");
    expect(config!.adminUsername).toBe("testadmin");
    expect(config!.adminPassword).toBe("testpass");
    expect(config!.logPath).toBe("/tmp/kc.log");

    delete process.env.KC_DEV_URL;
    delete process.env.KC_DEV_REALM;
    delete process.env.KC_DEV_ADMIN_USERNAME;
    delete process.env.KC_DEV_ADMIN_PASSWORD;
    delete process.env.KC_DEV_LOG_PATH;
  });

  // Verify defaults are used when optional vars not set
  it("uses defaults for optional vars", () => {
    process.env.KC_DEV_URL = "http://localhost:8080";

    const config = getDevConfig();
    expect(config!.realm).toBe("master");
    expect(config!.adminUsername).toBe("admin");
    expect(config!.adminPassword).toBe("admin");
    expect(config!.logPath).toBeUndefined();

    delete process.env.KC_DEV_URL;
  });

  // Verify trailing slashes are stripped from URL
  it("strips trailing slashes from URL", () => {
    process.env.KC_DEV_URL = "http://localhost:8080///";
    const config = getDevConfig();
    expect(config!.url).toBe("http://localhost:8080");
    delete process.env.KC_DEV_URL;
  });
});

describe("getSetupInstructions", () => {
  // Verify setup instructions contain essential information
  it("returns helpful setup instructions", () => {
    const instructions = getSetupInstructions();
    expect(instructions).toContain("KC_DEV_URL");
    expect(instructions).toContain("environment variable");
    expect(instructions).toContain("IDELauncher");
  });
});
