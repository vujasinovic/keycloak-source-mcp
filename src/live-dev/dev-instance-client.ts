/**
 * @file dev-instance-client.ts
 * @module live-dev
 * @author keycloak-source-mcp
 * @since 1.1.0
 *
 * Core client for connecting to a locally running Keycloak instance.
 *
 * Keycloak can be started in several ways:
 * - **Docker:** `docker run -p 8080:8080 quay.io/keycloak/keycloak start-dev`
 * - **IDELauncher:** Running `io.quarkus.runtime.Quarkus.run()` from the Keycloak source
 * - **Maven:** `./mvnw -pl quarkus/server quarkus:dev` from the Keycloak source root
 *
 * This client connects to the running instance and inspects its state via:
 * - Keycloak Admin REST API: /admin/realms — realm and provider management (always available)
 * - Quarkus Health: /q/health — liveness and readiness status (always available)
 * - Quarkus Dev UI: /q/dev — development tools and extension info (Quarkus dev mode only)
 * - Quarkus Info: /q/info — build and runtime information (Quarkus dev mode only)
 *
 * Note: The Quarkus Dev UI endpoints (/q/dev) are only available when running from
 * source in Quarkus dev mode (IDELauncher or Maven). Docker `start-dev` does NOT
 * expose these endpoints. The Admin REST API works with all deployment methods.
 *
 * This client handles connection lifecycle, health checking, authentication token
 * management, and graceful error handling when the instance is not available.
 *
 * Prerequisites:
 * - Keycloak must be running and accessible (default: localhost:8080)
 * - For admin API access, valid admin credentials must be provided
 */

/**
 * Configuration for connecting to a Keycloak dev instance.
 * All values are read from environment variables by {@link getDevConfig}.
 */
export interface DevInstanceConfig {
  /** Base URL of the running Keycloak instance, e.g. "http://localhost:8080" */
  url: string;
  /** Realm to use for admin token acquisition and default queries. Typically "master". */
  realm: string;
  /** Admin username for the Keycloak instance */
  adminUsername: string;
  /** Admin password for the Keycloak instance */
  adminPassword: string;
  /** Optional path to the Keycloak log file for log analysis */
  logPath?: string;
}

/**
 * Quarkus build and runtime information returned by /q/info.
 * Keycloak in dev mode is a Quarkus application, so this gives us
 * framework-level metadata about the running instance.
 */
export interface QuarkusInfo {
  /** Quarkus framework version, e.g. "3.8.1" */
  quarkusVersion: string;
  /** Java version the instance is running on */
  javaVersion: string;
  /** Operating system of the running instance */
  osName: string;
  /** Build timestamp or "unknown" */
  buildTime: string;
  /** Raw info object for any additional fields */
  raw: Record<string, unknown>;
}

/**
 * Represents a registered SPI provider in the running Keycloak instance.
 * Keycloak's SPI system uses a factory pattern — each provider type has a factory
 * that creates instances. The provider ID is returned by the factory's getId() method.
 */
export interface Provider {
  /** The SPI type, e.g. "authenticator", "required-action", "event-listener" */
  spiType: string;
  /** Unique provider ID as returned by ProviderFactory.getId() */
  providerId: string;
  /** Fully qualified Java class name of the provider factory */
  factoryClass: string;
  /** Whether this is a built-in Keycloak provider or a custom extension */
  isBuiltIn: boolean;
}

/**
 * Keycloak realm configuration summary.
 * A subset of the full realm representation focused on what's useful for development.
 */
export interface RealmConfig {
  /** Realm name (unique identifier) */
  realm: string;
  /** Display name for the realm */
  displayName: string;
  /** Whether the realm is enabled */
  enabled: boolean;
  /** Name of the default browser authentication flow */
  browserFlow: string;
  /** Name of the registration flow */
  registrationFlow: string;
  /** Name of the direct grant flow */
  directGrantFlow: string;
  /** Names of identity providers configured in this realm */
  identityProviders: string[];
  /** Raw realm JSON for advanced inspection */
  raw: Record<string, unknown>;
}

/**
 * Server-level information from the Keycloak Admin API /admin/serverinfo.
 * Includes all registered SPI types and their providers.
 */
export interface ServerInfo {
  /** Keycloak version string, e.g. "26.0.1" */
  keycloakVersion: string;
  /** All registered providers grouped by SPI type */
  providers: Record<string, ProviderInfo>;
  /** Total count of registered SPI types */
  spiCount: number;
  /** Total count of registered providers across all SPIs */
  providerCount: number;
  /** Raw server info for advanced inspection */
  raw: Record<string, unknown>;
}

/**
 * Information about a single SPI type and its registered providers.
 */
export interface ProviderInfo {
  /** Whether this SPI is internal (not intended for external use) */
  internal: boolean;
  /** Map of provider ID to provider details */
  providers: Record<string, { order: number }>;
}

/** Cached admin token with expiry tracking */
interface TokenCache {
  token: string;
  expiresAt: number;
}

/**
 * Client for communicating with a running Keycloak Quarkus dev instance.
 *
 * Handles health checking, admin token management with caching, and
 * all HTTP communication with both Quarkus management endpoints and
 * the Keycloak Admin REST API.
 *
 * @example
 * ```typescript
 * const client = new DevInstanceClient({
 *   url: "http://localhost:8080",
 *   realm: "master",
 *   adminUsername: "admin",
 *   adminPassword: "admin",
 * });
 *
 * if (await client.isRunning()) {
 *   const info = await client.getServerInfo();
 *   console.log(`Keycloak ${info.keycloakVersion} is running`);
 * }
 * ```
 */
export class DevInstanceClient {
  private config: DevInstanceConfig;
  private tokenCache: TokenCache | null = null;

  /**
   * Create a new DevInstanceClient.
   *
   * @param config - Connection configuration for the dev instance
   */
  constructor(config: DevInstanceConfig) {
    this.config = config;
  }

  /**
   * Check whether the Keycloak dev instance is running and healthy.
   *
   * "Running" means the Quarkus health endpoint (/q/health) responds with
   * an HTTP 200 status. This endpoint is available even before Keycloak
   * finishes full initialization, but only after Quarkus has started.
   *
   * @returns true if the instance responds to health checks, false otherwise
   *
   * @example
   * ```typescript
   * const running = await client.isRunning();
   * if (!running) console.log("Start Keycloak first");
   * ```
   */
  async isRunning(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.url}/q/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch Quarkus build and runtime information from /q/info.
   *
   * This endpoint returns framework-level metadata. In some Quarkus configurations
   * it may be disabled or return limited data. The method handles missing fields
   * gracefully by substituting "unknown".
   *
   * @returns Parsed Quarkus information
   * @throws Error if the instance is not running or the endpoint is not available
   *
   * @example
   * ```typescript
   * const info = await client.getQuarkusInfo();
   * console.log(`Quarkus ${info.quarkusVersion}, Java ${info.javaVersion}`);
   * ```
   */
  async getQuarkusInfo(): Promise<QuarkusInfo> {
    const data = await this.requestRaw<Record<string, unknown>>("/q/info");
    return {
      quarkusVersion: String((data as Record<string, unknown>)?.["quarkus.version"] ?? data?.["quarkusVersion"] ?? "unknown"),
      javaVersion: String(data?.["java.version"] ?? data?.["javaVersion"] ?? "unknown"),
      osName: String(data?.["os.name"] ?? data?.["osName"] ?? "unknown"),
      buildTime: String(data?.["build.time"] ?? data?.["buildTime"] ?? "unknown"),
      raw: data ?? {},
    };
  }

  /**
   * Obtain an admin access token from the Keycloak instance.
   *
   * Uses the OAuth2 Resource Owner Password Credentials grant against the
   * configured realm's token endpoint. Tokens are cached and reused until
   * they expire (with a 30-second safety margin).
   *
   * @returns JWT access token string
   * @throws Error if authentication fails (wrong credentials, instance down, etc.)
   *
   * @example
   * ```typescript
   * const token = await client.getAdminToken();
   * // Use token for Admin REST API calls
   * ```
   */
  async getAdminToken(): Promise<string> {
    // Return cached token if still valid (with 30s safety margin)
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) {
      return this.tokenCache.token;
    }

    const tokenUrl = `${this.config.url}/realms/${this.config.realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: this.config.adminUsername,
      password: this.config.adminPassword,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(
        `Admin token acquisition failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return data.access_token;
  }

  /**
   * List all registered SPI providers in the running Keycloak instance.
   *
   * Queries the Admin REST API server info endpoint and parses the provider
   * registry. Each provider is classified as built-in or custom based on
   * its class package — anything outside org.keycloak.* is custom.
   *
   * @param type - Optional SPI type filter, e.g. "authenticator"
   * @returns Array of registered providers
   * @throws Error if the admin API is not accessible
   *
   * @example
   * ```typescript
   * const providers = await client.getRegisteredProviders("authenticator");
   * for (const p of providers) {
   *   console.log(`${p.providerId} — ${p.factoryClass} (${p.isBuiltIn ? "built-in" : "custom"})`);
   * }
   * ```
   */
  async getRegisteredProviders(type?: string): Promise<Provider[]> {
    const serverInfo = await this.getServerInfo();
    const providers: Provider[] = [];

    for (const [spiType, info] of Object.entries(serverInfo.providers)) {
      if (type && spiType !== type) continue;

      for (const [providerId, details] of Object.entries(info.providers)) {
        const factoryClass = (details as Record<string, unknown>)?.["factoryClass"] as string ?? providerId;
        providers.push({
          spiType,
          providerId,
          factoryClass,
          isBuiltIn: factoryClass.startsWith("org.keycloak."),
        });
      }
    }

    return providers;
  }

  /**
   * Get the full configuration of a specific realm.
   *
   * Fetches the realm representation from the Admin REST API and extracts
   * the most development-relevant fields into a structured format.
   *
   * @param realm - Realm name to query
   * @returns Realm configuration summary
   * @throws Error if the realm doesn't exist or admin access fails
   *
   * @example
   * ```typescript
   * const config = await client.getRealmConfiguration("master");
   * console.log(`Browser flow: ${config.browserFlow}`);
   * ```
   */
  async getRealmConfiguration(realm: string): Promise<RealmConfig> {
    const data = await this.request<Record<string, unknown>>(`/admin/realms/${realm}`);
    const idps = (data.identityProviders as Array<{ alias: string }>) ?? [];

    return {
      realm: String(data.realm ?? realm),
      displayName: String(data.displayName ?? ""),
      enabled: Boolean(data.enabled),
      browserFlow: String(data.browserFlow ?? "browser"),
      registrationFlow: String(data.registrationFlow ?? "registration"),
      directGrantFlow: String(data.directGrantFlow ?? "direct grant"),
      identityProviders: idps.map((idp) => idp.alias),
      raw: data,
    };
  }

  /**
   * Get Keycloak server-level information including all registered SPIs.
   *
   * The serverinfo endpoint returns comprehensive metadata about the running
   * Keycloak instance including version, all SPI types, and their providers.
   * This is the primary endpoint for understanding the runtime SPI registry.
   *
   * @returns Server information with provider registry
   * @throws Error if the admin API is not accessible
   *
   * @example
   * ```typescript
   * const info = await client.getServerInfo();
   * console.log(`${info.spiCount} SPIs with ${info.providerCount} total providers`);
   * ```
   */
  async getServerInfo(): Promise<ServerInfo> {
    const data = await this.request<Record<string, unknown>>("/admin/serverinfo");
    const providers = (data.providers ?? {}) as Record<string, ProviderInfo>;

    let providerCount = 0;
    for (const spi of Object.values(providers)) {
      providerCount += Object.keys(spi.providers ?? {}).length;
    }

    return {
      keycloakVersion: String((data.systemInfo as Record<string, unknown>)?.version ?? "unknown"),
      providers,
      spiCount: Object.keys(providers).length,
      providerCount,
      raw: data,
    };
  }

  /**
   * Make an authenticated HTTP request to the Keycloak Admin REST API.
   *
   * Automatically acquires and attaches an admin bearer token.
   * Handles JSON parsing and HTTP error responses.
   *
   * @param path - API path relative to the base URL, e.g. "/admin/realms/master"
   * @param options - Optional fetch options (method, body, etc.)
   * @returns Parsed JSON response
   * @throws Error if the request fails or returns a non-2xx status
   *
   * @example
   * ```typescript
   * const realms = await client.request<Array<{ realm: string }>>("/admin/realms");
   * ```
   */
  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const token = await this.getAdminToken();
    const url = `${this.config.url}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...options?.headers,
      },
      signal: options?.signal ?? AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Admin API request failed: ${response.status} ${response.statusText} — ${path}`);
    }

    return (await response.json()) as T;
  }

  /**
   * Make an unauthenticated HTTP request (for Quarkus management endpoints).
   *
   * Used for endpoints like /q/health, /q/info that don't require authentication.
   *
   * @param path - Path relative to the base URL
   * @returns Parsed JSON response
   * @throws Error if the request fails
   */
  private async requestRaw<T>(path: string): Promise<T> {
    const url = `${this.config.url}${path}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText} — ${path}`);
    }

    return (await response.json()) as T;
  }

  /**
   * Invalidate the cached admin token, forcing re-authentication on next request.
   * Useful for testing or when credentials have changed.
   */
  clearTokenCache(): void {
    this.tokenCache = null;
  }
}

/**
 * Read the dev instance configuration from environment variables.
 *
 * All environment variables are optional. If KC_DEV_URL is not set,
 * returns null to indicate the feature is not configured.
 *
 * @returns Configuration object or null if not configured
 *
 * @example
 * ```typescript
 * const config = getDevConfig();
 * if (!config) {
 *   return "Set KC_DEV_URL to enable live dev features";
 * }
 * const client = new DevInstanceClient(config);
 * ```
 */
export function getDevConfig(): DevInstanceConfig | null {
  const url = process.env.KC_DEV_URL;
  if (!url) return null;

  return {
    url: url.replace(/\/+$/, ""), // strip trailing slashes
    realm: process.env.KC_DEV_REALM ?? "master",
    adminUsername: process.env.KC_DEV_ADMIN_USERNAME ?? "admin",
    adminPassword: process.env.KC_DEV_ADMIN_PASSWORD ?? "admin",
    logPath: process.env.KC_DEV_LOG_PATH,
  };
}

/**
 * Get a setup instructions message for when KC_DEV_URL is not configured.
 *
 * @returns Formatted setup instructions string
 */
export function getSetupInstructions(): string {
  return `Live Development Intelligence is not configured.

To connect to a running Keycloak dev instance, set these environment variables:

  Required:
    KC_DEV_URL=http://localhost:8080          Base URL of Keycloak

  Optional:
    KC_DEV_REALM=master                       Realm for queries (default: master)
    KC_DEV_ADMIN_USERNAME=admin              Admin username (default: admin)
    KC_DEV_ADMIN_PASSWORD=admin              Admin password (default: admin)
    KC_DEV_LOG_PATH=/path/to/keycloak.log    Log file for analysis

How to start Keycloak:
  Option 1 — Docker (simplest):
    docker run -p 8080:8080 -e KC_BOOTSTRAP_ADMIN_USERNAME=admin -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin quay.io/keycloak/keycloak:latest start-dev

  Option 2 — Maven (from Keycloak source):
    ./mvnw -pl quarkus/server quarkus:dev

  Option 3 — IDELauncher (from your IDE):
    Run io.quarkus.runtime.Quarkus.run() in the Keycloak source project

Note: Quarkus Dev UI endpoints (/q/dev) are only available with Options 2 and 3.
Docker start-dev mode uses the Admin REST API instead (works for most features).`;
}
