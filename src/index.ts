#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchClass } from "./tools/search_class.js";
import { getClassSource } from "./tools/get_class_source.js";
import { findInterfaceImplementors } from "./tools/find_interface_implementors.js";
import { searchSpiDefinitions } from "./tools/search_spi_definitions.js";
import { grepSource } from "./tools/grep_source.js";
import { explainImplementation } from "./tools/explain_implementation.js";
import { detectBreakingChanges } from "./tools/detect_breaking_changes.js";
import { traceDependencies } from "./tools/trace_dependencies.js";
import { keycloakAdmin } from "./tools/keycloak_admin.js";
import { upgradeAssistant } from "./tools/upgrade_assistant.js";
import { visualizeAuthFlow } from "./tools/visualize_auth_flow.js";
import { checkSecurityAdvisories } from "./tools/check_security_advisories.js";
import { listVersions } from "./tools/list_versions.js";
import { compareAcrossVersions } from "./tools/compare_across_versions.js";
import { connectDevInstance } from "./live-dev/tools/connect_dev_instance.js";
import { getLoadedProviders } from "./live-dev/tools/get_loaded_providers.js";
import { analyzeLogs } from "./live-dev/tools/analyze_logs.js";
import { traceAuthenticationFlow } from "./live-dev/tools/trace_authentication_flow.js";
import { validateSpiRegistration } from "./live-dev/tools/validate_spi_registration.js";
import { getDevInstanceConfig } from "./live-dev/tools/get_dev_instance_config.js";
import { debugAuthFlow } from "./live-dev/tools/debug_auth_flow.js";
import { diagnoseUserTool } from "./live-dev/tools/diagnose_user.js";
import { getSourcePath } from "./utils.js";
import { versionManager } from "./version-manager.js";

const versionParam = z
  .string()
  .optional()
  .describe('Optional version name (e.g. "v24", "v26"). Uses default if omitted. See list_versions.');

// Startup validation
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
  versionManager.initialize();
  const versions = versionManager.listVersions();
  const toolCount = 23;

  console.error("");
  console.error("keycloak-source-mcp started");
  console.error("");
  console.error("Registered versions:");
  console.error(versionManager.getStartupSummary());
  console.error("");
  console.error(`Tools available: ${toolCount}`);
  console.error("");
}

async function main(): Promise<void> {
  validateEnvironment();
  printStartupBanner();

  const server = new McpServer({
    name: "keycloak-source-mcp",
    version: "1.0.0",
  });

  server.tool(
    "search_class",
    "Search for a Java class or interface by name in the Keycloak source. Supports partial names and wildcards.",
    {
      className: z.string().describe("Class or interface name to search for"),
      version: versionParam,
    },
    async ({ className, version }) => ({
      content: [{ type: "text", text: await searchClass(className, version) }],
    })
  );

  server.tool(
    "get_class_source",
    "Get the full source code of a specific Java class. Auto-discovers file if not found at the given path.",
    {
      filePath: z.string().describe("Relative or absolute path to the Java file"),
      version: versionParam,
    },
    async ({ filePath, version }) => ({
      content: [{ type: "text", text: await getClassSource(filePath, version) }],
    })
  );

  server.tool(
    "find_interface_implementors",
    "Find all classes that implement a given interface or extend a given class.",
    {
      interfaceName: z.string().describe("Interface or class name to find implementors of"),
      version: versionParam,
    },
    async ({ interfaceName, version }) => ({
      content: [{ type: "text", text: await findInterfaceImplementors(interfaceName, version) }],
    })
  );

  server.tool(
    "search_spi_definitions",
    "Search and list SPI definitions in META-INF/services files.",
    {
      filter: z.string().optional().describe("Optional filter by SPI name"),
      version: versionParam,
    },
    async ({ filter, version }) => ({
      content: [{ type: "text", text: await searchSpiDefinitions(filter, version) }],
    })
  );

  server.tool(
    "grep_source",
    "Full-text search across the Keycloak source code. Uses ripgrep with regex support.",
    {
      query: z.string().describe("Search query (supports regex)"),
      filePattern: z.string().optional().describe("Glob pattern to filter files"),
      maxResults: z.number().optional().default(30).describe("Max results (default: 30, max: 100)"),
      version: versionParam,
    },
    async ({ query, filePattern, maxResults, version }) => ({
      content: [{ type: "text", text: await grepSource(query, filePattern, maxResults, version) }],
    })
  );

  server.tool(
    "explain_implementation",
    "Explain how a Keycloak feature works by finding relevant source files, interfaces, implementations, and SPIs.",
    {
      topic: z.string().describe('Topic (e.g. "authentication flow", "token refresh", "user federation")'),
      version: versionParam,
    },
    async ({ topic, version }) => ({
      content: [{ type: "text", text: await explainImplementation(topic, version) }],
    })
  );

  server.tool(
    "detect_breaking_changes",
    "Compare Keycloak SPI interfaces between two versions to detect breaking changes.",
    {
      fromVersion: z.string().describe("Source version (e.g. '24.0.0' or registered name like 'v24')"),
      toVersion: z.string().describe("Target version (e.g. '26.0.0' or registered name like 'v26')"),
      interfaceNames: z.array(z.string()).optional().describe("Specific interfaces to check"),
      sourcePathV1: z.string().optional().describe("Explicit path to older source"),
      sourcePathV2: z.string().optional().describe("Explicit path to newer source"),
    },
    async ({ fromVersion, toVersion, interfaceNames, sourcePathV1, sourcePathV2 }) => {
      // Try to resolve version names from VersionManager
      let v1Path = sourcePathV1;
      let v2Path = sourcePathV2;
      if (!v1Path) {
        try { v1Path = versionManager.resolve(fromVersion); } catch { /* fall through */ }
      }
      if (!v2Path) {
        try { v2Path = versionManager.resolve(toVersion); } catch { /* fall through */ }
      }
      return {
        content: [{
          type: "text",
          text: await detectBreakingChanges(fromVersion, toVersion, interfaceNames, v1Path, v2Path),
        }],
      };
    }
  );

  server.tool(
    "trace_dependencies",
    "Trace what a Keycloak class depends on and what depends on it.",
    {
      className: z.string().describe("Class or interface name"),
      direction: z.enum(["upstream", "downstream", "both"]).describe("Trace direction"),
      depth: z.number().optional().default(2).describe("Depth (default: 2, max: 4)"),
      version: versionParam,
    },
    async ({ className, direction, depth, version }) => ({
      content: [{ type: "text", text: await traceDependencies(className, direction, depth, version) }],
    })
  );

  server.tool(
    "keycloak_admin",
    "Connect to a running Keycloak instance and perform admin queries.",
    {
      action: z.string().describe('Action: "list_realms", "list_flows", "list_clients", "list_providers", "get_realm_settings"'),
      realm: z.string().optional().describe('Realm name (default: "master")'),
    },
    async ({ action, realm }) => ({
      content: [{ type: "text", text: await keycloakAdmin(action, realm) }],
    })
  );

  server.tool(
    "upgrade_assistant",
    "Analyze custom Keycloak SPI implementations for upgrade compatibility.",
    {
      customSourcePath: z.string().describe("Path to custom extensions source"),
      targetKeycloakVersion: z.string().describe("Target Keycloak version"),
      currentKeycloakSourcePath: z.string().optional().describe("Path to target version source"),
    },
    async ({ customSourcePath, targetKeycloakVersion, currentKeycloakSourcePath }) => ({
      content: [{ type: "text", text: await upgradeAssistant(customSourcePath, targetKeycloakVersion, currentKeycloakSourcePath) }],
    })
  );

  server.tool(
    "visualize_auth_flow",
    "Visualize a Keycloak authentication flow as a Mermaid diagram.",
    {
      source: z.enum(["realm_export", "description"]).describe("Source type"),
      realmExportPath: z.string().optional().describe("Path to realm JSON export"),
      flowName: z.string().optional().describe("Flow to visualize (default: 'browser')"),
      description: z.string().optional().describe("Plain English flow description"),
    },
    async ({ source, realmExportPath, flowName, description }) => ({
      content: [{ type: "text", text: await visualizeAuthFlow(source, realmExportPath, flowName, description) }],
    })
  );

  server.tool(
    "check_security_advisories",
    "Check Keycloak GitHub security advisories for CVEs affecting a version.",
    {
      keycloakVersion: z.string().describe("Keycloak version (e.g. '24.0.3')"),
      severity: z.enum(["all", "critical", "high", "medium", "low"]).optional().default("all").describe("Severity filter"),
    },
    async ({ keycloakVersion, severity }) => ({
      content: [{ type: "text", text: await checkSecurityAdvisories(keycloakVersion, severity) }],
    })
  );

  server.tool(
    "list_versions",
    "List all registered Keycloak source versions.",
    {},
    async () => ({
      content: [{ type: "text", text: listVersions() }],
    })
  );

  server.tool(
    "compare_across_versions",
    "Compare a class or interface across two registered Keycloak versions. Shows added/removed/changed methods.",
    {
      query: z.string().describe("Class or interface name to compare"),
      fromVersion: z.string().describe('Source version name (e.g. "v24")'),
      toVersion: z.string().describe('Target version name (e.g. "v26")'),
      mode: z.enum(["diff", "side_by_side"]).optional().default("diff").describe("Output mode"),
    },
    async ({ query, fromVersion, toVersion, mode }) => ({
      content: [{ type: "text", text: await compareAcrossVersions(query, fromVersion, toVersion, mode) }],
    })
  );

  // ── Live Development Intelligence tools ──

  server.tool(
    "connect_dev_instance",
    "Test connection to a running Keycloak dev instance. Returns status, version info, and detected custom providers.",
    {},
    async () => ({
      content: [{ type: "text", text: await connectDevInstance() }],
    })
  );

  server.tool(
    "get_loaded_providers",
    "List all SPI providers registered in the running Keycloak instance, correlated with source code.",
    {
      spiType: z.string().optional().describe('Filter by SPI type e.g. "authenticator", "required-action"'),
      customOnly: z.boolean().optional().default(false).describe("Show only non-Keycloak-core providers"),
    },
    async ({ spiType, customOnly }) => ({
      content: [{ type: "text", text: await getLoadedProviders(spiType, customOnly) }],
    })
  );

  server.tool(
    "analyze_logs",
    "Read and analyze recent Keycloak logs. Detects errors, stack traces, and authentication flow steps.",
    {
      lines: z.number().optional().default(200).describe("Number of recent log lines to analyze (default: 200)"),
      filter: z.string().optional().describe("Filter to specific class name or keyword"),
      extractFlow: z.boolean().optional().default(true).describe("Attempt to extract authentication flow steps"),
    },
    async ({ lines, filter, extractFlow }) => ({
      content: [{ type: "text", text: await analyzeLogs(lines, filter, extractFlow) }],
    })
  );

  server.tool(
    "trace_authentication_flow",
    "Guide through triggering and tracing a Keycloak authentication flow with log analysis.",
    {
      realm: z.string().describe("Realm to trace authentication in"),
      description: z.string().describe('Description of what to test, e.g. "browser login with OTP"'),
    },
    async ({ realm, description }) => ({
      content: [{ type: "text", text: await traceAuthenticationFlow(realm, description) }],
    })
  );

  server.tool(
    "validate_spi_registration",
    "Validate that custom SPI providers are correctly registered and configured. Detects common registration mistakes.",
    {
      customSourcePath: z.string().optional().describe("Path to custom extensions source (falls back to KEYCLOAK_SOURCE_PATH)"),
    },
    async ({ customSourcePath }) => ({
      content: [{ type: "text", text: await validateSpiRegistration(customSourcePath) }],
    })
  );

  server.tool(
    "get_dev_instance_config",
    "Get active configuration of the running Keycloak instance, focused on SPI-relevant settings.",
    {
      filter: z.string().optional().describe('Filter config keys by prefix e.g. "kc.spi", "quarkus.datasource"'),
    },
    async ({ filter }) => ({
      content: [{ type: "text", text: await getDevInstanceConfig(filter) }],
    })
  );

  server.tool(
    "debug_auth_flow",
    "Real-time auth flow debugger. Phase 'start' captures a log snapshot; phase 'analyze' reads new log entries and produces a source-annotated trace.",
    {
      phase: z.enum(["start", "analyze"]).describe("Phase: 'start' to capture snapshot, 'analyze' to produce trace"),
      realm: z.string().optional().default("master").describe("Realm name (default: master)"),
      description: z.string().optional().describe("Description of the flow being tested"),
      snapshot: z.string().optional().describe("JSON snapshot string from the start phase"),
      version: versionParam,
    },
    async ({ phase, realm, description, snapshot, version }) => ({
      content: [{ type: "text", text: await debugAuthFlow(phase, realm, description, snapshot, version) }],
    })
  );

  server.tool(
    "diagnose_user",
    "Diagnose why a user cannot log in. Searches by name, email, or username and checks account status, credentials, brute force lockout, recent login events, and active sessions.",
    {
      query: z.string().describe('User search query — name, email, or username (e.g. "John Doe", "john@example.com")'),
      realm: z.string().optional().default("master").describe("Realm to search in (default: master)"),
    },
    async ({ query, realm }) => ({
      content: [{ type: "text", text: await diagnoseUserTool(query, realm) }],
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
