/**
 * @file get_dev_instance_config.ts
 * @module live-dev/tools
 * @author keycloak-source-mcp
 * @since 1.1.0
 *
 * MCP tool: get_dev_instance_config
 *
 * Retrieves the full active configuration of the running Keycloak instance,
 * filtered to what's most relevant for SPI development. Uses the Quarkus
 * Dev UI configuration endpoint to get all resolved configuration properties.
 */

import {
  DevInstanceClient,
  getDevConfig,
  getSetupInstructions,
} from "../dev-instance-client.js";
import { getConfigurationProperties } from "../quarkus-dev-ui.js";

/**
 * Get the active configuration of the running Keycloak dev instance.
 *
 * Queries the Quarkus Dev UI for all resolved configuration properties
 * and presents them in a structured format. When a filter is provided,
 * only matching properties are shown.
 *
 * SPI-related configuration keys in Keycloak typically start with:
 * - kc.spi.* — SPI provider selection and configuration
 * - quarkus.* — Quarkus framework settings
 * - kc.* — Keycloak-specific settings
 *
 * @param filter - Optional prefix filter for configuration keys
 * @returns Formatted configuration listing or setup instructions
 *
 * @example
 * ```typescript
 * // All SPI configuration
 * const result = await getDevInstanceConfig("kc.spi");
 *
 * // Database configuration
 * const db = await getDevInstanceConfig("quarkus.datasource");
 * ```
 */
export async function getDevInstanceConfig(
  filter?: string
): Promise<string> {
  const config = getDevConfig();
  if (!config) return getSetupInstructions();

  const client = new DevInstanceClient(config);
  const running = await client.isRunning();
  if (!running) {
    return `Keycloak dev instance is not reachable at ${config.url}.\nStart the instance and try again.`;
  }

  let properties = await getConfigurationProperties(client);

  if (properties.length === 0) {
    // Dev UI config endpoint may not be available — try server info as fallback
    return getFallbackConfig(client, filter);
  }

  // Apply filter
  if (filter) {
    const lowerFilter = filter.toLowerCase();
    properties = properties.filter((p) => p.key.toLowerCase().includes(lowerFilter));
  }

  if (properties.length === 0) {
    return `No configuration properties found matching "${filter}".`;
  }

  // Group by prefix
  const groups = new Map<string, typeof properties>();
  for (const prop of properties) {
    const prefix = prop.key.split(".").slice(0, 2).join(".");
    const group = groups.get(prefix) ?? [];
    group.push(prop);
    groups.set(prefix, group);
  }

  const output: string[] = [];
  const title = filter
    ? `Dev Instance Configuration (filter: "${filter}")`
    : "Dev Instance Configuration";
  output.push(title);
  output.push("=".repeat(60));
  output.push(`Total: ${properties.length} properties`);
  output.push("");

  for (const [prefix, groupProps] of groups) {
    output.push(`── ${prefix}.* ──`);
    for (const prop of groupProps) {
      const isDefault = prop.value === prop.defaultValue || prop.source === "default";
      const marker = isDefault ? "" : " ← custom";
      output.push(`  ${prop.key}`);
      output.push(`    Value: ${prop.value}${marker}`);
      if (prop.source !== "unknown") {
        output.push(`    Source: ${prop.source}`);
      }
    }
    output.push("");
  }

  return output.join("\n");
}

/**
 * Fallback when Quarkus Dev UI config endpoint isn't available.
 * Uses the Keycloak Admin API to get server-level configuration.
 */
async function getFallbackConfig(
  client: DevInstanceClient,
  filter?: string
): Promise<string> {
  try {
    const serverInfo = await client.getServerInfo();
    const output: string[] = [];
    output.push("Dev Instance Configuration (from Admin API)");
    output.push("=".repeat(60));
    output.push("");
    output.push("Note: Quarkus Dev UI config endpoint not available.");
    output.push("Showing information from Keycloak Admin API instead.");
    output.push("");
    output.push(`Keycloak Version: ${serverInfo.keycloakVersion}`);
    output.push(`SPI Types: ${serverInfo.spiCount}`);
    output.push(`Total Providers: ${serverInfo.providerCount}`);
    output.push("");

    // Show SPI configuration from server info
    if (filter) {
      const lowerFilter = filter.toLowerCase();
      const matchingSPIs = Object.entries(serverInfo.providers)
        .filter(([name]) => name.toLowerCase().includes(lowerFilter));

      if (matchingSPIs.length === 0) {
        output.push(`No SPIs matching "${filter}" found.`);
      } else {
        for (const [spiName, spiInfo] of matchingSPIs) {
          output.push(`── ${spiName} ──`);
          output.push(`  Internal: ${spiInfo.internal}`);
          output.push(`  Providers: ${Object.keys(spiInfo.providers).join(", ")}`);
          output.push("");
        }
      }
    } else {
      output.push("Use a filter to narrow results, e.g.:");
      output.push('  filter: "authenticator" — show authenticator SPIs');
      output.push('  filter: "event" — show event-related SPIs');
    }

    return output.join("\n");
  } catch (error) {
    return `Error fetching configuration: ${error instanceof Error ? error.message : String(error)}`;
  }
}
