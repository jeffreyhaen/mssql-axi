import { describe, expect, it } from "vitest";
import { buildSampleSelectList } from "../src/commands/sample.js";

const META = (maxLength = 0) => ({ maxLength });

describe("buildSampleSelectList", () => {
  it("returns '*' for an empty column list", () => {
    expect(buildSampleSelectList([])).toBe("*");
  });

  it("passes through ordinary types unchanged", () => {
    const cols = [
      { name: "Id", type: "int", ...META(4) },
      { name: "Name", type: "nvarchar", ...META(100) },
      { name: "OrderDate", type: "datetimeoffset", ...META(8) },
      { name: "Active", type: "bit", ...META(1) },
    ];
    expect(buildSampleSelectList(cols)).toBe(
      "[Id], [Name], [OrderDate], [Active]",
    );
  });

  it("casts uniqueidentifier to VARCHAR(36)", () => {
    const cols = [
      { name: "Id", type: "int", ...META(4) },
      { name: "CartGroupOrder", type: "uniqueidentifier", ...META(16) },
      { name: "Name", type: "nvarchar", ...META(100) },
    ];
    expect(buildSampleSelectList(cols)).toBe(
      "[Id], CAST([CartGroupOrder] AS VARCHAR(36)) AS [CartGroupOrder], [Name]",
    );
  });

  it("casts varbinary to VARBINARY(256)", () => {
    const cols = [
      { name: "Id", type: "int", ...META(4) },
      { name: "Logo", type: "varbinary", ...META(-1) },
    ];
    expect(buildSampleSelectList(cols)).toBe(
      "[Id], CAST([Logo] AS VARBINARY(256)) AS [Logo]",
    );
  });

  it("casts fixed-length binary to VARBINARY(256)", () => {
    const cols = [{ name: "Hash", type: "binary", ...META(32) }];
    expect(buildSampleSelectList(cols)).toBe(
      "CAST([Hash] AS VARBINARY(256)) AS [Hash]",
    );
  });

  it("casts nvarchar(max) (maxLength -1) to NVARCHAR(4000)", () => {
    const cols = [
      { name: "Id", type: "int", ...META(4) },
      { name: "Name", type: "nvarchar", ...META(-1) },
    ];
    expect(buildSampleSelectList(cols)).toBe(
      "[Id], CAST([Name] AS NVARCHAR(4000)) AS [Name]",
    );
  });

  it("casts varchar(max) (maxLength -1) to VARCHAR(8000)", () => {
    const cols = [{ name: "Body", type: "varchar", ...META(-1) }];
    expect(buildSampleSelectList(cols)).toBe(
      "CAST([Body] AS VARCHAR(8000)) AS [Body]",
    );
  });

  it("handles all problematic types together", () => {
    const cols = [
      { name: "Id", type: "int", ...META(4) },
      { name: "OrderDate", type: "datetimeoffset", ...META(8) },
      { name: "CartGroupOrder", type: "uniqueidentifier", ...META(16) },
      { name: "Logo", type: "varbinary", ...META(-1) },
      { name: "Name", type: "nvarchar", ...META(-1) },
      { name: "ShortName", type: "nvarchar", ...META(50) },
    ];
    expect(buildSampleSelectList(cols)).toBe(
      "[Id], [OrderDate], CAST([CartGroupOrder] AS VARCHAR(36)) AS [CartGroupOrder], CAST([Logo] AS VARBINARY(256)) AS [Logo], CAST([Name] AS NVARCHAR(4000)) AS [Name], [ShortName]",
    );
  });

  it("escapes ] in column names", () => {
    const cols = [{ name: "Weird]Name", type: "int", ...META(4) }];
    expect(buildSampleSelectList(cols)).toBe("[Weird]]Name]");
  });

  it("matches type names case-insensitively (sys.types uses lowercase)", () => {
    const cols = [
      { name: "A", type: "UniqueIdentifier", ...META(16) },
      { name: "B", type: "VARBINARY", ...META(-1) },
      { name: "C", type: "NVARCHAR", ...META(-1) },
    ];
    expect(buildSampleSelectList(cols)).toBe(
      "CAST([A] AS VARCHAR(36)) AS [A], CAST([B] AS VARBINARY(256)) AS [B], CAST([C] AS NVARCHAR(4000)) AS [C]",
    );
  });
});
