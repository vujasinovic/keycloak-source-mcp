import * as fs from "node:fs";
import * as path from "node:path";
import { getSourcePath, searchWithRg, parseJavaClass } from "../utils.js";

/**
 * Topic-to-search-terms mapping for common Keycloak features.
 */
const TOPIC_HINTS: Record<string, { classes: string[]; interfaces: string[]; spiPatterns: string[]; keywords: string[] }> = {
  "authentication flow": {
    classes: ["AuthenticationFlowResolver", "AuthenticationProcessor", "DefaultAuthenticationFlow"],
    interfaces: ["Authenticator", "AuthenticatorFactory", "AuthenticationFlowModel"],
    spiPatterns: ["AuthenticatorSpi", "AuthenticatorFactory"],
    keywords: ["authenticate", "AuthenticationFlowContext", "AuthenticationFlowError"],
  },
  "token refresh": {
    classes: ["TokenManager", "RefreshTokenHandler", "TokenEndpoint"],
    interfaces: ["OIDCLoginProtocol", "TokenIntrospectionProvider"],
    spiPatterns: ["TokenExchangeProvider", "TokenIntrospectionSpi"],
    keywords: ["refreshToken", "TokenVerifier", "AccessTokenResponse"],
  },
  "user federation": {
    classes: ["UserFederationManager", "LDAPStorageProvider", "UserStorageManager"],
    interfaces: ["UserStorageProvider", "UserStorageProviderFactory", "UserLookupProvider"],
    spiPatterns: ["UserStorageProviderSpi", "UserFederationProviderFactory"],
    keywords: ["federation", "UserStorageProvider", "importUser"],
  },
  "required action": {
    classes: ["RequiredActionContextResult", "RequiredActionProviderEntity"],
    interfaces: ["RequiredActionProvider", "RequiredActionFactory"],
    spiPatterns: ["RequiredActionSpi", "RequiredActionProviderFactory"],
    keywords: ["requiredAction", "RequiredActionContext", "evaluateTriggers"],
  },
  "event listener": {
    classes: ["EventListenerTransaction", "JBossLoggingEventListenerProvider"],
    interfaces: ["EventListenerProvider", "EventListenerProviderFactory"],
    spiPatterns: ["EventListenerSpi"],
    keywords: ["onEvent", "AdminEvent", "EventType"],
  },
  "theme": {
    classes: ["ExtendingThemeManager", "FolderTheme", "ClasspathTheme"],
    interfaces: ["Theme", "ThemeProvider", "ThemeProviderFactory"],
    spiPatterns: ["ThemeSpi", "ThemeProviderFactory"],
    keywords: ["freemarker", "template", "ThemeResource"],
  },
  "protocol mapper": {
    classes: ["AbstractOIDCProtocolMapper", "HardcodedClaim", "UserAttributeMapper"],
    interfaces: ["ProtocolMapper", "OIDCAccessTokenMapper", "SAMLAttributeStatementMapper"],
    spiPatterns: ["ProtocolMapperSpi"],
    keywords: ["transformAccessToken", "setClaim", "IDToken"],
  },
  "credential": {
    classes: ["PasswordCredentialProvider", "OTPCredentialProvider", "WebAuthnCredentialProvider"],
    interfaces: ["CredentialProvider", "CredentialProviderFactory", "CredentialValidator"],
    spiPatterns: ["CredentialSpi"],
    keywords: ["CredentialModel", "isValid", "createCredential"],
  },
  "password": {
    classes: ["PasswordCredentialProvider", "PasswordHashProvider", "Pbkdf2PasswordHashProvider"],
    interfaces: ["CredentialProvider", "PasswordHashProvider", "PasswordPolicy"],
    spiPatterns: ["CredentialSpi", "PasswordHashSpi"],
    keywords: ["password", "hash", "credential", "PasswordPolicy"],
  },
  "login": {
    classes: ["AuthenticationProcessor", "UsernamePasswordForm", "LoginFormsProvider"],
    interfaces: ["Authenticator", "FormAuthenticator", "LoginFormsProvider"],
    spiPatterns: ["AuthenticatorSpi", "LoginFormsSpi"],
    keywords: ["login", "authenticate", "LoginPage", "login.ftl"],
  },
  "session": {
    classes: ["UserSessionManager", "AuthenticationSessionManager", "InfinispanUserSessionProvider"],
    interfaces: ["UserSessionProvider", "AuthenticationSessionProvider"],
    spiPatterns: ["UserSessionSpi"],
    keywords: ["UserSessionModel", "AuthenticationSessionModel", "createUserSession"],
  },
  "client": {
    classes: ["ClientManager", "ClientModelLazyDelegate"],
    interfaces: ["ClientModel", "ClientProvider", "ClientScopeModel"],
    spiPatterns: ["ClientSpi"],
    keywords: ["ClientModel", "clientId", "redirectUri"],
  },
  "authorization": {
    classes: ["AuthorizationProvider", "PolicyEvaluator", "DefaultPolicyEvaluator"],
    interfaces: ["PolicyProvider", "PermissionEvaluator", "ResourceServer"],
    spiPatterns: ["PolicySpi", "PermissionSpi"],
    keywords: ["policy", "permission", "ResourceServer", "authorize"],
  },
};

/**
 * Deeply explain how a Keycloak feature works by orchestrating multiple
 * source code searches, reading key files, and assembling a structured analysis.
 *
 * Accepts natural language input:
 * - "Explain how ExecuteActionsActionTokenHandler works"
 * - "How does Keycloak process a password reset flow?"
 * - "What happens when a Required Action is triggered?"
 */
export async function explainImplementation(topic: string, version?: string): Promise<string> {
  if (!topic || topic.trim().length === 0) {
    return "Error: topic is required and cannot be empty.";
  }

  const sourcePath = getSourcePath(version);
  const normalizedTopic = topic.toLowerCase();

  // Detect if this is a specific class query vs a conceptual topic
  const classQuery = detectClassQuery(topic);

  if (classQuery) {
    return explainClass(classQuery, sourcePath);
  }

  return explainTopic(topic, normalizedTopic, sourcePath);
}

/**
 * Detect if the user is asking about a specific Java class.
 * Returns the class name if detected, null otherwise.
 */
function detectClassQuery(topic: string): string | null {
  // Direct PascalCase class name (e.g. "ExecuteActionsActionTokenHandler")
  if (/^[A-Z][a-zA-Z0-9]+$/.test(topic.trim())) {
    return topic.trim();
  }

  // "Explain how ClassName works" patterns
  const patterns = [
    /(?:explain|describe|how does|what is|what does)\s+(?:how\s+)?(\b[A-Z][a-zA-Z0-9]{2,}\b)/i,
    /(\b[A-Z][a-zA-Z0-9]{2,}(?:Provider|Factory|Handler|Mapper|Manager|Processor|Resolver|Context|Model|Spi|Service)\b)/,
  ];

  for (const pattern of patterns) {
    const match = topic.match(pattern);
    if (match) {
      const candidate = match[1];
      // Only treat as class if it looks like a Java class name (PascalCase, 3+ chars)
      if (/^[A-Z][a-zA-Z0-9]{2,}$/.test(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Deep analysis of a specific class: source code, hierarchy, dependencies, SPI registration.
 */
async function explainClass(className: string, sourcePath: string): Promise<string> {
  const sections: string[] = [];
  sections.push(`Deep Analysis: ${className}`);
  sections.push("=".repeat(60));

  // 1. Find the class file
  const classFile = await findClassFile(sourcePath, className);
  if (!classFile) {
    sections.push("");
    sections.push(`Could not find class "${className}" in the Keycloak source.`);
    sections.push("");
    sections.push("Searching for similar names...");
    const similar = await findSimilarClasses(sourcePath, className);
    if (similar.length > 0) {
      sections.push("");
      sections.push("Did you mean:");
      for (const s of similar) {
        sections.push(`  - ${s}`);
      }
    }
    return sections.join("\n");
  }

  const relPath = path.relative(sourcePath, classFile);
  const source = await fs.promises.readFile(classFile, "utf-8");
  const parsed = parseJavaClass(source);

  // 2. Overview section
  sections.push("");
  sections.push("Overview");
  sections.push("-".repeat(40));
  sections.push(`File: ${relPath}`);
  sections.push(`Package: ${parsed.packageName}`);
  if (parsed.extendsList.length > 0) {
    sections.push(`Extends: ${parsed.extendsList.join(", ")}`);
  }
  if (parsed.implementsList.length > 0) {
    sections.push(`Implements: ${parsed.implementsList.join(", ")}`);
  }

  // Extract class javadoc
  const classDoc = extractClassJavadoc(source);
  if (classDoc) {
    sections.push("");
    sections.push(`Description: ${classDoc}`);
  }

  // 3. Source code with method signatures
  sections.push("");
  sections.push("Methods");
  sections.push("-".repeat(40));
  if (parsed.methods.length === 0) {
    sections.push("  (no methods found)");
  } else {
    for (const method of parsed.methods) {
      const mods = method.modifiers.length > 0 ? method.modifiers.join(" ") + " " : "";
      sections.push(`  ${mods}${method.returnType} ${method.name}(${method.parameters})`);
      if (method.javadoc) {
        const firstLine = method.javadoc.split("\n")[0];
        sections.push(`    → ${firstLine}`);
      }
    }
  }

  // 4. Interface/superclass hierarchy — read parent source
  const parents = [...parsed.extendsList, ...parsed.implementsList];
  if (parents.length > 0) {
    sections.push("");
    sections.push("Interface / Superclass Hierarchy");
    sections.push("-".repeat(40));

    for (const parent of parents) {
      const parentFile = await findClassFile(sourcePath, parent);
      if (parentFile) {
        const parentRel = path.relative(sourcePath, parentFile);
        const parentSource = await fs.promises.readFile(parentFile, "utf-8");
        const parentParsed = parseJavaClass(parentSource);
        const parentDoc = extractClassJavadoc(parentSource);

        sections.push(`  ${parent} (${parentRel})`);
        if (parentDoc) {
          sections.push(`    ${parentDoc}`);
        }
        if (parentParsed.methods.length > 0) {
          sections.push(`    Methods: ${parentParsed.methods.map((m) => m.name).join(", ")}`);
        }
        if (parentParsed.extendsList.length > 0) {
          sections.push(`    Extends: ${parentParsed.extendsList.join(", ")}`);
        }
        if (parentParsed.implementsList.length > 0) {
          sections.push(`    Implements: ${parentParsed.implementsList.join(", ")}`);
        }
      } else {
        sections.push(`  ${parent} (source not found — may be external dependency)`);
      }
    }
  }

  // 5. Find implementors/subclasses of this class (if it's an interface or abstract class)
  const isInterfaceOrAbstract = source.match(/\b(interface|abstract\s+class)\s+/);
  if (isInterfaceOrAbstract) {
    const implementors = await findImplementors(sourcePath, className);
    if (implementors.length > 0) {
      sections.push("");
      sections.push("Known Implementors / Subclasses");
      sections.push("-".repeat(40));
      for (const impl of implementors.slice(0, 15)) {
        sections.push(`  ${impl}`);
      }
      if (implementors.length > 15) {
        sections.push(`  ... and ${implementors.length - 15} more`);
      }
    }
  }

  // 6. Key dependencies (Keycloak-internal imports only)
  const internalImports = parsed.imports.filter((imp) => imp.startsWith("org.keycloak."));
  if (internalImports.length > 0) {
    sections.push("");
    sections.push("Keycloak Dependencies");
    sections.push("-".repeat(40));
    for (const imp of internalImports.slice(0, 20)) {
      sections.push(`  ${imp}`);
    }
  }

  // 7. SPI registration — check if this class appears in META-INF/services
  const spiRegistrations = await findSpiRegistration(sourcePath, className, parsed.packageName);
  if (spiRegistrations.length > 0) {
    sections.push("");
    sections.push("SPI Registration");
    sections.push("-".repeat(40));
    for (const reg of spiRegistrations) {
      sections.push(`  ${reg}`);
    }
  }

  // 8. Usage in the codebase — where is this class referenced?
  const usages = await findUsages(sourcePath, className);
  if (usages.length > 0) {
    sections.push("");
    sections.push("Referenced By");
    sections.push("-".repeat(40));
    for (const usage of usages.slice(0, 10)) {
      sections.push(`  ${usage}`);
    }
    if (usages.length > 10) {
      sections.push(`  ... and ${usages.length - 10} more references`);
    }
  }

  // 9. Full source code
  sections.push("");
  sections.push("Full Source");
  sections.push("-".repeat(40));
  sections.push(source);

  return sections.join("\n");
}

/**
 * Explain a conceptual topic by orchestrating multiple searches.
 */
async function explainTopic(topic: string, normalizedTopic: string, sourcePath: string): Promise<string> {
  // Find matching topic hints
  const hints = Object.entries(TOPIC_HINTS).find(([key]) =>
    normalizedTopic.includes(key)
  )?.[1];

  const sections: string[] = [];
  sections.push(`Keycloak Implementation Analysis: "${topic}"`);
  sections.push("=".repeat(60));

  // Build search terms
  const searchTerms = hints
    ? [...hints.classes, ...hints.interfaces]
    : extractSearchTerms(topic);

  // 1. Find key classes with details
  sections.push("");
  sections.push(await findKeyClassesDeep(sourcePath, searchTerms, topic));

  // 2. Find main interfaces with method signatures
  const interfaceNames = hints?.interfaces || extractSearchTerms(topic).map((t) => `${t}Provider`).slice(0, 4);
  sections.push("");
  sections.push(await findMainInterfacesDeep(sourcePath, interfaceNames, topic));

  // 3. Find implementations with hierarchy
  if (interfaceNames.length > 0) {
    const implSection = await findImplementationsDeep(sourcePath, interfaceNames);
    if (implSection) {
      sections.push("");
      sections.push(implSection);
    }
  }

  // 4. Find SPI extension points
  sections.push("");
  sections.push(await findSpiExtensionPoints(sourcePath, hints?.spiPatterns || [], topic));

  // 5. FreeMarker templates (for UI-related topics)
  if (isUiRelatedTopic(normalizedTopic)) {
    const ftlSection = await findFreeMarkerTemplates(sourcePath, topic);
    if (ftlSection) {
      sections.push("");
      sections.push(ftlSection);
    }
  }

  if (!hints) {
    sections.push("");
    sections.push("---");
    sections.push(`Note: "${topic}" did not match a known topic pattern.`);
    sections.push("Results are based on keyword search. Try more specific terms like:");
    for (const key of Object.keys(TOPIC_HINTS)) {
      sections.push(`  - "${key}"`);
    }
  }

  return sections.join("\n");
}

function extractSearchTerms(topic: string): string[] {
  const words = topic.split(/\s+/).filter((w) => w.length > 2);
  const terms: string[] = [];
  if (words.length > 0) {
    terms.push(words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(""));
  }
  terms.push(...words.filter((w) => w.length > 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  return terms;
}

function isUiRelatedTopic(topic: string): boolean {
  const uiTerms = ["login", "theme", "form", "template", "freemarker", "ftl", "page", "ui", "registration", "password reset"];
  return uiTerms.some((term) => topic.includes(term));
}

function extractClassJavadoc(source: string): string {
  // Find the javadoc immediately before the class declaration
  const match = source.match(/\/\*\*([\s\S]*?)\*\/\s*(?:@\w+.*\n\s*)*(?:public\s+|protected\s+|private\s+)?(?:abstract\s+)?(?:final\s+)?(?:class|interface|enum|record)\s+/);
  if (!match) return "";

  const doc = match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line && !line.startsWith("@"))
    .join(" ")
    .trim();

  return doc;
}

// ── Internal helpers ──

async function findClassFile(sourcePath: string, className: string): Promise<string | null> {
  try {
    const args = ["--files", "--glob", `**/${className}.java`];
    const result = await searchWithRg(args, sourcePath);
    if (!result.trim()) return null;
    const file = result.trim().split("\n")[0];
    return file.startsWith("/") ? file : path.join(sourcePath, file);
  } catch {
    return null;
  }
}

async function findSimilarClasses(sourcePath: string, className: string): Promise<string[]> {
  const results: string[] = [];
  try {
    // Search for classes with similar names
    const args = [
      "-n", "--type", "java", "-m", "10",
      `-i`, `(class|interface)\\s+\\w*${className.substring(0, Math.min(className.length, 8))}\\w*`,
    ];
    const result = await searchWithRg(args, sourcePath);
    if (result.trim()) {
      const lines = result.trim().split("\n");
      for (const line of lines) {
        const relLine = line.startsWith(sourcePath) ? line.substring(sourcePath.length + 1) : line;
        results.push(relLine);
      }
    }
  } catch {
    // no results
  }
  return results;
}

async function findImplementors(sourcePath: string, interfaceName: string): Promise<string[]> {
  const results: string[] = [];
  for (const keyword of ["implements", "extends"]) {
    try {
      const args = ["-n", "--type", "java", `-m`, "20", `${keyword}\\s+.*\\b${interfaceName}\\b`];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        for (const line of result.trim().split("\n")) {
          const relLine = line.startsWith(sourcePath) ? line.substring(sourcePath.length + 1) : line;
          if (!results.some((r) => r.split(":")[0] === relLine.split(":")[0])) {
            results.push(relLine);
          }
        }
      }
    } catch {
      // continue
    }
  }
  return results;
}

async function findUsages(sourcePath: string, className: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const args = ["-l", "--type", "java", `\\b${className}\\b`];
    const result = await searchWithRg(args, sourcePath);
    if (result.trim()) {
      for (const line of result.trim().split("\n")) {
        const relLine = line.startsWith(sourcePath) ? line.substring(sourcePath.length + 1) : line;
        // Exclude the class's own file
        if (!relLine.endsWith(`${className}.java`)) {
          results.push(relLine);
        }
      }
    }
  } catch {
    // no results
  }
  return results;
}

async function findSpiRegistration(sourcePath: string, className: string, packageName: string): Promise<string[]> {
  const fqn = packageName ? `${packageName}.${className}` : className;
  const results: string[] = [];
  try {
    const args = ["--files", "--glob", "**/META-INF/services/*"];
    const filesResult = await searchWithRg(args, sourcePath);
    if (filesResult.trim()) {
      for (const file of filesResult.trim().split("\n")) {
        const fullPath = file.startsWith("/") ? file : path.join(sourcePath, file);
        try {
          const content = await fs.promises.readFile(fullPath, "utf-8");
          if (content.includes(className) || content.includes(fqn)) {
            const spiInterface = path.basename(fullPath);
            const relFile = file.startsWith(sourcePath) ? file.substring(sourcePath.length + 1) : file;
            results.push(`Registered as provider for SPI: ${spiInterface} (${relFile})`);
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    // no results
  }
  return results;
}

async function findKeyClassesDeep(sourcePath: string, searchTerms: string[], topic: string): Promise<string> {
  let section = "Key Classes\n" + "-".repeat(40) + "\n";
  const found: Array<{ relPath: string; className: string; doc: string; methods: string[] }> = [];

  for (const term of searchTerms.slice(0, 8)) {
    try {
      const args = ["--files", "--glob", `**/${term}.java`];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        for (const file of result.trim().split("\n").slice(0, 3)) {
          const fullPath = file.startsWith("/") ? file : path.join(sourcePath, file);
          const relPath = file.startsWith(sourcePath) ? file.substring(sourcePath.length + 1) : file;

          // Don't add duplicates
          if (found.some((f) => f.relPath === relPath)) continue;

          try {
            const source = await fs.promises.readFile(fullPath, "utf-8");
            const parsed = parseJavaClass(source);
            const doc = extractClassJavadoc(source);
            found.push({
              relPath,
              className: parsed.className || term,
              doc,
              methods: parsed.methods.map((m) => m.name),
            });
          } catch {
            found.push({ relPath, className: term, doc: "", methods: [] });
          }
        }
      }
    } catch {
      // continue
    }
  }

  // Also do a broader keyword search if we don't have enough
  if (found.length < 3) {
    const topicWords = topic.split(/\s+/).filter((w) => w.length > 3);
    if (topicWords.length > 0) {
      const pattern = topicWords.join(".*");
      try {
        const args = ["-n", "--type", "java", "-m", "5", `-i`, `(class|interface)\\s+\\w*${pattern}\\w*`];
        const result = await searchWithRg(args, sourcePath);
        if (result.trim()) {
          for (const line of result.trim().split("\n")) {
            const relLine = line.startsWith(sourcePath) ? line.substring(sourcePath.length + 1) : line;
            const filePart = relLine.split(":")[0];
            if (!found.some((f) => f.relPath === filePart)) {
              found.push({ relPath: relLine, className: "", doc: "", methods: [] });
            }
          }
        }
      } catch {
        // continue
      }
    }
  }

  if (found.length === 0) {
    section += "  No key classes found for this topic.";
  } else {
    for (const item of found) {
      section += `\n  ${item.className || item.relPath}`;
      section += `\n    File: ${item.relPath}`;
      if (item.doc) {
        section += `\n    ${item.doc}`;
      }
      if (item.methods.length > 0) {
        section += `\n    Key methods: ${item.methods.slice(0, 8).join(", ")}`;
      }
    }
  }
  return section;
}

async function findMainInterfacesDeep(sourcePath: string, interfaces: string[], topic: string): Promise<string> {
  let section = "Main Interfaces\n" + "-".repeat(40) + "\n";
  const found: Array<{ name: string; relPath: string; doc: string; methods: string[]; hierarchy: string }> = [];

  const searchList = interfaces.length > 0
    ? interfaces
    : extractSearchTerms(topic).map((t) => `${t}Provider`).slice(0, 4);

  for (const iface of searchList) {
    const classFile = await findClassFile(sourcePath, iface);
    if (!classFile) {
      // Try content search as fallback
      try {
        const args = ["-n", "--type", "java", "-m", "2", `public\\s+interface\\s+${iface}`];
        const result = await searchWithRg(args, sourcePath);
        if (result.trim()) {
          const relLine = result.trim().split("\n")[0];
          const relPath = relLine.startsWith(sourcePath) ? relLine.substring(sourcePath.length + 1) : relLine;
          found.push({ name: iface, relPath, doc: "", methods: [], hierarchy: "" });
        }
      } catch {
        // continue
      }
      continue;
    }

    const relPath = path.relative(sourcePath, classFile);
    try {
      const source = await fs.promises.readFile(classFile, "utf-8");
      const parsed = parseJavaClass(source);
      const doc = extractClassJavadoc(source);

      let hierarchy = "";
      if (parsed.extendsList.length > 0) {
        hierarchy = `extends ${parsed.extendsList.join(", ")}`;
      }

      found.push({
        name: parsed.className || iface,
        relPath,
        doc,
        methods: parsed.methods.map((m) => {
          const sig = `${m.returnType} ${m.name}(${m.parameters})`;
          return m.javadoc ? `${sig} — ${m.javadoc.split("\n")[0]}` : sig;
        }),
        hierarchy,
      });
    } catch {
      found.push({ name: iface, relPath, doc: "", methods: [], hierarchy: "" });
    }
  }

  if (found.length === 0) {
    section += "  No main interfaces found for this topic.";
  } else {
    for (const item of found) {
      section += `\n  ${item.name}`;
      section += `\n    File: ${item.relPath}`;
      if (item.hierarchy) {
        section += `\n    ${item.hierarchy}`;
      }
      if (item.doc) {
        section += `\n    ${item.doc}`;
      }
      if (item.methods.length > 0) {
        section += "\n    Methods:";
        for (const m of item.methods) {
          section += `\n      - ${m}`;
        }
      }
    }
  }
  return section;
}

async function findImplementationsDeep(sourcePath: string, interfaces: string[]): Promise<string | null> {
  let section = "Default Implementations\n" + "-".repeat(40) + "\n";
  const found: Array<{ className: string; relPath: string; implementsInterface: string; doc: string }> = [];

  for (const iface of interfaces.slice(0, 4)) {
    try {
      const args = ["-n", "--type", "java", "-m", "10", `implements\\s+.*\\b${iface}\\b`];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        for (const line of result.trim().split("\n")) {
          const relLine = line.startsWith(sourcePath) ? line.substring(sourcePath.length + 1) : line;
          const filePart = relLine.split(":")[0];

          // Skip if we already have this file
          if (found.some((f) => f.relPath === filePart)) continue;

          // Try to read the file for more detail
          const fullPath = filePart.startsWith("/") ? filePart : path.join(sourcePath, filePart);
          try {
            const source = await fs.promises.readFile(fullPath, "utf-8");
            const parsed = parseJavaClass(source);
            const doc = extractClassJavadoc(source);
            found.push({
              className: parsed.className || path.basename(filePart, ".java"),
              relPath: filePart,
              implementsInterface: iface,
              doc,
            });
          } catch {
            found.push({
              className: path.basename(filePart, ".java"),
              relPath: filePart,
              implementsInterface: iface,
              doc: "",
            });
          }
        }
      }
    } catch {
      // continue
    }
  }

  if (found.length === 0) return null;

  for (const item of found) {
    section += `\n  ${item.className} implements ${item.implementsInterface}`;
    section += `\n    File: ${item.relPath}`;
    if (item.doc) {
      section += `\n    ${item.doc}`;
    }
  }

  return section;
}

async function findSpiExtensionPoints(sourcePath: string, spiPatterns: string[], topic: string): Promise<string> {
  let section = "SPI Extension Points\n" + "-".repeat(40) + "\n";
  const found: string[] = [];

  const patterns = spiPatterns.length > 0
    ? spiPatterns
    : extractSearchTerms(topic).map((t) => `${t}Spi`).slice(0, 4);

  for (const pattern of patterns) {
    try {
      const args = ["-n", "--type", "java", "-m", "3", `class\\s+${pattern}`];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        for (const line of result.trim().split("\n")) {
          const relLine = line.startsWith(sourcePath) ? line.substring(sourcePath.length + 1) : line;
          found.push(`  ${relLine}`);
        }
      }
    } catch {
      // continue
    }
  }

  // Also check META-INF/services
  const topicTerms = topic.split(/\s+/).filter((w) => w.length > 3);
  if (topicTerms.length > 0) {
    try {
      const filesArgs = ["--files", "--glob", "**/META-INF/services/*"];
      const filesResult = await searchWithRg(filesArgs, sourcePath);
      if (filesResult.trim()) {
        for (const file of filesResult.trim().split("\n")) {
          const basename = file.split("/").pop() || "";
          if (topicTerms.some((t) => basename.toLowerCase().includes(t.toLowerCase()))) {
            const relFile = file.startsWith(sourcePath) ? file.substring(sourcePath.length + 1) : file;
            // Read the file to list implementations
            const fullPath = file.startsWith("/") ? file : path.join(sourcePath, file);
            try {
              const content = await fs.promises.readFile(fullPath, "utf-8");
              const impls = content.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
              let entry = `  META-INF service: ${basename}`;
              entry += `\n    File: ${relFile}`;
              if (impls.length > 0) {
                entry += `\n    Registered providers:`;
                for (const impl of impls) {
                  entry += `\n      - ${impl}`;
                }
              }
              found.push(entry);
            } catch {
              found.push(`  META-INF service: ${relFile}`);
            }
          }
        }
      }
    } catch {
      // continue
    }
  }

  if (found.length === 0) {
    section += "  No SPI extension points found for this topic.";
  } else {
    section += found.join("\n");
  }
  return section;
}

async function findFreeMarkerTemplates(sourcePath: string, topic: string): Promise<string | null> {
  const topicTerms = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (topicTerms.length === 0) return null;

  const found: string[] = [];

  // Search for .ftl files related to the topic
  try {
    const args = ["--files", "--glob", "**/*.ftl"];
    const result = await searchWithRg(args, sourcePath);
    if (result.trim()) {
      for (const file of result.trim().split("\n")) {
        const basename = (file.split("/").pop() || "").toLowerCase();
        if (topicTerms.some((t) => basename.includes(t))) {
          const relFile = file.startsWith(sourcePath) ? file.substring(sourcePath.length + 1) : file;
          found.push(relFile);
        }
      }
    }
  } catch {
    // no results
  }

  if (found.length === 0) return null;

  let section = "FreeMarker Templates\n" + "-".repeat(40) + "\n";
  for (const f of found.slice(0, 10)) {
    section += `  ${f}\n`;
  }
  if (found.length > 10) {
    section += `  ... and ${found.length - 10} more templates`;
  }
  return section;
}
