/**
 * Tests for the log analyzer — parsing, filtering, and analyzing Keycloak log files.
 *
 * Uses fixture log files in tests/fixtures/logs/ that mirror realistic Keycloak
 * log output from Quarkus dev mode. Tests cover log parsing, filtering by class
 * and level, stack trace extraction, and auth flow summarization.
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readRecentLogs,
  parseLogEntry,
  filterByClass,
  filterByLevel,
  extractStackTrace,
  summarizeAuthFlow,
} from "../../src/live-dev/log-analyzer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "..", "fixtures", "logs");

describe("parseLogEntry", () => {
  // Verify a standard INFO log line is parsed correctly
  it("parses a standard Keycloak log line", () => {
    const entry = parseLogEntry(
      "2024-01-15 10:30:00,001 INFO  [org.keycloak.services] (main) KC-SERVICES0001: Loading config",
      1
    );
    expect(entry).not.toBeNull();
    expect(entry!.timestamp).toBe("2024-01-15 10:30:00,001");
    expect(entry!.level).toBe("INFO");
    expect(entry!.loggerName).toBe("org.keycloak.services");
    expect(entry!.threadName).toBe("main");
    expect(entry!.message).toContain("Loading config");
    expect(entry!.lineNumber).toBe(1);
  });

  // Verify ERROR level is correctly detected
  it("parses ERROR level correctly", () => {
    const entry = parseLogEntry(
      "2024-01-15 10:35:01,000 ERROR [org.keycloak.services] (executor-thread-3) Something failed",
      42
    );
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe("ERROR");
    expect(entry!.lineNumber).toBe(42);
  });

  // Verify WARN level is correctly detected
  it("parses WARN level correctly", () => {
    const entry = parseLogEntry(
      "2024-01-15 10:35:00,100 WARN  [org.keycloak.events] (executor-thread-3) type=LOGIN_ERROR",
      5
    );
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe("WARN");
  });

  // Verify non-log lines (stack traces, blank lines) return null
  it("returns null for non-log lines", () => {
    expect(parseLogEntry("	at org.keycloak.Foo.bar(Foo.java:42)")).toBeNull();
    expect(parseLogEntry("")).toBeNull();
    expect(parseLogEntry("just some random text")).toBeNull();
  });

  // Verify DEBUG level parsing
  it("parses DEBUG level", () => {
    const entry = parseLogEntry(
      "2024-01-15 10:40:00,060 DEBUG [org.keycloak.authentication.authenticators.browser.CookieAuthenticator] (executor-thread-5) No cookie found",
      3
    );
    expect(entry).not.toBeNull();
    expect(entry!.level).toBe("DEBUG");
    expect(entry!.loggerName).toContain("CookieAuthenticator");
  });
});

describe("readRecentLogs", () => {
  // Verify reading a normal log file returns structured entries
  it("reads and parses a normal log file", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-normal.log"));
    expect(entries.length).toBeGreaterThan(0);

    // First entry should be the Quarkus startup line
    expect(entries[0].loggerName).toBe("io.quarkus");
    expect(entries[0].level).toBe("INFO");
  });

  // Verify line limit is respected
  it("respects the lines parameter", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-normal.log"), 5);
    // Should return at most 5 parsed entries (may be fewer due to parsing)
    expect(entries.length).toBeLessThanOrEqual(5);
  });

  // Verify error when file doesn't exist
  it("throws for non-existent file", async () => {
    await expect(readRecentLogs("/nonexistent/path.log")).rejects.toThrow("not found");
  });

  // Verify stack trace continuation lines are appended to the preceding entry
  it("appends continuation lines to preceding entry", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-error.log"));
    const errorEntry = entries.find((e) => e.level === "ERROR");
    expect(errorEntry).toBeDefined();
    // The stack trace should be appended to the ERROR entry's message
    expect(errorEntry!.message).toContain("AuthenticationProcessor");
  });
});

describe("filterByClass", () => {
  // Verify filtering by class name works case-insensitively
  it("filters entries by class name substring", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-normal.log"));
    const filtered = filterByClass(entries, "AuthenticationProcessor");
    expect(filtered.length).toBeGreaterThan(0);
    for (const entry of filtered) {
      expect(entry.loggerName.toLowerCase()).toContain("authenticationprocessor");
    }
  });

  // Verify filtering returns empty for non-matching class
  it("returns empty array for non-matching class", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-normal.log"));
    const filtered = filterByClass(entries, "NonExistentClass12345");
    expect(filtered.length).toBe(0);
  });
});

describe("filterByLevel", () => {
  // Verify filtering by level returns only entries at or above that level
  it("filters by minimum level", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-error.log"));
    const errors = filterByLevel(entries, "ERROR");
    expect(errors.length).toBeGreaterThan(0);
    for (const entry of errors) {
      expect(["ERROR", "FATAL"]).toContain(entry.level);
    }
  });

  // Verify WARN level includes both WARN and ERROR
  it("WARN level includes WARN and ERROR", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-error.log"));
    const warnings = filterByLevel(entries, "WARN");
    const levels = warnings.map((e) => e.level);
    expect(levels).toContain("WARN");
    expect(levels).toContain("ERROR");
  });
});

describe("extractStackTrace", () => {
  // Verify stack trace extraction from error log
  it("extracts exception class and message", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-error.log"));
    const trace = extractStackTrace(entries);
    expect(trace).not.toBeNull();
    expect(trace!.exceptionClass).toContain("AuthenticationFlowException");
    expect(trace!.message).toContain("Invalid credentials");
  });

  // Verify stack frames are parsed
  it("parses stack frames with class, method, file, and line", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-error.log"));
    const trace = extractStackTrace(entries);
    expect(trace).not.toBeNull();
    expect(trace!.frames.length).toBeGreaterThan(0);

    const firstFrame = trace!.frames[0];
    expect(firstFrame.className).toContain("AuthenticationProcessor");
    expect(firstFrame.methodName).toBe("authenticateClient");
    expect(firstFrame.fileName).toBe("AuthenticationProcessor.java");
    expect(firstFrame.lineNumber).toBe(456);
  });

  // Verify caused-by chain is parsed
  it("parses caused-by chain", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-error.log"));
    const trace = extractStackTrace(entries);
    expect(trace).not.toBeNull();
    expect(trace!.causedBy.length).toBeGreaterThan(0);
    expect(trace!.causedBy[0].exceptionClass).toContain("LoginException");
  });

  // Verify no stack trace returns null
  it("returns null when no stack trace found", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-auth-flow.log"));
    const trace = extractStackTrace(entries);
    expect(trace).toBeNull();
  });
});

describe("summarizeAuthFlow", () => {
  // Verify auth flow steps are extracted from a login flow log
  it("extracts authentication flow steps", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-auth-flow.log"));
    const summary = summarizeAuthFlow(entries);
    expect(summary.steps.length).toBeGreaterThan(0);
  });

  // Verify flow completion is detected
  it("detects successful flow completion", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-auth-flow.log"));
    const summary = summarizeAuthFlow(entries);
    expect(summary.success).toBe(true);
  });

  // Verify steps have ordered numbers
  it("steps are numbered sequentially", async () => {
    const entries = await readRecentLogs(path.join(FIXTURES, "keycloak-auth-flow.log"));
    const summary = summarizeAuthFlow(entries);
    for (let i = 0; i < summary.steps.length; i++) {
      expect(summary.steps[i].order).toBe(i + 1);
    }
  });

  // Verify empty entries produce empty summary
  it("returns empty summary for non-auth logs", () => {
    const summary = summarizeAuthFlow([]);
    expect(summary.steps.length).toBe(0);
    expect(summary.success).toBe(false);
  });
});
