import { getSourcePath, searchWithRg, parseJavaClass } from "../utils.js";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * SPI type to interface/factory name mapping for common Keycloak SPIs.
 */
const SPI_TYPE_MAP: Record<string, { interfaceName: string; factoryName: string; modules: string[] }> = {
  authenticator: {
    interfaceName: "Authenticator",
    factoryName: "AuthenticatorFactory",
    modules: ["keycloak-server-spi", "keycloak-server-spi-private"],
  },
  requiredactionprovider: {
    interfaceName: "RequiredActionProvider",
    factoryName: "RequiredActionFactory",
    modules: ["keycloak-server-spi", "keycloak-server-spi-private"],
  },
  eventlistenerprovider: {
    interfaceName: "EventListenerProvider",
    factoryName: "EventListenerProviderFactory",
    modules: ["keycloak-server-spi", "keycloak-server-spi-private", "keycloak-events-api"],
  },
  tokenmapper: {
    interfaceName: "OIDCAccessTokenMapper",
    factoryName: "ProtocolMapperFactory",
    modules: ["keycloak-server-spi", "keycloak-server-spi-private"],
  },
  protocolmapper: {
    interfaceName: "ProtocolMapper",
    factoryName: "ProtocolMapperFactory",
    modules: ["keycloak-server-spi", "keycloak-server-spi-private"],
  },
  userstorageprovider: {
    interfaceName: "UserStorageProvider",
    factoryName: "UserStorageProviderFactory",
    modules: ["keycloak-server-spi", "keycloak-model-legacy"],
  },
  passwordhashprovider: {
    interfaceName: "PasswordHashProvider",
    factoryName: "PasswordHashProviderFactory",
    modules: ["keycloak-server-spi", "keycloak-server-spi-private"],
  },
  credentialprovider: {
    interfaceName: "CredentialProvider",
    factoryName: "CredentialProviderFactory",
    modules: ["keycloak-server-spi", "keycloak-server-spi-private"],
  },
};

/**
 * Generate a ready-to-use Java SPI implementation skeleton based on a description
 * of what the developer wants to build.
 */
export async function generateSpiBoilerplate(
  spiType: string,
  description: string,
  providerName: string,
  packageName: string
): Promise<string> {
  if (!spiType || !spiType.trim()) return "Error: spiType is required.";
  if (!description || !description.trim()) return "Error: description is required.";
  if (!providerName || !providerName.trim()) return "Error: providerName is required.";
  if (!packageName || !packageName.trim()) return "Error: packageName is required.";

  const sourcePath = getSourcePath();
  const normalizedType = spiType.toLowerCase().replace(/[\s_-]/g, "");

  // Resolve the interface and factory names
  let interfaceName: string;
  let factoryName: string;
  let modules: string[];

  const mapped = SPI_TYPE_MAP[normalizedType];
  if (mapped) {
    interfaceName = mapped.interfaceName;
    factoryName = mapped.factoryName;
    modules = mapped.modules;
  } else {
    // Try to find the interface dynamically
    interfaceName = spiType;
    factoryName = `${spiType}Factory`;
    modules = ["keycloak-server-spi", "keycloak-server-spi-private"];
  }

  // Find and read the interface source
  const interfaceMethods = await extractInterfaceMethods(sourcePath, interfaceName);
  const factoryMethods = await extractInterfaceMethods(sourcePath, factoryName);

  // Determine the full qualified interface name
  const interfaceFqn = await findFqn(sourcePath, interfaceName);
  const factoryFqn = await findFqn(sourcePath, factoryName);

  const providerClassName = providerName.endsWith("Provider")
    ? providerName
    : `${providerName}Provider`;
  const factoryClassName = providerName.endsWith("Factory")
    ? providerName
    : `${providerName}ProviderFactory`;
  const providerId = providerName
    .replace(/Provider$/, "")
    .replace(/Factory$/, "")
    .replace(/([A-Z])/g, "-$1")
    .toLowerCase()
    .replace(/^-/, "");

  const sections: string[] = [];
  sections.push(`Generated SPI Boilerplate: ${providerName}`);
  sections.push("=".repeat(60));
  sections.push(`SPI Type: ${spiType}`);
  sections.push(`Description: ${description}`);
  sections.push(`Package: ${packageName}`);
  sections.push("");

  // 1. Provider implementation
  sections.push("--- File: " + providerClassName + ".java ---");
  sections.push("```java");
  sections.push(generateProviderClass(
    packageName, providerClassName, interfaceName, interfaceFqn,
    interfaceMethods, description
  ));
  sections.push("```");
  sections.push("");

  // 2. Factory implementation
  sections.push("--- File: " + factoryClassName + ".java ---");
  sections.push("```java");
  sections.push(generateFactoryClass(
    packageName, factoryClassName, providerClassName, factoryName, factoryFqn,
    factoryMethods, providerId, interfaceName
  ));
  sections.push("```");
  sections.push("");

  // 3. META-INF/services entry
  const serviceFileName = factoryFqn || `org.keycloak.${factoryName}`;
  sections.push(`--- File: META-INF/services/${serviceFileName} ---`);
  sections.push("```");
  sections.push(`${packageName}.${factoryClassName}`);
  sections.push("```");
  sections.push("");

  // 4. pom.xml snippet
  sections.push("--- pom.xml dependency snippet ---");
  sections.push("```xml");
  sections.push(generatePomSnippet(modules));
  sections.push("```");

  return sections.join("\n");
}

interface MethodInfo {
  signature: string;
  returnType: string;
  name: string;
  params: string;
  javadoc: string;
}

async function extractInterfaceMethods(
  sourcePath: string,
  interfaceName: string
): Promise<MethodInfo[]> {
  // Find the interface file
  const args = ["--files", "--glob", `**/${interfaceName}.java`];
  let filePath: string;
  try {
    const result = await searchWithRg(args, sourcePath);
    if (!result.trim()) return [];
    filePath = result.trim().split("\n")[0];
    if (!filePath.startsWith("/")) filePath = path.join(sourcePath, filePath);
  } catch {
    return [];
  }

  try {
    const source = await fs.promises.readFile(filePath, "utf-8");
    const parsed = parseJavaClass(source);
    return parsed.methods.map((m) => ({
      signature: `${m.modifiers.join(" ")} ${m.returnType} ${m.name}(${m.parameters})`.trim(),
      returnType: m.returnType,
      name: m.name,
      params: m.parameters,
      javadoc: m.javadoc,
    }));
  } catch {
    return [];
  }
}

async function findFqn(sourcePath: string, className: string): Promise<string> {
  const args = ["--files", "--glob", `**/${className}.java`];
  try {
    const result = await searchWithRg(args, sourcePath);
    if (!result.trim()) return "";
    const filePath = result.trim().split("\n")[0];
    const fullPath = filePath.startsWith("/") ? filePath : path.join(sourcePath, filePath);
    const source = await fs.promises.readFile(fullPath, "utf-8");
    const pkgMatch = source.match(/^package\s+([\w.]+)\s*;/m);
    if (pkgMatch) return `${pkgMatch[1]}.${className}`;
  } catch {
    // ignore
  }
  return "";
}

function generateProviderClass(
  packageName: string,
  className: string,
  interfaceName: string,
  interfaceFqn: string,
  methods: MethodInfo[],
  description: string
): string {
  const imports = new Set<string>();
  imports.add("import org.keycloak.models.KeycloakSession");
  if (interfaceFqn) imports.add(`import ${interfaceFqn}`);

  const lines: string[] = [];
  lines.push(`package ${packageName};`);
  lines.push("");
  for (const imp of [...imports].sort()) {
    lines.push(`${imp};`);
  }
  lines.push("");
  lines.push("/**");
  lines.push(` * ${description}`);
  lines.push(" */");
  lines.push(`public class ${className} implements ${interfaceName} {`);
  lines.push("");
  lines.push("    private final KeycloakSession session;");
  lines.push("");
  lines.push(`    public ${className}(KeycloakSession session) {`);
  lines.push("        this.session = session;");
  lines.push("    }");

  if (methods.length > 0) {
    for (const method of methods) {
      lines.push("");
      if (method.javadoc) {
        lines.push("    /**");
        for (const docLine of method.javadoc.split("\n")) {
          lines.push(`     * ${docLine.trim()}`);
        }
        lines.push("     */");
      }
      lines.push("    @Override");
      const params = method.params || "";
      lines.push(`    public ${method.returnType} ${method.name}(${params}) {`);
      lines.push(`        // TODO: Implement — ${description}`);
      if (method.returnType === "void") {
        // no return
      } else if (method.returnType === "boolean") {
        lines.push("        return false;");
      } else if (method.returnType === "int" || method.returnType === "long") {
        lines.push("        return 0;");
      } else {
        lines.push("        return null;");
      }
      lines.push("    }");
    }
  } else {
    lines.push("");
    lines.push("    // TODO: Implement required interface methods");
    lines.push(`    // Check the ${interfaceName} interface for method signatures`);
  }

  lines.push("");
  lines.push("    @Override");
  lines.push("    public void close() {");
  lines.push("        // Clean up resources if needed");
  lines.push("    }");
  lines.push("}");

  return lines.join("\n");
}

function generateFactoryClass(
  packageName: string,
  className: string,
  providerClassName: string,
  factoryInterfaceName: string,
  factoryFqn: string,
  methods: MethodInfo[],
  providerId: string,
  providerInterfaceName: string
): string {
  const imports = new Set<string>();
  imports.add("import org.keycloak.Config");
  imports.add("import org.keycloak.models.KeycloakSession");
  imports.add("import org.keycloak.models.KeycloakSessionFactory");
  if (factoryFqn) imports.add(`import ${factoryFqn}`);

  const lines: string[] = [];
  lines.push(`package ${packageName};`);
  lines.push("");
  for (const imp of [...imports].sort()) {
    lines.push(`${imp};`);
  }
  lines.push("");
  lines.push(`public class ${className} implements ${factoryInterfaceName} {`);
  lines.push("");
  lines.push(`    public static final String PROVIDER_ID = "${providerId}";`);
  lines.push("");

  // Add create method
  lines.push("    @Override");
  lines.push(`    public ${providerInterfaceName} create(KeycloakSession session) {`);
  lines.push(`        return new ${providerClassName}(session);`);
  lines.push("    }");
  lines.push("");

  // Add standard factory methods
  lines.push("    @Override");
  lines.push("    public void init(Config.Scope config) {");
  lines.push("        // Read configuration if needed");
  lines.push("    }");
  lines.push("");

  lines.push("    @Override");
  lines.push("    public void postInit(KeycloakSessionFactory factory) {");
  lines.push("        // Post-initialization logic");
  lines.push("    }");
  lines.push("");

  lines.push("    @Override");
  lines.push("    public void close() {");
  lines.push("        // Clean up resources");
  lines.push("    }");
  lines.push("");

  lines.push("    @Override");
  lines.push("    public String getId() {");
  lines.push("        return PROVIDER_ID;");
  lines.push("    }");

  // Add any additional methods from the factory interface
  const standardMethods = new Set(["create", "init", "postInit", "close", "getId", "order"]);
  for (const method of methods) {
    if (standardMethods.has(method.name)) continue;
    lines.push("");
    if (method.javadoc) {
      lines.push("    /**");
      for (const docLine of method.javadoc.split("\n")) {
        lines.push(`     * ${docLine.trim()}`);
      }
      lines.push("     */");
    }
    lines.push("    @Override");
    lines.push(`    public ${method.returnType} ${method.name}(${method.params}) {`);
    lines.push("        // TODO: Implement");
    if (method.returnType !== "void") {
      if (method.returnType === "boolean") lines.push("        return false;");
      else if (method.returnType === "String") lines.push("        return null;");
      else lines.push("        return null;");
    }
    lines.push("    }");
  }

  lines.push("}");
  return lines.join("\n");
}

function generatePomSnippet(modules: string[]): string {
  const lines: string[] = [];
  lines.push("<dependencies>");
  for (const mod of modules) {
    lines.push("    <dependency>");
    lines.push("        <groupId>org.keycloak</groupId>");
    lines.push(`        <artifactId>${mod}</artifactId>`);
    lines.push("        <version>${keycloak.version}</version>");
    lines.push("        <scope>provided</scope>");
    lines.push("    </dependency>");
  }
  lines.push("</dependencies>");
  return lines.join("\n");
}
