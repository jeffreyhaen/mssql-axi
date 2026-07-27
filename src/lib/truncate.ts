/** Default per-cell truncation cap, per AXI principle 3. */
export const DEFAULT_CELL_CAP = 200;

/**
 * Truncates a string to at most `cap` characters. If truncated, appends a
 * size hint so the agent knows to use --full.
 */
export function truncateCell(value: unknown, cap: number = DEFAULT_CELL_CAP): {
  value: string | null;
  truncated: boolean;
  totalChars: number;
} {
  if (value === null || value === undefined) return { value: null, truncated: false, totalChars: 0 };
  const s = typeof value === "string" ? value : String(value);
  if (s.length <= cap) return { value: s, truncated: false, totalChars: s.length };
  return {
    value: `${s.slice(0, cap)}(truncated, ${s.length} chars total — use --full)`,
    truncated: true,
    totalChars: s.length,
  };
}

/**
 * Truncates every cell in a resultset row, returning a new object whose string
 * values are at most `cap` chars long.
 */
export function truncateRow(
  row: Record<string, unknown>,
  cap: number = DEFAULT_CELL_CAP,
): { row: Record<string, unknown>; anyTruncated: boolean } {
  const out: Record<string, unknown> = {};
  let anyTruncated = false;
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "string") {
      const t = truncateCell(v, cap);
      out[k] = t.value;
      if (t.truncated) anyTruncated = true;
    } else if (v instanceof Date) {
      const s = v.toISOString();
      const t = truncateCell(s, cap);
      out[k] = t.value;
      if (t.truncated) anyTruncated = true;
    } else if (
      v !== null &&
      typeof v === "object" &&
      // mssql returns decimals/ints/numerics as primitives, so this branch is
      // mostly for safety against custom recordset shapes.
      false
    ) {
      out[k] = v;
    } else {
      out[k] = v;
    }
  }
  return { row: out, anyTruncated };
}
