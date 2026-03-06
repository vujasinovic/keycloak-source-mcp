import { fetchWithCache } from "../utils.js";

interface Advisory {
  cveId: string;
  severity: string;
  title: string;
  description: string;
  affectedVersions: string;
  publishedAt: string;
  url: string;
}

interface GitHubAdvisory {
  ghsa_id: string;
  cve_id: string | null;
  summary: string;
  description: string;
  severity: string;
  published_at: string;
  html_url: string;
  vulnerabilities?: Array<{
    package?: { name?: string; ecosystem?: string };
    vulnerable_version_range?: string;
    first_patched_version?: { identifier?: string } | null;
  }>;
}

/**
 * Check Keycloak's GitHub security advisories for known CVEs affecting a specific version.
 */
export async function checkSecurityAdvisories(
  keycloakVersion: string,
  severity: "all" | "critical" | "high" | "medium" | "low" = "all"
): Promise<string> {
  if (!keycloakVersion || !keycloakVersion.trim()) {
    return "Error: keycloakVersion is required.";
  }

  let advisories: GitHubAdvisory[];
  try {
    advisories = await fetchAdvisories();
  } catch (error) {
    return `Error: Failed to fetch security advisories. You may be offline or rate-limited.\nDetails: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (advisories.length === 0) {
    return "No security advisories found. The GitHub API may have returned an empty response.";
  }

  // Filter by severity
  let filtered = advisories;
  if (severity !== "all") {
    filtered = advisories.filter(
      (a) => a.severity.toLowerCase() === severity.toLowerCase()
    );
  }

  // Filter by version
  const affecting = filtered.filter((a) =>
    advisoryAffectsVersion(a, keycloakVersion)
  );

  return formatAdvisoryReport(keycloakVersion, severity, affecting, advisories.length);
}

async function fetchAdvisories(): Promise<GitHubAdvisory[]> {
  const url = "https://api.github.com/repos/keycloak/keycloak/security/advisories?state=published&per_page=100";

  const response = await fetchWithCache(url, 30);

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as GitHubAdvisory[];
}

function advisoryAffectsVersion(advisory: GitHubAdvisory, version: string): boolean {
  if (!advisory.vulnerabilities || advisory.vulnerabilities.length === 0) {
    // If no structured vulnerability data, include it as potentially relevant
    return true;
  }

  const targetParts = parseVersion(version);
  if (!targetParts) return true; // Can't parse, include it

  for (const vuln of advisory.vulnerabilities) {
    const range = vuln.vulnerable_version_range;
    if (!range) continue;

    if (isVersionInRange(version, targetParts, range)) {
      return true;
    }
  }

  return false;
}

interface VersionParts {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(v: string): VersionParts | null {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

function compareVersions(a: VersionParts, b: VersionParts): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function isVersionInRange(version: string, vParts: VersionParts, range: string): boolean {
  // Parse ranges like ">= 20.0.0, < 24.0.4" or "< 25.0.1"
  const conditions = range.split(",").map((c) => c.trim());

  for (const cond of conditions) {
    const match = cond.match(/^([<>=!]+)\s*([\d.]+)/);
    if (!match) continue;

    const op = match[1];
    const boundParts = parseVersion(match[2]);
    if (!boundParts) continue;

    const cmp = compareVersions(vParts, boundParts);

    switch (op) {
      case "<":
        if (!(cmp < 0)) return false;
        break;
      case "<=":
        if (!(cmp <= 0)) return false;
        break;
      case ">":
        if (!(cmp > 0)) return false;
        break;
      case ">=":
        if (!(cmp >= 0)) return false;
        break;
      case "=":
      case "==":
        if (cmp !== 0) return false;
        break;
      case "!=":
        if (cmp === 0) return false;
        break;
    }
  }

  return true;
}

function formatAdvisoryReport(
  version: string,
  severity: string,
  advisories: GitHubAdvisory[],
  totalFetched: number
): string {
  const lines: string[] = [];
  lines.push(`Security Advisory Report: Keycloak ${version}`);
  lines.push("=".repeat(60));
  lines.push(`Severity filter: ${severity}`);
  lines.push(`Advisories checked: ${totalFetched}`);
  lines.push(`Affecting this version: ${advisories.length}`);
  lines.push("");

  if (advisories.length === 0) {
    lines.push("No known security advisories found affecting this version.");
    if (severity !== "all") {
      lines.push(`(Filtered by severity: ${severity}. Try severity "all" for complete results.)`);
    }
    return lines.join("\n");
  }

  // Sort by severity
  const severityOrder: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  advisories.sort((a, b) => {
    const aOrder = severityOrder[a.severity.toLowerCase()] ?? 4;
    const bOrder = severityOrder[b.severity.toLowerCase()] ?? 4;
    return aOrder - bOrder;
  });

  for (const adv of advisories) {
    const cve = adv.cve_id || adv.ghsa_id;
    const sevLabel = adv.severity.toUpperCase();
    const date = adv.published_at ? adv.published_at.split("T")[0] : "unknown";

    lines.push(`[${sevLabel}] ${cve}`);
    lines.push(`  Title: ${adv.summary}`);
    lines.push(`  Published: ${date}`);
    lines.push(`  URL: ${adv.html_url}`);

    if (adv.vulnerabilities && adv.vulnerabilities.length > 0) {
      for (const vuln of adv.vulnerabilities) {
        if (vuln.vulnerable_version_range) {
          lines.push(`  Affected: ${vuln.vulnerable_version_range}`);
        }
        if (vuln.first_patched_version?.identifier) {
          lines.push(`  Fixed in: ${vuln.first_patched_version.identifier}`);
        }
      }
    }

    // Truncate description
    if (adv.description) {
      const desc = adv.description.split("\n")[0].slice(0, 200);
      lines.push(`  ${desc}${adv.description.length > 200 ? "..." : ""}`);
    }

    lines.push("");
  }

  // Summary by severity
  const bySeverity = new Map<string, number>();
  for (const adv of advisories) {
    const sev = adv.severity.toLowerCase();
    bySeverity.set(sev, (bySeverity.get(sev) || 0) + 1);
  }

  lines.push("-".repeat(60));
  lines.push("Summary by severity:");
  for (const [sev, count] of [...bySeverity.entries()].sort((a, b) =>
    (severityOrder[a[0]] ?? 4) - (severityOrder[b[0]] ?? 4)
  )) {
    lines.push(`  ${sev.toUpperCase()}: ${count}`);
  }

  if (bySeverity.has("critical") || bySeverity.has("high")) {
    lines.push("");
    lines.push("RECOMMENDATION: Upgrade to the latest patched version to address critical/high severity issues.");
  }

  return lines.join("\n");
}
