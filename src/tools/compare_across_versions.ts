import * as fs from "node:fs";
import * as path from "node:path";
import { versionManager } from "../version-manager.js";
import {
  parseJavaClass,
  findClassFile,
  buildMethodMap,
  formatMethodSignature,
  getSourcePath,
  type ParsedMethod,
} from "../utils.js";
import { SEPARATOR } from "../constants.js";

const DEFAULT_SPIS = [
  "Authenticator",
  "RequiredActionProvider",
  "EventListenerProvider",
  "ProtocolMapper",
  "PasswordHashProvider",
  "UserStorageProvider",
  "CredentialProvider",
];

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

  // Find the class/interface in both versions (parallel)
  const classQuery = query.endsWith(".java") ? query.replace(/\.java$/, "") : query;
  const [fileFrom, fileTo] = await Promise.all([
    findClassFile(pathFrom, classQuery),
    findClassFile(pathTo, classQuery),
  ]);

  if (!fileFrom && !fileTo) {
    return `"${query}" not found in either ${fromVersion} or ${toVersion}.`;
  }

  const lines: string[] = [];
  lines.push(`Comparison: "${query}" — ${fromVersion} vs ${toVersion}`);
  lines.push(SEPARATOR.HEADER);
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
  const fromMethods = buildMethodMap(from.methods);
  const toMethods = buildMethodMap(to.methods);

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
  lines.push(SEPARATOR.SECTION);
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

// ── Breaking-change SPI scan ──

interface ChangeEntry {
  severity: "BREAKING" | "NON-BREAKING";
  description: string;
}

interface InterfaceReport {
  interfaceName: string;
  fileV1: string;
  fileV2: string;
  changes: ChangeEntry[];
}

/**
 * Scan Keycloak SPI interfaces across two versions for breaking changes.
 * If no interfaces are provided, scans a default set of well-known SPIs.
 */
export async function scanBreakingChanges(
  fromVersion: string,
  toVersion: string,
  interfaceNames?: string[],
  sourcePathV1?: string,
  sourcePathV2?: string
): Promise<string> {
  if (!fromVersion || !fromVersion.trim()) return "Error: fromVersion is required.";
  if (!toVersion || !toVersion.trim()) return "Error: toVersion is required.";

  const v1Path = sourcePathV1 || tryResolveVersion(fromVersion) || getSourcePath();
  const v2Path = sourcePathV2 || tryResolveVersion(toVersion) || getSourcePath();

  if (!fs.existsSync(v1Path)) return `Error: Source path for v1 does not exist: ${v1Path}`;
  if (!fs.existsSync(v2Path)) return `Error: Source path for v2 does not exist: ${v2Path}`;

  const interfaces = interfaceNames && interfaceNames.length > 0 ? interfaceNames : DEFAULT_SPIS;

  const results = await Promise.all(
    interfaces.map((ifaceName) => compareInterfaceForBreaking(ifaceName, v1Path, v2Path))
  );
  const reports = results.filter((r): r is InterfaceReport => r !== null);

  return formatBreakingReport(fromVersion, toVersion, reports);
}

function tryResolveVersion(version: string): string | null {
  try {
    return versionManager.resolve(version);
  } catch {
    return null;
  }
}

async function compareInterfaceForBreaking(
  interfaceName: string,
  v1Path: string,
  v2Path: string
): Promise<InterfaceReport | null> {
  const [fileV1, fileV2] = await Promise.all([
    findClassFile(v1Path, interfaceName),
    findClassFile(v2Path, interfaceName),
  ]);

  if (!fileV1 && !fileV2) return null;

  const report: InterfaceReport = {
    interfaceName,
    fileV1: fileV1 ? path.relative(v1Path, fileV1) : "(not found)",
    fileV2: fileV2 ? path.relative(v2Path, fileV2) : "(not found)",
    changes: [],
  };

  if (!fileV1) {
    report.changes.push({
      severity: "NON-BREAKING",
      description: `Interface ${interfaceName} is new in the target version.`,
    });
    return report;
  }

  if (!fileV2) {
    report.changes.push({
      severity: "BREAKING",
      description: `Interface ${interfaceName} was REMOVED in the target version.`,
    });
    return report;
  }

  const [sourceV1, sourceV2] = await Promise.all([
    fs.promises.readFile(fileV1, "utf-8"),
    fs.promises.readFile(fileV2, "utf-8"),
  ]);

  const parsedV1 = parseJavaClass(sourceV1);
  const parsedV2 = parseJavaClass(sourceV2);

  const methodsV1 = buildMethodMap(parsedV1.methods);
  const methodsV2 = buildMethodMap(parsedV2.methods);

  for (const [name, method] of methodsV1) {
    if (!methodsV2.has(name)) {
      report.changes.push({
        severity: "BREAKING",
        description: `Method removed: ${formatMethodSignature(method)}`,
      });
    }
  }

  for (const [name, method] of methodsV2) {
    if (!methodsV1.has(name)) {
      const isDefault = method.modifiers.includes("default");
      report.changes.push({
        severity: isDefault ? "NON-BREAKING" : "BREAKING",
        description: isDefault
          ? `New default method added: ${formatMethodSignature(method)}`
          : `New required method added (no default impl): ${formatMethodSignature(method)}`,
      });
    }
  }

  for (const [name, methodV1] of methodsV1) {
    const methodV2 = methodsV2.get(name);
    if (!methodV2) continue;

    const sigV1 = `${methodV1.returnType}(${methodV1.parameters})`;
    const sigV2 = `${methodV2.returnType}(${methodV2.parameters})`;

    if (sigV1 !== sigV2) {
      report.changes.push({
        severity: "BREAKING",
        description: `Method signature changed: ${name}\n      Was: ${formatMethodSignature(methodV1)}\n      Now: ${formatMethodSignature(methodV2)}`,
      });
    } else if (methodV1.javadoc !== methodV2.javadoc && methodV1.javadoc && methodV2.javadoc) {
      report.changes.push({
        severity: "NON-BREAKING",
        description: `Javadoc changed for method: ${name}`,
      });
    }
  }

  return report;
}

function formatBreakingReport(fromVersion: string, toVersion: string, reports: InterfaceReport[]): string {
  const lines: string[] = [];
  lines.push(`Breaking Changes Report: ${fromVersion} -> ${toVersion}`);
  lines.push(SEPARATOR.HEADER);
  lines.push("");

  if (reports.length === 0) {
    lines.push("No interfaces found to compare. Ensure both source paths contain Keycloak source code.");
    return lines.join("\n");
  }

  let totalBreaking = 0;
  let totalNonBreaking = 0;

  for (const report of reports) {
    const breaking = report.changes.filter((c) => c.severity === "BREAKING").length;
    const nonBreaking = report.changes.filter((c) => c.severity === "NON-BREAKING").length;
    totalBreaking += breaking;
    totalNonBreaking += nonBreaking;

    lines.push(`Interface: ${report.interfaceName}`);
    lines.push(SEPARATOR.SECTION);
    lines.push(`  v1: ${report.fileV1}`);
    lines.push(`  v2: ${report.fileV2}`);

    if (report.changes.length === 0) {
      lines.push("  No changes detected.");
    } else {
      for (const change of report.changes) {
        const icon = change.severity === "BREAKING" ? "[BREAKING]" : "[OK]";
        lines.push(`  ${icon} ${change.description}`);
      }
    }
    lines.push("");
  }

  lines.push(SEPARATOR.FOOTER);
  lines.push(`Summary: ${totalBreaking} breaking change(s), ${totalNonBreaking} non-breaking change(s)`);

  if (totalBreaking > 0) {
    lines.push("");
    lines.push("Action required: Review breaking changes above and update your custom implementations.");
  }

  return lines.join("\n");
}
