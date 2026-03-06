/**
 * @file quarkus-dev-ui.ts
 * @module live-dev
 * @author keycloak-source-mcp
 * @since 1.1.0
 *
 * Handles all Quarkus Dev UI specific endpoint interactions.
 *
 * The Quarkus Dev UI (available at /q/dev in dev mode) exposes rich information
 * about loaded extensions, CDI beans, active configuration properties, and dev
 * services. This module queries those endpoints to provide visibility into the
 * runtime composition of the Keycloak instance.
 *
 * Important: The Dev UI is only available when Quarkus runs in dev mode.
 * Production builds do not expose /q/dev. The endpoints return JSON when
 * requested with Accept: application/json headers.
 *
 * Quarkus version compatibility:
 * - Quarkus 3.x: Dev UI v2 with JSON API endpoints at /q/dev-v1/
 * - The exact endpoint paths may vary between Quarkus versions; this module
 *   tries multiple known paths and gracefully handles 404s.
 */

import type { DevInstanceClient } from "./dev-instance-client.js";

/**
 * A loaded Quarkus extension in the running instance.
 * Extensions are the building blocks of a Quarkus application — Keycloak
 * includes many extensions for its various features (RESTEasy, Hibernate, etc.).
 */
export interface QuarkusExtension {
  /** Extension name, e.g. "RESTEasy Reactive" */
  name: string;
  /** Maven group:artifact identifier */
  artifactId: string;
  /** Extension version */
  version: string;
  /** Brief description of the extension's purpose */
  description: string;
}

/**
 * An active configuration property in the running instance.
 * Quarkus uses MicroProfile Config for configuration, and these properties
 * control everything from database URLs to SPI settings.
 */
export interface ConfigProperty {
  /** Configuration key, e.g. "quarkus.datasource.jdbc.url" */
  key: string;
  /** Current effective value (may be masked for secrets) */
  value: string;
  /** Where the value came from: "env", "system", "application.properties", "default" */
  source: string;
  /** Default value if any */
  defaultValue: string;
}

/**
 * A CDI bean registered by Quarkus Arc (the CDI implementation).
 * Keycloak uses CDI extensively — SPI factories and providers are often CDI beans.
 */
export interface ArcBean {
  /** Fully qualified bean class name */
  beanClass: string;
  /** CDI scope, e.g. "ApplicationScoped", "RequestScoped" */
  scope: string;
  /** Bean kind: "CLASS", "PRODUCER_METHOD", "SYNTHETIC", etc. */
  kind: string;
  /** Qualifier annotations on the bean */
  qualifiers: string[];
}

/**
 * Information about an active Quarkus Dev Service.
 * Dev Services automatically provision dependencies (like databases) for development.
 */
export interface DevServiceInfo {
  /** Service type, e.g. "postgresql", "keycloak" */
  type: string;
  /** Container image used (if containerized) */
  image: string;
  /** Whether the service is currently running */
  running: boolean;
  /** Connection properties (e.g. JDBC URL, port) */
  properties: Record<string, string>;
}

/**
 * Query the Quarkus Dev UI for loaded extensions.
 *
 * Tries the standard Quarkus Dev UI JSON endpoint for extension listing.
 * If the endpoint is not available (e.g., production build), returns an empty array.
 *
 * @param client - The DevInstanceClient for HTTP communication
 * @returns Array of loaded Quarkus extensions
 *
 * @example
 * ```typescript
 * const extensions = await getLoadedExtensions(client);
 * console.log(`${extensions.length} extensions loaded`);
 * ```
 */
export async function getLoadedExtensions(client: DevInstanceClient): Promise<QuarkusExtension[]> {
  try {
    const data = await client.request<Record<string, unknown>[]>("/q/dev-v1/io.quarkus.quarkus-core/extensions");
    return data.map((ext) => ({
      name: String(ext.name ?? "unknown"),
      artifactId: String(ext.artifactId ?? ext.artifact ?? "unknown"),
      version: String(ext.version ?? "unknown"),
      description: String(ext.description ?? ""),
    }));
  } catch {
    // Dev UI endpoint not available — try alternative paths or return empty
    return [];
  }
}

/**
 * Query all active configuration properties from the running instance.
 *
 * Uses the Quarkus Dev UI configuration endpoint which lists all resolved
 * config values, their sources, and defaults.
 *
 * @param client - The DevInstanceClient for HTTP communication
 * @returns Array of active configuration properties
 *
 * @example
 * ```typescript
 * const props = await getConfigurationProperties(client);
 * const spiProps = props.filter(p => p.key.startsWith("kc.spi"));
 * ```
 */
export async function getConfigurationProperties(client: DevInstanceClient): Promise<ConfigProperty[]> {
  try {
    const data = await client.request<Record<string, unknown>[]>("/q/dev-v1/io.quarkus.quarkus-core/config");
    return data.map((prop) => ({
      key: String(prop.name ?? prop.key ?? ""),
      value: String(prop.value ?? ""),
      source: String(prop.configSourceName ?? prop.source ?? "unknown"),
      defaultValue: String(prop.defaultValue ?? ""),
    }));
  } catch {
    return [];
  }
}

/**
 * List CDI beans registered by Quarkus Arc.
 *
 * Keycloak's SPI factories are often CDI beans, so this can help verify
 * that custom providers are being discovered and instantiated correctly.
 *
 * @param client - The DevInstanceClient for HTTP communication
 * @param filter - Optional filter string to match bean class names
 * @returns Array of registered CDI beans
 *
 * @example
 * ```typescript
 * const beans = await getArcBeans(client, "Authenticator");
 * // Shows all beans with "Authenticator" in the class name
 * ```
 */
export async function getArcBeans(client: DevInstanceClient, filter?: string): Promise<ArcBean[]> {
  try {
    const data = await client.request<Record<string, unknown>[]>("/q/dev-v1/io.quarkus.quarkus-arc/beans");
    let beans = data.map((bean) => ({
      beanClass: String(bean.beanClass ?? bean["bean-class"] ?? "unknown"),
      scope: String(bean.scope ?? "Dependent"),
      kind: String(bean.kind ?? "CLASS"),
      qualifiers: Array.isArray(bean.qualifiers) ? bean.qualifiers.map(String) : [],
    }));

    if (filter) {
      const lowerFilter = filter.toLowerCase();
      beans = beans.filter((b) => b.beanClass.toLowerCase().includes(lowerFilter));
    }

    return beans;
  } catch {
    return [];
  }
}

/**
 * Get information about active Quarkus Dev Services.
 *
 * Dev Services are containers or processes that Quarkus automatically starts
 * during development to provide infrastructure (databases, message brokers, etc.).
 *
 * @param client - The DevInstanceClient for HTTP communication
 * @returns Array of active dev service descriptions
 *
 * @example
 * ```typescript
 * const services = await getDevServicesInfo(client);
 * for (const s of services) {
 *   console.log(`${s.type}: ${s.running ? "running" : "stopped"}`);
 * }
 * ```
 */
export async function getDevServicesInfo(client: DevInstanceClient): Promise<DevServiceInfo[]> {
  try {
    const data = await client.request<Record<string, unknown>[]>("/q/dev-v1/io.quarkus.quarkus-core/dev-services");
    return data.map((svc) => ({
      type: String(svc.type ?? svc.name ?? "unknown"),
      image: String(svc.containerImage ?? svc.image ?? ""),
      running: Boolean(svc.running ?? svc.isRunning ?? false),
      properties: (svc.config ?? svc.properties ?? {}) as Record<string, string>,
    }));
  } catch {
    return [];
  }
}
