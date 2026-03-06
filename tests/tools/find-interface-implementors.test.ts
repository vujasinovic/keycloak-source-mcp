import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findInterfaceImplementors } from "../../src/tools/find_interface_implementors.js";
import { setupMockEnv, cleanupEnv } from "../test-utils.js";

describe("find_interface_implementors", () => {
  beforeEach(setupMockEnv);
  afterEach(cleanupEnv);

  it("finds direct implementors (implements X)", async () => {
    const result = await findInterfaceImplementors("Authenticator");
    expect(result).toContain("AbstractUsernameFormAuthenticator");
  });

  it("finds subclasses (extends X)", async () => {
    const result = await findInterfaceImplementors("AbstractUsernameFormAuthenticator");
    expect(result).toContain("UsernamePasswordForm");
  });

  it("returns file path and matching line for each result", async () => {
    const result = await findInterfaceImplementors("Authenticator");
    expect(result).toContain(".java");
    expect(result).toContain("implements Authenticator");
  });

  it("returns no results when nothing found", async () => {
    const result = await findInterfaceImplementors("NonExistentInterface99");
    expect(result).toContain("No results found");
  });

  it("returns error for empty input", async () => {
    const result = await findInterfaceImplementors("");
    expect(result).toContain("Error");
  });
});
