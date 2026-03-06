/**
 * Tests for user-diagnostics core module.
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  extractBruteForcePolicy,
  formatDiagnosticReport,
  type DiagnosticReport,
  type UserRepresentation,
  type CredentialRepresentation,
  type LoginEvent,
  type UserSession,
  type BruteForceStatus,
  type BruteForcePolicy,
  type DiagnosticIssue,
} from "../../src/live-dev/user-diagnostics.js";

describe("extractBruteForcePolicy", () => {
  it("returns null when brute force is not enabled", () => {
    const result = extractBruteForcePolicy({ bruteForceProtected: false });
    expect(result).toBeNull();
  });

  it("returns null when field is missing", () => {
    const result = extractBruteForcePolicy({});
    expect(result).toBeNull();
  });

  it("extracts policy when enabled", () => {
    const result = extractBruteForcePolicy({
      bruteForceProtected: true,
      maxFailureWaitSeconds: 900,
      waitIncrementSeconds: 60,
      maxDeltaTimeSeconds: 43200,
      failureFactor: 5,
      permanentLockout: false,
    });
    expect(result).toEqual({
      enabled: true,
      maxFailureWaitSeconds: 900,
      waitIncrementSeconds: 60,
      maxDeltaTimeSeconds: 43200,
      failureFactor: 5,
      permanentLockout: false,
    });
  });

  it("uses defaults for missing fields", () => {
    const result = extractBruteForcePolicy({ bruteForceProtected: true });
    expect(result).not.toBeNull();
    expect(result!.failureFactor).toBe(30);
    expect(result!.maxFailureWaitSeconds).toBe(900);
  });
});

describe("formatDiagnosticReport", () => {
  function makeReport(overrides: Partial<DiagnosticReport> = {}): DiagnosticReport {
    return {
      user: {
        id: "abc-123",
        username: "john.doe",
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        emailVerified: true,
        enabled: true,
        requiredActions: [],
        createdTimestamp: 1700000000000,
      },
      realm: "master",
      credentials: [{ id: "cred-1", type: "password", createdDate: 1700000000000 }],
      bruteForce: null,
      recentEvents: [],
      sessions: [],
      realmBruteForcePolicy: null,
      realmPasswordPolicy: null,
      issues: [],
      ...overrides,
    };
  }

  it("formats a healthy user report", () => {
    const report = makeReport();
    const output = formatDiagnosticReport(report);

    expect(output).toContain("User Diagnosis — John Doe (john@example.com)");
    expect(output).toContain("Username: john.doe");
    expect(output).toContain("Realm: master");
    expect(output).toContain("Status: ENABLED");
    expect(output).toContain("Email verified: YES");
    expect(output).toContain("password");
    expect(output).toContain("No critical issues or warnings detected.");
  });

  it("shows disabled status", () => {
    const report = makeReport({
      user: {
        id: "abc-123",
        username: "john.doe",
        enabled: false,
        emailVerified: false,
      },
    });
    const output = formatDiagnosticReport(report);
    expect(output).toContain("Status: DISABLED");
    expect(output).toContain("Email verified: NO");
  });

  it("formats critical issues", () => {
    const report = makeReport({
      issues: [
        {
          severity: "critical",
          title: "Account is disabled",
          detail: "The user account has been manually disabled.",
          suggestion: "Re-enable the account.",
        },
      ],
    });
    const output = formatDiagnosticReport(report);
    expect(output).toContain("[CRITICAL] Account is disabled");
    expect(output).toContain("Re-enable the account.");
  });

  it("formats warning issues", () => {
    const report = makeReport({
      issues: [
        {
          severity: "warning",
          title: "Email not verified",
          detail: "Email john@example.com has not been verified.",
        },
      ],
    });
    const output = formatDiagnosticReport(report);
    expect(output).toContain("[WARNING] Email not verified");
  });

  it("formats login events", () => {
    const report = makeReport({
      recentEvents: [
        {
          time: 1700000000000,
          type: "LOGIN_ERROR",
          clientId: "my-app",
          ipAddress: "192.168.1.1",
          error: "invalid_user_credentials",
        },
        {
          time: 1699999000000,
          type: "LOGIN",
          clientId: "my-app",
          ipAddress: "192.168.1.1",
        },
      ],
    });
    const output = formatDiagnosticReport(report);
    expect(output).toContain("[FAIL]");
    expect(output).toContain("LOGIN_ERROR");
    expect(output).toContain("invalid_user_credentials");
    expect(output).toContain("[ OK ]");
    expect(output).toContain("client: my-app");
  });

  it("formats active sessions", () => {
    const report = makeReport({
      sessions: [
        {
          id: "sess-1",
          userId: "abc-123",
          ipAddress: "10.0.0.1",
          start: 1700000000,
          lastAccess: 1700001000,
          clients: { "client-1": "my-app" },
        },
      ],
    });
    const output = formatDiagnosticReport(report);
    expect(output).toContain("from 10.0.0.1");
    expect(output).toContain("Clients: my-app");
  });

  it("formats brute force policy", () => {
    const report = makeReport({
      realmBruteForcePolicy: {
        enabled: true,
        maxFailureWaitSeconds: 900,
        waitIncrementSeconds: 60,
        maxDeltaTimeSeconds: 43200,
        failureFactor: 5,
        permanentLockout: false,
      },
    });
    const output = formatDiagnosticReport(report);
    expect(output).toContain("Brute Force Policy");
    expect(output).toContain("Failure threshold: 5");
    expect(output).toContain("15m");
  });

  it("formats password policy", () => {
    const report = makeReport({
      realmPasswordPolicy: "length(8) and upperCase(1) and digit(1)",
    });
    const output = formatDiagnosticReport(report);
    expect(output).toContain("Password Policy");
    expect(output).toContain("length(8)");
  });

  it("formats required actions", () => {
    const report = makeReport({
      user: {
        id: "abc-123",
        username: "john.doe",
        firstName: "John",
        lastName: "Doe",
        enabled: true,
        requiredActions: ["UPDATE_PASSWORD", "VERIFY_EMAIL"],
      },
    });
    const output = formatDiagnosticReport(report);
    expect(output).toContain("Required actions: UPDATE_PASSWORD, VERIFY_EMAIL");
  });

  it("shows no credentials message", () => {
    const report = makeReport({ credentials: [] });
    const output = formatDiagnosticReport(report);
    expect(output).toContain("No credentials configured.");
  });

  it("formats info issues as notes", () => {
    const report = makeReport({
      issues: [
        {
          severity: "info",
          title: "No login events available",
          detail: "No login events found. Event logging may be disabled.",
          suggestion: "Enable event logging.",
        },
      ],
    });
    const output = formatDiagnosticReport(report);
    expect(output).toContain("Notes");
    expect(output).toContain("No login events available");
  });

  it("truncates long event lists", () => {
    const events: LoginEvent[] = Array.from({ length: 20 }, (_, i) => ({
      time: 1700000000000 + i * 1000,
      type: "LOGIN_ERROR",
      error: "invalid_user_credentials",
    }));
    const report = makeReport({ recentEvents: events });
    const output = formatDiagnosticReport(report);
    expect(output).toContain("... and 5 more events");
  });
});
