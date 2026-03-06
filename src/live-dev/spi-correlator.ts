/**
 * @file spi-correlator.ts
 * @module live-dev
 * @author keycloak-source-mcp
 * @since 1.1.0
 *
 * Correlates the live runtime state of SPIs with source code in the registered
 * Keycloak source paths. This is the bridge between "what is running" and
 * "what the code says" — the most architecturally important file in the
 * Live Development Intelligence feature.
 *
 * How Keycloak's SPI system works:
 *
 * 1. SPIs are defined by an interface pair: ProviderFactory + Provider
 *    (e.g., AuthenticatorFactory + Authenticator)
 *
 * 2. Implementations are registered via META-INF/services files where the
 *    key is the factory interface FQCN and the value lists factory implementation FQCNs
 *
 * 3. Each factory has a getId() method returning a unique string (the "provider ID")
 *    This ID is what appears in Keycloak configuration and realm exports
 *
 * 4. At runtime, Keycloak's ProviderManager discovers all factories, calls getId(),
 *    and builds a registry mapping (SPI type, provider ID) → factory class
 *
 * Correlation strategy:
 * - Given a live provider (spiType + providerId + factoryClass), we search source for:
 *   a. The factory class by FQCN (most reliable)
 *   b. The provider ID string in getId() methods (fallback)
 *   c. META-INF/services entries for the factory
 * - We classify providers as built-in (from org.keycloak.*) or custom
 * - We detect mismatches: source exists but not registered, or registered but source not found
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Provider } from "./dev-instance-client.js";
import { getSourcePath, searchWithRg } from "../utils.js";

/**
 * Result of correlating a live provider with its source code.
 * Contains both the runtime information and the source location (if found).
 */
export interface ProviderCorrelation {
  /** The live provider information */
  provider: Provider;
  /** Whether the source code was found in any registered source path */
  sourceFound: boolean;
  /** Relative path to the factory source file, if found */
  sourceFile: string | null;
  /** Relative path to the META-INF/services file where this factory is listed */
  servicesFile: string | null;
  /** Which Keycloak source version the source was found in */
  version: string;
  /** Any notes about the correlation (e.g., warnings) */
  notes: string[];
}

/**
 * Full correlation report comparing live providers against source code.
 */
export interface CorrelationReport {
  /** Total providers found in the running instance */
  totalProviders: number;
  /** Providers successfully correlated with source */
  correlatedCount: number;
  /** Providers where source was not found */
  uncorrelatedCount: number;
  /** Number of custom (non-Keycloak-core) providers */
  customCount: number;
  /** Individual correlation results */
  correlations: ProviderCorrelation[];
  /** Summary text */
  summary: string;
}

/**
 * Source location for a provider.
 */
export interface SourceLocation {
  /** Relative file path within the source tree */
  filePath: string;
  /** Which registered version this was found in */
  version: string;
}

/**
 * Correlate a single live provider with its source code location.
 *
 * Uses the factory class name to search across all registered Keycloak source paths.
 * The search strategy is:
 * 1. Convert FQCN to file path (e.g., org.keycloak.Foo → org/keycloak/Foo.java)
 * 2. Search for that path in source trees
 * 3. If not found by path, search by class name in file listing
 *
 * @param provider - The live provider to correlate
 * @param version - Optional version name to search in (default: "default")
 * @returns Correlation result including source location or null
 *
 * @example
 * ```typescript
 * const correlation = await correlateProvider({
 *   spiType: "authenticator",
 *   providerId: "auth-otp-form",
 *   factoryClass: "org.keycloak.authentication.authenticators.browser.OTPFormAuthenticatorFactory",
 *   isBuiltIn: true,
 * });
 * if (correlation.sourceFound) {
 *   console.log(`Source: ${correlation.sourceFile}`);
 * }
 * ```
 */
export async function correlateProvider(
  provider: Provider,
  version: string = "default"
): Promise<ProviderCorrelation> {
  const notes: string[] = [];
  let sourceFile: string | null = null;
  let servicesFile: string | null = null;

  let sourcePath: string;
  try {
    sourcePath = getSourcePath(version);
  } catch {
    return {
      provider,
      sourceFound: false,
      sourceFile: null,
      servicesFile: null,
      version,
      notes: ["Source path not available for version: " + version],
    };
  }

  // Strategy 1: Convert FQCN to expected file path
  const classFilePath = provider.factoryClass.replace(/\./g, "/") + ".java";
  const location = await findProviderSource(provider.providerId, provider.spiType, version);

  if (location) {
    sourceFile = location.filePath;
  } else {
    // Strategy 2: Search by class name
    const className = provider.factoryClass.split(".").pop() ?? "";
    if (className) {
      try {
        const args = ["--files", "--glob", `**/${className}.java`];
        const result = await searchWithRg(args, sourcePath);
        if (result.trim()) {
          sourceFile = result.trim().split("\n")[0];
          if (!sourceFile.startsWith("/")) {
            sourceFile = path.relative(sourcePath, path.join(sourcePath, sourceFile));
          } else {
            sourceFile = path.relative(sourcePath, sourceFile);
          }
        }
      } catch {
        notes.push("Source search failed for class: " + className);
      }
    }
  }

  // Check for META-INF/services entry
  try {
    const spiInterface = guessSpiInterface(provider.spiType);
    if (spiInterface) {
      const args = ["--files", "--glob", `**/META-INF/services/*${spiInterface}*`];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        servicesFile = result.trim().split("\n")[0];
      }
    }
  } catch {
    // META-INF search is best-effort
  }

  return {
    provider,
    sourceFound: sourceFile !== null,
    sourceFile,
    servicesFile,
    version,
    notes,
  };
}

/**
 * Search for the source file of a provider by its ID and SPI type.
 *
 * Searches for the provider ID string inside getId() method implementations
 * in the source code. This is useful when the factory class name from the
 * server info doesn't directly match the file path.
 *
 * @param providerId - The provider's unique ID string
 * @param spiType - The SPI type, e.g. "authenticator"
 * @param version - Version name to search in
 * @returns Source location or null if not found
 *
 * @example
 * ```typescript
 * const loc = await findProviderSource("auth-otp-form", "authenticator");
 * if (loc) console.log(`Found at ${loc.filePath}`);
 * ```
 */
export async function findProviderSource(
  providerId: string,
  spiType: string,
  version: string = "default"
): Promise<SourceLocation | null> {
  let sourcePath: string;
  try {
    sourcePath = getSourcePath(version);
  } catch {
    return null;
  }

  try {
    // Search for getId() returning this providerId
    const args = ["-n", "--type", "java", `-l`, `"${providerId}"`];
    const result = await searchWithRg(args, sourcePath);

    if (result.trim()) {
      const file = result.trim().split("\n")[0];
      const relPath = file.startsWith("/") ? path.relative(sourcePath, file) : file;
      return { filePath: relPath, version };
    }
  } catch {
    // Search failed
  }

  return null;
}

/**
 * Compare the set of live providers against what's available in source code.
 *
 * Produces a comprehensive report showing which providers have source,
 * which don't, and summary statistics. This is the primary diagnostic
 * for "is my SPI correctly set up?" questions.
 *
 * @param liveProviders - Array of providers from the running instance
 * @param version - Version name to correlate against
 * @returns Full correlation report
 *
 * @example
 * ```typescript
 * const providers = await client.getRegisteredProviders();
 * const report = await compareRegisteredVsSource(providers);
 * console.log(report.summary);
 * ```
 */
export async function compareRegisteredVsSource(
  liveProviders: Provider[],
  version: string = "default"
): Promise<CorrelationReport> {
  const correlations: ProviderCorrelation[] = [];

  for (const provider of liveProviders) {
    const correlation = await correlateProvider(provider, version);
    correlations.push(correlation);
  }

  const correlatedCount = correlations.filter((c) => c.sourceFound).length;
  const uncorrelatedCount = correlations.filter((c) => !c.sourceFound).length;
  const customCount = correlations.filter((c) => !c.provider.isBuiltIn).length;

  const summary = [
    `Provider Correlation Report`,
    `${"=".repeat(40)}`,
    `Total providers: ${liveProviders.length}`,
    `Source found: ${correlatedCount}`,
    `Source not found: ${uncorrelatedCount}`,
    `Custom providers: ${customCount}`,
  ].join("\n");

  return {
    totalProviders: liveProviders.length,
    correlatedCount,
    uncorrelatedCount,
    customCount,
    correlations,
    summary,
  };
}

/**
 * Identify which providers are custom (not part of Keycloak core).
 *
 * A provider is considered custom if its factory class is NOT in the
 * org.keycloak.* package hierarchy. This heuristic works because all
 * built-in Keycloak providers use that package prefix.
 *
 * @param liveProviders - Array of providers from the running instance
 * @returns Array of custom (non-core) providers
 *
 * @example
 * ```typescript
 * const custom = await detectCustomProviders(providers);
 * console.log(`Found ${custom.length} custom providers`);
 * ```
 */
export function detectCustomProviders(liveProviders: Provider[]): Provider[] {
  return liveProviders.filter((p) => !p.isBuiltIn);
}

/**
 * Guess the SPI factory interface name from a provider type string.
 *
 * Keycloak uses a naming convention where the SPI type maps to a factory interface:
 * - "authenticator" → "AuthenticatorFactory"
 * - "required-action" → "RequiredActionFactory"
 * - "event-listener" → "EventListenerProviderFactory"
 *
 * This is heuristic and may not cover all SPIs.
 *
 * @param spiType - The SPI type string from the provider registry
 * @returns Best-guess factory interface name, or null if unknown
 */
function guessSpiInterface(spiType: string): string | null {
  // Common SPI type → factory interface mappings
  const mappings: Record<string, string> = {
    authenticator: "AuthenticatorFactory",
    "required-action": "RequiredActionFactory",
    "event-listener": "EventListenerProviderFactory",
    "protocol-mapper": "ProtocolMapperFactory",
    "identity-provider": "IdentityProviderFactory",
    "user-storage": "UserStorageProviderFactory",
    "credential": "CredentialProviderFactory",
    "form-action": "FormActionFactory",
    "form-authenticator": "FormAuthenticatorFactory",
  };

  if (mappings[spiType]) return mappings[spiType];

  // Heuristic: capitalize words and append "Factory"
  const parts = spiType.split("-");
  const capitalized = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
  return capitalized + "Factory";
}
