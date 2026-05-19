import * as fs from "node:fs";
import * as path from "node:path";
import { execa } from "execa";
import { versionManager } from "../version-manager.js";

/**
 * Create a git worktree for a Keycloak release branch and register it
 * as a named version. Lets the user juggle versions from a single clone
 * without re-cloning gigabytes of repo history per version.
 */
export async function addVersionFromBranch(
  versionName: string,
  branch: string,
  baseRepoPath?: string,
  worktreePath?: string,
): Promise<string> {
  if (!versionName || !versionName.trim()) {
    return "Error: versionName is required (e.g. 'v24').";
  }
  if (!branch || !branch.trim()) {
    return "Error: branch is required (e.g. 'release/24.0').";
  }

  const baseRepo = baseRepoPath || process.env.KEYCLOAK_SOURCE_PATH;
  if (!baseRepo) {
    return "Error: baseRepoPath not provided and KEYCLOAK_SOURCE_PATH is not set.";
  }
  if (!fs.existsSync(baseRepo)) {
    return `Error: baseRepoPath does not exist: ${baseRepo}`;
  }
  if (!fs.existsSync(path.join(baseRepo, ".git"))) {
    return `Error: baseRepoPath is not a git repository: ${baseRepo}`;
  }

  const targetPath = worktreePath || defaultWorktreePath(baseRepo, versionName);

  // If the path already exists, try to register it rather than failing.
  if (fs.existsSync(targetPath)) {
    const entry = versionManager.register(versionName, targetPath);
    return [
      `Path already exists at ${targetPath}.`,
      `Registered as version "${versionName}" without creating a new worktree.`,
      `  exists: ${entry.exists}`,
      "",
      "Use list_versions to confirm.",
    ].join("\n");
  }

  // Verify the branch exists in the base repo (local or remote).
  const branchExists = await refExists(baseRepo, branch);
  if (!branchExists) {
    return [
      `Error: branch "${branch}" not found in ${baseRepo}.`,
      "",
      "If it is a remote branch you have not fetched yet, run:",
      `  git -C ${baseRepo} fetch origin ${branch}`,
      "then retry.",
    ].join("\n");
  }

  try {
    await execa("git", ["-C", baseRepo, "worktree", "add", targetPath, branch]);
  } catch (err) {
    return `Error creating worktree: ${err instanceof Error ? err.message : String(err)}`;
  }

  const entry = versionManager.register(versionName, targetPath);

  return [
    `Created worktree for branch "${branch}" at ${targetPath}`,
    `Registered as version "${versionName}".`,
    `  exists: ${entry.exists}`,
    "",
    "It's available to subsequent tool calls immediately (no restart needed).",
    "To make it persist across restarts, add to your MCP env:",
    `  KEYCLOAK_SOURCE_${versionName.toUpperCase().replace(/^V/, "V")}=${targetPath}`,
  ].join("\n");
}

function defaultWorktreePath(baseRepo: string, versionName: string): string {
  const parent = path.dirname(baseRepo);
  const repoName = path.basename(baseRepo);
  return path.join(parent, `${repoName}-${versionName}`);
}

async function refExists(repo: string, ref: string): Promise<boolean> {
  try {
    await execa("git", ["-C", repo, "rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    // Try as a remote ref
    try {
      await execa("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `origin/${ref}`]);
      return true;
    } catch {
      return false;
    }
  }
}
