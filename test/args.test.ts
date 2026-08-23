import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import {
  assertKnownFlags,
  assertMaxPositionals,
  flagBool,
  flagNumber,
  flagString,
  objectTarget,
  parseArgs,
  splitQualifiedName,
  sqlArgument,
} from "../src/lib/args.js";

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

describe("sqlArgument", () => {
  it("prefers --sql", () => {
    expect(sqlArgument(parseArgs(["--sql", "SELECT 1", "SELECT 2"]))).toBe("SELECT 1");
  });

  it("falls back to the first positional", () => {
    expect(sqlArgument(parseArgs(["SELECT 2"]))).toBe("SELECT 2");
  });

  it("ignores blank values", () => {
    expect(sqlArgument(parseArgs(["--sql", "   "]))).toBeUndefined();
    expect(sqlArgument(parseArgs([]))).toBeUndefined();
  });
});

describe("splitQualifiedName", () => {
  it("returns a bare name unqualified", () => {
    expect(splitQualifiedName("Users")).toEqual({ name: "Users" });
  });

  it("splits schema.name", () => {
    expect(splitQualifiedName("dbo.Users")).toEqual({ schema: "dbo", name: "Users" });
  });

  it("unwraps brackets", () => {
    expect(splitQualifiedName("[dbo].[Order Lines]")).toEqual({
      schema: "dbo",
      name: "Order Lines",
    });
  });

  it("keeps dots inside brackets", () => {
    expect(splitQualifiedName("[my.schema].[my.table]")).toEqual({
      schema: "my.schema",
      name: "my.table",
    });
  });

  it("uses the last two parts of db.schema.name", () => {
    expect(splitQualifiedName("app.dbo.Users")).toEqual({ schema: "dbo", name: "Users" });
  });
});

describe("assertMaxPositionals", () => {
  it("passes when at or under the maximum", () => {
    expect(() => assertMaxPositionals(parseArgs(["a", "b"]), 2, "cmd", "usage")).not.toThrow();
    expect(() => assertMaxPositionals(parseArgs(["a"]), 2, "cmd", "usage")).not.toThrow();
    expect(() => assertMaxPositionals(parseArgs([]), 0, "cmd", "usage")).not.toThrow();
  });

  it("throws a structured VALIDATION_ERROR naming the extra argument", () => {
    try {
      assertMaxPositionals(parseArgs(["a", "b", "c"]), 1, "sample", "usage hint");
      expect.unreachable();
    } catch (e) {
      const err = e as AxiError;
      expect(err).toBeInstanceOf(AxiError);
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.message).toContain("too many arguments");
      expect(err.message).toContain("'b'");
      expect(err.suggestions).toEqual(["usage hint"]);
    }
  });
});

describe("objectTarget", () => {
  it("reads --schema and --name", () => {
    expect(objectTarget(parseArgs(["--schema", "sales", "--name", "Orders"]))).toEqual({
      schema: "sales",
      name: "Orders",
    });
  });

  it("splits a qualified positional", () => {
    expect(objectTarget(parseArgs(["sales.Orders"]))).toEqual({
      schema: "sales",
      name: "Orders",
    });
  });

  it("lets an explicit --schema win over the qualified name", () => {
    expect(objectTarget(parseArgs(["dbo.Orders", "--schema", "sales"]))).toEqual({
      schema: "sales",
      name: "Orders",
    });
  });

  it("returns no name when nothing was given", () => {
    expect(objectTarget(parseArgs(["--schema", "dbo"]))).toEqual({
      schema: "dbo",
      name: undefined,
    });
  });
});
