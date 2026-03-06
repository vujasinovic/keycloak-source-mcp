import * as fs from "node:fs";
import * as path from "node:path";
import { getSourcePath, searchWithRg, parseJavaClass, type ParsedMethod } from "../utils.js";

interface AffectedClass {
  filePath: string;
  className: string;
  implementedInterfaces: string[];
  issues: UpgradeIssue[];
}

interface UpgradeIssue {
  severity: "BREAKING" | "WARNING" | "INFO";
  interfaceName: string;
  description: string;
  suggestedAction: string;
}

/**
 * Analyze a developer's existing custom SPI implementations and warn about
 * compatibility issues when upgrading Keycloak.
 */
export async function upgradeAssistant(
  customSourcePath: string,
  targetKeycloakVersion: string,
  currentKeycloakSourcePath?: string
): Promise<string> {
  if (!customSourcePath || !customSourcePath.trim()) return "Error: customSourcePath is required.";
  if (!targetKeycloakVersion || !targetKeycloakVersion.trim()) return "Error: targetKeycloakVersion is required.";

  if (!fs.existsSync(customSourcePath)) {
    return `Error: Custom source path does not exist: ${customSourcePath}`;
  }

  const keycloakPath = currentKeycloakSourcePath || getSourcePath();
  if (!fs.existsSync(keycloakPath)) {
    return `Error: Keycloak source path does not exist: ${keycloakPath}`;
  }

  // 1. Scan custom source for Java files
  const customFiles = await findJavaFiles(customSourcePath);
  if (customFiles.length === 0) {
    return `No Java files found in: ${customSourcePath}`;
  }

  // 2. Analyze each file
  const affectedClasses: AffectedClass[] = [];

  for (const file of customFiles) {
    const result = await analyzeCustomClass(file, customSourcePath, keycloakPath);
    if (result && result.issues.length > 0) {
      affectedClasses.push(result);
    }
  }

  // 3. Format report
  return formatUpgradeReport(
    customSourcePath,
    targetKeycloakVersion,
    customFiles.length,
    affectedClasses
  );
}

async function findJavaFiles(dir: string): Promise<string[]> {
  try {
    const args = ["--files", "--glob", "**/*.java"];
    const result = await searchWithRg(args, dir);
    if (!result.trim()) return [];
    return result.trim().split("\n").map((f) =>
      f.startsWith("/") ? f : path.join(dir, f)
    );
  } catch {
    return [];
  }
}

async function analyzeCustomClass(
  filePath: string,
  customBasePath: string,
  keycloakPath: string
): Promise<AffectedClass | null> {
  let source: string;
  try {
    source = await fs.promises.readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  const parsed = parseJavaClass(source);
  if (!parsed.className) return null;

  // Collect interfaces this class implements/extends
  const keycloakInterfaces: string[] = [];

  for (const iface of [...parsed.implementsList, ...parsed.extendsList]) {
    // Check if it's a Keycloak interface by looking for it in imports
    const fqn = parsed.imports.find((imp) =>
      imp.endsWith(`.${iface}`) && imp.startsWith("org.keycloak.")
    );
    if (fqn) {
      keycloakInterfaces.push(iface);
    }
  }

  if (keycloakInterfaces.length === 0) return null;

  const relPath = path.relative(customBasePath, filePath);
  const issues: UpgradeIssue[] = [];

  for (const ifaceName of keycloakInterfaces) {
    const ifaceIssues = await checkInterfaceCompatibility(
      parsed, ifaceName, keycloakPath
    );
    issues.push(...ifaceIssues);
  }

  return {
    filePath: relPath,
    className: parsed.className,
    implementedInterfaces: keycloakInterfaces,
    issues,
  };
}

async function checkInterfaceCompatibility(
  customParsed: ReturnType<typeof parseJavaClass>,
  interfaceName: string,
  keycloakPath: string
): Promise<UpgradeIssue[]> {
  const issues: UpgradeIssue[] = [];

  // Find the interface in Keycloak source
  let interfaceFile: string | null = null;
  try {
    const args = ["--files", "--glob", `**/${interfaceName}.java`];
    const result = await searchWithRg(args, keycloakPath);
    if (result.trim()) {
      const file = result.trim().split("\n")[0];
      interfaceFile = file.startsWith("/") ? file : path.join(keycloakPath, file);
    }
  } catch {
    // ignore
  }

  if (!interfaceFile) {
    issues.push({
      severity: "BREAKING",
      interfaceName,
      description: `Interface ${interfaceName} was not found in the target Keycloak source. It may have been removed or renamed.`,
      suggestedAction: `Search for the new name of this interface using search_class or grep_source. Check Keycloak migration guides.`,
    });
    return issues;
  }

  let interfaceSource: string;
  try {
    interfaceSource = await fs.promises.readFile(interfaceFile, "utf-8");
  } catch {
    return issues;
  }

  const interfaceParsed = parseJavaClass(interfaceSource);

  // Build maps of methods
  const customMethods = new Map<string, ParsedMethod>();
  for (const m of customParsed.methods) {
    customMethods.set(m.name, m);
  }

  const interfaceMethods = new Map<string, ParsedMethod>();
  for (const m of interfaceParsed.methods) {
    interfaceMethods.set(m.name, m);
  }

  // Check for new required methods in the interface that the custom class doesn't implement
  for (const [name, method] of interfaceMethods) {
    if (!customMethods.has(name) && !method.modifiers.includes("default")) {
      issues.push({
        severity: "BREAKING",
        interfaceName,
        description: `New required method not implemented: ${method.returnType} ${name}(${method.parameters})`,
        suggestedAction: `Add implementation for ${name}() in your class. Check existing Keycloak implementations for reference.`,
      });
    }
  }

  // Check for methods in custom class that no longer exist in interface
  for (const [name, method] of customMethods) {
    if (method.modifiers.includes("@Override") || customParsed.implementsList.includes(interfaceName)) {
      if (interfaceMethods.has(name)) {
        const ifMethod = interfaceMethods.get(name)!;
        // Check if signature changed
        if (method.returnType !== ifMethod.returnType || method.parameters !== ifMethod.parameters) {
          issues.push({
            severity: "BREAKING",
            interfaceName,
            description: `Method signature mismatch: ${name}\n      Your version: ${method.returnType} ${name}(${method.parameters})\n      Interface: ${ifMethod.returnType} ${name}(${ifMethod.parameters})`,
            suggestedAction: `Update the method signature to match the new interface definition.`,
          });
        }
      }
    }
  }

  // Check for deprecated annotations in the interface
  for (const [name, method] of interfaceMethods) {
    if (method.modifiers.includes("@Deprecated") && customMethods.has(name)) {
      issues.push({
        severity: "WARNING",
        interfaceName,
        description: `Method ${name}() is marked @Deprecated in the target Keycloak version.`,
        suggestedAction: `Plan to migrate away from ${name}(). Check Javadoc for the recommended replacement.`,
      });
    }
  }

  if (issues.length === 0) {
    issues.push({
      severity: "INFO",
      interfaceName,
      description: `Interface ${interfaceName} appears compatible — no breaking changes detected.`,
      suggestedAction: "No action required, but review the Keycloak changelog for behavioral changes.",
    });
  }

  return issues;
}

function formatUpgradeReport(
  customPath: string,
  targetVersion: string,
  totalFiles: number,
  affected: AffectedClass[]
): string {
  const lines: string[] = [];
  lines.push(`Upgrade Assistant Report`);
  lines.push("=".repeat(60));
  lines.push(`Custom source: ${customPath}`);
  lines.push(`Target Keycloak version: ${targetVersion}`);
  lines.push(`Java files scanned: ${totalFiles}`);
  lines.push(`Classes with Keycloak interfaces: ${affected.length}`);
  lines.push("");

  if (affected.length === 0) {
    lines.push("No Keycloak SPI implementations detected in your source code.");
    lines.push("Either your classes don't implement Keycloak interfaces, or they weren't detected.");
    lines.push("");
    lines.push("Tip: Make sure your custom classes import Keycloak interfaces from org.keycloak.* packages.");
    return lines.join("\n");
  }

  let breakingCount = 0;
  let warningCount = 0;

  for (const cls of affected) {
    lines.push(`File: ${cls.filePath}`);
    lines.push(`Class: ${cls.className}`);
    lines.push(`Implements: ${cls.implementedInterfaces.join(", ")}`);
    lines.push("-".repeat(40));

    for (const issue of cls.issues) {
      if (issue.severity === "BREAKING") breakingCount++;
      if (issue.severity === "WARNING") warningCount++;

      const icon = issue.severity === "BREAKING" ? "[BREAKING]"
        : issue.severity === "WARNING" ? "[WARNING]"
        : "[INFO]";
      lines.push(`  ${icon} ${issue.description}`);
      lines.push(`    Action: ${issue.suggestedAction}`);
    }
    lines.push("");
  }

  lines.push("=".repeat(60));
  lines.push("Summary");
  lines.push("-".repeat(40));
  lines.push(`  Breaking changes: ${breakingCount}`);
  lines.push(`  Warnings: ${warningCount}`);
  lines.push(`  Affected classes: ${affected.length}`);

  if (breakingCount > 0) {
    lines.push("");
    lines.push("Next steps:");
    lines.push("  1. Address all [BREAKING] issues before upgrading");
    lines.push("  2. Use get_class_source to read Keycloak's built-in implementations for reference");
    lines.push("  3. Use find_interface_implementors to see how Keycloak itself handles the changes");
    lines.push("  4. Check the Keycloak migration guide for your target version");
  }

  return lines.join("\n");
}
