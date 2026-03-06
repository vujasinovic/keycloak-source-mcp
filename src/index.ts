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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
