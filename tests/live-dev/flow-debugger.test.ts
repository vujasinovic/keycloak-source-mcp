/**
 * Tests for flow-debugger core logic — snapshot capture, log reading,
 * source resolution, error diagnosis, and annotated step building.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  captureLogSnapshot,
  readNewLogEntries,
  extractMethodSource,
  resolveAuthenticatorSource,
  diagnoseError,
  buildAnnotatedSteps,
  analyzeAuthFlow,
  formatFlowDiagnosis,
} from "../../src/live-dev/flow-debugger.js";
import { readRecentLogs } from "../../src/live-dev/log-analyzer.js";
import { setupMockEnv, cleanupEnv, MOCK_SOURCE_PATH } from "../test-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures", "logs");
const AUTH_FLOW_LOG = path.join(FIXTURES, "keycloak-auth-flow.log");
const AUTH_FLOW_ERROR_LOG = path.join(FIXTURES, "keycloak-auth-flow-error.log");

beforeEach(() => {
  setupMockEnv();
});

afterEach(() => {
  cleanupEnv();
});

describe("captureLogSnapshot", () => {
  it("returns correct line count for auth flow log", async () => {
    const snapshot = await captureLogSnapshot(AUTH_FLOW_LOG);
    const content = await fs.promises.readFile(AUTH_FLOW_LOG, "utf-8");
    const expectedLines = content.split("\n").length;

    expect(snapshot.logPath).toBe(AUTH_FLOW_LOG);
    expect(snapshot.lineCount).toBe(expectedLines);
    expect(snapshot.takenAt).toBeTruthy();
  });

  it("throws for missing file", async () => {
    await expect(captureLogSnapshot("/nonexistent/file.log")).rejects.toThrow("not found");
  });
});

describe("readNewLogEntries", () => {
  it("returns entries after the snapshot offset", async () => {
    // Snapshot at line 5 means we want entries from line 6 onward
    const snapshot = { logPath: AUTH_FLOW_LOG, lineCount: 5, takenAt: new Date().toISOString() };
    const entries = await readNewLogEntries(snapshot);
    expect(entries.length).toBeGreaterThan(0);
    // All entries should have line numbers > 5
    for (const entry of entries) {
      expect(entry.lineNumber).toBeGreaterThan(5);
    }
  });

  it("returns empty when no new lines since snapshot", async () => {
    const content = await fs.promises.readFile(AUTH_FLOW_LOG, "utf-8");
    const totalLines = content.split("\n").length;
    const snapshot = { logPath: AUTH_FLOW_LOG, lineCount: totalLines, takenAt: new Date().toISOString() };
    const entries = await readNewLogEntries(snapshot);
    expect(entries.length).toBe(0);
  });

  it("returns empty for truncated file", async () => {
    const snapshot = { logPath: AUTH_FLOW_LOG, lineCount: 99999, takenAt: new Date().toISOString() };
    const entries = await readNewLogEntries(snapshot);
    expect(entries.length).toBe(0);
  });
});

describe("extractMethodSource", () => {
  it("extracts a method body by name", () => {
    const source = `public class Foo {
    public void authenticate(Context ctx) {
        // Display the login form
        ctx.challenge();
    }

    public void action(Context ctx) {
        // Validate the submitted credentials
        ctx.success();
    }
}`;
    const result = extractMethodSource(source, "authenticate");
    expect(result).not.toBeNull();
    expect(result).toContain("authenticate");
    expect(result).toContain("Display the login form");
  });

  it("returns null for non-existent method", () => {
    const source = `public class Foo { public void bar() {} }`;
    expect(extractMethodSource(source, "nonExistent")).toBeNull();
  });
});

describe("resolveAuthenticatorSource", () => {
  it("finds UsernamePasswordForm via known mapping", async () => {
    const result = await resolveAuthenticatorSource(
      "auth-username-password-form",
      "org.keycloak.authentication.AuthenticationProcessor"
    );
    expect(result).not.toBeNull();
    expect(result!.className).toBe("UsernamePasswordForm");
    expect(result!.sourceFile).toContain("UsernamePasswordForm.java");
  });

  it("finds a class via logger class FQCN", async () => {
    const result = await resolveAuthenticatorSource(
      "some-unknown-id",
      "org.keycloak.authentication.authenticators.UsernamePasswordForm"
    );
    expect(result).not.toBeNull();
    expect(result!.className).toBe("UsernamePasswordForm");
  });

  it("returns null for unknown authenticator", async () => {
    const result = await resolveAuthenticatorSource(
      "totally-unknown-authenticator",
      "org.keycloak.authentication.AuthenticationProcessor"
    );
    expect(result).toBeNull();
  });
});

describe("diagnoseError", () => {
  it("extracts error diagnosis from error fixture", async () => {
    const entries = await readRecentLogs(AUTH_FLOW_ERROR_LOG);
    const diagnosis = await diagnoseError(entries);
    expect(diagnosis).not.toBeNull();
    expect(diagnosis!.exceptionClass).toContain("AuthenticationFlowException");
    expect(diagnosis!.message).toContain("Invalid user credentials");
    expect(diagnosis!.throwingFrame).toContain("AuthenticationProcessor");
    expect(diagnosis!.rootCauseClass).toContain("LoginException");
  });

  it("returns null for clean logs", async () => {
    const entries = await readRecentLogs(AUTH_FLOW_LOG);
    const diagnosis = await diagnoseError(entries);
    expect(diagnosis).toBeNull();
  });
});

describe("buildAnnotatedSteps", () => {
  it("produces annotated steps from auth flow fixture", async () => {
    const entries = await readRecentLogs(AUTH_FLOW_LOG);
    const steps = await buildAnnotatedSteps(entries);
    expect(steps.length).toBeGreaterThan(0);

    // Each step should have the base AuthFlowStep fields
    for (const step of steps) {
      expect(step.order).toBeGreaterThan(0);
      expect(step.authenticator).toBeTruthy();
      expect(step.logMessages).toBeInstanceOf(Array);
    }
  });
});

describe("formatFlowDiagnosis", () => {
  it("produces readable output", () => {
    const diagnosis = {
      realm: "test-realm",
      steps: [
        {
          order: 1,
          authenticator: "auth-cookie",
          result: "attempted",
          timestamp: "2024-01-15 10:40:00,050",
          loggerClass: "org.keycloak.authentication.AuthenticationProcessor",
          sourceFile: "CookieAuthenticator.java",
          className: "CookieAuthenticator",
          authenticateMethodSource: null,
          actionMethodSource: null,
          description: null,
          logMessages: ["Executing authenticator: auth-cookie"],
        },
      ],
      success: true,
      durationMs: 3000,
      errorDiagnosis: null,
      expectedFlow: "browser",
      newLogLines: 10,
    };

    const result = formatFlowDiagnosis(diagnosis);
    expect(result).toContain("Authentication Flow Debug Trace");
    expect(result).toContain("test-realm");
    expect(result).toContain("auth-cookie");
    expect(result).toContain("SUCCESS");
    expect(result).toContain("browser");
    expect(result).toContain("3000ms");
  });

  it("shows error diagnosis when present", () => {
    const diagnosis = {
      realm: "test-realm",
      steps: [],
      success: false,
      durationMs: -1,
      errorDiagnosis: {
        exceptionClass: "AuthenticationFlowException",
        message: "Invalid credentials",
        throwingFrame: "AuthenticationProcessor.authenticateClient(AuthenticationProcessor.java:456)",
        throwingMethodSource: null,
        explanation: "The authentication flow threw an exception.",
        rootCauseClass: "LoginException",
        rootCauseMessage: "Login failed",
      },
      expectedFlow: null,
      newLogLines: 5,
    };

    const result = formatFlowDiagnosis(diagnosis);
    expect(result).toContain("Error Diagnosis");
    expect(result).toContain("AuthenticationFlowException");
    expect(result).toContain("Invalid credentials");
    expect(result).toContain("LoginException");
  });
});

describe("analyzeAuthFlow", () => {
  it("end-to-end: produces diagnosis from snapshot at beginning of file", async () => {
    const snapshot = { logPath: AUTH_FLOW_LOG, lineCount: 0, takenAt: new Date().toISOString() };
    const diagnosis = await analyzeAuthFlow(snapshot, "test-realm");
    expect(diagnosis.realm).toBe("test-realm");
    expect(diagnosis.newLogLines).toBeGreaterThan(0);
    expect(diagnosis.steps.length).toBeGreaterThan(0);
    expect(diagnosis.success).toBe(true);
  });
});
