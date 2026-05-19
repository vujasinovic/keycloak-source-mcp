import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execa } from "execa";
import { addVersionFromBranch } from "../../src/tools/add_version_from_branch.js";
import { versionManager } from "../../src/version-manager.js";

describe("add_version_from_branch — input validation", () => {
  afterEach(() => {
    delete process.env.KEYCLOAK_SOURCE_PATH;
    versionManager._reset();
  });

  it("errors when versionName is empty", async () => {
    const result = await addVersionFromBranch("", "release/24.0", "/tmp");
    expect(result).toContain("versionName is required");
  });

  it("errors when branch is empty", async () => {
    const result = await addVersionFromBranch("v24", "", "/tmp");
    expect(result).toContain("branch is required");
  });

  it("errors when no baseRepoPath and no env var", async () => {
    const result = await addVersionFromBranch("v24", "release/24.0");
    expect(result).toContain("KEYCLOAK_SOURCE_PATH is not set");
  });

  it("errors when baseRepoPath is not a directory", async () => {
    const result = await addVersionFromBranch("v24", "release/24.0", "/nonexistent/path");
    expect(result).toContain("does not exist");
  });

  it("errors when baseRepoPath exists but is not a git repo", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "not-a-repo-"));
    try {
      const result = await addVersionFromBranch("v24", "release/24.0", tmp);
      expect(result).toContain("not a git repository");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("add_version_from_branch — git worktree integration", () => {
  let tmpRoot: string;
  let baseRepo: string;

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kc-mcp-worktree-"));
    baseRepo = path.join(tmpRoot, "keycloak");
    fs.mkdirSync(baseRepo);

    // Build a minimal git repo with main + a release branch.
    await execa("git", ["-C", baseRepo, "init", "-b", "main"]);
    await execa("git", ["-C", baseRepo, "config", "user.email", "test@example.com"]);
    await execa("git", ["-C", baseRepo, "config", "user.name", "test"]);
    fs.writeFileSync(path.join(baseRepo, "README.md"), "main\n");
    await execa("git", ["-C", baseRepo, "add", "."]);
    await execa("git", ["-C", baseRepo, "commit", "-m", "init"]);
    await execa("git", ["-C", baseRepo, "checkout", "-b", "release/24.0"]);
    fs.writeFileSync(path.join(baseRepo, "VERSION"), "24.0\n");
    await execa("git", ["-C", baseRepo, "add", "."]);
    await execa("git", ["-C", baseRepo, "commit", "-m", "24.0"]);
    await execa("git", ["-C", baseRepo, "checkout", "main"]);
  });

  afterEach(() => {
    versionManager._reset();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("creates a worktree and registers the version", async () => {
    const result = await addVersionFromBranch("v24", "release/24.0", baseRepo);
    expect(result).toContain("Created worktree");
    expect(result).toContain('Registered as version "v24"');

    const versions = versionManager.listVersions();
    const v24 = versions.find((v) => v.name === "v24");
    expect(v24).toBeDefined();
    expect(v24!.exists).toBe(true);
    expect(fs.existsSync(path.join(v24!.path, "VERSION"))).toBe(true);
  });

  it("errors when branch does not exist", async () => {
    const result = await addVersionFromBranch("v99", "release/99.0", baseRepo);
    expect(result).toContain("not found");
  });

  it("is idempotent — if the worktree path already exists, registers without recreating", async () => {
    const explicitPath = path.join(tmpRoot, "keycloak-v24");
    await addVersionFromBranch("v24", "release/24.0", baseRepo, explicitPath);
    versionManager._reset();

    const second = await addVersionFromBranch("v24", "release/24.0", baseRepo, explicitPath);
    expect(second).toContain("Path already exists");
    expect(second).toContain('Registered as version "v24"');
  });

  it("respects explicit worktreePath", async () => {
    const custom = path.join(tmpRoot, "custom-location");
    const result = await addVersionFromBranch("v24", "release/24.0", baseRepo, custom);
    expect(result).toContain(custom);
    expect(fs.existsSync(custom)).toBe(true);
  });
});
