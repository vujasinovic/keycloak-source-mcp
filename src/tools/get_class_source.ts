import * as fs from "node:fs";
import * as path from "node:path";
import { getSourcePath, searchWithRg } from "../utils.js";

/**
 * Get the full source code of a specific Java class.
 * If the file is not found at the given path, tries to search by filename automatically.
 */
export async function getClassSource(filePath: string, version?: string): Promise<string> {
  if (!filePath || filePath.trim().length === 0) {
    return "Error: filePath is required and cannot be empty.";
  }

  const sourcePath = getSourcePath(version);
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(sourcePath, filePath);

  // Try direct path first
  if (fs.existsSync(resolved)) {
    const content = await fs.promises.readFile(resolved, "utf-8");
    const relPath = path.relative(sourcePath, resolved);
    return `File: ${relPath}\n${"=".repeat(60)}\n\n${content}`;
  }

  // File not found — try searching by filename
  const filename = filePath.split("/").pop() || filePath;

  const searchArgs = [
    "--files",
    "--glob", `**/${filename}`,
  ];

  try {
    const results = await searchWithRg(searchArgs, sourcePath);
    if (results.trim()) {
      const files = results.trim().split("\n");
      const bestMatch = files[0];
      const fullPath = bestMatch.startsWith("/")
        ? bestMatch
        : `${sourcePath}/${bestMatch}`;

      if (fs.existsSync(fullPath)) {
        const content = await fs.promises.readFile(fullPath, "utf-8");
        const relPath = path.relative(sourcePath, fullPath);

        let header = `File: ${relPath}\n`;
        if (files.length > 1) {
          header += `(Best match — ${files.length} files found with name "${filename}")\n`;
          header += `Other matches:\n`;
          for (const f of files.slice(1, 6)) {
            const rel = f.startsWith(sourcePath) ? f.substring(sourcePath.length + 1) : f;
            header += `  - ${rel}\n`;
          }
        }
        header += "=".repeat(60);

        return `${header}\n\n${content}`;
      }
    }
  } catch {
    // search failed
  }

  return `Error: File not found: ${filePath}\n\nTried:\n  1. Direct path: ${resolved}\n  2. Search by filename: ${filename}\n\nUse search_class to find the correct file path.`;
}
