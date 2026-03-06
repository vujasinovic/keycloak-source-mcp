/**
 * @file diagnose_user.ts
 * @module live-dev/tools
 * @author keycloak-source-mcp
 * @since 1.3.0
 *
 * MCP tool: diagnose_user
 *
 * Diagnoses why a user cannot log in by querying the Keycloak Admin REST API.
 * Checks account status, credentials, brute force lockout, recent login events,
 * active sessions, and realm security policies.
 *
 * Requires KC_DEV_URL and admin credentials to be configured.
 */

import {
  DevInstanceClient,
  getDevConfig,
  getSetupInstructions,
} from "../dev-instance-client.js";
import {
  diagnoseUser,
  formatDiagnosticReport,
  type DiagnosticReport,
} from "../user-diagnostics.js";

/**
 * Diagnose user login issues.
 *
 * @param query - User search query (name, email, or username)
 * @param realm - Realm to search in (default: "master")
 * @returns Formatted diagnostic report or error message
 */
export async function diagnoseUserTool(
  query: string,
  realm: string = "master"
): Promise<string> {
  if (!query || !query.trim()) {
    return "Error: query is required. Provide a user's name, email, or username.";
  }

  const config = getDevConfig();
  if (!config) return getSetupInstructions();

  const client = new DevInstanceClient(config);

  try {
    const running = await client.isRunning();
    if (!running) {
      return [
        "Cannot connect to Keycloak instance.",
        "",
        `Tried: ${config.url}`,
        "",
        "Make sure Keycloak is running and KC_DEV_URL is correct.",
      ].join("\n");
    }

    const result = await diagnoseUser(client, realm, query.trim());

    if (typeof result === "string") {
      return result;
    }

    return formatDiagnosticReport(result as DiagnosticReport);
  } catch (error) {
    return `Error diagnosing user: ${error instanceof Error ? error.message : String(error)}`;
  }
}
