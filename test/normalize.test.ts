import { describe, expect, it } from "vitest";
import { isDestructive, normaliseSql } from "../src/lib/normalize.js";

describe("normaliseSql", () => {
  it("collapses whitespace", () => {
    expect(normaliseSql("SELECT  1")).toBe("SELECT 1");
    expect(normaliseSql("SELECT\n\t1")).toBe("SELECT 1");
  });

  it("strips line comments", () => {
    expect(normaliseSql("-- comment\nSELECT 1")).toBe("SELECT 1");
  });

  it("strips block comments", () => {
    expect(normaliseSql("/* hint */ SELECT 1")).toBe("SELECT 1");
  });

  it("preserves content inside string literals", () => {
    expect(normaliseSql("SELECT 'a  b'")).toBe("SELECT 'a b'");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseSql("  SELECT 1  ")).toBe("SELECT 1");
  });
});

describe("isDestructive", () => {
  it("flags DROP TABLE", () => {
    const r = isDestructive("DROP TABLE dbo.Users");
    expect(r.destructive).toBe(true);
    expect(r.reason).toMatch(/DROP/);
  });

  it("flags TRUNCATE", () => {
    expect(isDestructive("TRUNCATE TABLE dbo.Users").destructive).toBe(true);
  });

  it("flags DELETE without WHERE", () => {
    expect(isDestructive("DELETE FROM dbo.Users").destructive).toBe(true);
  });

  it("does NOT flag DELETE with WHERE", () => {
    expect(isDestructive("DELETE FROM dbo.Users WHERE id = 1").destructive).toBe(false);
  });

  it("flags UPDATE without WHERE", () => {
    expect(isDestructive("UPDATE dbo.Users SET active = 0").destructive).toBe(true);
  });

  it("does NOT flag UPDATE with WHERE", () => {
    expect(isDestructive("UPDATE dbo.Users SET active = 0 WHERE id = 1").destructive).toBe(
      false,
    );
  });

  it("does NOT flag INSERT", () => {
    expect(
      isDestructive("INSERT INTO dbo.Users (name) VALUES ('x')").destructive,
    ).toBe(false);
  });

  it("does NOT flag MERGE with WHEN MATCHED", () => {
    expect(isDestructive("MERGE INTO dbo.Users AS t USING dbo.Staging AS s ON 1=1 WHEN MATCHED THEN UPDATE SET t.x = s.x").destructive).toBe(false);
  });
});
