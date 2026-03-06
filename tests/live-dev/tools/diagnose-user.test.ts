/**
 * Tests for the diagnose_user tool wrapper.
 */

import { describe, it, expect, afterEach } from "vitest";
import { diagnoseUserTool } from "../../../src/live-dev/tools/diagnose_user.js";
import { cleanupEnv } from "../../test-utils.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.KC_DEV_URL;
  delete process.env.KC_DEV_ADMIN_USERNAME;
  delete process.env.KC_DEV_ADMIN_PASSWORD;
  cleanupEnv();
});

describe("diagnose_user tool", () => {
  it("returns error for empty query", async () => {
    const result = await diagnoseUserTool("");
    expect(result).toContain("query is required");
  });

  it("returns setup instructions when KC_DEV_URL not set", async () => {
    delete process.env.KC_DEV_URL;
    const result = await diagnoseUserTool("john");
    expect(result).toContain("KC_DEV_URL");
    expect(result).toContain("not configured");
  });

  it("returns connection error when instance is not reachable", async () => {
    process.env.KC_DEV_URL = "http://localhost:19999";
    globalThis.fetch = async () => {
      throw new Error("Connection refused");
    };
    const result = await diagnoseUserTool("john");
    expect(result).toContain("Cannot connect");
  });

  it("returns no-user-found message when search returns empty", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    process.env.KC_DEV_ADMIN_USERNAME = "admin";
    process.env.KC_DEV_ADMIN_PASSWORD = "admin";

    let callCount = 0;
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      callCount++;

      // Health check
      if (url.includes("/q/health")) {
        return new Response(JSON.stringify({ status: "UP" }), { status: 200 });
      }

      // Token endpoint
      if (url.includes("/openid-connect/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock-token", expires_in: 300 }),
          { status: 200 }
        );
      }

      // User search — return empty
      if (url.includes("/users?search=")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    };

    const result = await diagnoseUserTool("nonexistent-user", "master");
    expect(result).toContain("No user found");
    expect(result).toContain("nonexistent-user");
  });

  it("produces a full diagnostic report for a found user", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    process.env.KC_DEV_ADMIN_USERNAME = "admin";
    process.env.KC_DEV_ADMIN_PASSWORD = "admin";

    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/q/health")) {
        return new Response(JSON.stringify({ status: "UP" }), { status: 200 });
      }

      if (url.includes("/openid-connect/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock-token", expires_in: 300 }),
          { status: 200 }
        );
      }

      // User search
      if (url.includes("/users?search=")) {
        return new Response(
          JSON.stringify([
            {
              id: "user-123",
              username: "john.doe",
              firstName: "John",
              lastName: "Doe",
              email: "john@example.com",
              emailVerified: true,
              enabled: true,
              requiredActions: [],
              createdTimestamp: 1700000000000,
            },
          ]),
          { status: 200 }
        );
      }

      // Credentials
      if (url.includes("/credentials")) {
        return new Response(
          JSON.stringify([
            { id: "cred-1", type: "password", createdDate: 1700000000000 },
          ]),
          { status: 200 }
        );
      }

      // Brute force
      if (url.includes("/attack-detection/")) {
        return new Response(
          JSON.stringify({ numFailures: 0, disabled: false }),
          { status: 200 }
        );
      }

      // Events
      if (url.includes("/events?")) {
        return new Response(
          JSON.stringify([
            {
              time: 1700000000000,
              type: "LOGIN",
              clientId: "my-app",
              ipAddress: "192.168.1.1",
            },
          ]),
          { status: 200 }
        );
      }

      // Sessions
      if (url.includes("/sessions")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      // Realm settings
      if (url.match(/\/admin\/realms\/[^/]+$/)) {
        return new Response(
          JSON.stringify({
            realm: "master",
            bruteForceProtected: false,
            passwordPolicy: null,
          }),
          { status: 200 }
        );
      }

      return new Response("Not found", { status: 404 });
    };

    const result = await diagnoseUserTool("John Doe", "master");
    expect(result).toContain("User Diagnosis");
    expect(result).toContain("John Doe");
    expect(result).toContain("john@example.com");
    expect(result).toContain("john.doe");
    expect(result).toContain("ENABLED");
    expect(result).toContain("password");
    expect(result).toContain("[ OK ]");
    expect(result).toContain("LOGIN");
  });

  it("detects brute force lockout in report", async () => {
    process.env.KC_DEV_URL = "http://localhost:8080";
    process.env.KC_DEV_ADMIN_USERNAME = "admin";
    process.env.KC_DEV_ADMIN_PASSWORD = "admin";

    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("/q/health")) {
        return new Response(JSON.stringify({ status: "UP" }), { status: 200 });
      }

      if (url.includes("/openid-connect/token")) {
        return new Response(
          JSON.stringify({ access_token: "mock-token", expires_in: 300 }),
          { status: 200 }
        );
      }

      if (url.includes("/users?search=")) {
        return new Response(
          JSON.stringify([
            {
              id: "user-456",
              username: "locked.user",
              enabled: true,
              emailVerified: true,
              requiredActions: [],
            },
          ]),
          { status: 200 }
        );
      }

      if (url.includes("/credentials")) {
        return new Response(
          JSON.stringify([{ id: "cred-1", type: "password" }]),
          { status: 200 }
        );
      }

      if (url.includes("/attack-detection/")) {
        return new Response(
          JSON.stringify({
            numFailures: 5,
            disabled: true,
            lastIPFailure: "10.0.0.1",
            lastFailure: 1700000000000,
          }),
          { status: 200 }
        );
      }

      if (url.includes("/events?")) {
        return new Response(
          JSON.stringify([
            { time: 1700000000000, type: "LOGIN_ERROR", error: "invalid_user_credentials", ipAddress: "10.0.0.1" },
            { time: 1699999900000, type: "LOGIN_ERROR", error: "invalid_user_credentials", ipAddress: "10.0.0.1" },
            { time: 1699999800000, type: "LOGIN_ERROR", error: "invalid_user_credentials", ipAddress: "10.0.0.1" },
          ]),
          { status: 200 }
        );
      }

      if (url.includes("/sessions")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }

      if (url.match(/\/admin\/realms\/[^/]+$/)) {
        return new Response(
          JSON.stringify({
            realm: "master",
            bruteForceProtected: true,
            failureFactor: 5,
            maxFailureWaitSeconds: 1800,
            waitIncrementSeconds: 60,
            maxDeltaTimeSeconds: 43200,
            permanentLockout: false,
          }),
          { status: 200 }
        );
      }

      return new Response("Not found", { status: 404 });
    };

    const result = await diagnoseUserTool("locked.user", "master");
    expect(result).toContain("[CRITICAL]");
    expect(result).toContain("brute force");
    expect(result).toContain("Failed attempts: 5");
    expect(result).toContain("Brute Force Policy");
    expect(result).toContain("Failure threshold: 5");
    expect(result).toContain("invalid_user_credentials");
  });
});
