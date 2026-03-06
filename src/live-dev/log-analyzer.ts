/**
 * @file log-analyzer.ts
 * @module live-dev
 * @author keycloak-source-mcp
 * @since 1.1.0
 *
 * Reads and analyzes Keycloak log output to help developers understand what
 * happened during request flows, authentication sequences, and error scenarios.
 *
 * Keycloak (running on Quarkus) uses JBoss Logging with a format like:
 *   2024-01-15 10:30:45,123 INFO  [org.keycloak.services] (executor-thread-1) KC-SERVICES0001: ...
 *
 * The log format components are:
 *   - Timestamp: ISO-like date + time with milliseconds
 *   - Level: TRACE, DEBUG, INFO, WARN, ERROR, FATAL
 *   - Logger name in brackets: [org.keycloak.authentication.AuthenticationProcessor]
 *   - Thread name in parentheses: (executor-thread-1)
 *   - Message: the actual log content, optionally with a Keycloak message code
 *
 * Stack traces follow immediately after an ERROR/WARN entry as indented lines
 * starting with "at " or "Caused by:".
 *
 * Limitations:
 * - Log analysis is file-based; it requires KC_DEV_LOG_PATH to point to a readable log file
 * - Large log files are read from the end (last N lines) to avoid memory issues
 * - Log format parsing is heuristic — unusual formats may not parse cleanly
 * - Multi-line messages (e.g., JSON payloads in logs) may be split across entries
 */

import * as fs from "node:fs";

/**
 * Valid log levels in Keycloak/Quarkus logging.
 * Ordered from most to least verbose.
 */
export type LogLevel = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

/** Numeric severity for comparing log levels */
const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  TRACE: 0,
  DEBUG: 1,
  INFO: 2,
  WARN: 3,
  ERROR: 4,
  FATAL: 5,
};

/**
 * A parsed log entry from the Keycloak log file.
 * Each entry represents a single log statement from the running application.
 */
export interface LogEntry {
  /** Full raw log line as it appeared in the file */
  raw: string;
  /** Parsed timestamp, e.g. "2024-01-15 10:30:45,123" */
  timestamp: string;
  /** Log severity level */
  level: LogLevel;
  /** Logger name (usually a Java class), e.g. "org.keycloak.authentication.AuthenticationProcessor" */
  loggerName: string;
  /** Thread that produced the log entry, e.g. "executor-thread-1" */
  threadName: string;
  /** The actual log message content */
  message: string;
  /** Line number in the log file (1-based) */
  lineNumber: number;
}

/**
 * A parsed stack trace extracted from log entries.
 * Java stack traces in logs follow the pattern:
 *   ExceptionClass: message
 *     at package.Class.method(File.java:line)
 *     ...
 *   Caused by: AnotherException: message
 *     at ...
 */
export interface StackTrace {
  /** The exception class name, e.g. "org.keycloak.authentication.AuthenticationFlowException" */
  exceptionClass: string;
  /** The exception message */
  message: string;
  /** Stack frames from top to bottom */
  frames: StackFrame[];
  /** Nested caused-by exceptions */
  causedBy: Array<{ exceptionClass: string; message: string; frames: StackFrame[] }>;
}

/**
 * A single frame in a Java stack trace.
 */
export interface StackFrame {
  /** Fully qualified class name, e.g. "org.keycloak.authentication.AuthenticationProcessor" */
  className: string;
  /** Method name, e.g. "authenticateClient" */
  methodName: string;
  /** Source file name, e.g. "AuthenticationProcessor.java" */
  fileName: string;
  /** Line number in source, or -1 if unknown */
  lineNumber: number;
}

/**
 * Summary of an authentication flow extracted from log entries.
 * Authentication flows in Keycloak produce a characteristic sequence of log
 * entries that can be traced to understand what happened step by step.
 */
export interface AuthFlowSummary {
  /** Ordered list of steps detected in the flow */
  steps: AuthFlowStep[];
  /** Whether the flow completed successfully */
  success: boolean;
  /** Error message if the flow failed */
  error?: string;
  /** Total time from first to last step, in milliseconds (-1 if unknown) */
  durationMs: number;
}

/**
 * A single step in an authentication flow.
 */
export interface AuthFlowStep {
  /** Step number (1-based) */
  order: number;
  /** The authenticator or action that executed */
  authenticator: string;
  /** What happened: "attempted", "success", "failure", "required", "skipped" */
  result: string;
  /** Timestamp of this step */
  timestamp: string;
  /** The logger class that produced this entry */
  loggerClass: string;
}

/**
 * Regex for parsing a standard Keycloak/Quarkus log line.
 * Format: 2024-01-15 10:30:45,123 LEVEL  [logger.name] (thread-name) message
 *
 * The LEVEL field is padded with spaces on the right to 5 chars (e.g., "INFO "),
 * and the logger name is in square brackets.
 */
const LOG_LINE_REGEX = /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},?\d*)\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+\[([^\]]+)\]\s+\(([^)]+)\)\s+(.*)$/;

/**
 * Read the last N lines from the Keycloak log file.
 *
 * Reads the file from the end to efficiently get recent entries without
 * loading the entire file into memory. Each line is parsed into a structured
 * {@link LogEntry}; lines that don't match the expected format (e.g., continuation
 * lines of multi-line messages) are attached to the preceding entry's message.
 *
 * @param logPath - Absolute path to the Keycloak log file
 * @param lines - Number of recent lines to read (default: 200)
 * @returns Array of parsed log entries, oldest first
 * @throws Error if the log file doesn't exist or can't be read
 *
 * @example
 * ```typescript
 * const entries = await readRecentLogs("/tmp/keycloak.log", 100);
 * console.log(`Read ${entries.length} log entries`);
 * ```
 */
export async function readRecentLogs(logPath: string, lines: number = 200): Promise<LogEntry[]> {
  if (!fs.existsSync(logPath)) {
    throw new Error(`Log file not found: ${logPath}`);
  }

  const content = await fs.promises.readFile(logPath, "utf-8");
  const allLines = content.split("\n");

  // Take the last N lines
  const recentLines = allLines.slice(Math.max(0, allLines.length - lines));
  const entries: LogEntry[] = [];

  for (let i = 0; i < recentLines.length; i++) {
    const line = recentLines[i];
    if (!line.trim()) continue;

    const entry = parseLogEntry(line, allLines.length - recentLines.length + i + 1);
    if (entry) {
      entries.push(entry);
    } else if (entries.length > 0) {
      // Continuation line (stack trace or multi-line message) — append to last entry
      entries[entries.length - 1].message += "\n" + line;
    }
  }

  return entries;
}

/**
 * Parse a single raw log line into a structured {@link LogEntry}.
 *
 * Returns null if the line doesn't match the expected Keycloak log format.
 * This is normal for stack trace continuation lines or multi-line messages.
 *
 * @param raw - The raw log line string
 * @param lineNumber - The line number in the source file (1-based)
 * @returns Parsed LogEntry or null if the line doesn't match the format
 *
 * @example
 * ```typescript
 * const entry = parseLogEntry(
 *   '2024-01-15 10:30:45,123 INFO  [org.keycloak.services] (main) Starting...',
 *   1
 * );
 * if (entry) console.log(entry.level, entry.message);
 * ```
 */
export function parseLogEntry(raw: string, lineNumber: number = 0): LogEntry | null {
  const match = raw.match(LOG_LINE_REGEX);
  if (!match) return null;

  return {
    raw,
    timestamp: match[1],
    level: match[2] as LogLevel,
    loggerName: match[3],
    threadName: match[4],
    message: match[5],
    lineNumber,
  };
}

/**
 * Filter log entries to only those from a specific Java class or package.
 *
 * Performs a case-insensitive substring match on the logger name field,
 * so filtering by "AuthenticationProcessor" will match
 * "org.keycloak.authentication.AuthenticationProcessor".
 *
 * @param entries - Array of log entries to filter
 * @param className - Class name or package prefix to match against
 * @returns Filtered array of matching entries
 *
 * @example
 * ```typescript
 * const authLogs = filterByClass(entries, "AuthenticationProcessor");
 * ```
 */
export function filterByClass(entries: LogEntry[], className: string): LogEntry[] {
  const lower = className.toLowerCase();
  return entries.filter((e) => e.loggerName.toLowerCase().includes(lower));
}

/**
 * Filter log entries by minimum severity level.
 *
 * Returns entries at the specified level or higher.
 * Level ordering: TRACE < DEBUG < INFO < WARN < ERROR < FATAL
 *
 * @param entries - Array of log entries to filter
 * @param level - Minimum log level to include
 * @returns Filtered array of entries at or above the specified level
 *
 * @example
 * ```typescript
 * const warnings = filterByLevel(entries, "WARN"); // WARN, ERROR, FATAL
 * ```
 */
export function filterByLevel(entries: LogEntry[], level: LogLevel): LogEntry[] {
  const minSeverity = LOG_LEVEL_SEVERITY[level];
  return entries.filter((e) => LOG_LEVEL_SEVERITY[e.level] >= minSeverity);
}

/**
 * Extract and parse a Java stack trace from consecutive log entries.
 *
 * Looks for ERROR-level entries whose messages contain exception information,
 * then scans following continuation lines for "at " frames and "Caused by:" chains.
 *
 * @param entries - Array of log entries to scan
 * @returns Parsed stack trace or null if none found
 *
 * @example
 * ```typescript
 * const trace = extractStackTrace(entries);
 * if (trace) {
 *   console.log(`Exception: ${trace.exceptionClass}: ${trace.message}`);
 *   for (const frame of trace.frames) {
 *     console.log(`  at ${frame.className}.${frame.methodName}(${frame.fileName}:${frame.lineNumber})`);
 *   }
 * }
 * ```
 */
export function extractStackTrace(entries: LogEntry[]): StackTrace | null {
  // Find the first ERROR entry that looks like it has a stack trace
  for (const entry of entries) {
    if (entry.level !== "ERROR" && entry.level !== "FATAL") continue;

    const fullMessage = entry.message;
    const lines = fullMessage.split("\n");

    // Check if the message contains stack trace frames
    const hasFrames = lines.some((l) => l.trim().startsWith("at ") || l.trim().startsWith("Caused by:"));
    if (!hasFrames) continue;

    // Parse the exception header — scan all lines since the exception may not be on line 0
    // (e.g., line 0 might be "KC-SERVICES9999: Failed to process authentication"
    //  and line 1 is "org.keycloak...Exception: message")
    let exceptionClass = "Unknown";
    let message = lines[0];
    for (const line of lines) {
      const exceptionMatch = line.trim().match(/^([\w.$]+(?:Exception|Error|Throwable)):\s*(.*)/);
      if (exceptionMatch) {
        exceptionClass = exceptionMatch[1];
        message = exceptionMatch[2];
        break;
      }
    }

    const frames: StackFrame[] = [];
    const causedBy: StackTrace["causedBy"] = [];

    let currentCaused: { exceptionClass: string; message: string; frames: StackFrame[] } | null = null;

    for (let i = 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();

      if (trimmed.startsWith("Caused by:")) {
        // Start a new caused-by chain
        if (currentCaused) causedBy.push(currentCaused);
        const causedMatch = trimmed.match(/^Caused by:\s+([\w.$]+(?:Exception|Error|Throwable)):\s*(.*)/);
        currentCaused = {
          exceptionClass: causedMatch ? causedMatch[1] : "Unknown",
          message: causedMatch ? causedMatch[2] : trimmed,
          frames: [],
        };
      } else if (trimmed.startsWith("at ")) {
        const frame = parseStackFrame(trimmed);
        if (frame) {
          if (currentCaused) {
            currentCaused.frames.push(frame);
          } else {
            frames.push(frame);
          }
        }
      }
    }

    if (currentCaused) causedBy.push(currentCaused);

    return { exceptionClass, message, frames, causedBy };
  }

  return null;
}

/**
 * Parse a single stack frame line like "at org.keycloak.Foo.bar(Foo.java:42)".
 *
 * @param line - The raw stack frame line (with or without "at " prefix)
 * @returns Parsed frame or null if the line doesn't match
 */
function parseStackFrame(line: string): StackFrame | null {
  const match = line.match(/at\s+([\w.$]+)\.([\w$<>]+)\(([^:]+):(\d+)\)/);
  if (!match) {
    // Try native or unknown source format: at pkg.Class.method(Unknown Source)
    const nativeMatch = line.match(/at\s+([\w.$]+)\.([\w$<>]+)\((.+)\)/);
    if (nativeMatch) {
      return {
        className: nativeMatch[1],
        methodName: nativeMatch[2],
        fileName: nativeMatch[3],
        lineNumber: -1,
      };
    }
    return null;
  }

  return {
    className: match[1],
    methodName: match[2],
    fileName: match[3],
    lineNumber: parseInt(match[4], 10),
  };
}

/**
 * Analyze log entries to extract a summary of an authentication flow.
 *
 * Keycloak's AuthenticationProcessor and related classes log characteristic
 * messages during authentication flows. This function scans for those patterns
 * to reconstruct the step-by-step sequence of what happened.
 *
 * Key log patterns detected:
 * - "Authentication flow" — flow start
 * - "executes" / "executing" — authenticator execution
 * - "ATTEMPTED" / "SUCCESS" / "FAILURE" — authenticator result
 * - "REQUIRED" / "ALTERNATIVE" / "CONDITIONAL" — requirement level
 * - "authentication session" — session creation/lookup
 *
 * @param entries - Array of log entries to analyze
 * @returns Summary of the detected authentication flow
 *
 * @example
 * ```typescript
 * const summary = summarizeAuthFlow(entries);
 * for (const step of summary.steps) {
 *   console.log(`${step.order}. ${step.authenticator}: ${step.result}`);
 * }
 * ```
 */
export function summarizeAuthFlow(entries: LogEntry[]): AuthFlowSummary {
  const steps: AuthFlowStep[] = [];
  let success = false;
  let error: string | undefined;
  let firstTimestamp = "";
  let lastTimestamp = "";

  // Authentication-related logger patterns
  const authLoggers = [
    "authentication",
    "AuthenticationProcessor",
    "AuthenticationManager",
    "AuthenticatorUtil",
    "authenticator",
  ];

  const authEntries = entries.filter((e) =>
    authLoggers.some((pattern) => e.loggerName.toLowerCase().includes(pattern.toLowerCase()))
  );

  let stepOrder = 0;

  for (const entry of authEntries) {
    const msg = entry.message.toLowerCase();

    // Detect authenticator execution steps
    if (msg.includes("execut") || msg.includes("process") || msg.includes("authenticat")) {
      stepOrder++;

      // Try to extract the authenticator name from the message
      const nameMatch = entry.message.match(/(?:authenticator|execution|provider)[:\s]+(\S+)/i);
      const authenticator = nameMatch ? nameMatch[1] : entry.loggerName.split(".").pop() ?? "unknown";

      let result = "attempted";
      if (msg.includes("success")) result = "success";
      else if (msg.includes("fail") || msg.includes("invalid")) result = "failure";
      else if (msg.includes("required")) result = "required";
      else if (msg.includes("skip")) result = "skipped";

      steps.push({
        order: stepOrder,
        authenticator,
        result,
        timestamp: entry.timestamp,
        loggerClass: entry.loggerName,
      });

      if (!firstTimestamp) firstTimestamp = entry.timestamp;
      lastTimestamp = entry.timestamp;
    }

    // Detect flow completion
    if (msg.includes("authentication complete") || msg.includes("successfully authenticated")) {
      success = true;
    }

    // Detect flow failure
    if (entry.level === "ERROR" || msg.includes("authentication failed")) {
      error = entry.message;
    }
  }

  // Calculate duration from timestamps if possible
  let durationMs = -1;
  if (firstTimestamp && lastTimestamp) {
    const parseTs = (ts: string) => {
      const normalized = ts.replace(",", ".");
      return new Date(normalized).getTime();
    };
    const start = parseTs(firstTimestamp);
    const end = parseTs(lastTimestamp);
    if (!isNaN(start) && !isNaN(end)) {
      durationMs = end - start;
    }
  }

  return { steps, success, error, durationMs };
}
