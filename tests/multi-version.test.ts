import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { versionManager } from "../src/version-manager.js";
import { listVersions } from "../src/tools/list_versions.js";
import { compareAcrossVersions } from "../src/tools/compare_across_versions.js";
import { searchClass } from "../src/tools/search_class.js";
import { getClassSource } from "../src/tools/get_class_source.js";
import { setupMultiVersionEnv, cleanupEnv, MOCK_SOURCE_PATH, MOCK_SOURCE_V2_PATH } from "./test-utils.js";

describe("VersionManager", () => {
  beforeEach(setupMultiVersionEnv);
  afterEach(cleanupEnv);

  it("reads KEYCLOAK_SOURCE_V* env vars", () => {
    const versions = versionManager.listVersions();
    const names = versions.map((v) => v.name);
    expect(names).toContain("default");
    expect(names).toContain("vtest");
    expect(names).toContain("vv2");
  });

  it("returns correct path for registered version", () => {
    expect(versionManager.resolve("default")).toBe(MOCK_SOURCE_PATH);
    expect(versionManager.resolve("vv2")).toBe(MOCK_SOURCE_V2_PATH);
  });

  it("returns helpful error for unregistered version", () => {
    expect(() => versionManager.resolve("vnonexistent")).toThrow("not registered");
  });

  it("getDefault returns KEYCLOAK_SOURCE_PATH", () => {
    expect(versionManager.getDefault()).toBe(MOCK_SOURCE_PATH);
  });

  it("hasMultipleVersions returns true when multiple registered", () => {
    expect(versionManager.hasMultipleVersions()).toBe(true);
  });

  it("getStartupSummary returns formatted text", () => {
    const summary = versionManager.getStartupSummary();
    expect(summary).toContain("default");
    expect(summary).toContain("found");
  });
});

describe("list_versions tool", () => {
  beforeEach(setupMultiVersionEnv);
  afterEach(cleanupEnv);

  it("returns all registered versions", () => {
    const result = listVersions();
    expect(result).toContain("default");
    expect(result).toContain("vtest");
    expect(result).toContain("vv2");
    expect(result).toContain("found");
  });
});

describe("existing tools with version parameter", () => {
  beforeEach(setupMultiVersionEnv);
  afterEach(cleanupEnv);

  it("search_class uses version parameter when provided", async () => {
    const result = await searchClass("Authenticator", "vv2");
    expect(result).toContain("Authenticator.java");
  });

  it("search_class falls back to default when version not provided", async () => {
    const result = await searchClass("Authenticator");
    expect(result).toContain("Authenticator.java");
  });

  it("get_class_source uses version parameter", async () => {
    const result = await getClassSource("Authenticator.java", "vv2");
    expect(result).toContain("supportsCredentialType");
  });

  it("get_class_source default does not have v2 methods", async () => {
    const result = await getClassSource("Authenticator.java");
    expect(result).not.toContain("supportsCredentialType");
  });
});

describe("compare_across_versions", () => {
  beforeEach(setupMultiVersionEnv);
  afterEach(cleanupEnv);

  it("correctly identifies added methods", async () => {
    const result = await compareAcrossVersions("Authenticator", "vtest", "vv2");
    expect(result).toContain("supportsCredentialType");
    expect(result).toContain("added");
  });

  it("correctly identifies changed signatures", async () => {
    const result = await compareAcrossVersions("Authenticator", "vtest", "vv2");
    expect(result).toContain("configuredFor");
    expect(result).toContain("changed");
  });

  it("correctly identifies removed methods", async () => {
    const result = await compareAcrossVersions("RequiredActionProvider", "vtest", "vv2");
    expect(result).toContain("evaluateTriggers");
    expect(result).toContain("removed");
  });

  it("handles class not found in either version", async () => {
    const result = await compareAcrossVersions("NonExistentClass", "vtest", "vv2");
    expect(result).toContain("not found");
  });

  it("supports side_by_side mode", async () => {
    const result = await compareAcrossVersions("Authenticator", "vtest", "vv2", "side_by_side");
    expect(result).toContain("```java");
  });

  it("returns error for invalid version", async () => {
    const result = await compareAcrossVersions("Authenticator", "vnonexistent", "vv2");
    expect(result).toContain("Error");
  });

  it("shows summary of changes", async () => {
    const result = await compareAcrossVersions("Authenticator", "vtest", "vv2");
    expect(result).toContain("Summary:");
  });
});
