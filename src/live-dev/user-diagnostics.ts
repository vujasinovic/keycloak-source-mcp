/**
 * @file user-diagnostics.ts
 * @module live-dev
 * @author keycloak-source-mcp
 * @since 1.3.0
 *
 * Core logic for diagnosing user login issues against a live Keycloak instance.
 *
 * Queries the Keycloak Admin REST API to build a comprehensive diagnostic report:
 * - User lookup (by name, email, or username)
 * - Account status (enabled, email verified, required actions)
 * - Credential inventory (password, OTP, WebAuthn)
 * - Brute force lockout detection
 * - Recent login events (successes and failures)
 * - Active sessions
 * - Realm security policies (brute force, password policy)
 */

import { DevInstanceClient } from "./dev-instance-client.js";

// ── Types ──

export interface UserRepresentation {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  emailVerified?: boolean;
  enabled?: boolean;
  requiredActions?: string[];
  createdTimestamp?: number;
  attributes?: Record<string, string[]>;
}

export interface CredentialRepresentation {
  id: string;
  type: string;
  userLabel?: string;
  createdDate?: number;
  credentialData?: string;
}

export interface BruteForceStatus {
  numFailures: number;
  disabled: boolean;
  lastIPFailure?: string;
  lastFailure?: number;
}

export interface LoginEvent {
  time: number;
  type: string;
  clientId?: string;
  userId?: string;
  ipAddress?: string;
  error?: string;
  details?: Record<string, string>;
}

export interface UserSession {
  id: string;
  userId: string;
  ipAddress?: string;
  start?: number;
  lastAccess?: number;
  clients?: Record<string, string>;
}

export interface DiagnosticReport {
  user: UserRepresentation;
  realm: string;
  credentials: CredentialRepresentation[];
  bruteForce: BruteForceStatus | null;
  recentEvents: LoginEvent[];
  sessions: UserSession[];
  realmBruteForcePolicy: BruteForcePolicy | null;
  realmPasswordPolicy: string | null;
  issues: DiagnosticIssue[];
}

export interface BruteForcePolicy {
  enabled: boolean;
  maxFailureWaitSeconds: number;
  waitIncrementSeconds: number;
  maxDeltaTimeSeconds: number;
  failureFactor: number;
  permanentLockout: boolean;
}

export interface DiagnosticIssue {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  suggestion?: string;
}

// ── Core functions ──

/**
 * Search for a user in the given realm.
 * Returns all matching users (the Admin API performs fuzzy matching on name, email, username).
 */
export async function searchUser(
  client: DevInstanceClient,
  realm: string,
  query: string
): Promise<UserRepresentation[]> {
  const encodedRealm = encodeURIComponent(realm);
  const encodedQuery = encodeURIComponent(query);
  return client.request<UserRepresentation[]>(
    `/admin/realms/${encodedRealm}/users?search=${encodedQuery}&max=10`
  );
}

/**
 * Fetch credentials for a specific user.
 */
export async function getUserCredentials(
  client: DevInstanceClient,
  realm: string,
  userId: string
): Promise<CredentialRepresentation[]> {
  const encodedRealm = encodeURIComponent(realm);
  const encodedId = encodeURIComponent(userId);
  return client.request<CredentialRepresentation[]>(
    `/admin/realms/${encodedRealm}/users/${encodedId}/credentials`
  );
}

/**
 * Check brute force lockout status for a user.
 * Returns null if brute force protection is not enabled or the endpoint is unavailable.
 */
export async function getBruteForceStatus(
  client: DevInstanceClient,
  realm: string,
  userId: string
): Promise<BruteForceStatus | null> {
  const encodedRealm = encodeURIComponent(realm);
  const encodedId = encodeURIComponent(userId);
  try {
    return await client.request<BruteForceStatus>(
      `/admin/realms/${encodedRealm}/attack-detection/brute-force/users/${encodedId}`
    );
  } catch {
    return null;
  }
}

/**
 * Fetch recent login events for a user.
 */
export async function getLoginEvents(
  client: DevInstanceClient,
  realm: string,
  userId: string,
  maxEvents: number = 25
): Promise<LoginEvent[]> {
  const encodedRealm = encodeURIComponent(realm);
  const encodedId = encodeURIComponent(userId);
  try {
    return await client.request<LoginEvent[]>(
      `/admin/realms/${encodedRealm}/events?user=${encodedId}&type=LOGIN&type=LOGIN_ERROR&type=LOGOUT&type=CODE_TO_TOKEN&type=CODE_TO_TOKEN_ERROR&max=${maxEvents}`
    );
  } catch {
    // Events may not be enabled in the realm
    return [];
  }
}

/**
 * Fetch active sessions for a user.
 */
export async function getUserSessions(
  client: DevInstanceClient,
  realm: string,
  userId: string
): Promise<UserSession[]> {
  const encodedRealm = encodeURIComponent(realm);
  const encodedId = encodeURIComponent(userId);
  try {
    return await client.request<UserSession[]>(
      `/admin/realms/${encodedRealm}/users/${encodedId}/sessions`
    );
  } catch {
    return [];
  }
}

/**
 * Extract brute force policy from realm settings.
 */
export function extractBruteForcePolicy(
  realmSettings: Record<string, unknown>
): BruteForcePolicy | null {
  if (!realmSettings.bruteForceProtected) return null;
  return {
    enabled: Boolean(realmSettings.bruteForceProtected),
    maxFailureWaitSeconds: Number(realmSettings.maxFailureWaitSeconds ?? 900),
    waitIncrementSeconds: Number(realmSettings.waitIncrementSeconds ?? 60),
    maxDeltaTimeSeconds: Number(realmSettings.maxDeltaTimeSeconds ?? 43200),
    failureFactor: Number(realmSettings.failureFactor ?? 30),
    permanentLockout: Boolean(realmSettings.permanentLockout),
  };
}

/**
 * Run all diagnostic checks for a user and produce a full report.
 */
export async function diagnoseUser(
  client: DevInstanceClient,
  realm: string,
  query: string
): Promise<DiagnosticReport | string> {
  // 1. Find the user
  const users = await searchUser(client, realm, query);

  if (users.length === 0) {
    return `No user found matching "${query}" in realm "${realm}".\n\n` +
      "Try searching by:\n" +
      "  - Full name (e.g. \"John Doe\")\n" +
      "  - Email (e.g. \"john@example.com\")\n" +
      "  - Username (e.g. \"john.doe\")\n\n" +
      "The user may also exist in a different realm.";
  }

  // Pick best match: exact username/email match first, otherwise first result
  const user = users.find(
    (u) =>
      u.username === query ||
      u.email === query.toLowerCase()
  ) ?? users[0];

  // 2. Run all checks in parallel
  const [credentials, bruteForce, events, sessions, realmSettings] =
    await Promise.all([
      getUserCredentials(client, realm, user.id),
      getBruteForceStatus(client, realm, user.id),
      getLoginEvents(client, realm, user.id),
      getUserSessions(client, realm, user.id),
      client.request<Record<string, unknown>>(
        `/admin/realms/${encodeURIComponent(realm)}`
      ),
    ]);

  const bruteForcePolicy = extractBruteForcePolicy(realmSettings);
  const passwordPolicy = realmSettings.passwordPolicy as string | null ?? null;

  // 3. Analyze issues
  const issues = analyzeIssues(user, credentials, bruteForce, events, bruteForcePolicy);

  // If multiple matches, add an info issue
  if (users.length > 1) {
    issues.push({
      severity: "info",
      title: "Multiple users matched",
      detail: `Search returned ${users.length} users. Showing diagnosis for: ${user.username}`,
      suggestion: `Other matches: ${users.filter((u) => u.id !== user.id).map((u) => u.username).join(", ")}`,
    });
  }

  return {
    user,
    realm,
    credentials,
    bruteForce,
    recentEvents: events,
    sessions,
    realmBruteForcePolicy: bruteForcePolicy,
    realmPasswordPolicy: passwordPolicy,
    issues,
  };
}

/**
 * Analyze diagnostic data and identify issues.
 */
function analyzeIssues(
  user: UserRepresentation,
  credentials: CredentialRepresentation[],
  bruteForce: BruteForceStatus | null,
  events: LoginEvent[],
  bruteForcePolicy: BruteForcePolicy | null
): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  // Account disabled
  if (user.enabled === false) {
    issues.push({
      severity: "critical",
      title: "Account is disabled",
      detail: "The user account has been manually disabled by an administrator.",
      suggestion: "Re-enable the account in Keycloak Admin Console > Users > Enable toggle.",
    });
  }

  // Brute force lockout
  if (bruteForce?.disabled) {
    const failureCount = bruteForce.numFailures;
    const threshold = bruteForcePolicy?.failureFactor ?? "unknown";
    const lastFailureTime = bruteForce.lastFailure
      ? new Date(bruteForce.lastFailure).toISOString()
      : "unknown";

    let lockDetail = `Failed attempts: ${failureCount}`;
    if (typeof threshold === "number") {
      lockDetail += ` / ${threshold} (threshold)`;
    }
    lockDetail += `\nLast failure: ${lastFailureTime}`;
    if (bruteForce.lastIPFailure) {
      lockDetail += `\nLast failure IP: ${bruteForce.lastIPFailure}`;
    }
    if (bruteForcePolicy) {
      if (bruteForcePolicy.permanentLockout) {
        lockDetail += "\nLockout type: PERMANENT (requires admin intervention)";
      } else {
        lockDetail += `\nMax lockout wait: ${formatDuration(bruteForcePolicy.maxFailureWaitSeconds)}`;
      }
    }

    issues.push({
      severity: "critical",
      title: "Account is temporarily locked (brute force protection)",
      detail: lockDetail,
      suggestion: bruteForcePolicy?.permanentLockout
        ? "Clear the brute force lockout via Admin Console > Users > Credentials, or via Admin API: DELETE /attack-detection/brute-force/users/{userId}"
        : "The account will auto-unlock after the wait period, or an admin can clear it manually via Admin API: DELETE /attack-detection/brute-force/users/{userId}",
    });
  }

  // Email not verified
  if (user.emailVerified === false && user.email) {
    issues.push({
      severity: "warning",
      title: "Email not verified",
      detail: `Email ${user.email} has not been verified.`,
      suggestion: "If the realm requires email verification, the user cannot log in until they verify their email. Send a verification email or mark it as verified in Admin Console.",
    });
  }

  // Required actions pending
  if (user.requiredActions && user.requiredActions.length > 0) {
    issues.push({
      severity: "warning",
      title: "Required actions pending",
      detail: `The user must complete these actions: ${user.requiredActions.join(", ")}`,
      suggestion: "These actions will be prompted on next login. If they're blocking access, an admin can remove them.",
    });
  }

  // No credentials configured
  const hasPassword = credentials.some((c) => c.type === "password");
  const hasOtp = credentials.some((c) => c.type === "otp" || c.type === "totp");

  if (!hasPassword && credentials.length === 0) {
    issues.push({
      severity: "critical",
      title: "No credentials configured",
      detail: "The user has no password or any other credentials set up.",
      suggestion: "Set a temporary password in Admin Console > Users > Credentials, or send a password reset email.",
    });
  } else if (!hasPassword) {
    issues.push({
      severity: "warning",
      title: "No password configured",
      detail: `The user has ${credentials.length} credential(s) but no password. Configured types: ${credentials.map((c) => c.type).join(", ")}`,
      suggestion: "The user may only be able to log in via social/IDP login, or may need a password set.",
    });
  }

  // Analyze recent login failures
  const recentErrors = events.filter((e) => e.type === "LOGIN_ERROR");
  if (recentErrors.length > 0) {
    const errorTypes = new Map<string, number>();
    for (const evt of recentErrors) {
      const err = evt.error ?? "unknown";
      errorTypes.set(err, (errorTypes.get(err) ?? 0) + 1);
    }

    const errorSummary = Array.from(errorTypes.entries())
      .map(([err, count]) => `${err}: ${count}x`)
      .join(", ");

    const lastError = recentErrors[0];
    const lastErrorTime = new Date(lastError.time).toISOString();

    issues.push({
      severity: recentErrors.length >= 3 ? "warning" : "info",
      title: `${recentErrors.length} recent login failure(s)`,
      detail: `Error breakdown: ${errorSummary}\nMost recent failure: ${lastErrorTime}${lastError.clientId ? ` via client "${lastError.clientId}"` : ""}${lastError.ipAddress ? ` from IP ${lastError.ipAddress}` : ""}`,
      suggestion: getErrorSuggestion(recentErrors[0].error),
    });
  }

  // No recent successful logins
  const successfulLogins = events.filter((e) => e.type === "LOGIN");
  if (successfulLogins.length === 0 && events.length > 0) {
    issues.push({
      severity: "info",
      title: "No recent successful logins",
      detail: "No successful login events found in the event history. The user may have never logged in, or events may have been purged.",
    });
  }

  // No events at all
  if (events.length === 0) {
    issues.push({
      severity: "info",
      title: "No login events available",
      detail: "No login events found. Event logging may be disabled for this realm.",
      suggestion: 'Enable event logging in Admin Console > Realm Settings > Events > "Save events" toggle.',
    });
  }

  return issues;
}

/**
 * Get a contextual suggestion based on the login error type.
 */
function getErrorSuggestion(error?: string): string {
  switch (error) {
    case "invalid_user_credentials":
      return "The user is entering the wrong password. They may need a password reset.";
    case "user_not_found":
      return "The username/email does not match. Check for typos or case sensitivity in the username.";
    case "user_disabled":
      return "The account is disabled. Re-enable it in Admin Console.";
    case "user_temporarily_disabled":
      return "Brute force protection has locked the account. Clear the lockout or wait for it to expire.";
    case "invalid_client_credentials":
      return "The client secret is wrong. Check the client configuration.";
    case "expired_code":
      return "The login session or code expired. This can happen if the user takes too long or uses the back button.";
    case "invalid_redirect_uri":
      return "The redirect URI doesn't match the client's allowed redirect URIs. Check the client configuration.";
    case "consent_denied":
      return "The user denied consent. Review the client's required consent scopes.";
    default:
      return "Review the error details and check the Keycloak server logs for more context.";
  }
}

/**
 * Format a diagnostic report into a human-readable string.
 */
export function formatDiagnosticReport(report: DiagnosticReport): string {
  const { user, realm, credentials, bruteForce, recentEvents, sessions, issues } = report;
  const lines: string[] = [];

  // Header
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username;
  const emailPart = user.email ? ` (${user.email})` : "";
  lines.push(`User Diagnosis — ${displayName}${emailPart}`);
  lines.push("=".repeat(60));
  lines.push("");

  // User overview
  lines.push(`Username: ${user.username}  |  ID: ${user.id}  |  Realm: ${realm}`);
  const status = user.enabled !== false ? "ENABLED" : "DISABLED";
  const emailVerified = user.emailVerified ? "YES" : "NO";
  lines.push(`Status: ${status}  |  Email verified: ${emailVerified}`);
  if (user.createdTimestamp) {
    lines.push(`Created: ${new Date(user.createdTimestamp).toISOString()}`);
  }
  if (user.requiredActions && user.requiredActions.length > 0) {
    lines.push(`Required actions: ${user.requiredActions.join(", ")}`);
  }
  lines.push("");

  // Issues (most important section)
  const criticalIssues = issues.filter((i) => i.severity === "critical");
  const warningIssues = issues.filter((i) => i.severity === "warning");
  const infoIssues = issues.filter((i) => i.severity === "info");

  if (criticalIssues.length > 0) {
    lines.push("ISSUES FOUND");
    lines.push("-".repeat(60));
    for (const issue of criticalIssues) {
      lines.push("");
      lines.push(`[CRITICAL] ${issue.title}`);
      for (const line of issue.detail.split("\n")) {
        lines.push(`  ${line}`);
      }
      if (issue.suggestion) {
        lines.push(`  -> ${issue.suggestion}`);
      }
    }
    lines.push("");
  }

  if (warningIssues.length > 0) {
    if (criticalIssues.length === 0) {
      lines.push("WARNINGS");
      lines.push("-".repeat(60));
    }
    for (const issue of warningIssues) {
      lines.push("");
      lines.push(`[WARNING] ${issue.title}`);
      for (const line of issue.detail.split("\n")) {
        lines.push(`  ${line}`);
      }
      if (issue.suggestion) {
        lines.push(`  -> ${issue.suggestion}`);
      }
    }
    lines.push("");
  }

  if (criticalIssues.length === 0 && warningIssues.length === 0) {
    lines.push("No critical issues or warnings detected.");
    lines.push("");
  }

  // Recent login events
  lines.push("Recent Login Events");
  lines.push("-".repeat(60));
  if (recentEvents.length === 0) {
    lines.push("  No login events available (event logging may be disabled).");
  } else {
    for (const evt of recentEvents.slice(0, 15)) {
      const time = new Date(evt.time).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
      const isError = evt.type.endsWith("_ERROR");
      const icon = isError ? "FAIL" : " OK ";
      const clientPart = evt.clientId ? ` — client: ${evt.clientId}` : "";
      const ipPart = evt.ipAddress ? ` — IP: ${evt.ipAddress}` : "";
      const errorPart = evt.error ? ` — ${evt.error}` : "";
      lines.push(`  [${icon}] ${time} ${evt.type}${errorPart}${clientPart}${ipPart}`);
    }
    if (recentEvents.length > 15) {
      lines.push(`  ... and ${recentEvents.length - 15} more events`);
    }
  }
  lines.push("");

  // Credentials
  lines.push("Credentials");
  lines.push("-".repeat(60));
  if (credentials.length === 0) {
    lines.push("  No credentials configured.");
  } else {
    for (const cred of credentials) {
      const label = cred.userLabel ? ` "${cred.userLabel}"` : "";
      const created = cred.createdDate
        ? ` (created: ${new Date(cred.createdDate).toISOString().split("T")[0]})`
        : "";
      lines.push(`  ${cred.type}${label}${created}`);
    }
  }
  lines.push("");

  // Active sessions
  lines.push("Active Sessions");
  lines.push("-".repeat(60));
  if (sessions.length === 0) {
    lines.push("  No active sessions.");
  } else {
    for (const session of sessions) {
      const started = session.start
        ? new Date(session.start * 1000).toISOString()
        : "unknown";
      const lastAccess = session.lastAccess
        ? new Date(session.lastAccess * 1000).toISOString()
        : "unknown";
      const ipPart = session.ipAddress ? ` from ${session.ipAddress}` : "";
      const clientList = session.clients
        ? Object.values(session.clients).join(", ")
        : "";
      lines.push(`  Session${ipPart} — started: ${started}, last access: ${lastAccess}`);
      if (clientList) {
        lines.push(`    Clients: ${clientList}`);
      }
    }
  }
  lines.push("");

  // Brute force policy (if relevant)
  if (bruteForce || report.realmBruteForcePolicy) {
    lines.push("Brute Force Policy");
    lines.push("-".repeat(60));
    if (report.realmBruteForcePolicy) {
      const policy = report.realmBruteForcePolicy;
      lines.push(`  Enabled: ${policy.enabled}`);
      lines.push(`  Failure threshold: ${policy.failureFactor}`);
      lines.push(`  Wait increment: ${formatDuration(policy.waitIncrementSeconds)}`);
      lines.push(`  Max wait: ${formatDuration(policy.maxFailureWaitSeconds)}`);
      lines.push(`  Permanent lockout: ${policy.permanentLockout}`);
    } else {
      lines.push("  Brute force protection is not enabled for this realm.");
    }
    lines.push("");
  }

  // Password policy
  if (report.realmPasswordPolicy) {
    lines.push("Password Policy");
    lines.push("-".repeat(60));
    lines.push(`  ${report.realmPasswordPolicy}`);
    lines.push("");
  }

  // Info notes
  if (infoIssues.length > 0) {
    lines.push("Notes");
    lines.push("-".repeat(60));
    for (const issue of infoIssues) {
      lines.push(`  ${issue.title}: ${issue.detail.split("\n")[0]}`);
      if (issue.suggestion) {
        lines.push(`    -> ${issue.suggestion}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format seconds into a human-readable duration.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
