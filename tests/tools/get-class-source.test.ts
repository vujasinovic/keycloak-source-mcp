import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getClassSource } from "../../src/tools/get_class_source.js";
import { setupMockEnv, cleanupEnv } from "../test-utils.js";

describe("get_class_source", () => {
  beforeEach(setupMockEnv);
  afterEach(cleanupEnv);

  it("returns full file content for valid path", async () => {
    const result = await getClassSource(
      "services/src/main/java/org/keycloak/authentication/Authenticator.java"
    );
    expect(result).toContain("public interface Authenticator");
    expect(result).toContain("void authenticate");
  });

  it("includes file path header in output", async () => {
    const result = await getClassSource(
      "services/src/main/java/org/keycloak/authentication/Authenticator.java"
    );
    expect(result).toContain("File:");
    expect(result).toContain("Authenticator.java");
  });

  it("auto-discovers file when given just a filename", async () => {
    const result = await getClassSource("Authenticator.java");
    expect(result).toContain("public interface Authenticator");
  });

  it("returns helpful error for non-existent path", async () => {
    const result = await getClassSource("nonexistent/path/Foo.java");
    expect(result).toContain("Error");
  });

  it("returns error for empty input", async () => {
    const result = await getClassSource("");
    expect(result).toContain("Error");
  });
});
