import { getSourcePath, searchWithRg, relativePath, formatResults } from "../utils.js";

/**
 * Search for a Java class or interface by name in the Keycloak source.
 * Supports partial names and wildcards. Returns file paths, package names,
 * and class declaration excerpts.
 */
export async function searchClass(className: string, version?: string): Promise<string> {
  if (!className || className.trim().length === 0) {
    return "Error: className is required and cannot be empty.";
  }

  const sourcePath = getSourcePath(version);

  // Search for .java files matching the class name
  const pattern = className.replace(/\*/g, ".*");
  const fileSearchArgs = [
    "--files",
    "--glob", `**/${pattern}*.java`,
    "--sort", "path",
  ];

  let fileResults: string;
  try {
    fileResults = await searchWithRg(fileSearchArgs, sourcePath);
  } catch {
    // Fallback: search for class declarations via content search
    fileResults = "";
  }

  const matches: string[] = [];

  if (fileResults.trim()) {
    const files = fileResults.trim().split("\n").slice(0, 20);

    for (const file of files) {
      const relPath = relativePath(file.startsWith("/") ? file : `${sourcePath}/${file}`);

      // Search for the class/interface declaration line in the file
      try {
        const declArgs = [
          "-n",
          "--max-count", "1",
          `(public|protected|private)?\\s*(abstract\\s+)?(class|interface|enum|record)\\s+\\w+`,
          file.startsWith("/") ? file : `${sourcePath}/${file}`,
        ];
        const declResult = await searchWithRg(declArgs, sourcePath);

        // Extract package name
        const pkgArgs = [
          "-n",
          "--max-count", "1",
          `^package\\s+`,
          file.startsWith("/") ? file : `${sourcePath}/${file}`,
        ];
        const pkgResult = await searchWithRg(pkgArgs, sourcePath);
        const pkgLine = pkgResult.trim().split("\n")[0] || "";
        const pkgMatch = pkgLine.match(/package\s+([\w.]+)/);
        const packageName = pkgMatch ? pkgMatch[1] : "unknown";

        const declLine = declResult.trim().split("\n")[0] || "";
        const lineContent = declLine.replace(/^\d+:/, "").trim();

        matches.push(`  ${relPath}\n    Package: ${packageName}\n    ${lineContent || "(declaration not found)"}`);
      } catch {
        matches.push(`  ${relPath}`);
      }
    }
  }

  // If no file-name matches, search class declarations in file contents
  if (matches.length === 0) {
    const contentArgs = [
      "-n",
      "--type", "java",
      `-m`, "20",
      `(class|interface|enum|record)\\s+${pattern}`,
    ];
    try {
      const contentResults = await searchWithRg(contentArgs, sourcePath);
      if (contentResults.trim()) {
        const lines = contentResults.trim().split("\n").slice(0, 20);
        for (const line of lines) {
          const relLine = line.startsWith(sourcePath)
            ? line.substring(sourcePath.length + 1)
            : line;
          matches.push(`  ${relLine}`);
        }
      }
    } catch {
      // no results
    }
  }

  return formatResults(
    `Search results for class: "${className}"`,
    matches,
    20
  );
}
