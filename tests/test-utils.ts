import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { versionManager } from "../src/version-manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const MOCK_SOURCE_PATH = path.join(__dirname, "fixtures", "keycloak-mock-source");
export const MOCK_SOURCE_V2_PATH = path.join(__dirname, "fixtures", "keycloak-mock-source-v2");

/**
 * Set KEYCLOAK_SOURCE_PATH to the mock fixture for testing.
 */
export function setupMockEnv(): void {
  process.env.KEYCLOAK_SOURCE_PATH = MOCK_SOURCE_PATH;
}

/**
 * Set up multi-version env vars for testing.
 */
export function setupMultiVersionEnv(): void {
  process.env.KEYCLOAK_SOURCE_PATH = MOCK_SOURCE_PATH;
  process.env.KEYCLOAK_SOURCE_VTEST = MOCK_SOURCE_PATH;
  process.env.KEYCLOAK_SOURCE_VV2 = MOCK_SOURCE_V2_PATH;
}

/**
 * Clean up env vars after tests.
 */
export function cleanupEnv(): void {
  delete process.env.KEYCLOAK_SOURCE_PATH;
  delete process.env.KEYCLOAK_SOURCE_VTEST;
  delete process.env.KEYCLOAK_SOURCE_VV2;
  versionManager._reset();
}

/**
 * Assert that a result string contains expected text.
 */
export function assertContains(result: string, expected: string): void {
  if (!result.includes(expected)) {
    throw new Error(`Expected result to contain "${expected}", but got:\n${result.slice(0, 500)}`);
  }
}

/**
 * Assert that a result string does NOT contain expected text.
 */
export function assertNotContains(result: string, notExpected: string): void {
  if (result.includes(notExpected)) {
    throw new Error(`Expected result NOT to contain "${notExpected}", but it did`);
  }
}
