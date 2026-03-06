/**
 * @file connect_dev_instance.ts
 * @module live-dev/tools
 * @author keycloak-source-mcp
 * @since 1.1.0
 *
 * MCP tool: connect_dev_instance
 *
 * Tests the connection to a running Keycloak dev instance and returns a
 * comprehensive status report. This is the first tool a developer should
 * use to verify their live dev setup is working correctly.
 *
 * If KC_DEV_URL is not configured, returns helpful setup instructions
 * instead of an error — ensuring a smooth first-time experience.
 */

import {
  DevInstanceClient,
  getDevConfig,
  getSetupInstructions,
} from "../dev-instance-client.js";
import { getLoadedExtensions } from "../quarkus-dev-ui.js";
import { correlateProvider, detectCustomProviders } from "../spi-correlator.js";

/**
 * Test the connection to the Keycloak dev instance and return a full status report.
 *
 * The connection check sequence is:
 * 1. Verify KC_DEV_URL is configured
 * 2. Ping the health endpoint to check if the instance is running
 * 3. Fetch Quarkus runtime info (version, Java version)
 * 4. Fetch Keycloak server info (version, SPI count)
 * 5. Detect and correlate custom providers with source code
 * 6. Compile everything into a formatted status report
 *
 * @returns Formatted connection status report or setup instructions
 *
 * @example
 * ```typescript
 * const report = await connectDevInstance();
 * // Returns either a status report or setup instructions
 * ```
 */
export async function connectDevInstance(): Promise<string> {
  const config = getDevConfig();
  if (!config) {
    return getSetupInstructions();
  }

  const client = new DevInstanceClient(config);
  const lines: string[] = [];

  // Step 1: Health check
  const running = await client.isRunning();
  if (!running) {
    lines.push("🔴 Keycloak Dev Instance Not Reachable");
    lines.push("");
    lines.push(`URL: ${config.url}`);
    lines.push("Status: Not responding");
    lines.push("");
    lines.push("Possible causes:");
    lines.push("  1. Keycloak is not started — run via Docker, IDELauncher, or 'mvnw quarkus:dev'");
    lines.push("  2. Wrong URL — check KC_DEV_URL (current: " + config.url + ")");
    lines.push("  3. Firewall or port conflict on the configured port");
    lines.push("  4. Instance is still starting up — wait and try again");
    return lines.join("\n");
  }

  // Step 2: Gather instance info
  let kcVersion = "unknown";
  let quarkusVersion = "unknown";
  let spiCount = 0;
  let providerCount = 0;
  let customProviders: Awaited<ReturnType<typeof detectCustomProviders>> = [];
  let extensionCount = 0;

  try {
    const quarkusInfo = await client.getQuarkusInfo();
    quarkusVersion = quarkusInfo.quarkusVersion;
  } catch {
    // Quarkus info not available — non-critical
  }

  try {
    const serverInfo = await client.getServerInfo();
    kcVersion = serverInfo.keycloakVersion;
    spiCount = serverInfo.spiCount;
    providerCount = serverInfo.providerCount;

    const allProviders = await client.getRegisteredProviders();
    customProviders = detectCustomProviders(allProviders);
  } catch {
    // Server info requires admin access — will show limited info
    lines.push("🟡 Keycloak Dev Instance Connected (limited — admin access failed)");
    lines.push("");
    lines.push(`URL:          ${config.url}`);
    lines.push("Status:       Running (healthy)");
    lines.push("Admin:        ❌ Could not obtain admin token");
    lines.push("");
    lines.push("Check KC_DEV_ADMIN_USERNAME and KC_DEV_ADMIN_PASSWORD.");
    lines.push("Default credentials are admin/admin.");
    return lines.join("\n");
  }

  try {
    const extensions = await getLoadedExtensions(client);
    extensionCount = extensions.length;
  } catch {
    // Extension info is optional
  }

  // Step 3: Build status report
  lines.push("🟢 Keycloak Dev Instance Connected");
  lines.push("");
  lines.push(`URL:          ${config.url}`);
  lines.push("Status:       Running (healthy)");
  lines.push(`Keycloak:     ${kcVersion}`);
  lines.push(`Quarkus:      ${quarkusVersion}`);
  lines.push(`Realm:        ${config.realm}`);
  lines.push("");
  lines.push(`Registered SPIs:     ${spiCount}`);
  lines.push(`Total Providers:     ${providerCount}`);
  lines.push(`Custom Providers:    ${customProviders.length}`);
  if (extensionCount > 0) {
    lines.push(`Loaded Extensions:   ${extensionCount}`);
  }

  // Step 4: Show custom provider details with source correlation
  if (customProviders.length > 0) {
    lines.push("");
    lines.push("Custom providers detected:");

    for (const provider of customProviders.slice(0, 20)) {
      try {
        const correlation = await correlateProvider(provider);
        const icon = correlation.sourceFound ? "✅" : "⚠️";
        const sourceNote = correlation.sourceFound
          ? "(found in source)"
          : "(source not found — check KEYCLOAK_SOURCE_PATH)";
        const name = provider.factoryClass.split(".").pop() ?? provider.providerId;
        lines.push(`  ${icon} ${provider.spiType.padEnd(20)} → ${name.padEnd(30)} ${sourceNote}`);
      } catch {
        lines.push(`  ❓ ${provider.spiType.padEnd(20)} → ${provider.providerId}`);
      }
    }

    if (customProviders.length > 20) {
      lines.push(`  ... and ${customProviders.length - 20} more`);
    }
  }

  lines.push("");
  lines.push('Run "get_loaded_providers" for full provider details.');
  lines.push('Run "validate_spi_registration" to check for configuration issues.');

  return lines.join("\n");
}
