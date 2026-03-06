import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { grepSource } from "../../src/tools/grep_source.js";
import { setupMockEnv, cleanupEnv } from "../test-utils.js";

describe("grep_source", () => {
  beforeEach(setupMockEnv);
  afterEach(cleanupEnv);

  it("finds text that exists in source", async () => {
    const result = await grepSource("public interface Authenticator");
    expect(result).toContain("Authenticator.java");
  });

  it("returns file path and line number with each match", async () => {
    const result = await grepSource("void authenticate");
    expect(result).toMatch(/\.java:\d+/);
  });

  it("respects maxResults limit", async () => {
    const result = await grepSource("void", undefined, 2);
    const lines = result.split("\n").filter((l) => l.includes(".java:"));
    expect(lines.length).toBeLessThanOrEqual(2);
  });

  it("supports regex patterns", async () => {
    const result = await grepSource("void\\s+close");
    expect(result).toContain("close");
  });

  it("respects filePattern filter", async () => {
    const result = await grepSource("interface", "*.java");
    expect(result).toContain(".java");
  });

  it("returns no results when nothing found", async () => {
    const result = await grepSource("xyzNonExistentString12345");
    expect(result).toContain("No results found");
  });

  it("returns error for empty input", async () => {
    const result = await grepSource("");
    expect(result).toContain("Error");
  });
});
