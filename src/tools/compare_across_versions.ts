import * as fs from "node:fs";
import * as path from "node:path";
import { versionManager } from "../version-manager.js";
import { searchWithRg, parseJavaClass, type ParsedMethod } from "../utils.js";

/**
 * Compare a class, interface, or search result across two registered Keycloak versions.
 */
export async function compareAcrossVersions(
  query: string,
  fromVersion: string,
  toVersion: string,
  mode: "diff" | "side_by_side" = "diff"
): Promise<string> {
  if (!query || !query.trim()) return "Error: query is required.";
  if (!fromVersion || !fromVersion.trim()) return "Error: fromVersion is required.";
  if (!toVersion || !toVersion.trim()) return "Error: toVersion is required.";

  let pathFrom: string;
  let pathTo: string;
  try {
    pathFrom = versionManager.resolve(fromVersion);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
  try {
    pathTo = versionManager.resolve(toVersion);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }

  // Find the class/interface in both versions
  const fileFrom = await findFile(pathFrom, query);
  const fileTo = await findFile(pathTo, query);

  if (!fileFrom && !fileTo) {
    return `"${query}" not found in either ${fromVersion} or ${toVersion}.`;
  }

  const lines: string[] = [];
  lines.push(`Comparison: "${query}" — ${fromVersion} vs ${toVersion}`);
  lines.push("=".repeat(60));
  lines.push("");

  if (!fileFrom) {
    lines.push(`Not found in ${fromVersion} — this is new in ${toVersion}.`);
    if (fileTo) {
      lines.push(`Location in ${toVersion}: ${path.relative(pathTo, fileTo)}`);
    }
    return lines.join("\n");
  }

  if (!fileTo) {
    lines.push(`Not found in ${toVersion} — this was removed since ${fromVersion}.`);
    lines.push(`Previous location: ${path.relative(pathFrom, fileFrom)}`);
    return lines.join("\n");
  }

  const sourceFrom = await fs.promises.readFile(fileFrom, "utf-8");
  const sourceTo = await fs.promises.readFile(fileTo, "utf-8");

  const parsedFrom = parseJavaClass(sourceFrom);
  const parsedTo = parseJavaClass(sourceTo);

  lines.push(`${fromVersion}: ${path.relative(pathFrom, fileFrom)}`);
  lines.push(`${toVersion}: ${path.relative(pathTo, fileTo)}`);
  lines.push("");

  if (mode === "diff") {
    lines.push(generateDiff(parsedFrom, parsedTo, fromVersion, toVersion));
  } else {
    lines.push(generateSideBySide(sourceFrom, sourceTo, fromVersion, toVersion));
  }

  return lines.join("\n");
}

async function findFile(sourcePath: string, query: string): Promise<string | null> {
  // Try as class name first
  const classQuery = query.endsWith(".java") ? query : `${query}.java`;
  try {
    const args = ["--files", "--glob", `**/${classQuery}`];
    const result = await searchWithRg(args, sourcePath);
    if (result.trim()) {
      const file = result.trim().split("\n")[0];
      return file.startsWith("/") ? file : path.join(sourcePath, file);
    }
  } catch {
    // ignore
  }
  return null;
}

function generateDiff(
  from: ReturnType<typeof parseJavaClass>,
  to: ReturnType<typeof parseJavaClass>,
  fromVersion: string,
  toVersion: string
): string {
  const lines: string[] = [];

  // Compare package
  if (from.packageName !== to.packageName) {
    lines.push("Package changed:");
    lines.push(`  - ${from.packageName}`);
    lines.push(`  + ${to.packageName}`);
    lines.push("");
  }

  // Compare extends/implements
  const extendsRemoved = from.extendsList.filter((e) => !to.extendsList.includes(e));
  const extendsAdded = to.extendsList.filter((e) => !from.extendsList.includes(e));
  if (extendsRemoved.length > 0 || extendsAdded.length > 0) {
    lines.push("Extends changed:");
    for (const e of extendsRemoved) lines.push(`  - ${e}`);
    for (const e of extendsAdded) lines.push(`  + ${e}`);
    lines.push("");
  }

  const implRemoved = from.implementsList.filter((i) => !to.implementsList.includes(i));
  const implAdded = to.implementsList.filter((i) => !from.implementsList.includes(i));
  if (implRemoved.length > 0 || implAdded.length > 0) {
    lines.push("Implements changed:");
    for (const i of implRemoved) lines.push(`  - ${i}`);
    for (const i of implAdded) lines.push(`  + ${i}`);
    lines.push("");
  }

  // Compare imports
  const importsRemoved = from.imports.filter((i) => !to.imports.includes(i));
  const importsAdded = to.imports.filter((i) => !from.imports.includes(i));
  if (importsRemoved.length > 0 || importsAdded.length > 0) {
    lines.push("Imports changed:");
    for (const i of importsRemoved) lines.push(`  - import ${i}`);
    for (const i of importsAdded) lines.push(`  + import ${i}`);
    lines.push("");
  }

  // Compare methods
  const fromMethods = new Map<string, ParsedMethod>();
  const toMethods = new Map<string, ParsedMethod>();
  for (const m of from.methods) fromMethods.set(m.name, m);
  for (const m of to.methods) toMethods.set(m.name, m);

  const removedMethods: ParsedMethod[] = [];
  const addedMethods: ParsedMethod[] = [];
  const changedMethods: Array<{ name: string; from: ParsedMethod; to: ParsedMethod }> = [];

  for (const [name, method] of fromMethods) {
    if (!toMethods.has(name)) {
      removedMethods.push(method);
    } else {
      const toMethod = toMethods.get(name)!;
      const sigFrom = `${method.returnType}(${method.parameters})`;
      const sigTo = `${toMethod.returnType}(${toMethod.parameters})`;
      if (sigFrom !== sigTo) {
        changedMethods.push({ name, from: method, to: toMethod });
      }
    }
  }
  for (const [name, method] of toMethods) {
    if (!fromMethods.has(name)) {
      addedMethods.push(method);
    }
  }

  if (removedMethods.length > 0) {
    lines.push(`Methods removed (in ${toVersion}):`);
    for (const m of removedMethods) {
      lines.push(`  - ${m.returnType} ${m.name}(${m.parameters})`);
    }
    lines.push("");
  }

  if (addedMethods.length > 0) {
    lines.push(`Methods added (in ${toVersion}):`);
    for (const m of addedMethods) {
      const isDefault = m.modifiers.includes("default");
      lines.push(`  + ${m.returnType} ${m.name}(${m.parameters})${isDefault ? " [default]" : ""}`);
    }
    lines.push("");
  }

  if (changedMethods.length > 0) {
    lines.push("Methods with changed signatures:");
    for (const { name, from: mFrom, to: mTo } of changedMethods) {
      lines.push(`  ${name}:`);
      lines.push(`    - ${mFrom.returnType} ${name}(${mFrom.parameters})`);
      lines.push(`    + ${mTo.returnType} ${name}(${mTo.parameters})`);
    }
    lines.push("");
  }

  if (removedMethods.length === 0 && addedMethods.length === 0 && changedMethods.length === 0 && lines.length === 0) {
    lines.push("No structural differences detected between versions.");
  }

  // Summary
  lines.push("-".repeat(40));
  lines.push(`Summary: ${removedMethods.length} removed, ${addedMethods.length} added, ${changedMethods.length} changed`);

  return lines.join("\n");
}

function generateSideBySide(
  sourceFrom: string,
  sourceTo: string,
  fromVersion: string,
  toVersion: string
): string {
  const lines: string[] = [];

  lines.push(`--- ${fromVersion} ---`);
  lines.push("```java");
  lines.push(sourceFrom);
  lines.push("```");
  lines.push("");
  lines.push(`--- ${toVersion} ---`);
  lines.push("```java");
  lines.push(sourceTo);
  lines.push("```");

  return lines.join("\n");
}
