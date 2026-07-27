import { describe, expect, it } from "vitest";
import { truncateCell, truncateRow } from "../src/lib/truncate.js";

describe("truncateCell", () => {
  it("returns null for null/undefined", () => {
    expect(truncateCell(null)).toEqual({ value: null, truncated: false, totalChars: 0 });
    expect(truncateCell(undefined)).toEqual({ value: null, truncated: false, totalChars: 0 });
  });

  it("passes through short strings untouched", () => {
    expect(truncateCell("hello")).toEqual({
      value: "hello",
      truncated: false,
      totalChars: 5,
    });
  });

  it("truncates long strings with a hint", () => {
    const long = "x".repeat(500);
    const out = truncateCell(long, 50);
    expect(out.truncated).toBe(true);
    expect(out.totalChars).toBe(500);
    expect(out.value).toContain("(truncated, 500 chars total");
    expect(out.value).toContain("--full");
  });

  it("truncates at exactly cap when equal to length", () => {
    const exact = "x".repeat(10);
    expect(truncateCell(exact, 10).truncated).toBe(false);
  });
});

describe("truncateRow", () => {
  it("truncates string cells beyond the cap", () => {
    const r = { id: 1, desc: "x".repeat(300) };
    const { row, anyTruncated } = truncateRow(r, 100);
    expect(anyTruncated).toBe(true);
    expect(typeof row.desc).toBe("string");
    expect((row.desc as string).length).toBeLessThan(300);
  });

  it("leaves numeric and boolean values untouched", () => {
    const r = { id: 1, active: true, count: 42 };
    const { row, anyTruncated } = truncateRow(r);
    expect(row).toEqual({ id: 1, active: true, count: 42 });
    expect(anyTruncated).toBe(false);
  });

  it("serializes dates as ISO strings", () => {
    const d = new Date("2025-01-15T10:30:00.000Z");
    const { row } = truncateRow({ when: d });
    expect(row.when).toBe("2025-01-15T10:30:00.000Z");
  });
});
