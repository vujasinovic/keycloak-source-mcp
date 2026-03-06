import { execa } from "execa";
import * as path from "node:path";
import * as fs from "node:fs";
import { versionManager } from "./version-manager.js";

/**
 * Parsed method from a Java class/interface.
 */
export interface ParsedMethod {
  name: string;
  returnType: string;
  parameters: string;
  modifiers: string[];
  javadoc: string;
}

/**
 * Result of parsing a Java source file.
 */
export interface ParsedJavaClass {
  className: string;
  packageName: string;
  imports: string[];
  implementsList: string[];
  extendsList: string[];
  methods: ParsedMethod[];
}

/**
 * Parse a Java source file to extract class structure.
 * Extracts class name, package, imports, implements/extends, and method signatures.
 */
export function parseJavaClass(source: string): ParsedJavaClass {
  const result: ParsedJavaClass = {
    className: "",
    packageName: "",
    imports: [],
    implementsList: [],
    extendsList: [],
    methods: [],
  };

  const lines = source.split("\n");

  // Package
  const pkgMatch = source.match(/^package\s+([\w.]+)\s*;/m);
  if (pkgMatch) result.packageName = pkgMatch[1];

  // Imports
  const importRegex = /^import\s+(?:static\s+)?([\w.*]+)\s*;/gm;
  let importMatch;
  while ((importMatch = importRegex.exec(source)) !== null) {
    result.imports.push(importMatch[1]);
  }

  // Class/interface declaration
  const declRegex = /(?:public\s+|protected\s+|private\s+)?(?:abstract\s+)?(?:final\s+)?(?:class|interface|enum|record)\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([\w\s,<>?]+?))?(?:\s+implements\s+([\w\s,<>?]+?))?\s*\{/;
  const declMatch = source.match(declRegex);
  if (declMatch) {
    result.className = declMatch[1];
    if (declMatch[2]) {
      result.extendsList = declMatch[2].split(",").map((s) => s.trim().replace(/<.*>/, "")).filter(Boolean);
    }
    if (declMatch[3]) {
      result.implementsList = declMatch[3].split(",").map((s) => s.trim().replace(/<.*>/, "")).filter(Boolean);
    }
  }

  // Methods — scan line by line for method signatures
  let currentJavadoc = "";
  let inJavadoc = false;
  let braceDepth = 0;
  let inClassBody = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track brace depth to know when we're at class level
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") braceDepth--;
    }

    if (!inClassBody && braceDepth >= 1) {
      inClassBody = true;
      continue;
    }

    // Javadoc tracking
    if (trimmed.startsWith("/**")) {
      inJavadoc = true;
      currentJavadoc = "";
    }
    if (inJavadoc) {
      const docLine = trimmed
        .replace(/^\/\*\*\s?/, "")
        .replace(/^\*\/\s?$/, "")
        .replace(/^\*\s?/, "")
        .trim();
      if (docLine) currentJavadoc += (currentJavadoc ? "\n" : "") + docLine;
      if (trimmed.includes("*/")) {
        inJavadoc = false;
      }
      continue;
    }

    // Only parse methods at class-body level (braceDepth == 1)
    if (!inClassBody || braceDepth !== 1) {
      if (!trimmed.startsWith("@")) currentJavadoc = "";
      continue;
    }

    // Skip annotations but preserve them as modifiers
    if (trimmed.startsWith("@")) continue;

    // Method signature pattern
    const methodRegex = /^((?:(?:public|protected|private|static|final|abstract|default|synchronized|native)\s+)*)(?:<[\w\s,?]+>\s+)?([\w<>\[\]?,\s]+?)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws\s+[\w\s,]+)?\s*[;{]/;
    const methodMatch = trimmed.match(methodRegex);

    if (methodMatch) {
      const modifiers = methodMatch[1].trim().split(/\s+/).filter(Boolean);
      const returnType = methodMatch[2].trim();
      const name = methodMatch[3];
      const params = methodMatch[4].trim();

      // Skip constructors (return type equals class name)
      if (name === result.className) {
        currentJavadoc = "";
        continue;
      }

      // Collect annotations from preceding lines
      for (let j = i - 1; j >= 0; j--) {
        const prev = lines[j].trim();
        if (prev.startsWith("@")) {
          modifiers.unshift(prev.split("(")[0]);
        } else if (prev === "" || prev.startsWith("*") || prev.endsWith("*/")) {
          break;
        } else {
          break;
        }
      }

      result.methods.push({
        name,
        returnType,
        parameters: params,
        modifiers,
        javadoc: currentJavadoc,
      });
    }

    currentJavadoc = "";
  }

  return result;
}

/**
 * Fetch an admin access token from a Keycloak instance using the OAuth2 resource owner password flow.
 */
export async function fetchKeycloakAdminToken(
  baseUrl: string,
  realm: string,
  clientId: string,
  username: string,
  password: string
): Promise<string> {
  const tokenUrl = `${baseUrl}/realms/${realm}/protocol/openid-connect/token`;

  const body = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    username,
    password,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to obtain admin token: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

/**
 * In-memory cache for HTTP responses to avoid hammering external URLs.
 */
const httpCache = new Map<string, { response: Response; body: unknown; expiresAt: number }>();

/**
 * Fetch a URL with in-memory caching. Returns a Response-like object.
 * Cached responses are cloned so the body can be read multiple times.
 */
export async function fetchWithCache(url: string, ttlMinutes: number): Promise<Response> {
  const now = Date.now();
  const cached = httpCache.get(url);

  if (cached && cached.expiresAt > now) {
    // Return a new Response from cached body
    return new Response(JSON.stringify(cached.body), {
      status: cached.response.status,
      statusText: cached.response.statusText,
      headers: { "Content-Type": "application/json" },
    });
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "keycloak-source-mcp/1.0",
    },
  });

  if (response.ok) {
    const body = await response.json();
    httpCache.set(url, {
      response,
      body,
      expiresAt: now + ttlMinutes * 60 * 1000,
    });
    // Return a fresh Response so the caller can read the body
    return new Response(JSON.stringify(body), {
      status: response.status,
      statusText: response.statusText,
      headers: { "Content-Type": "application/json" },
    });
  }

  return response;
}

/**
 * Validate basic Mermaid syntax structure.
 * Returns { valid: true } or { valid: false, warning: string }.
 */
export function validateMermaid(mermaid: string): { valid: boolean; warning?: string } {
  const trimmed = mermaid.trim();

  if (!trimmed) {
    return { valid: false, warning: "Mermaid diagram is empty." };
  }

  const firstLine = trimmed.split("\n")[0].trim();
  const validStarts = ["flowchart", "graph", "sequenceDiagram", "classDiagram", "stateDiagram", "gantt", "pie", "erDiagram"];
  if (!validStarts.some((s) => firstLine.startsWith(s))) {
    return { valid: false, warning: `Mermaid diagram should start with a diagram type (e.g. 'flowchart TD'). Got: "${firstLine}"` };
  }

  // Check for balanced brackets
  let braces = 0;
  let brackets = 0;
  let parens = 0;
  for (const ch of trimmed) {
    if (ch === "{") braces++;
    if (ch === "}") braces--;
    if (ch === "[") brackets++;
    if (ch === "]") brackets--;
    if (ch === "(") parens++;
    if (ch === ")") parens--;
  }

  if (braces !== 0 || brackets !== 0 || parens !== 0) {
    return { valid: false, warning: "Mermaid diagram has unbalanced brackets. It may not render correctly." };
  }

  // Check that there are node definitions
  const hasNodes = /\w+[\[\({]/.test(trimmed) || /-->/.test(trimmed);
  if (!hasNodes) {
    return { valid: false, warning: "Mermaid diagram does not appear to contain any nodes or connections." };
  }

  return { valid: true };
}

/**
 * Parse and validate a Keycloak realm JSON export file.
 */
export async function parseRealmExport(filePath: string): Promise<{
  valid: boolean;
  data?: Record<string, unknown>;
  error?: string;
}> {
  if (!fs.existsSync(filePath)) {
    return { valid: false, error: `File not found: ${filePath}` };
  }

  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;

    if (!data.realm && !data.id) {
      return { valid: false, error: "JSON file does not appear to be a Keycloak realm export (missing 'realm' or 'id' field)." };
    }

    return { valid: true, data };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

let useRipgrep: boolean | null = null;
let rgBinary = "rg";

/**
 * Check if ripgrep (rg) is available on the system.
 */
async function isRipgrepAvailable(): Promise<boolean> {
  if (useRipgrep !== null) return useRipgrep;

  // Try common rg locations
  const candidates = [
    "rg",
    "/opt/homebrew/bin/rg",
    "/usr/local/bin/rg",
  ];

  for (const candidate of candidates) {
    try {
      await execa(candidate, ["--version"]);
      rgBinary = candidate;
      useRipgrep = true;
      return true;
    } catch {
      // try next
    }
  }

  useRipgrep = false;
  return false;
}

/**
 * Get the validated Keycloak source path from environment.
 * Optionally accepts a version name to resolve via VersionManager.
 */
export function getSourcePath(version?: string): string {
  if (version) {
    return versionManager.resolve(version);
  }
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
      const result = await execa(rgBinary, args, {
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

  // Check if this is a --files mode request (list files by pattern)
  const isFilesMode = args.includes("--files");
  if (isFilesMode) {
    return fallbackFindFiles(args, cwd);
  }

  // Fallback to grep for content search
  const grepArgs = convertRgArgsToGrep(args);
  try {
    const result = await execa("grep", grepArgs, {
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
 * Fallback for rg --files mode using find command.
 */
async function fallbackFindFiles(args: string[], cwd: string): Promise<string> {
  // Extract glob pattern from args
  let globPattern = "";
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--glob" || args[i] === "-g") && i + 1 < args.length) {
      globPattern = args[i + 1];
    }
  }

  if (!globPattern) {
    // No glob, list all files
    const result = await execa("find", [".", "-type", "f"], { cwd, timeout: 30000 });
    return result.stdout;
  }

  // Convert rg glob to find -name pattern
  // e.g., "**/Authenticator*.java" -> "Authenticator*.java"
  // e.g., "**/META-INF/services/*" -> find with -path
  const findArgs: string[] = [".", "-type", "f"];

  if (globPattern.includes("/")) {
    // Use -path for patterns with directory separators
    // Remove leading **/ if present
    const pathPattern = globPattern.replace(/^\*\*\//, "*/");
    findArgs.push("-path", `./${pathPattern}`);
  } else {
    // Simple filename pattern
    const namePattern = globPattern.replace(/^\*\*\//, "");
    findArgs.push("-name", namePattern);
  }

  try {
    const result = await execa("find", findArgs, { cwd, timeout: 30000 });
    // Sort output to match rg --sort path behavior
    const files = result.stdout.trim().split("\n").filter(Boolean).sort();
    return files.join("\n");
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
  const grepArgs: string[] = ["-r", "-n", "-E"];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--type" || arg === "-t") {
      i++;
      const type = args[i];
      grepArgs.push(`--include=*.${type}`);
    } else if (arg === "--glob" || arg === "-g") {
      i++;
      grepArgs.push(`--include=${args[i]}`);
    } else if (arg === "-l" || arg === "--files-with-matches") {
      grepArgs.push("-l");
    } else if (arg === "-i" || arg === "--ignore-case") {
      grepArgs.push("-i");
    } else if (arg === "-w" || arg === "--word-regexp") {
      grepArgs.push("-w");
    } else if (arg === "--max-count" || arg === "-m") {
      i++;
      grepArgs.push("-m", args[i]);
    } else if (arg === "--sort" || arg === "--files") {
      // Skip rg-specific flags with no grep equivalent
      if (arg === "--sort") i++; // skip the sort value too
    } else if (!arg.startsWith("-")) {
      // This is a pattern or path — convert rg regex to POSIX
      grepArgs.push(convertRgRegexToPosix(arg));
    }
    i++;
  }
  return grepArgs;
}

/**
 * Convert ripgrep regex syntax to POSIX Extended Regex for grep -E.
 */
function convertRgRegexToPosix(pattern: string): string {
  return pattern
    .replace(/\\s/g, "[[:space:]]")
    .replace(/\\w/g, "[[:alnum:]_]")
    .replace(/\\d/g, "[[:digit:]]");
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
