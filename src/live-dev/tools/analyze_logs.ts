/**
 * @file analyze_logs.ts
 * @module live-dev/tools
 * @author keycloak-source-mcp
 * @since 1.1.0
 *
 * MCP tool: analyze_logs
 *
 * Reads and analyzes recent Keycloak logs to help developers understand
 * what happened during request processing, authentication flows, and errors.
 * Requires KC_DEV_LOG_PATH to be set to the Keycloak log file path.
 */

import { getDevConfig, getSetupInstructions } from "../dev-instance-client.js";
import {
  readRecentLogs,
  filterByClass,
  filterByLevel,
  extractStackTrace,
  summarizeAuthFlow,
  type LogEntry,
} from "../log-analyzer.js";

/**
 * Analyze recent Keycloak log entries and return a structured summary.
 *
 * Reads the last N lines from the Keycloak log file, then applies filtering
 * and analysis to produce a human-readable report. If extractFlow is true,
 * attempts to identify and summarize authentication flow steps.
 *
 * @param lines - Number of recent log lines to read (default: 200, max: 2000)
 * @param filter - Optional class name or keyword to filter entries
 * @param extractFlow - Whether to attempt auth flow extraction (default: true)
 * @returns Formatted log analysis or setup instructions
 *
 * @example
 * ```typescript
 * // Analyze last 100 lines, filtered to authentication
 * const result = await analyzeLogs(100, "authentication", true);
 *
 * // Just show recent errors
 * const errors = await analyzeLogs(500, undefined, false);
 * ```
 */
export async function analyzeLogs(
  lines: number = 200,
  filter?: string,
  extractFlow: boolean = true
): Promise<string> {
  const config = getDevConfig();
  if (!config) return getSetupInstructions();

  if (!config.logPath) {
    return [
      "Log analysis requires KC_DEV_LOG_PATH to be set.",
      "",
      "Set it to the path of your Keycloak log file:",
      "  KC_DEV_LOG_PATH=/path/to/keycloak.log",
      "",
      "For Quarkus dev mode, the log is typically at:",
      "  - Console output (redirect with: mvnw quarkus:dev 2>&1 | tee keycloak.log)",
      "  - Or configure quarkus.log.file.enable=true in application.properties",
    ].join("\n");
  }

  // Clamp lines to reasonable range
  const lineCount = Math.min(Math.max(lines, 10), 2000);

  let entries: LogEntry[];
  try {
    entries = await readRecentLogs(config.logPath, lineCount);
  } catch (error) {
    return `Error reading logs: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (entries.length === 0) {
    return "No log entries found. The log file may be empty or in an unexpected format.";
  }

  // Apply filter
  if (filter) {
    entries = filterByClass(entries, filter);
    if (entries.length === 0) {
      return `No log entries matching "${filter}" in the last ${lineCount} lines.`;
    }
  }

  const output: string[] = [];
  output.push("Keycloak Log Analysis");
  output.push("=".repeat(60));
  output.push(`Analyzed: ${entries.length} entries from ${config.logPath}`);
  output.push("");

  // Error/Warning summary
  const errors = filterByLevel(entries, "ERROR");
  const warnings = filterByLevel(entries, "WARN").filter((e) => e.level === "WARN");

  if (errors.length > 0 || warnings.length > 0) {
    output.push(`⚠️  ${errors.length} ERROR(s), ${warnings.length} WARNING(s) detected`);
    output.push("");

    if (errors.length > 0) {
      output.push("── Errors ──");
      for (const err of errors.slice(0, 10)) {
        output.push(`  [${err.timestamp}] ${err.message.split("\n")[0]}`);
      }
      if (errors.length > 10) {
        output.push(`  ... and ${errors.length - 10} more errors`);
      }
      output.push("");
    }
  }

  // Stack trace analysis
  const stackTrace = extractStackTrace(entries);
  if (stackTrace) {
    output.push("── Stack Trace Detected ──");
    output.push(`Exception: ${stackTrace.exceptionClass}`);
    output.push(`Message: ${stackTrace.message}`);
    output.push("");
    output.push("Stack frames (top 10):");
    for (const frame of stackTrace.frames.slice(0, 10)) {
      const loc = frame.lineNumber > 0 ? `:${frame.lineNumber}` : "";
      output.push(`  at ${frame.className}.${frame.methodName}(${frame.fileName}${loc})`);
    }
    if (stackTrace.causedBy.length > 0) {
      output.push(`  Caused by: ${stackTrace.causedBy[0].exceptionClass}: ${stackTrace.causedBy[0].message}`);
    }
    output.push("");
  }

  // Auth flow extraction
  if (extractFlow) {
    const flowSummary = summarizeAuthFlow(entries);
    if (flowSummary.steps.length > 0) {
      output.push("── Authentication Flow ──");
      for (const step of flowSummary.steps) {
        const icon = step.result === "success" ? "✅" : step.result === "failure" ? "❌" : "▶️";
        output.push(`  ${step.order}. ${icon} ${step.authenticator} → ${step.result} [${step.timestamp}]`);
      }
      output.push("");
      output.push(`Flow result: ${flowSummary.success ? "SUCCESS" : "INCOMPLETE/FAILED"}`);
      if (flowSummary.durationMs >= 0) {
        output.push(`Duration: ${flowSummary.durationMs}ms`);
      }
      if (flowSummary.error) {
        output.push(`Error: ${flowSummary.error.split("\n")[0]}`);
      }
      output.push("");
    }
  }

  // Recent activity summary (last 20 entries)
  output.push("── Recent Activity (last 20) ──");
  const recentEntries = entries.slice(-20);
  for (const entry of recentEntries) {
    const levelIcon =
      entry.level === "ERROR" ? "🔴" :
      entry.level === "WARN" ? "🟡" :
      entry.level === "DEBUG" ? "🔵" : "⚪";
    const shortLogger = entry.loggerName.split(".").pop() ?? entry.loggerName;
    output.push(`  ${levelIcon} [${entry.timestamp}] ${shortLogger}: ${entry.message.split("\n")[0].substring(0, 100)}`);
  }

  return output.join("\n");
}
