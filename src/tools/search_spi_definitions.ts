import * as fs from "node:fs";
import * as path from "node:path";
import { getSourcePath, searchWithRg, relativePath, resolveToAbsolute } from "../utils.js";
import { SEPARATOR } from "../constants.js";

/**
 * Search and list SPI definitions in META-INF/services files.
 * Helps developers understand the extension points available in Keycloak.
 */
export async function searchSpiDefinitions(filter?: string, version?: string): Promise<string> {
  const sourcePath = getSourcePath(version);

  // Find all META-INF/services files
  const args = [
    "--files",
    "--glob", "**/META-INF/services/*",
  ];

  let fileList: string;
  try {
    fileList = await searchWithRg(args, sourcePath);
  } catch {
    return "Error: Failed to search for META-INF/services files.";
  }

  if (!fileList.trim()) {
    return "No META-INF/services files found in the Keycloak source tree.";
  }

  const files = fileList.trim().split("\n");
  const results: string[] = [];

  for (const file of files) {
    const fullPath = resolveToAbsolute(file, sourcePath);
    const spiName = path.basename(fullPath);

    // Apply filter if provided
    if (filter && !spiName.toLowerCase().includes(filter.toLowerCase())) {
      continue;
    }

    try {
      const content = await fs.promises.readFile(fullPath, "utf-8");
      const implementations = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

      if (implementations.length === 0) continue;

      const relPath = relativePath(fullPath);
      let entry = `  SPI Interface: ${spiName}\n  File: ${relPath}\n  Implementations:`;
      for (const impl of implementations) {
        entry += `\n    - ${impl}`;
      }
      results.push(entry);
    } catch {
      // skip unreadable files
    }
  }

  if (results.length === 0) {
    const filterMsg = filter ? ` matching "${filter}"` : "";
    return `No SPI definitions found${filterMsg}.`;
  }

  let output = `SPI Definitions${filter ? ` (filter: "${filter}")` : ""}\n`;
  output += SEPARATOR.HEADER + "\n\n";
  output += `Found ${results.length} SPI definition(s):\n\n`;
  output += results.join("\n\n");

  return output;
}
