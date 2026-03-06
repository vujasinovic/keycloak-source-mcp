import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { explainImplementation } from "../../src/tools/explain_implementation.js";
import { setupMockEnv, cleanupEnv } from "../test-utils.js";

describe("explain_implementation", () => {
  beforeEach(setupMockEnv);
  afterEach(cleanupEnv);

  it("returns key classes for known topics", async () => {
    const result = await explainImplementation("authentication flow");
    expect(result).toContain("Key Classes");
  });

  it("returns main interfaces section", async () => {
    const result = await explainImplementation("authentication flow");
    expect(result).toContain("Main Interfaces");
  });

  it("returns SPI extension points section", async () => {
    const result = await explainImplementation("authentication flow");
    expect(result).toContain("SPI Extension Points");
  });

  it("handles unknown topics gracefully", async () => {
    const result = await explainImplementation("quantum teleportation");
    expect(result).toContain("Keycloak Implementation Analysis");
    expect(result).not.toContain("Error");
  });

  it("returns error for empty input", async () => {
    const result = await explainImplementation("");
    expect(result).toContain("Error");
  });

  it("finds event listener related content", async () => {
    const result = await explainImplementation("event listener");
    expect(result).toContain("Key Classes");
  });
});
