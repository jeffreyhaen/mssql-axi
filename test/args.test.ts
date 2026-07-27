import { describe, expect, it } from "vitest";
import { assertKnownFlags, flagBool, flagNumber, flagString, parseArgs } from "../src/lib/args.js";

describe("parseArgs", () => {
  it("returns empty args for an empty array", () => {
    expect(parseArgs([])).toEqual({ flags: {}, positionals: [] });
  });

  it("parses --key value", () => {
    expect(parseArgs(["--server", "localhost"])).toEqual({
      flags: { server: "localhost" },
      positionals: [],
    });
  });

  it("parses --key=value", () => {
    expect(parseArgs(["--limit=10"])).toEqual({
      flags: { limit: "10" },
      positionals: [],
    });
  });

  it("treats a bare --flag with no following non-flag value as boolean true", () => {
    expect(parseArgs(["--execute"])).toEqual({ flags: { execute: true }, positionals: [] });
  });

  it("does not eat a flag-shaped value as the argument to a bare --flag", () => {
    // --execute --sql "..."  should NOT have sql as the value of execute
    expect(parseArgs(["--execute", "--sql", "x"])).toEqual({
      flags: { execute: true, sql: "x" },
      positionals: [],
    });
  });

  it("captures positionals before any flags", () => {
    expect(parseArgs(["Users", "--limit", "5"])).toEqual({
      flags: { limit: "5" },
      positionals: ["Users"],
    });
  });

  it("captures multiple positionals", () => {
    expect(parseArgs(["a", "b", "c"])).toEqual({
      flags: {},
      positionals: ["a", "b", "c"],
    });
  });
});

describe("flag accessors", () => {
  it("flagString returns the value when present", () => {
    const a = parseArgs(["--server", "x"]);
    expect(flagString(a, "server")).toBe("x");
  });

  it("flagString returns undefined for a bare flag", () => {
    const a = parseArgs(["--execute"]);
    expect(flagString(a, "execute")).toBeUndefined();
  });

  it("flagString returns undefined for a missing key", () => {
    const a = parseArgs([]);
    expect(flagString(a, "missing")).toBeUndefined();
  });

  it("flagBool returns true only for bare --flag", () => {
    expect(flagBool(parseArgs(["--x"]), "x")).toBe(true);
    expect(flagBool(parseArgs(["--x", "y"]), "x")).toBe(false);
  });

  it("flagNumber parses and returns finite numbers", () => {
    expect(flagNumber(parseArgs(["--n", "42"]), "n")).toBe(42);
  });

  it("flagNumber throws on non-numeric values", () => {
    expect(() => flagNumber(parseArgs(["--n", "abc"]), "n")).toThrow(/expects a number/);
  });
});

describe("assertKnownFlags", () => {
  it("passes when all flags are known", () => {
    const a = parseArgs(["--server", "x", "--limit", "5"]);
    expect(() => assertKnownFlags(a, ["server", "limit"], "list")).not.toThrow();
  });

  it("throws with a useful message when an unknown flag is present", () => {
    const a = parseArgs(["--server", "x", "--foobar", "1"]);
    expect(() => assertKnownFlags(a, ["server"], "list")).toThrow(/unknown flag --foobar/);
  });
});
