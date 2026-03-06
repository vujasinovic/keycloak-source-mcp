/**
 * @file trace_authentication_flow.ts
 * @module live-dev/tools
 * @author keycloak-source-mcp
 * @since 1.1.0
 *
 * MCP tool: trace_authentication_flow
 *
 * Guides the developer through triggering an authentication flow and then
 * analyzes the captured log entries to trace what happened step-by-step.
 *
 * IMPORTANT: This tool does NOT automatically trigger authentication flows.
 * Automatically triggering auth flows would:
 * - Create real sessions in the running instance
 * - Potentially lock out accounts or trigger security policies
 * - Require managing browser sessions and CSRF tokens
 *
 * Instead, it provides guidance and then analyzes the logs after the developer
 * manually triggers the flow. This is both safer and more realistic since
 * developers need to test their specific flow configuration.
 */

import { getDevConfig, getSetupInstructions, DevInstanceClient } from "../dev-instance-client.js";
import { readRecentLogs, summarizeAuthFlow, filterByClass } from "../log-analyzer.js";

/**
 * Provide guidance for tracing an authentication flow and analyze the results.
 *
 * This tool works in two phases:
 * 1. Returns instructions for the developer to trigger their specific flow
 * 2. When called again (after the flow), analyzes the log entries
 *
 * Why we guide rather than auto-trigger: Authentication flows involve security-sensitive
 * operations (session creation, credential validation, MFA). Automatically triggering
 * these could create unwanted sessions, trigger account lockouts, or interfere with
 * active development. The developer knows their specific test scenario best.
 *
 * @param realm - The realm to trace authentication in
 * @param description - Plain English description of what the developer is testing
 * @returns Guidance instructions and/or flow analysis
 *
 * @example
 * ```typescript
 * const result = await traceAuthenticationFlow("master", "browser login with OTP");
 * // Returns instructions first, then analysis after developer triggers the flow
 * ```
 */
export async function traceAuthenticationFlow(
  realm: string,
  description: string
): Promise<string> {
  const config = getDevConfig();
  if (!config) return getSetupInstructions();

  if (!realm || !realm.trim()) return "Error: realm is required.";
  if (!description || !description.trim()) return "Error: description is required.";

  const client = new DevInstanceClient(config);
  const running = await client.isRunning();
  if (!running) {
    return `Keycloak dev instance is not reachable at ${config.url}.\nStart the instance and try again.`;
  }

  const output: string[] = [];
  output.push("Authentication Flow Trace");
  output.push("=".repeat(60));
  output.push(`Realm: ${realm}`);
  output.push(`Scenario: ${description}`);
  output.push("");

  // Provide flow trigger guidance based on the description
  output.push("── Step 1: Trigger the Flow ──");
  output.push("");

  const lowerDesc = description.toLowerCase();
  if (lowerDesc.includes("browser") || lowerDesc.includes("login") || lowerDesc.includes("password")) {
    output.push("To trigger a browser login flow:");
    output.push(`  1. Open: ${config.url}/realms/${realm}/account`);
    output.push("  2. Click 'Sign In' if not already prompted");
    output.push("  3. Enter credentials and complete the flow");
    output.push("  4. Watch the Keycloak console/log output");
  } else if (lowerDesc.includes("registration") || lowerDesc.includes("register")) {
    output.push("To trigger a registration flow:");
    output.push(`  1. Open: ${config.url}/realms/${realm}/account`);
    output.push("  2. Click 'Register' on the login page");
    output.push("  3. Fill in the registration form");
  } else if (lowerDesc.includes("direct") || lowerDesc.includes("grant") || lowerDesc.includes("api")) {
    output.push("To trigger a direct grant flow:");
    output.push("  Use curl or any HTTP client:");
    output.push(`  curl -X POST ${config.url}/realms/${realm}/protocol/openid-connect/token \\`);
    output.push('    -d "grant_type=password" \\');
    output.push('    -d "client_id=<your-client>" \\');
    output.push('    -d "username=<user>" \\');
    output.push('    -d "password=<pass>"');
  } else {
    output.push("Trigger your authentication scenario now.");
    output.push(`  The realm '${realm}' should be configured with the flow you want to test.`);
    output.push(`  Open: ${config.url}/realms/${realm}/account`);
  }

  output.push("");
  output.push("── Step 2: Log Analysis ──");
  output.push("");

  // If log path is configured, try to analyze existing logs
  if (config.logPath) {
    try {
      const entries = await readRecentLogs(config.logPath, 500);
      const authEntries = filterByClass(entries, "authentication");

      if (authEntries.length > 0) {
        const flowSummary = summarizeAuthFlow(entries);

        if (flowSummary.steps.length > 0) {
          output.push("Recent authentication activity detected in logs:");
          output.push("");

          for (const step of flowSummary.steps) {
            const icon = step.result === "success" ? "✅" :
                         step.result === "failure" ? "❌" : "▶️";
            output.push(`  ${step.order}. ${icon} ${step.authenticator}`);
            output.push(`     Result: ${step.result}`);
            output.push(`     Class: ${step.loggerClass}`);
            output.push(`     Time: ${step.timestamp}`);
            output.push("");
          }

          output.push(`Overall: ${flowSummary.success ? "COMPLETED" : "IN PROGRESS / FAILED"}`);
          if (flowSummary.durationMs >= 0) {
            output.push(`Duration: ${flowSummary.durationMs}ms`);
          }
          if (flowSummary.error) {
            output.push(`Error: ${flowSummary.error.split("\n")[0]}`);
          }
        } else {
          output.push("No authentication flow steps detected in recent logs.");
          output.push("Trigger the flow above, then run this tool again to analyze.");
        }
      } else {
        output.push("No authentication-related log entries found.");
        output.push("Trigger the flow above, then run this tool again to analyze.");
      }
    } catch (error) {
      output.push(`Could not read logs: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    output.push("KC_DEV_LOG_PATH not configured — cannot analyze logs.");
    output.push("Set KC_DEV_LOG_PATH to enable automatic flow analysis.");
    output.push("");
    output.push("Without log analysis, you can still:");
    output.push("  1. Watch the console output of your Keycloak dev instance");
    output.push("  2. Look for AuthenticationProcessor and authenticator log lines");
    output.push("  3. Use the Keycloak Admin Console > Events to see authentication events");
  }

  return output.join("\n");
}
