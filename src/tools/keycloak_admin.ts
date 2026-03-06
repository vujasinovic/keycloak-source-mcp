import { fetchKeycloakAdminToken } from "../utils.js";

interface AdminConfig {
  url: string;
  realm: string;
  clientId: string;
  username: string;
  password: string;
}

/**
 * Connect to a running Keycloak instance and perform administrative queries.
 * Works alongside source tools — source tools answer "how is it built",
 * admin tools answer "what is the current state".
 */
export async function keycloakAdmin(
  action: string,
  realm?: string
): Promise<string> {
  if (!action || !action.trim()) return "Error: action is required.";

  const config = getAdminConfig();
  if (!config) {
    return [
      "Keycloak Admin API is not configured.",
      "",
      "To enable admin tools, set these environment variables:",
      "  KEYCLOAK_ADMIN_URL=http://localhost:8080",
      "  KEYCLOAK_ADMIN_USERNAME=admin",
      "  KEYCLOAK_ADMIN_PASSWORD=admin",
      "",
      "Optional:",
      "  KEYCLOAK_ADMIN_REALM=master (default: master)",
      "  KEYCLOAK_ADMIN_CLIENT_ID=admin-cli (default: admin-cli)",
      "",
      "Add them to your MCP server config:",
      '  "env": {',
      '    "KEYCLOAK_ADMIN_URL": "http://localhost:8080",',
      '    "KEYCLOAK_ADMIN_USERNAME": "admin",',
      '    "KEYCLOAK_ADMIN_PASSWORD": "admin"',
      "  }",
    ].join("\n");
  }

  const normalizedAction = action.toLowerCase().replace(/[\s_-]/g, "");

  try {
    switch (normalizedAction) {
      case "listrealms":
        return await listRealms(config);
      case "listflows":
        return await listFlows(config, realm || "master");
      case "listclients":
        return await listClients(config, realm || "master");
      case "listproviders":
        return await listProviders(config);
      case "getrealmsettings":
        return await getRealmSettings(config, realm || "master");
      default:
        return [
          `Unknown action: "${action}"`,
          "",
          "Available actions:",
          "  list_realms — List all realms",
          "  list_flows — List authentication flows in a realm",
          "  list_clients — List clients in a realm",
          "  list_providers — List all registered SPI providers",
          "  get_realm_settings — Get full realm configuration",
        ].join("\n");
    }
  } catch (error) {
    return `Error executing admin action "${action}": ${error instanceof Error ? error.message : String(error)}`;
  }
}

function getAdminConfig(): AdminConfig | null {
  const url = process.env.KEYCLOAK_ADMIN_URL;
  const username = process.env.KEYCLOAK_ADMIN_USERNAME;
  const password = process.env.KEYCLOAK_ADMIN_PASSWORD;

  if (!url || !username || !password) return null;

  return {
    url: url.replace(/\/$/, ""),
    realm: process.env.KEYCLOAK_ADMIN_REALM || "master",
    clientId: process.env.KEYCLOAK_ADMIN_CLIENT_ID || "admin-cli",
    username,
    password,
  };
}

async function adminFetch(config: AdminConfig, path: string): Promise<unknown> {
  const token = await fetchKeycloakAdminToken(
    config.url,
    config.realm,
    config.clientId,
    config.username,
    config.password
  );

  const response = await fetch(`${config.url}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Admin API returned ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function listRealms(config: AdminConfig): Promise<string> {
  const realms = (await adminFetch(config, "/admin/realms")) as Array<{
    realm: string;
    enabled: boolean;
    displayName?: string;
  }>;

  const lines: string[] = [];
  lines.push("Realms");
  lines.push("=".repeat(40));
  lines.push("");

  for (const r of realms) {
    const status = r.enabled ? "enabled" : "disabled";
    const display = r.displayName ? ` (${r.displayName})` : "";
    lines.push(`  ${r.realm}${display} [${status}]`);
  }

  lines.push("");
  lines.push(`Total: ${realms.length} realm(s)`);
  return lines.join("\n");
}

async function listFlows(config: AdminConfig, realm: string): Promise<string> {
  const flows = (await adminFetch(
    config,
    `/admin/realms/${encodeURIComponent(realm)}/authentication/flows`
  )) as Array<{
    id: string;
    alias: string;
    builtIn: boolean;
    providerId: string;
  }>;

  const lines: string[] = [];
  lines.push(`Authentication Flows — Realm: ${realm}`);
  lines.push("=".repeat(40));
  lines.push("");

  for (const f of flows) {
    const builtIn = f.builtIn ? " [built-in]" : " [custom]";
    lines.push(`  ${f.alias}${builtIn}`);
    lines.push(`    ID: ${f.id}`);
    lines.push(`    Provider: ${f.providerId}`);
  }

  lines.push("");
  lines.push(`Total: ${flows.length} flow(s)`);
  return lines.join("\n");
}

async function listClients(config: AdminConfig, realm: string): Promise<string> {
  const clients = (await adminFetch(
    config,
    `/admin/realms/${encodeURIComponent(realm)}/clients`
  )) as Array<{
    id: string;
    clientId: string;
    enabled: boolean;
    protocol?: string;
    publicClient?: boolean;
  }>;

  const lines: string[] = [];
  lines.push(`Clients — Realm: ${realm}`);
  lines.push("=".repeat(40));
  lines.push("");

  for (const c of clients) {
    const status = c.enabled ? "enabled" : "disabled";
    const type = c.publicClient ? "public" : "confidential";
    lines.push(`  ${c.clientId} [${status}, ${type}]`);
    lines.push(`    ID: ${c.id}`);
    if (c.protocol) lines.push(`    Protocol: ${c.protocol}`);
  }

  lines.push("");
  lines.push(`Total: ${clients.length} client(s)`);
  return lines.join("\n");
}

async function listProviders(config: AdminConfig): Promise<string> {
  const info = (await adminFetch(config, "/admin/serverinfo")) as {
    providers?: Record<string, { spi: string; implementations?: Record<string, unknown> }>;
  };

  const lines: string[] = [];
  lines.push("Registered SPI Providers");
  lines.push("=".repeat(40));
  lines.push("");

  if (!info.providers) {
    lines.push("  No provider information available.");
    return lines.join("\n");
  }

  const entries = Object.entries(info.providers);
  for (const [spiName, spiInfo] of entries.slice(0, 50)) {
    const implCount = spiInfo.implementations
      ? Object.keys(spiInfo.implementations).length
      : 0;
    lines.push(`  ${spiName} (${implCount} implementation(s))`);
    if (spiInfo.implementations) {
      for (const implName of Object.keys(spiInfo.implementations).slice(0, 10)) {
        lines.push(`    - ${implName}`);
      }
    }
  }

  if (entries.length > 50) {
    lines.push(`  ... and ${entries.length - 50} more SPIs`);
  }

  lines.push("");
  lines.push(`Total: ${entries.length} SPI(s)`);
  return lines.join("\n");
}

async function getRealmSettings(config: AdminConfig, realm: string): Promise<string> {
  const settings = (await adminFetch(
    config,
    `/admin/realms/${encodeURIComponent(realm)}`
  )) as Record<string, unknown>;

  const lines: string[] = [];
  lines.push(`Realm Settings — ${realm}`);
  lines.push("=".repeat(40));
  lines.push("");

  // Show key settings in a readable format
  const keyFields = [
    "realm", "enabled", "displayName", "registrationAllowed",
    "registrationEmailAsUsername", "verifyEmail", "loginWithEmailAllowed",
    "duplicateEmailsAllowed", "resetPasswordAllowed", "bruteForceProtected",
    "sslRequired", "defaultSignatureAlgorithm", "accessTokenLifespan",
    "ssoSessionIdleTimeout", "ssoSessionMaxLifespan",
    "internationalizationEnabled", "supportedLocales", "defaultLocale",
  ];

  for (const field of keyFields) {
    if (field in settings) {
      const value = settings[field];
      lines.push(`  ${field}: ${JSON.stringify(value)}`);
    }
  }

  return lines.join("\n");
}
