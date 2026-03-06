/**
 * @file get_loaded_providers.ts
 * @module live-dev/tools
 * @author keycloak-source-mcp
 * @since 1.1.0
 *
 * MCP tool: get_loaded_providers
 *
 * Lists all SPI providers currently registered in the running Keycloak instance,
 * correlated with source code locations. Supports filtering by SPI type and
 * showing only custom (non-core) providers.
 */

import {
  DevInstanceClient,
  getDevConfig,
  getSetupInstructions,
} from "../dev-instance-client.js";
import { correlateProvider, detectCustomProviders } from "../spi-correlator.js";

/**
 * List all SPI providers currently loaded in the running Keycloak instance.
 *
 * Queries the Admin REST API for the complete provider registry, then correlates
 * each provider with its source code location. Results are formatted as a
 * structured table grouped by SPI type.
 *
 * @param spiType - Optional filter to show only providers of this SPI type
 * @param customOnly - If true, show only non-Keycloak-core providers (default: false)
 * @returns Formatted provider listing or setup instructions
 *
 * @example
 * ```typescript
 * // All authenticator providers
 * const result = await getLoadedProviders("authenticator");
 *
 * // Only custom providers
 * const custom = await getLoadedProviders(undefined, true);
 * ```
 */
export async function getLoadedProviders(
  spiType?: string,
  customOnly: boolean = false
): Promise<string> {
  const config = getDevConfig();
  if (!config) return getSetupInstructions();

  const client = new DevInstanceClient(config);

  const running = await client.isRunning();
  if (!running) {
    return `Keycloak dev instance is not reachable at ${config.url}.\nMake sure the instance is running and KC_DEV_URL is correct.`;
  }

  let providers;
  try {
    providers = await client.getRegisteredProviders(spiType);
  } catch (error) {
    return `Error fetching providers: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (customOnly) {
    providers = detectCustomProviders(providers);
  }

  if (providers.length === 0) {
    const filterNote = spiType ? ` for SPI type "${spiType}"` : "";
    const customNote = customOnly ? " custom" : "";
    return `No${customNote} providers found${filterNote}.`;
  }

  // Group by SPI type
  const grouped = new Map<string, typeof providers>();
  for (const p of providers) {
    const group = grouped.get(p.spiType) ?? [];
    group.push(p);
    grouped.set(p.spiType, group);
  }

  const lines: string[] = [];
  const title = customOnly ? "Custom Loaded Providers" : "All Loaded Providers";
  lines.push(title);
  lines.push("=".repeat(60));
  lines.push(`Total: ${providers.length} provider(s) in ${grouped.size} SPI type(s)`);
  lines.push("");

  for (const [type, typeProviders] of grouped) {
    lines.push(`── ${type} (${typeProviders.length}) ──`);

    for (const provider of typeProviders) {
      const className = provider.factoryClass.split(".").pop() ?? provider.factoryClass;
      const tag = provider.isBuiltIn ? "built-in" : "custom";

      let sourceStatus = "";
      if (!provider.isBuiltIn) {
        try {
          const corr = await correlateProvider(provider);
          sourceStatus = corr.sourceFound ? " [source: found]" : " [source: not found]";
        } catch {
          sourceStatus = " [source: unknown]";
        }
      }

      lines.push(`  ${provider.providerId.padEnd(35)} ${className.padEnd(40)} (${tag})${sourceStatus}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
