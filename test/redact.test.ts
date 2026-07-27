import { describe, expect, it } from "vitest";
import { collectSecretStrings, redactSecrets } from "../src/lib/redact.js";

describe("redactSecrets - object walking", () => {
  it("passes primitives through", () => {
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets("plain text")).toBe("plain text");
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets(null)).toBe(null);
  });

  it("redacts top-level password fields", () => {
    const out = redactSecrets({ user: "u", password: "secret" });
    expect(out).toEqual({ user: "u", password: "***REDACTED***" });
  });

  it("redacts nested objects without recursing forever", () => {
    const cyclic: Record<string, unknown> = { name: "x" };
    cyclic.self = cyclic;
    const out = redactSecrets(cyclic);
    expect(out.name).toBe("x");
    expect(out.self).toBe(cyclic); // stops on cycles via WeakSet
  });

  it("redacts array elements with sensitive keys", () => {
    const out = redactSecrets([{ token: "t" }, { safe: 1 }]);
    expect(out).toEqual([{ token: "***REDACTED***" }, { safe: 1 }]);
  });

  it("redacts by name pattern (case-insensitive)", () => {
    const out = redactSecrets({ MyPassword: "x", APITOKEN: "y" });
    expect(out).toEqual({ MyPassword: "***REDACTED***", APITOKEN: "***REDACTED***" });
  });

  it("does not over-redact a normal field named 'passport' (no exact match)", () => {
    const out = redactSecrets({ passport: "AB123456" });
    expect(out.passport).toBe("AB123456");
  });

  it("redacts fields whose name matches the password pattern", () => {
    const out = redactSecrets({ pwd: "x" });
    expect(out.pwd).toBe("***REDACTED***");
  });
});

describe("redactSecrets - inline string scrubbing", () => {
  it("scrubs secret strings from any field's value", () => {
    const out = redactSecrets(
      { error: "connection failed for user=root password=TopSecret123" },
      ["TopSecret123"],
    );
    expect((out as { error: string }).error).toContain("***REDACTED***");
    expect((out as { error: string }).error).not.toContain("TopSecret123");
  });

  it("scrubs multiple secrets at once", () => {
    const out = redactSecrets({ msg: "SECRETA and SECRETB together" }, ["SECRETA", "SECRETB"]);
    expect((out as { msg: string }).msg).toBe("***REDACTED*** and ***REDACTED*** together");
  });

  it("ignores secrets shorter than 4 chars", () => {
    const out = redactSecrets({ msg: "short ab" }, ["ab"]);
    expect((out as { msg: string }).msg).toBe("short ab");
  });

  it("handles regex metacharacters in secrets", () => {
    const secret = "C:\\secret.path";
    const input = `fail ${secret}`;
    const out = redactSecrets({ msg: input }, [secret]);
    expect((out as { msg: string }).msg).toContain("***REDACTED***");
    expect((out as { msg: string }).msg).not.toContain("secret.path");
  });
});

describe("collectSecretStrings", () => {
  it("collects top-level secret values", () => {
    const found = collectSecretStrings({ user: "u", password: "topsecret" });
    expect(found).toContain("topsecret");
  });

  it("collects from nested objects", () => {
    const found = collectSecretStrings({ connection: { token: "abc" } });
    expect(found).toContain("abc");
  });

  it("ignores non-sensitive fields", () => {
    const found = collectSecretStrings({ server: "x", database: "y" });
    expect(found).toEqual([]);
  });

  it("deduplicates identical secrets", () => {
    const found = collectSecretStrings({ a: { password: "same" }, b: { token: "same" } });
    expect(found.filter((s) => s === "same")).toHaveLength(1);
  });
});
