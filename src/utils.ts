import { execaCommand } from "execa";
import * as path from "node:path";
import * as fs from "node:fs";

let useRipgrep: boolean | null = null;

/**
 * Check if ripgrep (rg) is available on the system.
 */
async function isRipgrepAvailable(): Promise<boolean> {
  if (useRipgrep !== null) return useRipgrep;
  try {
    await execaCommand("rg --version");
    useRipgrep = true;
  } catch {
    useRipgrep = false;
  }
  return useRipgrep;
}

/**
 * Get the validated Keycloak source path from environment.
 */
export function getSourcePath(): string {
  const sourcePath = process.env.KEYCLOAK_SOURCE_PATH;
  if (!sourcePath) {
    throw new Error(
      "KEYCLOAK_SOURCE_PATH environment variable is not set.\n" +
        "Please set it to the root of your local Keycloak source checkout.\n" +
        "Example: export KEYCLOAK_SOURCE_PATH=/path/to/keycloak"
    );
  }
  if (!fs.existsSync(sourcePath)) {
    throw new Error(
      `KEYCLOAK_SOURCE_PATH directory does not exist: ${sourcePath}\n` +
        "Please clone the Keycloak source first:\n" +
        "  git clone https://github.com/keycloak/keycloak.git"
    );
  }
  return sourcePath;
}

/**
 * Execute a search command using ripgrep with fallback to grep.
 * Returns the raw stdout string.
 */
export async function searchWithRg(
  args: string[],
  cwd: string
): Promise<string> {
  const hasRg = await isRipgrepAvailable();

  if (hasRg) {
    try {
      const result = await execaCommand(`rg ${args.join(" ")}`, {
        cwd,
        timeout: 30000,
      });
      return result.stdout;
    } catch (error: unknown) {
      const e = error as { exitCode?: number; stdout?: string };
      // rg exits with 1 when no matches found
      if (e.exitCode === 1) return "";
      throw error;
    }
  }

  // Fallback to grep
  const grepArgs = convertRgArgsToGrep(args);
  try {
    const result = await execaCommand(`grep ${grepArgs.join(" ")}`, {
      cwd,
      timeout: 60000,
    });
    return result.stdout;
  } catch (error: unknown) {
    const e = error as { exitCode?: number };
    if (e.exitCode === 1) return "";
    throw error;
  }
}

/**
 * Convert common ripgrep arguments to grep equivalents.
 */
function convertRgArgsToGrep(args: string[]): string[] {
  const grepArgs: string[] = ["-r", "-n"];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--type" || arg === "-t") {
      // rg --type java -> grep --include="*.java"
      i++;
      const type = args[i];
      if (type === "java") grepArgs.push('--include="*.java"');
      else if (type === "xml") grepArgs.push('--include="*.xml"');
      else grepArgs.push(`--include="*.${type}"`);
    } else if (arg === "--glob" || arg === "-g") {
      i++;
      grepArgs.push(`--include="${args[i]}"`);
    } else if (arg === "-l" || arg === "--files-with-matches") {
      grepArgs.push("-l");
    } else if (arg === "-i" || arg === "--ignore-case") {
      grepArgs.push("-i");
    } else if (arg === "-w" || arg === "--word-regexp") {
      grepArgs.push("-w");
    } else if (arg === "--max-count") {
      i++;
      grepArgs.push(`-m ${args[i]}`);
    } else if (arg === "-m") {
      i++;
      grepArgs.push(`-m ${args[i]}`);
    } else if (!arg.startsWith("-")) {
      grepArgs.push(arg);
    }
    i++;
  }
  return grepArgs;
}

/**
 * Make a file path relative to the Keycloak source root.
 */
export function relativePath(filePath: string): string {
  const sourcePath = getSourcePath();
  if (filePath.startsWith(sourcePath)) {
    return path.relative(sourcePath, filePath);
  }
  return filePath;
}

/**
 * Resolve a potentially relative path against the Keycloak source root.
 */
export function resolvePath(filePath: string): string {
  const sourcePath = getSourcePath();
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(sourcePath, filePath);
}

/**
 * Read a file and return its contents.
 */
export async function readFile(filePath: string): Promise<string> {
  const resolved = resolvePath(filePath);
  return fs.promises.readFile(resolved, "utf-8");
}

/**
 * Format a list of search results into readable text.
 */
export function formatResults(
  title: string,
  results: string[],
  maxResults: number
): string {
  if (results.length === 0) {
    return `${title}\n\nNo results found.`;
  }

  const truncated = results.slice(0, maxResults);
  let output = `${title}\n${"=".repeat(title.length)}\n\n`;
  output += truncated.join("\n");

  if (results.length > maxResults) {
    output += `\n\n... and ${results.length - maxResults} more results (showing ${maxResults}/${results.length})`;
  }

  return output;
}
