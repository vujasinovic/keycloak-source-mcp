import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { searchSpiDefinitions } from "../../src/tools/search_spi_definitions.js";
import { setupMockEnv, cleanupEnv } from "../test-utils.js";

describe("search_spi_definitions", () => {
  beforeEach(setupMockEnv);
  afterEach(cleanupEnv);

  it("lists all META-INF/services files when no filter", async () => {
    const result = await searchSpiDefinitions();
    expect(result).toContain("SPI Definitions");
    expect(result).toContain("AuthenticatorFactory");
    expect(result).toContain("RequiredActionFactory");
    expect(result).toContain("EventListenerProviderFactory");
  });

  it("filters by SPI name when filter provided", async () => {
    const result = await searchSpiDefinitions("Authenticator");
    expect(result).toContain("AuthenticatorFactory");
    expect(result).not.toContain("EventListenerProviderFactory");
  });

  it("returns interface name and listed providers", async () => {
    const result = await searchSpiDefinitions("Authenticator");
    expect(result).toContain("UsernamePasswordFormFactory");
    expect(result).toContain("OTPFormFactory");
  });

  it("returns no results for non-matching filter", async () => {
    const result = await searchSpiDefinitions("NonExistentSpi");
    expect(result).toContain("No SPI definitions found");
  });
});
