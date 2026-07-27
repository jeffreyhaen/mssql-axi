import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { validateReadOnly } from "../src/lib/readOnlyGuard.js";

describe("validateReadOnly - positive", () => {
  it("accepts a simple SELECT", () => {
    const out = validateReadOnly("SELECT 1");
    expect(out.kind).toBe("select");
  });

  it("accepts SELECT with a trailing semicolon", () => {
    const out = validateReadOnly("SELECT id, name FROM dbo.Users;");
    expect(out.kind).toBe("select");
  });

  it("accepts a WITH cte + SELECT", () => {
    const out = validateReadOnly(
      "WITH cte AS (SELECT 1 AS x) SELECT * FROM cte",
    );
    expect(out.kind).toBe("select");
    if (out.kind === "select") expect(out.withCte).toBe(true);
  });

  it("accepts a multi-CTE WITH", () => {
    const out = validateReadOnly(
      "WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS y) SELECT * FROM a JOIN b ON 1=1",
    );
    expect(out.kind).toBe("select");
  });

  it("accepts an EXPLAIN", () => {
    const out = validateReadOnly("EXPLAIN SELECT * FROM dbo.Users");
    expect(out.kind).toBe("explain");
  });

  it("accepts SET SHOWPLAN_XML ON; <SELECT>; SET SHOWPLAN_XML OFF;", () => {
    const out = validateReadOnly(
      "SET SHOWPLAN_XML ON; SELECT id FROM dbo.Users; SET SHOWPLAN_XML OFF;",
    );
    expect(out.kind).toBe("showplan");
    if (out.kind === "showplan") {
      expect(out.selectSql).toBe("SELECT id FROM dbo.Users");
    }
  });

  it("strips line comments before validating", () => {
    const out = validateReadOnly("-- a comment\nSELECT 1");
    expect(out.kind).toBe("select");
  });

  it("strips block comments before validating", () => {
    const out = validateReadOnly("/* hint */ SELECT 1");
    expect(out.kind).toBe("select");
  });

  it("accepts SELECT containing semicolons inside string literals", () => {
    const out = validateReadOnly("SELECT 'a;b;c' AS s");
    expect(out.kind).toBe("select");
  });
});

describe("validateReadOnly - negative", () => {
  const forbidden = [
    ["INSERT", "INSERT INTO dbo.Users (name) VALUES ('x')"],
    ["UPDATE", "UPDATE dbo.Users SET name = 'y'"],
    ["DELETE", "DELETE FROM dbo.Users"],
    ["DELETE with WHERE", "DELETE FROM dbo.Users WHERE id = 1"],
    ["MERGE", "MERGE INTO dbo.Users AS t USING dbo.Staging AS s ON 1=1"],
    ["DROP", "DROP TABLE dbo.Users"],
    ["TRUNCATE", "TRUNCATE TABLE dbo.Users"],
    ["EXEC", "EXEC sp_help"],
    ["GRANT", "GRANT SELECT ON dbo.Users TO agent_reader"],
    ["ALTER", "ALTER TABLE dbo.Users ADD col INT"],
    ["CREATE", "CREATE TABLE dbo.X (id INT)"],
    ["BACKUP", "BACKUP DATABASE app TO DISK = 'x'"],
  ] as const;

  for (const [label, sql] of forbidden) {
    it(`rejects ${label}`, () => {
      expect(() => validateReadOnly(sql)).toThrow(AxiError);
      try {
        validateReadOnly(sql);
      } catch (e) {
        expect((e as AxiError).code).toBe("READ_ONLY");
      }
    });
  }

  it("rejects GO terminators", () => {
    expect(() => validateReadOnly("SELECT 1; GO")).toThrow(/GO/);
  });

  it("rejects stacked statements", () => {
    expect(() => validateReadOnly("SELECT 1; SELECT 2")).toThrow(/stacked/);
  });

  it("rejects empty input", () => {
    expect(() => validateReadOnly("")).toThrow(AxiError);
  });

  it("rejects only-comments input", () => {
    expect(() => validateReadOnly("-- nothing here")).toThrow(AxiError);
  });

  it("rejects non-SELECT starting token", () => {
    expect(() => validateReadOnly("PRINT 'hi'")).toThrow(/only SELECT/);
  });

  it("rejects SET without SHOWPLAN_XML", () => {
    expect(() => validateReadOnly("SET XACT_ABORT ON")).toThrow(/only SELECT/);
  });

  it("rejects SHOWPLAN_XML with a non-SELECT in the middle", () => {
    expect(() =>
      validateReadOnly("SET SHOWPLAN_XML ON; DELETE FROM x; SET SHOWPLAN_XML OFF"),
    ).toThrow();
  });

  it("rejects SQL over the size limit", () => {
    const huge = "SELECT '" + "a".repeat(200_001) + "'";
    expect(() => validateReadOnly(huge)).toThrow(/exceeds/);
  });
});
