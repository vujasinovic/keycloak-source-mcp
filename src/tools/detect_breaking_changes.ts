import * as fs from "node:fs";
import * as path from "node:path";
import {
  getSourcePath,
  parseJavaClass,
  findClassFile,
  buildMethodMap,
  formatMethodSignature,
} from "../utils.js";
import { versionManager } from "../version-manager.js";
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
 * Compare Keycloak SPI interfaces between two source versions to detect
 * breaking changes relevant to a developer's customizations.
 */
export async function detectBreakingChanges(
  fromVersion: string,
  toVersion: string,
  interfaceNames?: string[],
  sourcePathV1?: string,
  sourcePathV2?: string
): Promise<string> {
  if (!fromVersion || !fromVersion.trim()) return "Error: fromVersion is required.";
  if (!toVersion || !toVersion.trim()) return "Error: toVersion is required.";

  // Resolve version paths: explicit paths take priority, then version manager, then default
  const v1Path = sourcePathV1 || tryResolveVersion(fromVersion) || getSourcePath();
  const v2Path = sourcePathV2 || tryResolveVersion(toVersion) || getSourcePath();

  if (!fs.existsSync(v1Path)) return `Error: Source path for v1 does not exist: ${v1Path}`;
  if (!fs.existsSync(v2Path)) return `Error: Source path for v2 does not exist: ${v2Path}`;

  const interfaces = interfaceNames && interfaceNames.length > 0
    ? interfaceNames
    : DEFAULT_SPIS;

  // Compare all interfaces in parallel
  const results = await Promise.all(
    interfaces.map((ifaceName) => compareInterface(ifaceName, v1Path, v2Path))
  );
  const reports = results.filter((r): r is InterfaceReport => r !== null);

  return formatReport(fromVersion, toVersion, reports);
}

function tryResolveVersion(version: string): string | null {
  try {
    return versionManager.resolve(version);
  } catch {
    return null;
  }
}

async function compareInterface(
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

  // Check for removed methods
  for (const [name, method] of methodsV1) {
    if (!methodsV2.has(name)) {
      report.changes.push({
        severity: "BREAKING",
        description: `Method removed: ${formatMethodSignature(method)}`,
      });
    }
  }

  // Check for new methods
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

  // Check for signature changes
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

function formatReport(fromVersion: string, toVersion: string, reports: InterfaceReport[]): string {
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
