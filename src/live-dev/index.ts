/**
 * @file index.ts
 * @module live-dev
 * @author keycloak-source-mcp
 * @since 1.1.0
 *
 * Barrel export for the Live Development Intelligence feature.
 *
 * Re-exports all public types, classes, and functions from the live-dev module
 * to provide a clean import surface for consumers (primarily src/index.ts).
 */

export {
  DevInstanceClient,
  getDevConfig,
  getSetupInstructions,
  type DevInstanceConfig,
  type QuarkusInfo,
  type Provider,
  type RealmConfig,
  type ServerInfo,
  type ProviderInfo,
} from "./dev-instance-client.js";

export {
  getLoadedExtensions,
  getConfigurationProperties,
  getArcBeans,
  getDevServicesInfo,
  type QuarkusExtension,
  type ConfigProperty,
  type ArcBean,
  type DevServiceInfo,
} from "./quarkus-dev-ui.js";

export {
  readRecentLogs,
  parseLogEntry,
  filterByClass,
  filterByLevel,
  extractStackTrace,
  summarizeAuthFlow,
  type LogLevel,
  type LogEntry,
  type StackTrace,
  type StackFrame,
  type AuthFlowSummary,
  type AuthFlowStep,
} from "./log-analyzer.js";

export {
  correlateProvider,
  findProviderSource,
  compareRegisteredVsSource,
  detectCustomProviders,
  type ProviderCorrelation,
  type CorrelationReport,
  type SourceLocation,
} from "./spi-correlator.js";
