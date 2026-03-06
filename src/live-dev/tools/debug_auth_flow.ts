/**
 * @file debug_auth_flow.ts
 * @module live-dev/tools
 * @author keycloak-source-mcp
 * @since 1.2.0
 *
 * MCP tool: debug_auth_flow
 *
 * Two-phase real-time authentication flow debugger:
 * - Phase "start": captures log snapshot, returns trigger instructions
 * - Phase "analyze": reads new log entries since snapshot, produces annotated trace
 *
 * Minimum requirement: KC_DEV_LOG_PATH must be set.
 * KC_DEV_URL is optional (enables realm config enrichment).
 */

import { getDevConfig } from "../dev-instance-client.js";
import {
  captureLogSnapshot,
  analyzeAuthFlow,
  formatFlowDiagnosis,
  fetchExpectedFlow,
  type LogSnapshot,
} from "../flow-debugger.js";

/**
 * Get the log file path from dev config or environment.
 */
function getLogPath(): string | null {
  const config = getDevConfig();
  return config?.logPath ?? process.env.KC_DEV_LOG_PATH ?? null;
}

/**
 * Debug an authentication flow in two phases.
 *
 * @param phase - "start" to capture snapshot, "analyze" to produce trace
 * @param realm - Realm name (default: "master")
 * @param description - Optional description of the flow being tested
 * @param snapshot - JSON snapshot string from start phase (required for analyze)
 * @param version - Optional Keycloak source version
 * @returns Formatted result string
 */
export async function debugAuthFlow(
  phase: "start" | "analyze",
  realm?: string,
  description?: string,
  snapshot?: string,
  version?: string
): Promise<string> {
  try {
    if (phase === "start") {
      return await startPhase(realm ?? "master", description);
    } else {
      return await analyzePhase(snapshot, realm ?? "master", version);
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function startPhase(realm: string, description?: string): Promise<string> {
  const logPath = getLogPath();
  if (!logPath) {
    return [
      "debug_auth_flow requires KC_DEV_LOG_PATH to be set.",
      "",
      "Set it to the path of your Keycloak log file:",
      "  KC_DEV_LOG_PATH=/path/to/keycloak.log",
      "",
      "For Quarkus dev mode, redirect output:",
      "  mvnw quarkus:dev 2>&1 | tee keycloak.log",
    ].join("\n");
  }

  const snap = await captureLogSnapshot(logPath);
  const snapJson = JSON.stringify(snap);

  const output: string[] = [];
  output.push("Debug Auth Flow — Snapshot Captured");
  output.push("=".repeat(60));
  output.push(`Log file: ${snap.logPath}`);
  output.push(`Current position: line ${snap.lineCount}`);
  output.push(`Captured at: ${snap.takenAt}`);
  output.push("");

  // Trigger instructions
  const config = getDevConfig();
  const baseUrl = config?.url ?? process.env.KC_DEV_URL;

  output.push("Now trigger your authentication flow:");
  if (baseUrl) {
    output.push(`  Browser login: ${baseUrl}/realms/${realm}/account`);
    output.push(`  Direct grant: curl -X POST ${baseUrl}/realms/${realm}/protocol/openid-connect/token ...`);
  } else {
    output.push("  Trigger the flow in your browser or via API.");
  }

  if (description) {
    output.push("");
    output.push(`Scenario: ${description}`);
  }

  output.push("");
  output.push("After the flow completes, call debug_auth_flow with phase: \"analyze\"");
  output.push("and pass the following snapshot:");
  output.push("");
  output.push(`SNAPSHOT: ${snapJson}`);

  return output.join("\n");
}

async function analyzePhase(
  snapshotJson: string | undefined,
  realm: string,
  version?: string
): Promise<string> {
  if (!snapshotJson) {
    return 'Error: snapshot parameter is required for analyze phase. Run with phase: "start" first.';
  }

  let snap: LogSnapshot;
  try {
    snap = JSON.parse(snapshotJson) as LogSnapshot;
  } catch {
    return "Error: Invalid snapshot JSON. Use the exact snapshot string from the start phase.";
  }

  if (!snap.logPath || typeof snap.lineCount !== "number") {
    return "Error: Invalid snapshot format. Missing logPath or lineCount.";
  }

  const diagnosis = await analyzeAuthFlow(snap, realm, version);

  // Try to enrich with expected flow from realm config
  const config = getDevConfig();
  if (config?.url) {
    const expected = await fetchExpectedFlow(realm, config.url);
    if (expected) {
      diagnosis.expectedFlow = expected;
    }
  }

  return formatFlowDiagnosis(diagnosis);
}
