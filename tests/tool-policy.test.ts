import { describe, it, expect } from "@jest/globals";
import {
  matchToolPattern,
  allowedPatternsForUser,
  isToolAllowed,
  filterToolsForUser,
  rolesForTool,
  effectiveRole,
  assertToolPolicy,
  type ToolPolicy,
} from "../src/server/tool-policy.js";
import { parseToolPolicy } from "../src/server/config.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const POLICY: ToolPolicy = {
  roles: {
    admin: ["*"],
    fileclerk: ["fs.*"],
    accountant: ["erp.book", "fs.read"],
  },
  userRoles: {
    alice: "admin",
    bob: "fileclerk",
    carol: "accountant",
    // dave is intentionally unmapped → fail-closed.
  },
};

const tools = [
  { name: "fs.read" },
  { name: "fs.write" },
  { name: "erp.book" },
  { name: "calculator.evaluate" },
];

describe("matchToolPattern", () => {
  it("matches the wildcard, prefix and exact forms", () => {
    expect(matchToolPattern("*", "anything.at.all")).toBe(true);
    expect(matchToolPattern("fs.*", "fs.read")).toBe(true);
    expect(matchToolPattern("fs.*", "erp.book")).toBe(false);
    expect(matchToolPattern("erp.book", "erp.book")).toBe(true);
    expect(matchToolPattern("erp.book", "erp.list")).toBe(false);
  });
});

describe("filterToolsForUser", () => {
  it("admin (wildcard) keeps every tool", () => {
    expect(filterToolsForUser(POLICY, "alice", tools).map((t) => t.name)).toEqual([
      "fs.read",
      "fs.write",
      "erp.book",
      "calculator.evaluate",
    ]);
  });

  it("prefix role only keeps the matching namespace", () => {
    expect(filterToolsForUser(POLICY, "bob", tools).map((t) => t.name)).toEqual(["fs.read", "fs.write"]);
  });

  it("exact-name role keeps only the listed tools", () => {
    expect(filterToolsForUser(POLICY, "carol", tools).map((t) => t.name)).toEqual(["fs.read", "erp.book"]);
  });

  it("unknown user is fail-closed: no tools at all", () => {
    expect(allowedPatternsForUser(POLICY, "dave")).toEqual([]);
    expect(filterToolsForUser(POLICY, "dave", tools)).toEqual([]);
    expect(isToolAllowed(POLICY, "dave", "fs.read")).toBe(false);
  });

  it("user mapped to an undefined role is also fail-closed", () => {
    const broken: ToolPolicy = { roles: {}, userRoles: { eve: "ghost" } };
    expect(filterToolsForUser(broken, "eve", tools)).toEqual([]);
  });

  it("without a policy every tool is allowed (regression / no breaking change)", () => {
    expect(filterToolsForUser(undefined, "whoever", tools)).toEqual(tools);
  });
});

describe("rolesForTool / effectiveRole", () => {
  it("lists every role that may use a tool (sorted)", () => {
    expect(rolesForTool(POLICY, "fs.read")).toEqual(["admin", "accountant", "fileclerk"].sort());
    expect(rolesForTool(POLICY, "erp.book")).toEqual(["accountant", "admin"]);
    expect(rolesForTool(POLICY, "calculator.evaluate")).toEqual(["admin"]);
  });

  it("reports the effective role for accountability", () => {
    expect(effectiveRole(POLICY, "alice")).toBe("admin");
    expect(effectiveRole(POLICY, "dave")).toContain("least privilege");
    expect(effectiveRole(undefined, "alice")).toContain("keine Policy");
  });
});

describe("parseToolPolicy (env)", () => {
  it("returns undefined when unset", () => {
    expect(parseToolPolicy(undefined)).toBeUndefined();
    expect(parseToolPolicy("   ")).toBeUndefined();
  });

  it("parses inline JSON", () => {
    const parsed = parseToolPolicy(JSON.stringify(POLICY));
    expect(parsed?.userRoles.alice).toBe("admin");
  });

  it("reads a JSON file when the value is an existing path", () => {
    const dir = mkdtempSync(join(tmpdir(), "tool-policy-"));
    const file = join(dir, "policy.json");
    writeFileSync(file, JSON.stringify(POLICY));
    try {
      const parsed = parseToolPolicy(file);
      expect(parsed?.roles.fileclerk).toEqual(["fs.*"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws on structurally invalid policies", () => {
    expect(() => parseToolPolicy('{"roles":{}}')).toThrow(/userRoles/);
    expect(() => assertToolPolicy({ roles: { r: [1] }, userRoles: {} })).toThrow(/pattern/);
    expect(() => parseToolPolicy("{not json")).toThrow(/inline JSON/);
  });
});
