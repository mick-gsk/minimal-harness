import { describe, it, expect } from "@jest/globals";
import { parseApiKeys, parseList } from "../src/server/config.js";

describe("parseApiKeys", () => {
  it("parses key:user pairs", () => {
    expect(parseApiKeys("sk-a:alice,sk-b:bob")).toEqual({ "sk-a": "alice", "sk-b": "bob" });
  });

  it("tolerates whitespace around entries", () => {
    expect(parseApiKeys(" sk-a : alice , sk-b : bob ")).toEqual({ "sk-a": "alice", "sk-b": "bob" });
  });

  it("fails fast on missing or malformed input", () => {
    expect(() => parseApiKeys(undefined)).toThrow(/API_KEYS is required/);
    expect(() => parseApiKeys("")).toThrow(/API_KEYS is required/);
    expect(() => parseApiKeys("no-colon")).toThrow(/key:userId/);
    expect(() => parseApiKeys("sk-a:")).toThrow(/key:userId/);
    expect(() => parseApiKeys(":alice")).toThrow(/key:userId/);
  });

  it("rejects duplicate keys without echoing the secret", () => {
    expect(() => parseApiKeys("sk-a:alice,sk-a:bob")).toThrow(/duplicate/);
    try {
      parseApiKeys("sk-a:alice,sk-a:bob");
    } catch (err) {
      expect((err as Error).message).not.toContain("sk-a");
    }
  });
});

describe("parseList", () => {
  it("splits, trims and drops empties", () => {
    expect(parseList(" a, b ,,c ")).toEqual(["a", "b", "c"]);
    expect(parseList(undefined)).toEqual([]);
  });
});
