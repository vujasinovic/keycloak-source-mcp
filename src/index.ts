#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getClassSource } from "./tools/get_class_source.js";
import { findInterfaceImplementors } from "./tools/find_interface_implementors.js";
import { searchSpiDefinitions } from "./tools/search_spi_definitions.js";
import { grepSource } from "./tools/grep_source.js";
import { explainImplementation } from "./tools/explain_implementation.js";
import { traceDependencies } from "./tools/trace_dependencies.js";
import { keycloakAdmin } from "./tools/keycloak_admin.js";
import { upgradeAssistant } from "./tools/upgrade_assistant.js";
import { visualizeAuthFlow } from "./tools/visualize_auth_flow.js";
import { checkSecurityAdvisories } from "./tools/check_security_advisories.js";
import { listVersions } from "./tools/list_versions.js";
import { addVersionFromBranch } from "./tools/add_version_from_branch.js";
import { compareAcrossVersions, scanBreakingChanges } from "./tools/compare_across_versions.js";
import { connectDevInstance } from "./live-dev/tools/connect_dev_instance.js";
import { getLoadedProviders } from "./live-dev/tools/get_loaded_providers.js";
import { analyzeLogs } from "./live-dev/tools/analyze_logs.js";
import { traceAuthenticationFlow } from "./live-dev/tools/trace_authentication_flow.js";
import { validateSpiRegistration } from "./live-dev/tools/validate_spi_registration.js";
import { getDevInstanceConfig } from "./live-dev/tools/get_dev_instance_config.js";
import { diagnoseUserTool } from "./live-dev/tools/diagnose_user.js";
import { getSourcePath } from "./utils.js";
import { versionManager } from "./version-manager.js";

// ── Shared parameter schemas ──

const versionParam = z
  .string()
  .optional()
  .describe('Optional version name (e.g. "v24", "v26"). Uses default if omitted. See list_versions.');

// ── Registration helper — eliminates per-tool boilerplate ──

let toolCount = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textTool(
  server: McpServer,
  name: string,
  description: string,
  schema: Record<string, z.ZodTypeAny>,
  handler: (args: any) => Promise<string> | string,
): void {
  toolCount++;
  server.tool(name, description, schema, async (args) => ({
    content: [{ type: "text", text: await handler(args) }],
  }));
}

// ── Startup ──

function validateEnvironment(): void {
  try {
    getSourcePath();
  } catch (error) {
    console.error("========================================");
    console.error("  Keycloak Source MCP — Startup Error");
    console.error("========================================");
    console.error("");
    console.error(error instanceof Error ? error.message : String(error));
    console.error("");
    console.error("To fix this:");
    console.error("  1. Clone the Keycloak source code:");
    console.error("     git clone https://github.com/keycloak/keycloak.git");
    console.error("  2. Set the environment variable:");
    console.error("     export KEYCLOAK_SOURCE_PATH=/path/to/keycloak");
    console.error("");
    process.exit(1);
  }
}

function printStartupBanner(): void {
  console.error("");
  console.error("keycloak-source-mcp started");
  console.error("");
  console.error("Registered versions:");
  console.error(versionManager.getStartupSummary());
  console.error("");
  console.error(`Tools available: ${toolCount}`);
  console.error("");
}

// ── Main ──

async function main(): Promise<void> {
  validateEnvironment();
  versionManager.initialize();

  const server = new McpServer({
    name: "keycloak-source-mcp",
    version: "1.0.0",
  });

  // ── Source Analysis Tools ──

  textTool(server, "get_class_source",
    "Get the full source code of a specific Java class. Auto-discovers file if not found at the given path.",
    {
      filePath: z.string().describe("Relative or absolute path to the Java file"),
      version: versionParam,
    },
    ({ filePath, version }) => getClassSource(filePath, version),
  );

  textTool(server, "find_interface_implementors",
    "Find all classes that implement a given interface or extend a given class.",
    {
      interfaceName: z.string().describe("Interface or class name to find implementors of"),
      version: versionParam,
    },
    ({ interfaceName, version }) => findInterfaceImplementors(interfaceName, version),
  );

  textTool(server, "search_spi_definitions",
    "Search and list SPI definitions in META-INF/services files.",
    {
      filter: z.string().optional().describe("Optional filter by SPI name"),
      version: versionParam,
    },
    ({ filter, version }) => searchSpiDefinitions(filter, version),
  );

  textTool(server, "grep_source",
    "Full-text search across the Keycloak source code. Uses ripgrep with regex support.",
    {
      query: z.string().describe("Search query (supports regex)"),
      filePattern: z.string().optional().describe("Glob pattern to filter files"),
      maxResults: z.number().optional().default(30).describe("Max results (default: 30, max: 100)"),
      version: versionParam,
    },
    ({ query, filePattern, maxResults, version }) => grepSource(query, filePattern, maxResults, version),
  );

  textTool(server, "explain_implementation",
    "Primary tool for understanding Keycloak internals. Accepts natural language queries about features, classes, or flows. " +
    "Orchestrates deep source analysis including class hierarchies, interface methods, SPI extension points, implementations, and dependencies. " +
    'Examples: "How does authentication flow work?", "Explain ExecuteActionsActionTokenHandler", "What happens during password reset?", "RequiredActionProvider"',
    {
      topic: z.string().describe('Natural language query or class name (e.g. "How does token refresh work?", "AuthenticationProcessor", "required action flow")'),
      version: versionParam,
    },
    ({ topic, version }) => explainImplementation(topic, version),
  );

  // ── Version Comparison ──

  textTool(server, "compare_versions",
    "Compare Keycloak source across two versions. " +
    "Use target='class' (default) with `query` to diff a specific class or interface. " +
    "Use target='spi_scan' to scan well-known SPI interfaces (or a custom list) for breaking changes.",
    {
      fromVersion: z.string().describe('Source version (e.g. "v24")'),
      toVersion: z.string().describe('Target version (e.g. "v26")'),
      target: z.enum(["class", "spi_scan"]).optional().default("class").describe("What to compare"),
      query: z.string().optional().describe("Class/interface name (required when target='class')"),
      mode: z.enum(["diff", "side_by_side"]).optional().default("diff").describe("Output mode for class compare"),
      interfaces: z.array(z.string()).optional().describe("SPI interfaces to scan (target='spi_scan' only)"),
      sourcePathV1: z.string().optional().describe("Explicit override for source v1 path (spi_scan only)"),
      sourcePathV2: z.string().optional().describe("Explicit override for source v2 path (spi_scan only)"),
    },
    ({ fromVersion, toVersion, target, query, mode, interfaces, sourcePathV1, sourcePathV2 }) => {
      if (target === "spi_scan") {
        return scanBreakingChanges(fromVersion, toVersion, interfaces, sourcePathV1, sourcePathV2);
      }
      if (!query) return "Error: `query` is required when target='class'.";
      return compareAcrossVersions(query, fromVersion, toVersion, mode);
    },
  );

  // ── Dependency & Architecture Tools ──

  textTool(server, "trace_dependencies",
    "Trace what a Keycloak class depends on and what depends on it.",
    {
      className: z.string().describe("Class or interface name"),
      direction: z.enum(["upstream", "downstream", "both"]).describe("Trace direction"),
      depth: z.number().optional().default(2).describe("Depth (default: 2, max: 4)"),
      version: versionParam,
    },
    ({ className, direction, depth, version }) => traceDependencies(className, direction, depth, version),
  );

  textTool(server, "upgrade_assistant",
    "Analyze custom Keycloak SPI implementations for upgrade compatibility.",
    {
      customSourcePath: z.string().describe("Path to custom extensions source"),
      targetKeycloakVersion: z.string().describe("Target Keycloak version"),
      currentKeycloakSourcePath: z.string().optional().describe("Path to target version source"),
    },
    ({ customSourcePath, targetKeycloakVersion, currentKeycloakSourcePath }) =>
      upgradeAssistant(customSourcePath, targetKeycloakVersion, currentKeycloakSourcePath),
  );

  // ── Admin & Visualization Tools ──

  textTool(server, "keycloak_admin",
    "Connect to a running Keycloak instance and perform admin queries.",
    {
      action: z.string().describe('Action: "list_realms", "list_flows", "list_clients", "list_providers", "get_realm_settings"'),
      realm: z.string().optional().describe('Realm name (default: "master")'),
    },
    ({ action, realm }) => keycloakAdmin(action, realm),
  );

  textTool(server, "visualize_auth_flow",
    "Visualize a Keycloak authentication flow as a Mermaid diagram.",
    {
      source: z.enum(["realm_export", "description"]).describe("Source type"),
      realmExportPath: z.string().optional().describe("Path to realm JSON export"),
      flowName: z.string().optional().describe("Flow to visualize (default: 'browser')"),
      description: z.string().optional().describe("Plain English flow description"),
    },
    ({ source, realmExportPath, flowName, description }) =>
      visualizeAuthFlow(source, realmExportPath, flowName, description),
  );

  textTool(server, "check_security_advisories",
    "Check Keycloak GitHub security advisories for CVEs affecting a version.",
    {
      keycloakVersion: z.string().describe("Keycloak version (e.g. '24.0.3')"),
      severity: z.enum(["all", "critical", "high", "medium", "low"]).optional().default("all").describe("Severity filter"),
    },
    ({ keycloakVersion, severity }) => checkSecurityAdvisories(keycloakVersion, severity),
  );

  textTool(server, "list_versions",
    "List all registered Keycloak source versions.",
    {},
    () => listVersions(),
  );

  textTool(server, "add_version_from_branch",
    "Create a git worktree of a Keycloak release branch and register it as a named version. " +
    "Lets you juggle multiple versions from a single clone (shared .git) without re-cloning. " +
    "Example: add_version_from_branch(versionName='v26', branch='release/26.0').",
    {
      versionName: z.string().describe("Name to register the version under (e.g. 'v26')"),
      branch: z.string().describe("Branch ref in the base repo (e.g. 'release/26.0')"),
      baseRepoPath: z.string().optional().describe("Path to the main Keycloak clone. Defaults to KEYCLOAK_SOURCE_PATH."),
      worktreePath: z.string().optional().describe("Where to create the worktree. Defaults to sibling of baseRepoPath."),
    },
    ({ versionName, branch, baseRepoPath, worktreePath }) =>
      addVersionFromBranch(versionName, branch, baseRepoPath, worktreePath),
  );

  // ── Live Development Intelligence Tools ──

  textTool(server, "connect_dev_instance",
    "Test connection to a running Keycloak dev instance. Returns status, version info, and detected custom providers.",
    {},
    () => connectDevInstance(),
  );

  textTool(server, "get_loaded_providers",
    "List all SPI providers registered in the running Keycloak instance, correlated with source code.",
    {
      spiType: z.string().optional().describe('Filter by SPI type e.g. "authenticator", "required-action"'),
      customOnly: z.boolean().optional().default(false).describe("Show only non-Keycloak-core providers"),
    },
    ({ spiType, customOnly }) => getLoadedProviders(spiType, customOnly),
  );

  textTool(server, "analyze_logs",
    "Read and analyze recent Keycloak logs. Detects errors, stack traces, and authentication flow steps.",
    {
      lines: z.number().optional().default(200).describe("Number of recent log lines to analyze (default: 200)"),
      filter: z.string().optional().describe("Filter to specific class name or keyword"),
      extractFlow: z.boolean().optional().default(true).describe("Attempt to extract authentication flow steps"),
    },
    ({ lines, filter, extractFlow }) => analyzeLogs(lines, filter, extractFlow),
  );

  textTool(server, "trace_authentication_flow",
    "Guide through triggering and tracing a Keycloak authentication flow with log analysis.",
    {
      realm: z.string().describe("Realm to trace authentication in"),
      description: z.string().describe('Description of what to test, e.g. "browser login with OTP"'),
    },
    ({ realm, description }) => traceAuthenticationFlow(realm, description),
  );

  textTool(server, "validate_spi_registration",
    "Validate that custom SPI providers are correctly registered and configured. Detects common registration mistakes.",
    {
      customSourcePath: z.string().optional().describe("Path to custom extensions source (falls back to KEYCLOAK_SOURCE_PATH)"),
    },
    ({ customSourcePath }) => validateSpiRegistration(customSourcePath),
  );

  textTool(server, "get_dev_instance_config",
    "Get active configuration of the running Keycloak instance, focused on SPI-relevant settings.",
    {
      filter: z.string().optional().describe('Filter config keys by prefix e.g. "kc.spi", "quarkus.datasource"'),
    },
    ({ filter }) => getDevInstanceConfig(filter),
  );

  textTool(server, "diagnose_user",
    "Diagnose why a user cannot log in. Searches by name, email, or username and checks account status, credentials, brute force lockout, recent login events, and active sessions.",
    {
      query: z.string().describe('User search query — name, email, or username (e.g. "John Doe", "john@example.com")'),
      realm: z.string().optional().default("master").describe("Realm to search in (default: master)"),
    },
    ({ query, realm }) => diagnoseUserTool(query, realm),
  );

  // Print banner after all tools registered so count is accurate
  printStartupBanner();

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
