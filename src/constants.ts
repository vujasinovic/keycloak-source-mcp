/**
 * Centralized constants for the keycloak-source-mcp server.
 * Eliminates magic numbers scattered across tool implementations.
 */

/** Result limits for search and display operations. */
export const LIMITS = {
  /** Max files returned from class name search. */
  MAX_SEARCH_RESULTS: 20,
  /** Max results for grep_source tool. */
  MAX_GREP_RESULTS: 100,
  /** Default results for grep_source tool. */
  DEFAULT_GREP_RESULTS: 30,
  /** Max implementors displayed. */
  MAX_IMPLEMENTORS: 40,
  /** Max dependencies traced per level. */
  MAX_DEPENDENCIES: 30,
  /** Max downstream files to explore. */
  MAX_DOWNSTREAM_FILES: 20,
  /** Max implementors in explain_implementation class view. */
  MAX_IMPLEMENTOR_DISPLAY: 15,
  /** Max internal imports displayed. */
  MAX_INTERNAL_IMPORTS_DISPLAY: 20,
  /** Max usage references displayed. */
  MAX_USAGE_DISPLAY: 10,
  /** Max SPIs listed from admin API. */
  MAX_PROVIDERS_DISPLAY: 50,
  /** Max implementations listed per SPI from admin API. */
  MAX_PROVIDER_IMPLS_DISPLAY: 10,
  /** Max recursion depth for dependency tracing. */
  MAX_TRACE_DEPTH: 4,
  /** Max FreeMarker templates displayed. */
  MAX_FREEMARKER_DISPLAY: 10,
  /** Max interfaces to search in topic mode. */
  MAX_INTERFACES_TO_SEARCH: 4,
  /** Max search terms generated from topic. */
  MAX_SEARCH_TERMS: 8,
} as const;

/** Separator strings for consistent output formatting. */
export const SEPARATOR = {
  /** Major section header. */
  HEADER: "=".repeat(60),
  /** Sub-section divider. */
  SECTION: "-".repeat(40),
  /** Footer/summary divider. */
  FOOTER: "-".repeat(60),
} as const;
