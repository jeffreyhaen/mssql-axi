/**
 * Normalises SQL for --confirm comparison: strips comments, collapses all
 * whitespace to single spaces, and trims. Two SQL strings that are functionally
 * the same produce the same normalised form.
 */
export function normaliseSql(sql: string): string {
  return stripComments(sql).replace(/\s+/g, " ").trim();
}

function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Detects destructive patterns that the user must explicitly opt into via
 * --allow-destructive. A "destructive" statement is one that:
 *   - drops or truncates a table/object, or
 *   - is a DELETE/UPDATE without a WHERE clause.
 *
 * The check is conservative: a missing WHERE is treated as destructive even
 * if the user intended a single-row update via a subquery.
 */
export function isDestructive(sql: string): { destructive: boolean; reason: string | null } {
  const upper = sql.toUpperCase();
  if (/\bDROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|FUNCTION|PROCEDURE)\b/.test(upper)) {
    return { destructive: true, reason: "DROP statement detected" };
  }
  if (/\bTRUNCATE\b/.test(upper)) {
    return { destructive: true, reason: "TRUNCATE statement detected" };
  }
  const trimmed = stripComments(sql).trim();
  if (/^DELETE\b/i.test(trimmed)) {
    if (!/\bWHERE\b/i.test(upper)) {
      return { destructive: true, reason: "DELETE without WHERE clause" };
    }
  }
  if (/^UPDATE\b/i.test(trimmed)) {
    if (!/\bWHERE\b/i.test(upper)) {
      return { destructive: true, reason: "UPDATE without WHERE clause" };
    }
  }
  return { destructive: false, reason: null };
}
