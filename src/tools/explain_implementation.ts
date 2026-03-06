import { getSourcePath, searchWithRg } from "../utils.js";

/**
 * Topic-to-search-terms mapping for common Keycloak features.
 */
const TOPIC_HINTS: Record<string, { classes: string[]; interfaces: string[]; spiPatterns: string[] }> = {
  "authentication flow": {
    classes: ["AuthenticationFlowResolver", "AuthenticationProcessor", "DefaultAuthenticationFlow"],
    interfaces: ["Authenticator", "AuthenticatorFactory", "AuthenticationFlowModel"],
    spiPatterns: ["AuthenticatorSpi", "AuthenticatorFactory"],
  },
  "token refresh": {
    classes: ["TokenManager", "RefreshTokenHandler", "TokenEndpoint"],
    interfaces: ["OIDCLoginProtocol", "TokenIntrospectionProvider"],
    spiPatterns: ["TokenExchangeProvider", "TokenIntrospectionSpi"],
  },
  "user federation": {
    classes: ["UserFederationManager", "LDAPStorageProvider", "UserStorageManager"],
    interfaces: ["UserStorageProvider", "UserStorageProviderFactory", "UserLookupProvider"],
    spiPatterns: ["UserStorageProviderSpi", "UserFederationProviderFactory"],
  },
  "required action": {
    classes: ["RequiredActionContextResult", "RequiredActionProviderEntity"],
    interfaces: ["RequiredActionProvider", "RequiredActionFactory"],
    spiPatterns: ["RequiredActionSpi", "RequiredActionProviderFactory"],
  },
  "event listener": {
    classes: ["EventListenerTransaction", "JBossLoggingEventListenerProvider"],
    interfaces: ["EventListenerProvider", "EventListenerProviderFactory"],
    spiPatterns: ["EventListenerSpi"],
  },
  "theme": {
    classes: ["ExtendingThemeManager", "FolderTheme", "ClasspathTheme"],
    interfaces: ["Theme", "ThemeProvider", "ThemeProviderFactory"],
    spiPatterns: ["ThemeSpi", "ThemeProviderFactory"],
  },
  "protocol mapper": {
    classes: ["AbstractOIDCProtocolMapper", "HardcodedClaim", "UserAttributeMapper"],
    interfaces: ["ProtocolMapper", "OIDCAccessTokenMapper", "SAMLAttributeStatementMapper"],
    spiPatterns: ["ProtocolMapperSpi"],
  },
  "credential": {
    classes: ["PasswordCredentialProvider", "OTPCredentialProvider", "WebAuthnCredentialProvider"],
    interfaces: ["CredentialProvider", "CredentialProviderFactory", "CredentialValidator"],
    spiPatterns: ["CredentialSpi"],
  },
};

/**
 * Explain how a specific Keycloak feature or mechanism works by finding
 * and analyzing the relevant source files.
 */
export async function explainImplementation(topic: string): Promise<string> {
  if (!topic || topic.trim().length === 0) {
    return "Error: topic is required and cannot be empty.";
  }

  const sourcePath = getSourcePath();
  const normalizedTopic = topic.toLowerCase();

  // Find matching topic hints
  let hints = Object.entries(TOPIC_HINTS).find(([key]) =>
    normalizedTopic.includes(key)
  )?.[1];

  // Build dynamic search terms if no predefined hints match
  const searchTerms = hints
    ? [...hints.classes, ...hints.interfaces]
    : extractSearchTerms(topic);

  const sections: string[] = [];

  // 1. Find key classes
  sections.push(await findKeyClasses(sourcePath, searchTerms, topic));

  // 2. Find main interfaces
  sections.push(await findMainInterfaces(sourcePath, hints?.interfaces || [], topic));

  // 3. Find implementations
  if (hints?.interfaces.length) {
    sections.push(await findImplementations(sourcePath, hints.interfaces));
  }

  // 4. Find SPI extension points
  sections.push(await findSpiExtensionPoints(sourcePath, hints?.spiPatterns || [], topic));

  let output = `Keycloak Implementation Analysis: "${topic}"\n`;
  output += "=".repeat(60) + "\n\n";
  output += sections.join("\n\n");

  if (!hints) {
    output += `\n\n---\nNote: "${topic}" did not match a known topic pattern. `;
    output += "Results are based on keyword search. Try more specific terms like:\n";
    output += Object.keys(TOPIC_HINTS).map((k) => `  - "${k}"`).join("\n");
  }

  return output;
}

function extractSearchTerms(topic: string): string[] {
  // Convert topic to PascalCase search terms
  const words = topic.split(/\s+/).filter((w) => w.length > 2);
  const terms: string[] = [];
  if (words.length > 0) {
    terms.push(words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(""));
  }
  terms.push(...words.filter((w) => w.length > 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  return terms;
}

async function findKeyClasses(sourcePath: string, searchTerms: string[], topic: string): Promise<string> {
  let section = "Key Classes\n" + "-".repeat(40) + "\n";
  const found: string[] = [];

  for (const term of searchTerms.slice(0, 8)) {
    try {
      const args = [
        "-n", "--type", "java", "-m", "3",
        `(class|interface|enum)\\s+${term}`,
      ];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        const lines = result.trim().split("\n");
        for (const line of lines) {
          const relLine = line.startsWith(sourcePath) ? line.substring(sourcePath.length + 1) : line;
          found.push(`  ${relLine}`);
        }
      }
    } catch {
      // continue
    }
  }

  // Also do a broader keyword search
  const topicWords = topic.split(/\s+/).filter((w) => w.length > 3);
  if (topicWords.length > 0 && found.length < 5) {
    const pattern = topicWords.join(".*");
    try {
      const args = [
        "-n", "--type", "java", "-m", "5",
        `-i`, `(class|interface)\\s+\\w*${pattern}\\w*`,
      ];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        const lines = result.trim().split("\n");
        for (const line of lines) {
          const relLine = line.startsWith(sourcePath) ? line.substring(sourcePath.length + 1) : line;
          if (!found.some((f) => f.includes(relLine.split(":")[0]))) {
            found.push(`  ${relLine}`);
          }
        }
      }
    } catch {
      // continue
    }
  }

  if (found.length === 0) {
    section += "  No key classes found for this topic.";
  } else {
    section += found.join("\n");
  }
  return section;
}

async function findMainInterfaces(sourcePath: string, interfaces: string[], topic: string): Promise<string> {
  let section = "Main Interfaces\n" + "-".repeat(40) + "\n";
  const found: string[] = [];

  const searchList = interfaces.length > 0
    ? interfaces
    : extractSearchTerms(topic).map((t) => `${t}Provider`).slice(0, 4);

  for (const iface of searchList) {
    try {
      const args = [
        "-n", "--type", "java", "-m", "2",
        `public\\s+interface\\s+${iface}`,
      ];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        const lines = result.trim().split("\n");
        for (const line of lines) {
          const relLine = line.startsWith(sourcePath) ? line.substring(sourcePath.length + 1) : line;
          found.push(`  ${relLine}`);
        }
      }
    } catch {
      // continue
    }
  }

  if (found.length === 0) {
    section += "  No main interfaces found for this topic.";
  } else {
    section += found.join("\n");
  }
  return section;
}

async function findImplementations(sourcePath: string, interfaces: string[]): Promise<string> {
  let section = "Default Implementations\n" + "-".repeat(40) + "\n";
  const found: string[] = [];

  for (const iface of interfaces.slice(0, 4)) {
    try {
      const args = [
        "-n", "--type", "java", "-m", "5",
        `implements\\s+.*\\b${iface}\\b`,
      ];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        const lines = result.trim().split("\n");
        for (const line of lines) {
          const relLine = line.startsWith(sourcePath) ? line.substring(sourcePath.length + 1) : line;
          found.push(`  ${relLine}`);
        }
      }
    } catch {
      // continue
    }
  }

  if (found.length === 0) {
    section += "  No implementations found.";
  } else {
    section += found.join("\n");
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
      const args = [
        "-n", "--type", "java", "-m", "3",
        `class\\s+${pattern}`,
      ];
      const result = await searchWithRg(args, sourcePath);
      if (result.trim()) {
        const lines = result.trim().split("\n");
        for (const line of lines) {
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
      const filesArgs = [
        "--files",
        "--glob", "**/META-INF/services/*",
      ];
      const filesResult = await searchWithRg(filesArgs, sourcePath);
      if (filesResult.trim()) {
        const files = filesResult.trim().split("\n");
        for (const file of files) {
          const basename = file.split("/").pop() || "";
          if (topicTerms.some((t) => basename.toLowerCase().includes(t.toLowerCase()))) {
            const relFile = file.startsWith(sourcePath) ? file.substring(sourcePath.length + 1) : file;
            found.push(`  META-INF service: ${relFile}`);
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
