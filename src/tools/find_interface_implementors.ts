import { getSourcePath, searchWithRg, relativePath, formatResults } from "../utils.js";

/**
 * Find all classes that implement a given interface or extend a given class.
 * Useful for discovering how Keycloak implements its own SPIs internally.
 */
export async function findInterfaceImplementors(interfaceName: string): Promise<string> {
  if (!interfaceName || interfaceName.trim().length === 0) {
    return "Error: interfaceName is required and cannot be empty.";
  }

  const sourcePath = getSourcePath();
  const matches: string[] = [];

  // Search for "implements InterfaceName" and "extends InterfaceName"
  for (const keyword of ["implements", "extends"]) {
    const args = [
      "-n",
      "--type", "java",
      `${keyword}\\s+.*\\b${interfaceName}\\b`,
    ];

    try {
      const results = await searchWithRg(args, sourcePath);
      if (results.trim()) {
        const lines = results.trim().split("\n");
        for (const line of lines) {
          // Format: filepath:linenum:content
          let relLine = line;
          if (line.startsWith(sourcePath)) {
            relLine = line.substring(sourcePath.length + 1);
          }

          const colonIdx = relLine.indexOf(":");
          const secondColon = relLine.indexOf(":", colonIdx + 1);
          if (colonIdx > 0 && secondColon > 0) {
            const file = relLine.substring(0, colonIdx);
            const lineNum = relLine.substring(colonIdx + 1, secondColon);
            const content = relLine.substring(secondColon + 1).trim();
            matches.push(`  ${file}:${lineNum}\n    ${content}`);
          } else {
            matches.push(`  ${relLine}`);
          }
        }
      }
    } catch {
      // no results for this keyword
    }
  }

  // Deduplicate by file path
  const seen = new Set<string>();
  const unique = matches.filter((m) => {
    const file = m.trim().split("\n")[0].split(":")[0].trim();
    if (seen.has(file)) return false;
    seen.add(file);
    return true;
  });

  return formatResults(
    `Implementors/subclasses of: "${interfaceName}"`,
    unique,
    40
  );
}
