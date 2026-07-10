import { describe, it, expect } from "@jest/globals";
import { ApiKeyAuth } from "../src/server/auth.js";

describe("ApiKeyAuth", () => {
  const auth = new ApiKeyAuth({ "sk-alice-1": "alice", "sk-bob-2": "bob" });

  it("resolves a valid bearer token to its user", () => {
    expect(auth.resolveUser("Bearer sk-alice-1")).toBe("alice");
    expect(auth.resolveUser("Bearer sk-bob-2")).toBe("bob");
  });

  it("rejects unknown keys", () => {
    expect(auth.resolveUser("Bearer sk-mallory")).toBeNull();
  });

  it("rejects missing or malformed headers", () => {
    expect(auth.resolveUser(undefined)).toBeNull();
    expect(auth.resolveUser("")).toBeNull();
    expect(auth.resolveUser("sk-alice-1")).toBeNull(); // no Bearer prefix
    expect(auth.resolveUser("Basic sk-alice-1")).toBeNull();
  });

  it("rejects keys that are a prefix of a valid key", () => {
    expect(auth.resolveUser("Bearer sk-alice")).toBeNull();
    expect(auth.resolveUser("Bearer sk-alice-11")).toBeNull();
  });
});
