import * as fs from "node:fs";

interface RegisteredVersion {
  name: string;
  path: string;
  exists: boolean;
}

/**
 * Manages multiple Keycloak source versions registered via environment variables.
 * KEYCLOAK_SOURCE_PATH is treated as "default".
 * KEYCLOAK_SOURCE_V* vars are auto-registered as named versions.
 */
class VersionManagerImpl {
  private versions = new Map<string, RegisteredVersion>();
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Register default from KEYCLOAK_SOURCE_PATH
    const defaultPath = process.env.KEYCLOAK_SOURCE_PATH;
    if (defaultPath) {
      this.versions.set("default", {
        name: "default",
        path: defaultPath,
        exists: fs.existsSync(defaultPath),
      });
    }

    // Scan for KEYCLOAK_SOURCE_V* env vars
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith("KEYCLOAK_SOURCE_V") && value) {
        const versionName = key.replace("KEYCLOAK_SOURCE_V", "v").toLowerCase();
        this.versions.set(versionName, {
          name: versionName,
          path: value,
          exists: fs.existsSync(value),
        });
      }
    }
  }

  /**
   * Get the source path for a named version.
   */
  getVersion(name: string): string {
    this.initialize();
    const version = this.versions.get(name);
    if (!version) {
      const available = this.listVersions().map((v) => v.name).join(", ");
      throw new Error(
        `Version "${name}" is not registered. Available versions: ${available || "(none)"}`
      );
    }
    if (!version.exists) {
      throw new Error(`Version "${name}" path does not exist: ${version.path}`);
    }
    return version.path;
  }

  /**
   * Get the default source path.
   */
  getDefault(): string {
    this.initialize();
    const def = this.versions.get("default");
    if (!def) {
      throw new Error("No default version registered. Set KEYCLOAK_SOURCE_PATH.");
    }
    if (!def.exists) {
      throw new Error(`Default version path does not exist: ${def.path}`);
    }
    return def.path;
  }

  /**
   * List all registered versions.
   */
  listVersions(): RegisteredVersion[] {
    this.initialize();
    return [...this.versions.values()];
  }

  /**
   * Resolve a version parameter: if provided, look up the named version;
   * if not, fall back to the default.
   */
  resolve(version?: string): string {
    if (version) {
      return this.getVersion(version);
    }
    return this.getDefault();
  }

  /**
   * Check if any non-default versions are registered.
   */
  hasMultipleVersions(): boolean {
    this.initialize();
    return this.versions.size > 1;
  }

  /**
   * Format a startup summary.
   */
  getStartupSummary(): string {
    this.initialize();
    const versions = this.listVersions();
    if (versions.length === 0) return "  (no versions registered)";

    const maxNameLen = Math.max(...versions.map((v) => v.name.length));
    return versions
      .map((v) => {
        const status = v.exists ? "found" : "not found";
        return `  ${v.name.padEnd(maxNameLen + 2)} ${v.path} [${status}]`;
      })
      .join("\n");
  }

  /**
   * Reset for testing.
   */
  _reset(): void {
    this.versions.clear();
    this.initialized = false;
  }
}

export const versionManager = new VersionManagerImpl();
export type { RegisteredVersion };
