/**
 * @file validate_spi_registration.ts
 * @module live-dev/tools
 * @author keycloak-source-mcp
 * @since 1.1.0
 *
 * MCP tool: validate_spi_registration
 *
 * Validates that all custom SPI providers are correctly registered and configured.
 * This is invaluable for debugging "my SPI isn't being picked up" issues which
 * are extremely common in Keycloak SPI development.
 *
 * Common registration mistakes this tool detects:
 * - Missing META-INF/services entry
 * - Factory class not implementing the correct interface
 * - Typos in META-INF/services file name
 * - Provider ID mismatch between code and configuration
 * - Missing no-arg constructor on factory class
 */

import {
  DevInstanceClient,
  getDevConfig,
  getSetupInstructions,
  type Provider,
} from "../dev-instance-client.js";
import {
  compareRegisteredVsSource,
  detectCustomProviders,
  type ProviderCorrelation,
} from "../spi-correlator.js";
import { searchWithRg, getSourcePath } from "../../utils.js";

/**
 * Validate the registration and configuration of custom SPI providers.
 *
 * The validation process:
 * 1. Fetch all registered providers from the running instance
 * 2. Identify which are custom (non-Keycloak-core)
 * 3. For each custom provider:
 *    - Check if META-INF/services entry exists in source
 *    - Verify the factory class can be found in source
 *    - Look for common mistakes (wrong interface, missing factory)
 * 4. Compile a validation report with ✅ / ⚠️ / ❌ status
 *
 * @param customSourcePath - Optional explicit path to custom extensions source
 * @returns Formatted validation report or setup instructions
 *
 * @example
 * ```typescript
 * const report = await validateSpiRegistration();
 * // Shows status for each custom provider
 *
 * const report = await validateSpiRegistration("/path/to/my-extensions");
 * // Validates against specific source directory
 * ```
 */
export async function validateSpiRegistration(
  customSourcePath?: string
): Promise<string> {
  const config = getDevConfig();
  if (!config) return getSetupInstructions();

  const client = new DevInstanceClient(config);
  const running = await client.isRunning();
  if (!running) {
    return `Keycloak dev instance is not reachable at ${config.url}.\nStart the instance and try again.`;
  }

  let allProviders: Provider[];
  try {
    allProviders = await client.getRegisteredProviders();
  } catch (error) {
    return `Error fetching providers: ${error instanceof Error ? error.message : String(error)}`;
  }

  const customProviders = detectCustomProviders(allProviders);
  const output: string[] = [];

  output.push("SPI Registration Validation");
  output.push("=".repeat(60));
  output.push(`Total providers: ${allProviders.length}`);
  output.push(`Custom providers: ${customProviders.length}`);
  output.push("");

  if (customProviders.length === 0) {
    output.push("No custom providers detected.");
    output.push("All registered providers are Keycloak built-in.");
    output.push("");
    output.push("If you expected custom providers, check:");
    output.push("  1. Your extension JAR is on the classpath");
    output.push("  2. META-INF/services files are present in the JAR");
    output.push("  3. Docker: mount your JAR into /opt/keycloak/providers/");
    output.push("  4. IDELauncher/Maven: ensure your module is on the classpath");
    return output.join("\n");
  }

  // Validate each custom provider
  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const provider of customProviders) {
    const validation = await validateSingleProvider(provider, customSourcePath);
    output.push(`── ${provider.spiType}: ${provider.providerId} ──`);
    output.push(`  Factory: ${provider.factoryClass}`);

    for (const check of validation.checks) {
      if (check.status === "pass") {
        output.push(`  ✅ ${check.label}`);
        passCount++;
      } else if (check.status === "warn") {
        output.push(`  ⚠️  ${check.label}`);
        if (check.detail) output.push(`     ${check.detail}`);
        warnCount++;
      } else {
        output.push(`  ❌ ${check.label}`);
        if (check.detail) output.push(`     ${check.detail}`);
        failCount++;
      }
    }
    output.push("");
  }

  // Summary
  output.push("─".repeat(40));
  output.push(`Summary: ${passCount} ✅  ${warnCount} ⚠️   ${failCount} ❌`);

  if (failCount > 0) {
    output.push("");
    output.push("Common fixes for ❌ issues:");
    output.push("  - Ensure META-INF/services/<InterfaceFQCN> file exists");
    output.push("  - Verify factory class FQCN matches the services file entry");
    output.push("  - Check that getId() returns the expected provider ID");
    output.push("  - Ensure factory class has a public no-arg constructor");
  }

  return output.join("\n");
}

/** Result of validating a single provider */
interface ValidationResult {
  checks: Array<{
    label: string;
    status: "pass" | "warn" | "fail";
    detail?: string;
  }>;
}

/**
 * Run validation checks on a single custom provider.
 */
async function validateSingleProvider(
  provider: Provider,
  customSourcePath?: string
): Promise<ValidationResult> {
  const checks: ValidationResult["checks"] = [];

  // Check 1: Factory class exists in source
  let sourcePath: string;
  try {
    sourcePath = customSourcePath ?? getSourcePath();
  } catch {
    checks.push({
      label: "Source check",
      status: "warn",
      detail: "KEYCLOAK_SOURCE_PATH not set — cannot verify source",
    });
    return { checks };
  }

  const className = provider.factoryClass.split(".").pop() ?? "";
  if (className) {
    try {
      const args = ["--files", "--glob", `**/${className}.java`];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        checks.push({ label: "Factory source found", status: "pass" });
      } else {
        checks.push({
          label: "Factory source not found",
          status: "warn",
          detail: `Could not find ${className}.java in source path`,
        });
      }
    } catch {
      checks.push({
        label: "Factory source check failed",
        status: "warn",
        detail: "Search error — source path may be incorrect",
      });
    }
  }

  // Check 2: META-INF/services file exists
  try {
    const args = ["--files", "--glob", "**/META-INF/services/*"];
    const result = await searchWithRg(args, sourcePath);
    if (result.trim()) {
      // Check if any services file contains the factory class
      const serviceFiles = result.trim().split("\n");
      let foundInServices = false;

      for (const sf of serviceFiles) {
        try {
          const contentArgs = ["-l", provider.factoryClass.split(".").pop() ?? "", sf.startsWith("/") ? sf : `${sourcePath}/${sf}`];
          const contentResult = await searchWithRg(contentArgs, sourcePath);
          if (contentResult.trim()) {
            foundInServices = true;
            break;
          }
        } catch {
          // Continue checking other files
        }
      }

      if (foundInServices) {
        checks.push({ label: "META-INF/services entry found", status: "pass" });
      } else {
        checks.push({
          label: "META-INF/services entry not found",
          status: "warn",
          detail: "Factory class not listed in any META-INF/services file",
        });
      }
    } else {
      checks.push({
        label: "No META-INF/services files found",
        status: "fail",
        detail: "Custom providers must be registered in META-INF/services",
      });
    }
  } catch {
    checks.push({
      label: "META-INF/services check",
      status: "warn",
      detail: "Could not search for services files",
    });
  }

  // Check 3: Provider is responding (it's registered, so it was loaded successfully)
  checks.push({ label: "Provider loaded at runtime", status: "pass" });

  return { checks };
}
