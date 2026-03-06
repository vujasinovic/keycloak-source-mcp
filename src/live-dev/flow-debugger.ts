/**
 * @file flow-debugger.ts
 * @module live-dev
 * @author keycloak-source-mcp
 * @since 1.2.0
 *
 * Real-time authentication flow debugger with source code tracing.
 *
 * Captures a log file snapshot, then after the user triggers an auth flow,
 * reads only the NEW log entries and produces a fully source-annotated trace
 * showing what each authenticator did and why errors occurred.
 *
 * Two-phase design:
 * - Phase 1 (start): Records current log position, returns snapshot + trigger instructions
 * - Phase 2 (analyze): Reads new entries since snapshot, builds annotated trace
 *
 * The snapshot is exchanged as JSON between phases — no server-side state needed.
 */

import * as fs from "node:fs";
import {
  parseLogEntry,
  summarizeAuthFlow,
  extractStackTrace,
  type LogEntry,
  type StackTrace,
  type AuthFlowStep,
} from "./log-analyzer.js";
import { findProviderSource } from "./spi-correlator.js";
import { getSourcePath, searchWithRg } from "../utils.js";

/** Snapshot of log file position, passed from start to analyze phase */
export interface LogSnapshot {
  logPath: string;
  lineCount: number;
  takenAt: string;
}

/** An auth flow step annotated with source code information */
export interface AnnotatedAuthStep extends AuthFlowStep {
  sourceFile: string | null;
  className: string | null;
  authenticateMethodSource: string | null;
  actionMethodSource: string | null;
  description: string | null;
  logMessages: string[];
}

/** Diagnosis of an error found in the flow */
export interface ErrorDiagnosis {
  exceptionClass: string;
  message: string;
  throwingFrame: string | null;
  throwingMethodSource: string | null;
  explanation: string;
  rootCauseClass: string | null;
  rootCauseMessage: string | null;
}

/** Complete diagnosis of an authentication flow */
export interface FlowDiagnosis {
  realm: string;
  steps: AnnotatedAuthStep[];
  success: boolean;
  durationMs: number;
  errorDiagnosis: ErrorDiagnosis | null;
  expectedFlow: string | null;
  newLogLines: number;
}

/**
 * Known mapping of authenticator provider IDs to their implementation class names.
 * These are the most common built-in authenticators.
 */
const KNOWN_AUTHENTICATOR_CLASSES: Record<string, string> = {
  "auth-cookie": "CookieAuthenticator",
  "auth-username-password-form": "UsernamePasswordForm",
  "auth-otp-form": "OTPFormAuthenticator",
  "identity-provider-redirector": "IdentityProviderAuthenticator",
  "direct-grant-validate-username": "ValidateUsername",
  "direct-grant-validate-password": "ValidatePassword",
};

/**
 * Count lines in a log file and return a snapshot of the current position.
 */
export async function captureLogSnapshot(logPath: string): Promise<LogSnapshot> {
  if (!fs.existsSync(logPath)) {
    throw new Error(`Log file not found: ${logPath}`);
  }

  const content = await fs.promises.readFile(logPath, "utf-8");
  const lineCount = content.split("\n").length;

  return {
    logPath,
    lineCount,
    takenAt: new Date().toISOString(),
  };
}

/**
 * Read only the log entries that appeared after the snapshot was taken.
 */
export async function readNewLogEntries(snapshot: LogSnapshot): Promise<LogEntry[]> {
  if (!fs.existsSync(snapshot.logPath)) {
    throw new Error(`Log file not found: ${snapshot.logPath}`);
  }

  const content = await fs.promises.readFile(snapshot.logPath, "utf-8");
  const allLines = content.split("\n");

  // If the file was truncated/rotated (fewer lines than snapshot), read all
  if (allLines.length <= snapshot.lineCount) {
    return [];
  }

  const newLines = allLines.slice(snapshot.lineCount);
  const entries: LogEntry[] = [];

  for (let i = 0; i < newLines.length; i++) {
    const line = newLines[i];
    if (!line.trim()) continue;

    const entry = parseLogEntry(line, snapshot.lineCount + i + 1);
    if (entry) {
      entries.push(entry);
    } else if (entries.length > 0) {
      // Continuation line (stack trace) — append to last entry
      entries[entries.length - 1].message += "\n" + line;
    }
  }

  return entries;
}

/**
 * Extract a single method body from raw Java source by name.
 * Tracks brace depth to find the complete method. Returns at most 50 lines.
 */
export function extractMethodSource(rawSource: string, methodName: string): string | null {
  const lines = rawSource.split("\n");
  const methodPattern = new RegExp(`\\b${methodName}\\s*\\(`);

  for (let i = 0; i < lines.length; i++) {
    if (!methodPattern.test(lines[i])) continue;

    // Check this looks like a method declaration (has a return type or modifier before it)
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    const result: string[] = [];
    let braceDepth = 0;
    let foundOpen = false;

    for (let j = i; j < lines.length && result.length < 50; j++) {
      result.push(lines[j]);
      for (const ch of lines[j]) {
        if (ch === "{") {
          braceDepth++;
          foundOpen = true;
        }
        if (ch === "}") braceDepth--;
      }
      if (foundOpen && braceDepth === 0) break;
    }

    if (result.length > 0) return result.join("\n");
  }

  return null;
}

/**
 * Resolve the source file for an authenticator by its provider ID and logger class.
 *
 * Strategy:
 * 1. Known class mapping (fastest, no I/O)
 * 2. Logger class FQCN (extract class name from logger)
 * 3. findProviderSource from spi-correlator (searches getId() in source)
 * 4. searchWithRg by class name (broadest search)
 */
export async function resolveAuthenticatorSource(
  authenticatorId: string,
  loggerClass: string,
  version?: string
): Promise<{ sourceFile: string; className: string } | null> {
  let sourcePath: string;
  try {
    sourcePath = getSourcePath(version);
  } catch {
    return null;
  }

  // Strategy 1: Known mapping
  const knownClass = KNOWN_AUTHENTICATOR_CLASSES[authenticatorId];
  if (knownClass) {
    try {
      const args = ["--files", "--glob", `**/${knownClass}.java`];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        const file = result.trim().split("\n")[0];
        return { sourceFile: file, className: knownClass };
      }
    } catch {
      // fall through to next strategy
    }
  }

  // Strategy 2: Logger class FQCN
  const loggerClassName = loggerClass.split(".").pop();
  if (loggerClassName && loggerClassName !== "AuthenticationProcessor") {
    try {
      const args = ["--files", "--glob", `**/${loggerClassName}.java`];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        const file = result.trim().split("\n")[0];
        return { sourceFile: file, className: loggerClassName };
      }
    } catch {
      // fall through
    }
  }

  // Strategy 3: findProviderSource (searches for provider ID in source)
  try {
    const location = await findProviderSource(authenticatorId, "authenticator", version);
    if (location) {
      const className = location.filePath.split("/").pop()?.replace(".java", "") ?? null;
      return className ? { sourceFile: location.filePath, className } : null;
    }
  } catch {
    // fall through
  }

  // Strategy 4: Search by authenticator ID as class name (last resort)
  if (knownClass) {
    // Already tried in strategy 1
    return null;
  }

  return null;
}

/**
 * Diagnose errors found in log entries.
 * Extracts the stack trace, finds the first org.keycloak frame,
 * and attempts to read the throwing method source.
 */
export async function diagnoseError(
  entries: LogEntry[],
  version?: string
): Promise<ErrorDiagnosis | null> {
  const trace = extractStackTrace(entries);
  if (!trace) return null;

  let throwingFrame: string | null = null;
  let throwingMethodSource: string | null = null;

  // Find first org.keycloak frame
  const kcFrame = trace.frames.find((f) => f.className.startsWith("org.keycloak"));
  if (kcFrame) {
    throwingFrame = `${kcFrame.className}.${kcFrame.methodName}(${kcFrame.fileName}:${kcFrame.lineNumber})`;

    // Try to read the source of the throwing method
    try {
      const sourcePath = getSourcePath(version);
      const className = kcFrame.className.split(".").pop() ?? "";
      const args = ["--files", "--glob", `**/${className}.java`];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        const filePath = result.trim().split("\n")[0];
        const fullPath = filePath.startsWith("/") ? filePath : `${sourcePath}/${filePath}`;
        if (fs.existsSync(fullPath)) {
          const source = await fs.promises.readFile(fullPath, "utf-8");
          throwingMethodSource = extractMethodSource(source, kcFrame.methodName);
        }
      }
    } catch {
      // Source lookup is best-effort
    }
  }

  const rootCause = trace.causedBy.length > 0 ? trace.causedBy[trace.causedBy.length - 1] : null;

  const explanation = buildErrorExplanation(trace, kcFrame?.className ?? null);

  return {
    exceptionClass: trace.exceptionClass,
    message: trace.message,
    throwingFrame,
    throwingMethodSource,
    explanation,
    rootCauseClass: rootCause?.exceptionClass ?? null,
    rootCauseMessage: rootCause?.message ?? null,
  };
}

function buildErrorExplanation(trace: StackTrace, throwingClass: string | null): string {
  const parts: string[] = [];

  if (trace.exceptionClass.includes("AuthenticationFlowException")) {
    parts.push("The authentication flow threw an exception during processing.");
  } else {
    parts.push(`Exception ${trace.exceptionClass} was thrown during authentication.`);
  }

  if (trace.message) {
    parts.push(`Reason: ${trace.message}`);
  }

  if (throwingClass) {
    parts.push(`Thrown from: ${throwingClass}`);
  }

  if (trace.causedBy.length > 0) {
    const root = trace.causedBy[trace.causedBy.length - 1];
    parts.push(`Root cause: ${root.exceptionClass}: ${root.message}`);
  }

  return parts.join("\n");
}

/**
 * Build annotated auth flow steps with source code references.
 */
export async function buildAnnotatedSteps(
  entries: LogEntry[],
  version?: string
): Promise<AnnotatedAuthStep[]> {
  const flowSummary = summarizeAuthFlow(entries);
  const annotatedSteps: AnnotatedAuthStep[] = [];

  for (const step of flowSummary.steps) {
    // Collect log messages related to this step
    const logMessages = collectStepLogMessages(entries, step);

    // Resolve source
    const source = await resolveAuthenticatorSource(
      step.authenticator,
      step.loggerClass,
      version
    );

    let authenticateMethodSource: string | null = null;
    let actionMethodSource: string | null = null;
    let description: string | null = null;

    if (source) {
      try {
        const sourcePath = getSourcePath(version);
        const fullPath = source.sourceFile.startsWith("/")
          ? source.sourceFile
          : `${sourcePath}/${source.sourceFile}`;
        if (fs.existsSync(fullPath)) {
          const rawSource = await fs.promises.readFile(fullPath, "utf-8");
          authenticateMethodSource = extractMethodSource(rawSource, "authenticate");
          actionMethodSource = extractMethodSource(rawSource, "action");

          // Extract class-level javadoc as description
          const javadocMatch = rawSource.match(/\/\*\*\s*\n([\s\S]*?)\*\//);
          if (javadocMatch) {
            description = javadocMatch[1]
              .split("\n")
              .map((l) => l.trim().replace(/^\*\s?/, "").trim())
              .filter(Boolean)
              .join(" ");
          }
        }
      } catch {
        // Source reading is best-effort
      }
    }

    annotatedSteps.push({
      ...step,
      sourceFile: source?.sourceFile ?? null,
      className: source?.className ?? null,
      authenticateMethodSource,
      actionMethodSource,
      description,
      logMessages,
    });
  }

  return annotatedSteps;
}

/**
 * Collect log messages that relate to a specific auth flow step.
 */
function collectStepLogMessages(entries: LogEntry[], step: AuthFlowStep): string[] {
  const messages: string[] = [];
  const authenticatorLower = step.authenticator.toLowerCase();

  for (const entry of entries) {
    const msg = entry.message.toLowerCase();
    if (
      msg.includes(authenticatorLower) ||
      entry.loggerName.toLowerCase().includes(authenticatorLower.replace(/-/g, ""))
    ) {
      messages.push(entry.message.split("\n")[0]);
    }
  }

  return messages;
}

/**
 * Optionally fetch the expected flow name from the realm configuration.
 * Requires KC_DEV_URL to be available.
 */
export async function fetchExpectedFlow(
  realm: string,
  baseUrl: string
): Promise<string | null> {
  try {
    const response = await fetch(`${baseUrl}/admin/realms/${realm}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    return (data.browserFlow as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * Main orchestrator: analyze an authentication flow from new log entries since snapshot.
 */
export async function analyzeAuthFlow(
  snapshot: LogSnapshot,
  realm: string = "master",
  version?: string
): Promise<FlowDiagnosis> {
  const entries = await readNewLogEntries(snapshot);
  const steps = await buildAnnotatedSteps(entries, version);
  const errorDiagnosis = await diagnoseError(entries, version);

  const flowSummary = summarizeAuthFlow(entries);

  return {
    realm,
    steps,
    success: flowSummary.success,
    durationMs: flowSummary.durationMs,
    errorDiagnosis,
    expectedFlow: null,
    newLogLines: entries.length,
  };
}

/**
 * Format a FlowDiagnosis into a human-readable string.
 */
export function formatFlowDiagnosis(diagnosis: FlowDiagnosis): string {
  const output: string[] = [];

  output.push("Authentication Flow Debug Trace");
  output.push("=".repeat(60));
  output.push(
    `Realm: ${diagnosis.realm} | New log lines analyzed: ${diagnosis.newLogLines} | Duration: ${diagnosis.durationMs >= 0 ? diagnosis.durationMs + "ms" : "unknown"}`
  );

  if (diagnosis.expectedFlow) {
    output.push(`Expected flow: ${diagnosis.expectedFlow}`);
  }

  output.push("");

  if (diagnosis.steps.length === 0 && !diagnosis.errorDiagnosis) {
    output.push("No authentication flow steps detected in the new log entries.");
    output.push("Make sure you triggered an authentication flow after starting the debug session.");
    return output.join("\n");
  }

  for (const step of diagnosis.steps) {
    const result = step.result.toUpperCase();
    output.push(`-- Step ${step.order}: ${step.authenticator} -- ${result}`);

    output.push(`   Logger: ${step.loggerClass}`);

    for (const msg of step.logMessages) {
      output.push(`   Log: ${msg}`);
    }

    if (step.sourceFile) {
      const fileName = step.sourceFile.split("/").pop() ?? step.sourceFile;
      output.push(`   Source: ${fileName}`);

      if (step.authenticateMethodSource) {
        // Show a summary of the authenticate method
        const firstComment = extractFirstComment(step.authenticateMethodSource);
        if (firstComment) {
          output.push(`     authenticate(): ${firstComment}`);
        }
      }

      if (step.actionMethodSource) {
        const firstComment = extractFirstComment(step.actionMethodSource);
        if (firstComment) {
          output.push(`     action(): ${firstComment}`);
        }
      }
    }

    if (step.description) {
      output.push(`   Description: ${step.description}`);
    }

    output.push("");
  }

  // Result summary
  output.push(`-- Result: ${diagnosis.success ? "SUCCESS" : "FAILED"}`);

  // Error diagnosis
  if (diagnosis.errorDiagnosis) {
    output.push("");
    output.push("-- Error Diagnosis --");
    output.push(`   Exception: ${diagnosis.errorDiagnosis.exceptionClass}`);
    output.push(`   Message: ${diagnosis.errorDiagnosis.message}`);

    if (diagnosis.errorDiagnosis.throwingFrame) {
      output.push(`   Thrown at: ${diagnosis.errorDiagnosis.throwingFrame}`);
    }

    if (diagnosis.errorDiagnosis.rootCauseClass) {
      output.push(
        `   Root cause: ${diagnosis.errorDiagnosis.rootCauseClass}: ${diagnosis.errorDiagnosis.rootCauseMessage}`
      );
    }

    output.push("");
    output.push(`   ${diagnosis.errorDiagnosis.explanation.split("\n").join("\n   ")}`);
  }

  return output.join("\n");
}

/**
 * Extract the first // comment from a method body as a brief description.
 */
function extractFirstComment(methodSource: string): string | null {
  const lines = methodSource.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) {
      return trimmed.replace(/^\/\/\s*/, "");
    }
  }
  return null;
}
