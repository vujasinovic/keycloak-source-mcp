import { versionManager } from "../version-manager.js";

/**
 * List all registered Keycloak source versions.
 */
export function listVersions(): string {
  const versions = versionManager.listVersions();

  if (versions.length === 0) {
    return [
      "No Keycloak source versions registered.",
      "",
      "Set KEYCLOAK_SOURCE_PATH for the default version.",
      "Set KEYCLOAK_SOURCE_V24, KEYCLOAK_SOURCE_V25, etc. for named versions.",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("Registered Keycloak Source Versions");
  lines.push("");

  const maxNameLen = Math.max(...versions.map((v) => v.name.length), 4);
  const maxPathLen = Math.max(...versions.map((v) => v.path.length), 4);

  const header = `${"NAME".padEnd(maxNameLen + 2)}${"PATH".padEnd(maxPathLen + 2)}STATUS`;
  lines.push(header);
  lines.push("\u2500".repeat(header.length));

  for (const v of versions) {
    const status = v.exists ? "found" : "not found";
    lines.push(
      `${v.name.padEnd(maxNameLen + 2)}${v.path.padEnd(maxPathLen + 2)}${status}`
    );
  }

  return lines.join("\n");
}
