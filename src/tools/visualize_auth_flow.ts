import * as fs from "node:fs";
import { getSourcePath, searchWithRg, validateMermaid } from "../utils.js";

interface FlowExecution {
  authenticator?: string;
  authenticatorFlow?: boolean;
  requirement?: string;
  flowAlias?: string;
  priority?: number;
  autheticatorFlow?: boolean; // KC sometimes uses this typo
}

interface AuthFlow {
  id?: string;
  alias: string;
  builtIn?: boolean;
  topLevel?: boolean;
  authenticationExecutions?: FlowExecution[];
}

interface RealmExport {
  realm?: string;
  authenticationFlows?: AuthFlow[];
}

/**
 * Known authenticator display names mapped from provider IDs.
 */
const AUTHENTICATOR_LABELS: Record<string, string> = {
  "auth-cookie": "Cookie SSO",
  "auth-spnego": "Kerberos/SPNEGO",
  "identity-provider-redirector": "Identity Provider Redirector",
  "auth-username-password-form": "Username/Password Form",
  "auth-otp-form": "OTP Verification",
  "auth-conditional-otp": "Conditional OTP",
  "direct-grant-validate-username": "Validate Username",
  "direct-grant-validate-password": "Validate Password",
  "direct-grant-validate-otp": "Validate OTP",
  "registration-page-form": "Registration Page",
  "registration-user-creation": "User Creation",
  "registration-password-action": "Password Validation",
  "registration-profile-action": "Profile Validation",
  "registration-recaptcha-action": "reCAPTCHA",
  "reset-credentials-choose-user": "Choose User",
  "reset-credential-email": "Send Reset Email",
  "reset-password": "Reset Password",
  "reset-otp": "Reset OTP",
  "conditional-user-configured": "User Configured?",
  "conditional-user-role": "User Has Role?",
  "webauthn-authenticator": "WebAuthn",
  "webauthn-authenticator-passwordless": "WebAuthn Passwordless",
};

/**
 * Visualize a Keycloak authentication flow as a Mermaid diagram.
 */
export async function visualizeAuthFlow(
  source: "realm_export" | "description",
  realmExportPath?: string,
  flowName?: string,
  description?: string
): Promise<string> {
  if (source === "realm_export") {
    if (!realmExportPath || !realmExportPath.trim()) {
      return "Error: realmExportPath is required when source is 'realm_export'.";
    }
    return await visualizeFromExport(realmExportPath, flowName);
  } else if (source === "description") {
    if (!description || !description.trim()) {
      return "Error: description is required when source is 'description'.";
    }
    return await visualizeFromDescription(description);
  }

  return "Error: source must be 'realm_export' or 'description'.";
}

async function visualizeFromExport(exportPath: string, flowName?: string): Promise<string> {
  if (!fs.existsSync(exportPath)) {
    return `Error: Realm export file not found: ${exportPath}`;
  }

  let realmData: RealmExport;
  try {
    let raw = await fs.promises.readFile(exportPath, "utf-8");
    // Handle Keycloak realm templates with $(env:...) placeholders
    // Replace bare (unquoted) placeholders with quoted placeholder strings
    raw = raw.replace(/(?<!")(\$\(env:[^)]+\))(?!")/g, '"$1"');
    realmData = JSON.parse(raw) as RealmExport;
  } catch (error) {
    return `Error: Failed to parse realm export JSON: ${error instanceof Error ? error.message : String(error)}`;
  }

  if (!realmData.authenticationFlows || realmData.authenticationFlows.length === 0) {
    return "No authentication flows found in the realm export.";
  }

  const targetFlowName = flowName || "browser";
  const flow = realmData.authenticationFlows.find(
    (f) => f.alias.toLowerCase() === targetFlowName.toLowerCase()
  );

  if (!flow) {
    const available = realmData.authenticationFlows.map((f) => f.alias).join(", ");
    return `Flow "${targetFlowName}" not found. Available flows: ${available}`;
  }

  const flowMap = new Map<string, AuthFlow>();
  for (const f of realmData.authenticationFlows) {
    flowMap.set(f.alias, f);
  }

  const mermaidLines = generateMermaidFromFlow(flow, flowMap);
  const mermaid = mermaidLines.join("\n");
  const validation = validateMermaid(mermaid);

  const lines: string[] = [];
  lines.push(`Authentication Flow: "${flow.alias}"${realmData.realm ? ` (Realm: ${realmData.realm})` : ""}`);
  lines.push("=".repeat(60));
  lines.push("");
  lines.push("```mermaid");
  lines.push(mermaid);
  lines.push("```");

  if (!validation.valid) {
    lines.push("");
    lines.push(`Note: ${validation.warning}`);
  }

  // Add legend
  lines.push("");
  lines.push("Legend:");
  lines.push("  [[ ]] = Sub-flow | (( )) = Conditional");
  lines.push("  REQUIRED = must pass | ALTERNATIVE = any one can pass | CONDITIONAL = evaluated if condition met | DISABLED = skipped");

  return lines.join("\n");
}

function generateMermaidFromFlow(
  flow: AuthFlow,
  flowMap: Map<string, AuthFlow>
): string[] {
  const lines: string[] = [];
  let nodeCounter = 0;

  function nextId(): string {
    return `N${nodeCounter++}`;
  }

  lines.push("flowchart TD");

  const startId = nextId();
  lines.push(`  ${startId}([Start: ${sanitize(flow.alias)}])`);

  const executions = flow.authenticationExecutions || [];
  if (executions.length === 0) {
    const emptyId = nextId();
    lines.push(`  ${startId} --> ${emptyId}[No executions defined]`);
    return lines;
  }

  // Group executions by requirement
  const alternatives: Array<{ id: string; label: string }> = [];
  let prevId = startId;

  for (const exec of executions) {
    const requirement = exec.requirement || "REQUIRED";
    if (requirement === "DISABLED") continue;

    const isSubFlow = exec.authenticatorFlow || exec.autheticatorFlow;
    const label = getExecutionLabel(exec);
    const nodeId = nextId();

    if (isSubFlow && exec.flowAlias) {
      // Render sub-flow as a subgraph
      const subFlow = flowMap.get(exec.flowAlias);
      if (subFlow) {
        const subStartId = nodeId;
        lines.push(`  subgraph ${nodeId}_sub["${sanitize(exec.flowAlias)}"]`);

        const subExecutions = subFlow.authenticationExecutions || [];
        let subPrevId = "";

        for (const subExec of subExecutions) {
          const subReq = subExec.requirement || "REQUIRED";
          if (subReq === "DISABLED") continue;

          const subNodeId = nextId();
          const subLabel = getExecutionLabel(subExec);

          if (subReq === "CONDITIONAL") {
            lines.push(`    ${subNodeId}((${sanitize(subLabel)}))`);
          } else {
            lines.push(`    ${subNodeId}[${sanitize(subLabel)}]`);
          }

          if (subPrevId) {
            lines.push(`    ${subPrevId} -->|${subReq}| ${subNodeId}`);
          }
          subPrevId = subNodeId;
        }

        if (!subPrevId) {
          const emptySubId = nextId();
          lines.push(`    ${emptySubId}[Empty sub-flow]`);
        }

        lines.push("  end");

        if (requirement === "ALTERNATIVE") {
          alternatives.push({ id: `${nodeId}_sub`, label: exec.flowAlias });
        } else {
          lines.push(`  ${prevId} -->|${requirement}| ${nodeId}_sub`);
          prevId = `${nodeId}_sub`;
        }
        continue;
      }
    }

    // Regular execution node
    if (requirement === "CONDITIONAL") {
      lines.push(`  ${nodeId}((${sanitize(label)}))`);
    } else {
      lines.push(`  ${nodeId}[${sanitize(label)}]`);
    }

    if (requirement === "ALTERNATIVE") {
      alternatives.push({ id: nodeId, label });
    } else {
      lines.push(`  ${prevId} -->|${requirement}| ${nodeId}`);
      prevId = nodeId;
    }
  }

  // Connect alternatives with branching
  if (alternatives.length > 0) {
    const decisionId = nextId();
    lines.push(`  ${prevId} --> ${decisionId}{Alternatives}`);
    for (const alt of alternatives) {
      lines.push(`  ${decisionId} -->|ALTERNATIVE| ${alt.id}`);
    }
    // All alternatives converge
    const mergeId = nextId();
    lines.push(`  ${mergeId}([Continue])`);
    for (const alt of alternatives) {
      lines.push(`  ${alt.id} --> ${mergeId}`);
    }
    prevId = mergeId;
  }

  const endId = nextId();
  lines.push(`  ${prevId} --> ${endId}([End])`);

  return lines;
}

function getExecutionLabel(exec: FlowExecution): string {
  if (exec.authenticator) {
    return AUTHENTICATOR_LABELS[exec.authenticator] || exec.authenticator;
  }
  if (exec.flowAlias) {
    return exec.flowAlias;
  }
  return "Unknown Step";
}

function sanitize(text: string): string {
  return text.replace(/"/g, "'").replace(/[[\]{}()]/g, "");
}

async function visualizeFromDescription(description: string): Promise<string> {
  const sourcePath = getSourcePath();

  // Parse description for authenticator keywords
  const steps = parseDescriptionSteps(description);

  // Try to resolve step names to real Keycloak authenticator IDs
  const resolvedSteps: Array<{ label: string; requirement: string; isConditional: boolean }> = [];

  for (const step of steps) {
    const resolved = await resolveAuthenticator(step.keyword, sourcePath);
    resolvedSteps.push({
      label: resolved || step.keyword,
      requirement: step.requirement,
      isConditional: step.isConditional,
    });
  }

  // Generate Mermaid
  const mermaidLines: string[] = [];
  mermaidLines.push("flowchart TD");

  let prevId = "start";
  mermaidLines.push(`  start([Start])`);

  const alternatives: Array<{ id: string; label: string }> = [];

  for (let i = 0; i < resolvedSteps.length; i++) {
    const step = resolvedSteps[i];
    const nodeId = `step${i}`;

    if (step.isConditional) {
      mermaidLines.push(`  ${nodeId}((${sanitize(step.label)}))`);
    } else {
      mermaidLines.push(`  ${nodeId}[${sanitize(step.label)}]`);
    }

    if (step.requirement === "ALTERNATIVE") {
      alternatives.push({ id: nodeId, label: step.label });
    } else {
      mermaidLines.push(`  ${prevId} -->|${step.requirement}| ${nodeId}`);
      prevId = nodeId;
    }
  }

  if (alternatives.length > 0) {
    const decisionId = "alt_decision";
    mermaidLines.push(`  ${prevId} --> ${decisionId}{Alternatives}`);
    for (const alt of alternatives) {
      mermaidLines.push(`  ${decisionId} -->|ALTERNATIVE| ${alt.id}`);
    }
    const mergeId = "alt_merge";
    mermaidLines.push(`  ${mergeId}([Continue])`);
    for (const alt of alternatives) {
      mermaidLines.push(`  ${alt.id} --> ${mergeId}`);
    }
    prevId = mergeId;
  }

  mermaidLines.push(`  ${prevId} --> finish([End])`);

  const mermaid = mermaidLines.join("\n");
  const validation = validateMermaid(mermaid);

  const lines: string[] = [];
  lines.push(`Authentication Flow (from description)`);
  lines.push("=".repeat(60));
  lines.push(`Description: ${description}`);
  lines.push("");
  lines.push("```mermaid");
  lines.push(mermaid);
  lines.push("```");

  if (!validation.valid) {
    lines.push("");
    lines.push(`Note: ${validation.warning}`);
  }

  if (resolvedSteps.length === 0) {
    lines.push("");
    lines.push("Could not extract flow steps from the description. Try a more structured description, e.g.:");
    lines.push('  "First username/password form (required), then OTP verification (conditional), or WebAuthn (alternative)"');
  }

  return lines.join("\n");
}

interface DescriptionStep {
  keyword: string;
  requirement: string;
  isConditional: boolean;
}

function parseDescriptionSteps(description: string): DescriptionStep[] {
  const steps: DescriptionStep[] = [];

  // Split on common delimiters
  const parts = description.split(/(?:,\s*|\s+then\s+|\s+followed by\s+|\s+and then\s+|\s+next\s+|\.\s+)/i);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || trimmed.length < 3) continue;

    let requirement = "REQUIRED";
    let isConditional = false;

    const lowerPart = trimmed.toLowerCase();

    if (lowerPart.includes("alternative") || lowerPart.includes("or ")) {
      requirement = "ALTERNATIVE";
    } else if (lowerPart.includes("conditional") || lowerPart.includes("if ")) {
      requirement = "CONDITIONAL";
      isConditional = true;
    } else if (lowerPart.includes("optional")) {
      requirement = "ALTERNATIVE";
    } else if (lowerPart.includes("required")) {
      requirement = "REQUIRED";
    }

    // Clean up the keyword
    const keyword = trimmed
      .replace(/\s*\((?:required|alternative|conditional|optional|disabled)\)\s*/gi, "")
      .replace(/^(?:first|then|next|finally|after that)\s+/i, "")
      .trim();

    if (keyword.length > 2) {
      steps.push({ keyword, requirement, isConditional });
    }
  }

  return steps;
}

async function resolveAuthenticator(keyword: string, sourcePath: string): Promise<string | null> {
  const lowerKeyword = keyword.toLowerCase();

  // Check known labels first
  for (const [id, label] of Object.entries(AUTHENTICATOR_LABELS)) {
    if (label.toLowerCase().includes(lowerKeyword) || lowerKeyword.includes(label.toLowerCase())) {
      return label;
    }
    if (lowerKeyword.includes(id)) {
      return label;
    }
  }

  // Common keyword mapping
  const keywordMap: Record<string, string> = {
    "password": "Username/Password Form",
    "username": "Username/Password Form",
    "login form": "Username/Password Form",
    "otp": "OTP Verification",
    "totp": "OTP Verification",
    "2fa": "OTP Verification",
    "two factor": "OTP Verification",
    "webauthn": "WebAuthn",
    "fido": "WebAuthn",
    "passkey": "WebAuthn Passwordless",
    "cookie": "Cookie SSO",
    "sso": "Cookie SSO",
    "kerberos": "Kerberos/SPNEGO",
    "spnego": "Kerberos/SPNEGO",
    "idp": "Identity Provider Redirector",
    "identity provider": "Identity Provider Redirector",
    "social": "Identity Provider Redirector",
    "recaptcha": "reCAPTCHA",
    "captcha": "reCAPTCHA",
    "email": "Send Reset Email",
    "sms": "SMS Verification",
    "magic link": "Magic Link",
  };

  for (const [key, label] of Object.entries(keywordMap)) {
    if (lowerKeyword.includes(key)) {
      return label;
    }
  }

  // Try searching Keycloak source for a matching authenticator factory
  try {
    const searchTerm = keyword.replace(/\s+/g, ".*");
    const args = [
      "-l", "--type", "java", "-i",
      `class.*${searchTerm}.*(?:Authenticator|Factory)`,
    ];
    const result = await searchWithRg(args, sourcePath);
    if (result.trim()) {
      const file = result.trim().split("\n")[0];
      const className = file.split("/").pop()?.replace(".java", "") || "";
      if (className) return className;
    }
  } catch {
    // ignore
  }

  return null;
}
