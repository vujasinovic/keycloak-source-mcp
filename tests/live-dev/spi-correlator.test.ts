/**
 * Tests for the SPI correlator — matching live providers with source code.
 *
 * Uses the existing mock Keycloak source fixtures from tests/fixtures/keycloak-mock-source.
 * Tests verify that provider correlation, custom detection, and source matching work correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { setupMockEnv, cleanupEnv, MOCK_SOURCE_PATH } from "../test-utils.js";
import {
  correlateProvider,
  detectCustomProviders,
  compareRegisteredVsSource,
} from "../../src/live-dev/spi-correlator.js";
import type { Provider } from "../../src/live-dev/dev-instance-client.js";

describe("spi-correlator", () => {
  beforeEach(setupMockEnv);
  afterEach(cleanupEnv);

  // Verify correlateProvider finds source for a known class in mock fixtures
  it("correlateProvider finds source for known provider", async () => {
    const provider: Provider = {
      spiType: "authenticator",
      providerId: "username-password-form",
      factoryClass: "org.keycloak.authentication.authenticators.UsernamePasswordForm",
      isBuiltIn: true,
    };

    const result = await correlateProvider(provider);
    expect(result.sourceFound).toBe(true);
    expect(result.sourceFile).toContain("UsernamePasswordForm");
  });

  // Verify correlateProvider returns sourceFound=false for unknown provider
  it("correlateProvider returns null gracefully for unknown provider", async () => {
    const provider: Provider = {
      spiType: "authenticator",
      providerId: "nonexistent-auth",
      factoryClass: "com.example.NonExistentFactory",
      isBuiltIn: false,
    };

    const result = await correlateProvider(provider);
    expect(result.sourceFound).toBe(false);
    expect(result.sourceFile).toBeNull();
  });

  // Verify detectCustomProviders filters out built-in providers
  it("detectCustomProviders correctly identifies non-core providers", () => {
    const providers: Provider[] = [
      { spiType: "authenticator", providerId: "a", factoryClass: "org.keycloak.Foo", isBuiltIn: true },
      { spiType: "authenticator", providerId: "b", factoryClass: "com.mycompany.Bar", isBuiltIn: false },
      { spiType: "event-listener", providerId: "c", factoryClass: "org.keycloak.Baz", isBuiltIn: true },
    ];

    const custom = detectCustomProviders(providers);
    expect(custom.length).toBe(1);
    expect(custom[0].providerId).toBe("b");
    expect(custom[0].factoryClass).toContain("mycompany");
  });

  // Verify detectCustomProviders returns empty for all built-in providers
  it("detectCustomProviders returns empty for all built-in", () => {
    const providers: Provider[] = [
      { spiType: "authenticator", providerId: "a", factoryClass: "org.keycloak.Foo", isBuiltIn: true },
    ];
    expect(detectCustomProviders(providers).length).toBe(0);
  });

  // Verify compareRegisteredVsSource produces a correct report
  it("compareRegisteredVsSource identifies mismatches", async () => {
    const providers: Provider[] = [
      {
        spiType: "authenticator",
        providerId: "username-password-form",
        factoryClass: "org.keycloak.authentication.authenticators.UsernamePasswordForm",
        isBuiltIn: true,
      },
      {
        spiType: "authenticator",
        providerId: "nonexistent",
        factoryClass: "com.example.NonExistent",
        isBuiltIn: false,
      },
    ];

    const report = await compareRegisteredVsSource(providers);
    expect(report.totalProviders).toBe(2);
    expect(report.correlatedCount).toBeGreaterThanOrEqual(1);
    expect(report.uncorrelatedCount).toBeGreaterThanOrEqual(1);
    expect(report.summary).toContain("Provider Correlation Report");
  });
});
