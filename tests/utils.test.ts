import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseJavaClass,
  formatResults,
  getSourcePath,
  findClassFile,
  resolveToAbsolute,
  stripSourcePrefix,
  buildMethodMap,
  formatMethodSignature,
  type ParsedMethod,
} from "../src/utils.js";
import { setupMockEnv, cleanupEnv, MOCK_SOURCE_PATH } from "./test-utils.js";
import * as fs from "node:fs";
import * as path from "node:path";

describe("parseJavaClass", () => {
  it("extracts class name and package from a class", () => {
    const source = fs.readFileSync(
      path.join(MOCK_SOURCE_PATH, "services/src/main/java/org/keycloak/authentication/authenticators/UsernamePasswordForm.java"),
      "utf-8"
    );
    const parsed = parseJavaClass(source);
    expect(parsed.className).toBe("UsernamePasswordForm");
    expect(parsed.packageName).toBe("org.keycloak.authentication.authenticators");
  });

  it("extracts extends declaration", () => {
    const source = fs.readFileSync(
      path.join(MOCK_SOURCE_PATH, "services/src/main/java/org/keycloak/authentication/authenticators/UsernamePasswordForm.java"),
      "utf-8"
    );
    const parsed = parseJavaClass(source);
    expect(parsed.extendsList).toContain("AbstractUsernameFormAuthenticator");
  });

  it("extracts implements declaration", () => {
    const source = fs.readFileSync(
      path.join(MOCK_SOURCE_PATH, "services/src/main/java/org/keycloak/authentication/authenticators/AbstractUsernameFormAuthenticator.java"),
      "utf-8"
    );
    const parsed = parseJavaClass(source);
    expect(parsed.implementsList).toContain("Authenticator");
  });

  it("extracts import statements", () => {
    const source = fs.readFileSync(
      path.join(MOCK_SOURCE_PATH, "services/src/main/java/org/keycloak/authentication/Authenticator.java"),
      "utf-8"
    );
    const parsed = parseJavaClass(source);
    expect(parsed.imports).toContain("org.keycloak.models.RealmModel");
    expect(parsed.imports).toContain("org.keycloak.models.UserModel");
  });

  it("extracts method signatures from an interface", () => {
    const source = fs.readFileSync(
      path.join(MOCK_SOURCE_PATH, "services/src/main/java/org/keycloak/authentication/Authenticator.java"),
      "utf-8"
    );
    const parsed = parseJavaClass(source);
    const methodNames = parsed.methods.map((m) => m.name);
    expect(methodNames).toContain("authenticate");
    expect(methodNames).toContain("action");
    expect(methodNames).toContain("requiresUser");
    expect(methodNames).toContain("close");
  });

  it("extracts method return types", () => {
    const source = fs.readFileSync(
      path.join(MOCK_SOURCE_PATH, "services/src/main/java/org/keycloak/authentication/Authenticator.java"),
      "utf-8"
    );
    const parsed = parseJavaClass(source);
    const requiresUser = parsed.methods.find((m) => m.name === "requiresUser");
    expect(requiresUser?.returnType).toBe("boolean");

    const authenticate = parsed.methods.find((m) => m.name === "authenticate");
    expect(authenticate?.returnType).toBe("void");
  });

  it("extracts javadoc comments", () => {
    const source = fs.readFileSync(
      path.join(MOCK_SOURCE_PATH, "services/src/main/java/org/keycloak/authentication/Authenticator.java"),
      "utf-8"
    );
    const parsed = parseJavaClass(source);
    const authenticate = parsed.methods.find((m) => m.name === "authenticate");
    expect(authenticate?.javadoc).toContain("authenticate a user");
  });

  it("handles interfaces correctly", () => {
    const source = fs.readFileSync(
      path.join(MOCK_SOURCE_PATH, "services/src/main/java/org/keycloak/models/RealmModel.java"),
      "utf-8"
    );
    const parsed = parseJavaClass(source);
    expect(parsed.className).toBe("RealmModel");
    expect(parsed.implementsList).toEqual([]);
    expect(parsed.extendsList).toEqual([]);
  });

  it("handles files with no implements/extends", () => {
    const source = `package com.test;\npublic class Simple {\n  public void doSomething() {}\n}`;
    const parsed = parseJavaClass(source);
    expect(parsed.className).toBe("Simple");
    expect(parsed.implementsList).toEqual([]);
    expect(parsed.extendsList).toEqual([]);
  });
});

describe("formatResults", () => {
  it("formats results with title", () => {
    const result = formatResults("Test Title", ["item1", "item2"], 10);
    expect(result).toContain("Test Title");
    expect(result).toContain("item1");
    expect(result).toContain("item2");
  });

  it("returns no results message when empty", () => {
    const result = formatResults("Test Title", [], 10);
    expect(result).toContain("No results found");
  });

  it("truncates results beyond maxResults", () => {
    const items = Array.from({ length: 10 }, (_, i) => `item${i}`);
    const result = formatResults("Title", items, 3);
    expect(result).toContain("item0");
    expect(result).toContain("item2");
    expect(result).toContain("7 more results");
    expect(result).not.toContain("item5");
  });
});

describe("getSourcePath", () => {
  beforeEach(setupMockEnv);
  afterEach(cleanupEnv);

  it("returns path from KEYCLOAK_SOURCE_PATH", () => {
    expect(getSourcePath()).toBe(MOCK_SOURCE_PATH);
  });

  it("throws when env var not set", () => {
    delete process.env.KEYCLOAK_SOURCE_PATH;
    expect(() => getSourcePath()).toThrow("KEYCLOAK_SOURCE_PATH");
  });

  it("throws when path does not exist", () => {
    process.env.KEYCLOAK_SOURCE_PATH = "/nonexistent/path";
    expect(() => getSourcePath()).toThrow("does not exist");
  });
});

// ── Tests for shared helpers ──

describe("findClassFile", () => {
  beforeEach(setupMockEnv);
  afterEach(cleanupEnv);

  it("finds a class by name", async () => {
    const result = await findClassFile(MOCK_SOURCE_PATH, "Authenticator");
    expect(result).not.toBeNull();
    expect(result!).toContain("Authenticator.java");
  });

  it("returns null for non-existent class", async () => {
    const result = await findClassFile(MOCK_SOURCE_PATH, "NonExistentClass12345");
    expect(result).toBeNull();
  });

  it("returns an absolute path", async () => {
    const result = await findClassFile(MOCK_SOURCE_PATH, "Authenticator");
    expect(result).not.toBeNull();
    expect(path.isAbsolute(result!)).toBe(true);
  });
});

describe("resolveToAbsolute", () => {
  it("returns absolute path unchanged", () => {
    expect(resolveToAbsolute("/absolute/path.java", "/base")).toBe("/absolute/path.java");
  });

  it("joins relative path with base", () => {
    expect(resolveToAbsolute("relative/path.java", "/base")).toBe("/base/relative/path.java");
  });
});

describe("stripSourcePrefix", () => {
  it("strips matching prefix", () => {
    expect(stripSourcePrefix("/src/keycloak/Foo.java", "/src/keycloak")).toBe("Foo.java");
  });

  it("returns line unchanged when prefix does not match", () => {
    expect(stripSourcePrefix("/other/Foo.java", "/src/keycloak")).toBe("/other/Foo.java");
  });
});

describe("buildMethodMap", () => {
  it("builds a map keyed by method name", () => {
    const methods: ParsedMethod[] = [
      { name: "foo", returnType: "void", parameters: "", modifiers: [], javadoc: "" },
      { name: "bar", returnType: "String", parameters: "int x", modifiers: ["public"], javadoc: "" },
    ];
    const map = buildMethodMap(methods);
    expect(map.size).toBe(2);
    expect(map.get("foo")?.returnType).toBe("void");
    expect(map.get("bar")?.parameters).toBe("int x");
  });

  it("handles empty array", () => {
    const map = buildMethodMap([]);
    expect(map.size).toBe(0);
  });
});

describe("formatMethodSignature", () => {
  it("formats a method signature correctly", () => {
    const method: ParsedMethod = {
      name: "authenticate",
      returnType: "void",
      parameters: "AuthenticationFlowContext context",
      modifiers: ["public"],
      javadoc: "",
    };
    expect(formatMethodSignature(method)).toBe("void authenticate(AuthenticationFlowContext context)");
  });
});
