import * as fs from "node:fs";
import * as path from "node:path";
import { getSourcePath, searchWithRg, parseJavaClass } from "../utils.js";

interface DepNode {
  name: string;
  filePath: string;
  kind: "internal" | "jdk" | "jakarta" | "external";
  children: DepNode[];
}

const JDK_PREFIXES = [
  "java.", "javax.annotation", "javax.crypto", "javax.net", "javax.security",
  "sun.", "com.sun.",
];
const JAKARTA_PREFIXES = [
  "jakarta.", "javax.persistence", "javax.ws.", "javax.inject",
  "javax.enterprise", "javax.transaction",
];

/**
 * Trace what a given Keycloak class depends on (upstream) and what depends on it (downstream).
 */
export async function traceDependencies(
  className: string,
  direction: "upstream" | "downstream" | "both",
  depth: number = 2
): Promise<string> {
  if (!className || !className.trim()) return "Error: className is required.";
  if (depth < 1) depth = 1;
  if (depth > 4) depth = 4;

  const sourcePath = getSourcePath();

  // Find the class file
  const classFile = await findClassFile(sourcePath, className);
  if (!classFile) {
    return `Error: Could not find class "${className}" in the Keycloak source.`;
  }

  const relPath = path.relative(sourcePath, classFile);
  const lines: string[] = [];
  lines.push(`Dependency Trace: ${className}`);
  lines.push("=".repeat(60));
  lines.push(`File: ${relPath}`);
  lines.push(`Direction: ${direction} | Depth: ${depth}`);
  lines.push("");

  const visited = new Set<string>();

  if (direction === "upstream" || direction === "both") {
    lines.push("Upstream Dependencies (what this class depends on)");
    lines.push("-".repeat(50));
    const tree = await traceUpstream(sourcePath, classFile, className, depth, visited);
    lines.push(renderTree(tree, "  "));
    lines.push("");
  }

  if (direction === "downstream" || direction === "both") {
    visited.clear();
    lines.push("Downstream Dependents (what depends on this class)");
    lines.push("-".repeat(50));
    const tree = await traceDownstream(sourcePath, className, depth, visited);
    lines.push(renderTree(tree, "  "));
    lines.push("");
  }

  // Legend
  lines.push("Legend: [KC] = Keycloak internal, [JDK] = Java standard, [JK] = Jakarta EE, [EXT] = External");

  return lines.join("\n");
}

async function findClassFile(sourcePath: string, className: string): Promise<string | null> {
  try {
    const args = ["--files", "--glob", `**/${className}.java`];
    const result = await searchWithRg(args, sourcePath);
    if (!result.trim()) return null;
    const file = result.trim().split("\n")[0];
    return file.startsWith("/") ? file : path.join(sourcePath, file);
  } catch {
    return null;
  }
}

function classifyImport(importPath: string): "jdk" | "jakarta" | "internal" | "external" {
  if (JDK_PREFIXES.some((p) => importPath.startsWith(p))) return "jdk";
  if (JAKARTA_PREFIXES.some((p) => importPath.startsWith(p))) return "jakarta";
  if (importPath.startsWith("org.keycloak.")) return "internal";
  return "external";
}

async function traceUpstream(
  sourcePath: string,
  filePath: string,
  className: string,
  depth: number,
  visited: Set<string>
): Promise<DepNode> {
  visited.add(className);

  const node: DepNode = {
    name: className,
    filePath: path.relative(sourcePath, filePath),
    kind: "internal",
    children: [],
  };

  if (depth <= 0) return node;

  try {
    const source = await fs.promises.readFile(filePath, "utf-8");
    const parsed = parseJavaClass(source);

    // Collect dependencies from imports and extends/implements
    const deps: Array<{ name: string; fqn: string }> = [];

    for (const imp of parsed.imports) {
      const simpleName = imp.split(".").pop() || imp;
      if (simpleName === "*") continue;
      deps.push({ name: simpleName, fqn: imp });
    }

    // Deduplicate and limit
    const seen = new Set<string>();
    const uniqueDeps = deps.filter((d) => {
      if (seen.has(d.name)) return false;
      seen.add(d.name);
      return true;
    }).slice(0, 30);

    for (const dep of uniqueDeps) {
      const kind = classifyImport(dep.fqn);

      if (kind !== "internal" || visited.has(dep.name)) {
        node.children.push({
          name: dep.fqn,
          filePath: "",
          kind,
          children: [],
        });
        continue;
      }

      // Recurse into internal dependencies
      const depFile = await findClassFile(sourcePath, dep.name);
      if (depFile && !visited.has(dep.name)) {
        const child = await traceUpstream(sourcePath, depFile, dep.name, depth - 1, visited);
        node.children.push(child);
      } else {
        node.children.push({
          name: dep.fqn,
          filePath: "",
          kind: "internal",
          children: [],
        });
      }
    }
  } catch {
    // Can't read file
  }

  return node;
}

async function traceDownstream(
  sourcePath: string,
  className: string,
  depth: number,
  visited: Set<string>
): Promise<DepNode> {
  visited.add(className);

  const node: DepNode = {
    name: className,
    filePath: "",
    kind: "internal",
    children: [],
  };

  if (depth <= 0) return node;

  // Find all files that import or reference this class
  try {
    const args = [
      "-l", "--type", "java",
      `\\b${className}\\b`,
    ];
    const result = await searchWithRg(args, sourcePath);
    if (!result.trim()) return node;

    const files = result.trim().split("\n").slice(0, 20);

    for (const file of files) {
      const fullPath = file.startsWith("/") ? file : path.join(sourcePath, file);
      const relPath = path.relative(sourcePath, fullPath);

      try {
        const source = await fs.promises.readFile(fullPath, "utf-8");
        const parsed = parseJavaClass(source);
        const depClassName = parsed.className;

        if (!depClassName || depClassName === className || visited.has(depClassName)) {
          node.children.push({
            name: relPath,
            filePath: relPath,
            kind: "internal",
            children: [],
          });
          continue;
        }

        if (depth > 1) {
          const child = await traceDownstream(sourcePath, depClassName, depth - 1, visited);
          child.filePath = relPath;
          node.children.push(child);
        } else {
          node.children.push({
            name: depClassName,
            filePath: relPath,
            kind: "internal",
            children: [],
          });
        }
      } catch {
        node.children.push({
          name: relPath,
          filePath: relPath,
          kind: "internal",
          children: [],
        });
      }
    }
  } catch {
    // search failed
  }

  return node;
}

function renderTree(node: DepNode, indent: string): string {
  const kindLabel = {
    internal: "[KC]",
    jdk: "[JDK]",
    jakarta: "[JK]",
    external: "[EXT]",
  }[node.kind];

  let line = `${indent}${kindLabel} ${node.name}`;
  if (node.filePath) {
    line += ` (${node.filePath})`;
  }

  const childLines = node.children.map((c) => renderTree(c, indent + "  "));

  if (childLines.length === 0) return line;
  return [line, ...childLines].join("\n");
}
