import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { explainImplementation } from "../../src/tools/explain_implementation.js";
import { setupMockEnv, cleanupEnv } from "../test-utils.js";

describe("explain_implementation", () => {
  beforeEach(setupMockEnv);
  afterEach(cleanupEnv);

  describe("topic-based queries", () => {
    it("returns key classes for known topics", async () => {
      const result = await explainImplementation("authentication flow");
      expect(result).toContain("Key Classes");
    });

    it("returns main interfaces section with method signatures", async () => {
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

    it("finds event listener related content", async () => {
      const result = await explainImplementation("event listener");
      expect(result).toContain("Key Classes");
    });

    it("suggests known topics when no match found", async () => {
      const result = await explainImplementation("quantum teleportation");
      expect(result).toContain("did not match a known topic pattern");
      expect(result).toContain("authentication flow");
    });
  });

  describe("class-based queries", () => {
    it("returns deep analysis for a PascalCase class name", async () => {
      const result = await explainImplementation("Authenticator");
      expect(result).toContain("Deep Analysis: Authenticator");
      expect(result).toContain("Overview");
      expect(result).toContain("Methods");
      expect(result).toContain("Full Source");
    });

    it("includes method signatures for class queries", async () => {
      const result = await explainImplementation("Authenticator");
      expect(result).toContain("authenticate");
      expect(result).toContain("AuthenticationFlowContext");
    });

    it("finds implementors for interfaces", async () => {
      const result = await explainImplementation("Authenticator");
      expect(result).toContain("Known Implementors");
    });

    it("handles natural language class queries", async () => {
      const result = await explainImplementation("Explain how UsernamePasswordForm works");
      expect(result).toContain("Deep Analysis: UsernamePasswordForm");
      expect(result).toContain("Overview");
    });

    it("shows hierarchy for classes with extends/implements", async () => {
      const result = await explainImplementation("UsernamePasswordForm");
      expect(result).toContain("Interface / Superclass Hierarchy");
      expect(result).toContain("AbstractUsernameFormAuthenticator");
    });

    it("shows Keycloak dependencies", async () => {
      const result = await explainImplementation("UsernamePasswordForm");
      expect(result).toContain("Keycloak Dependencies");
    });

    it("handles non-existent class gracefully", async () => {
      const result = await explainImplementation("NonExistentClassFoo");
      expect(result).toContain("Could not find class");
    });
  });

  describe("edge cases", () => {
    it("returns error for empty input", async () => {
      const result = await explainImplementation("");
      expect(result).toContain("Error");
    });

    it("returns error for whitespace-only input", async () => {
      const result = await explainImplementation("   ");
      expect(result).toContain("Error");
    });
  });
});
