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
import { generateSpiBoilerplate } from "./tools/generate_spi_boilerplate.js";
import { detectBreakingChanges } from "./tools/detect_breaking_changes.js";
import { traceDependencies } from "./tools/trace_dependencies.js";
import { keycloakAdmin } from "./tools/keycloak_admin.js";
import { upgradeAssistant } from "./tools/upgrade_assistant.js";
import { getSourcePath } from "./utils.js";

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

async function main(): Promise<void> {
  validateEnvironment();

  const server = new McpServer({
    name: "keycloak-source-mcp",
    version: "1.0.0",
  });

  /**
   * Search for a Java class or interface by name in the Keycloak source.
   * Supports partial names and wildcards.
   */
  server.tool(
    "search_class",
    "Search for a Java class or interface by name in the Keycloak source. Supports partial names and wildcards. Returns file paths, package names, and class declaration excerpts.",
    {
      className: z
        .string()
        .describe("Class or interface name to search for (supports partial names and wildcards)"),
    },
    async ({ className }) => ({
      content: [{ type: "text", text: await searchClass(className) }],
    })
  );

  /**
   * Get the full source code of a specific Java class.
   */
  server.tool(
    "get_class_source",
    "Get the full source code of a specific Java class. If the file is not found, it will try to search by filename automatically and return the best match.",
    {
      filePath: z
        .string()
        .describe("Relative or absolute path to the Java file, as returned by search_class"),
    },
    async ({ filePath }) => ({
      content: [{ type: "text", text: await getClassSource(filePath) }],
    })
  );

  /**
   * Find all classes that implement a given interface or extend a given class.
   */
  server.tool(
    "find_interface_implementors",
    "Find all classes that implement a given interface or extend a given class. Especially useful for discovering how Keycloak implements its SPIs internally.",
    {
      interfaceName: z
        .string()
        .describe("Interface or class name to find implementors/subclasses of"),
    },
    async ({ interfaceName }) => ({
      content: [{ type: "text", text: await findInterfaceImplementors(interfaceName) }],
    })
  );

  /**
   * Search and list SPI definitions in META-INF/services files.
   */
  server.tool(
    "search_spi_definitions",
    "Search and list SPI definitions in META-INF/services files. Helps discover extension points available in Keycloak.",
    {
      filter: z
        .string()
        .optional()
        .describe("Optional filter by SPI name. Leave empty to list all SPI definitions."),
    },
    async ({ filter }) => ({
      content: [{ type: "text", text: await searchSpiDefinitions(filter) }],
    })
  );

  /**
   * Full-text search across the entire Keycloak source code.
   */
  server.tool(
    "grep_source",
    "Full-text search across the entire Keycloak source code. Uses ripgrep for fast search with regex support.",
    {
      query: z
        .string()
        .describe("Search query (supports regex patterns)"),
      filePattern: z
        .string()
        .optional()
        .describe("Optional glob pattern to filter files (e.g. '*.java', '*.xml')"),
      maxResults: z
        .number()
        .optional()
        .default(30)
        .describe("Maximum number of results to return (default: 30, max: 100)"),
    },
    async ({ query, filePattern, maxResults }) => ({
      content: [{ type: "text", text: await grepSource(query, filePattern, maxResults) }],
    })
  );

  /**
   * Explain how a specific Keycloak feature or mechanism works.
   */
  server.tool(
    "explain_implementation",
    "Explain how a specific Keycloak feature or mechanism works by finding and analyzing relevant source files. Returns key classes, main interfaces, default implementations, and SPI extension points.",
    {
      topic: z
        .string()
        .describe(
          'Topic to explain (e.g. "authentication flow", "token refresh", "user federation", "required action", "event listener", "theme", "protocol mapper", "credential")'
        ),
    },
    async ({ topic }) => ({
      content: [{ type: "text", text: await explainImplementation(topic) }],
    })
  );

  /**
   * Generate a ready-to-use Java SPI implementation skeleton.
   */
  server.tool(
    "generate_spi_boilerplate",
    "Generate a ready-to-use Java SPI implementation skeleton based on a description. Produces Provider class, Factory class, META-INF/services entry, and pom.xml dependencies.",
    {
      spiType: z
        .string()
        .describe(
          'SPI type (e.g. "Authenticator", "RequiredActionProvider", "EventListenerProvider", "TokenMapper", "UserStorageProvider")'
        ),
      description: z
        .string()
        .describe("Plain English description of what the customization should do"),
      providerName: z
        .string()
        .describe('Desired provider class name prefix (e.g. "SmsSender")'),
      packageName: z
        .string()
        .describe('Target Java package (e.g. "com.mycompany.keycloak")'),
    },
    async ({ spiType, description, providerName, packageName }) => ({
      content: [
        {
          type: "text",
          text: await generateSpiBoilerplate(spiType, description, providerName, packageName),
        },
      ],
    })
  );

  /**
   * Detect breaking changes between Keycloak versions.
   */
  server.tool(
    "detect_breaking_changes",
    "Compare Keycloak SPI interfaces between two versions to detect breaking changes. Categorizes changes as BREAKING or NON-BREAKING.",
    {
      fromVersion: z.string().describe("Source Keycloak version (e.g. '24.0.0')"),
      toVersion: z.string().describe("Target Keycloak version (e.g. '26.0.0')"),
      interfaceNames: z
        .array(z.string())
        .optional()
        .describe(
          "Specific interfaces to check. If empty, scans all commonly customized SPIs."
        ),
      sourcePathV1: z
        .string()
        .optional()
        .describe("Path to older version source. Falls back to KEYCLOAK_SOURCE_PATH."),
      sourcePathV2: z
        .string()
        .optional()
        .describe("Path to newer version source. Falls back to KEYCLOAK_SOURCE_PATH."),
    },
    async ({ fromVersion, toVersion, interfaceNames, sourcePathV1, sourcePathV2 }) => ({
      content: [
        {
          type: "text",
          text: await detectBreakingChanges(
            fromVersion,
            toVersion,
            interfaceNames,
            sourcePathV1,
            sourcePathV2
          ),
        },
      ],
    })
  );

  /**
   * Trace class dependencies upstream and downstream.
   */
  server.tool(
    "trace_dependencies",
    "Trace what a Keycloak class depends on (upstream) and what depends on it (downstream). Shows a dependency tree with Keycloak internal, JDK, Jakarta EE, and external classifications.",
    {
      className: z.string().describe("Class or interface name to trace"),
      direction: z
        .enum(["upstream", "downstream", "both"])
        .describe("upstream = what it depends on, downstream = what depends on it"),
      depth: z
        .number()
        .optional()
        .default(2)
        .describe("How many levels deep to trace (default: 2, max: 4)"),
    },
    async ({ className, direction, depth }) => ({
      content: [
        {
          type: "text",
          text: await traceDependencies(className, direction, depth),
        },
      ],
    })
  );

  /**
   * Query a running Keycloak instance via Admin REST API.
   */
  server.tool(
    "keycloak_admin",
    "Connect to a running Keycloak instance and perform admin queries. Requires KEYCLOAK_ADMIN_URL, KEYCLOAK_ADMIN_USERNAME, KEYCLOAK_ADMIN_PASSWORD env vars.",
    {
      action: z
        .string()
        .describe(
          'Action to perform: "list_realms", "list_flows", "list_clients", "list_providers", "get_realm_settings"'
        ),
      realm: z
        .string()
        .optional()
        .describe('Realm name (default: "master"). Required for list_flows, list_clients, get_realm_settings.'),
    },
    async ({ action, realm }) => ({
      content: [
        {
          type: "text",
          text: await keycloakAdmin(action, realm),
        },
      ],
    })
  );

  /**
   * Analyze custom SPI implementations for upgrade compatibility.
   */
  server.tool(
    "upgrade_assistant",
    "Analyze a developer's custom Keycloak SPI implementations and detect compatibility issues for a target Keycloak version. Produces an actionable upgrade report.",
    {
      customSourcePath: z
        .string()
        .describe("Path to the developer's custom Keycloak extensions source code"),
      targetKeycloakVersion: z
        .string()
        .describe("The Keycloak version to upgrade to"),
      currentKeycloakSourcePath: z
        .string()
        .optional()
        .describe("Path to the target Keycloak version source. Falls back to KEYCLOAK_SOURCE_PATH."),
    },
    async ({ customSourcePath, targetKeycloakVersion, currentKeycloakSourcePath }) => ({
      content: [
        {
          type: "text",
          text: await upgradeAssistant(
            customSourcePath,
            targetKeycloakVersion,
            currentKeycloakSourcePath
          ),
        },
      ],
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
