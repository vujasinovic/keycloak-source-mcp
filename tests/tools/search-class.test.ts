import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { searchClass } from "../../src/tools/search_class.js";
import { setupMockEnv, cleanupEnv } from "../test-utils.js";

describe("search_class", () => {
  beforeEach(setupMockEnv);
  afterEach(cleanupEnv);

  it("finds exact class name match", async () => {
    const result = await searchClass("Authenticator");
    expect(result).toContain("Authenticator.java");
  });

  it("finds partial class name match", async () => {
    const result = await searchClass("Username");
    expect(result).toContain("UsernamePasswordForm");
  });

  it("returns file path relative to source root", async () => {
    const result = await searchClass("Authenticator");
    expect(result).toContain("services/src/main/java");
  });

  it("returns package name in result", async () => {
    const result = await searchClass("Authenticator");
    expect(result).toContain("org.keycloak");
  });

  it("returns no results message when nothing found", async () => {
    const result = await searchClass("NonExistentClass12345");
    expect(result).toContain("No results found");
  });

  it("returns error for empty input", async () => {
    const result = await searchClass("");
    expect(result).toContain("Error");
  });
});
