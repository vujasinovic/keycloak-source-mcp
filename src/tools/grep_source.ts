import { getSourcePath, searchWithRg, formatResults } from "../utils.js";

/**
 * Full-text search across the entire Keycloak source code.
 * Uses ripgrep for fast search with regex support.
 */
export async function grepSource(
  query: string,
  filePattern?: string,
  maxResults: number = 30,
  version?: string
): Promise<string> {
  if (!query || query.trim().length === 0) {
    return "Error: query is required and cannot be empty.";
  }

  if (maxResults < 1) maxResults = 1;
  if (maxResults > 100) maxResults = 100;

  const sourcePath = getSourcePath(version);

  const args: string[] = ["-n"];

  if (filePattern) {
    args.push("--glob", filePattern);
  }

  // Request more results than maxResults to account for formatting,
  // but cap the actual ripgrep output
  args.push("-m", String(maxResults + 10));
  args.push(query);

  let rawResults: string;
  try {
    rawResults = await searchWithRg(args, sourcePath);
  } catch (error) {
    return `Error: Search failed. Make sure your query is a valid regex pattern.\nDetails: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (!rawResults.trim()) {
    const patternMsg = filePattern ? ` in files matching "${filePattern}"` : "";
    return `No results found for "${query}"${patternMsg}.`;
  }

  const lines = rawResults.trim().split("\n");
  const formatted = lines.map((line) => {
    if (line.startsWith(sourcePath)) {
      return `  ${line.substring(sourcePath.length + 1)}`;
    }
    return `  ${line}`;
  });

  return formatResults(
    `Search results for: "${query}"${filePattern ? ` (files: ${filePattern})` : ""}`,
    formatted,
    maxResults
  );
}
