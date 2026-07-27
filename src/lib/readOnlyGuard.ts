import { AxiError } from "axi-sdk-js";

/**
 * Result of a successful read-only validation. The validator either returns
 * this descriptor (which the caller can use to choose between direct execution
 * and SET SHOWPLAN_XML wrapping) or throws an AxiError.
 */
export type ReadOnlyPlan =
  | { kind: "select"; sql: string; withCte: boolean }
  | { kind: "explain"; sql: string; withCte: boolean }
  | { kind: "showplan"; selectSql: string };

const MAX_SQL_LENGTH = 200_000;

/**
 * Validates that the SQL is safe to run under read-only enforcement.
 *
 * Allowed:
 *  - A single SELECT, optionally preceded by a WITH cte clause.
 *  - A single EXPLAIN of an allowed SELECT.
 *  - A SET SHOWPLAN_XML ON; <SELECT>; SET SHOWPLAN_XML OFF; sequence.
 *
 * Rejected: anything with INSERT/UPDATE/DELETE/MERGE/DROP/TRUNCATE/EXEC/GRANT/REVOKE,
 * stacked statements, semicolons followed by another keyword, GO terminators,
 * or non-SELECT starting tokens.
 */
export function validateReadOnly(sql: string): ReadOnlyPlan {
  if (typeof sql !== "string") {
    throw new AxiError("SQL must be a string", "VALIDATION_ERROR");
  }
  if (sql.length === 0) {
    throw new AxiError("SQL is empty", "VALIDATION_ERROR");
  }
  if (sql.length > MAX_SQL_LENGTH) {
    throw new AxiError(
      `SQL exceeds ${MAX_SQL_LENGTH.toLocaleString()} chars`,
      "VALIDATION_ERROR",
      ["Split the query or use --full to bypass (not applicable here)"],
    );
  }

  const stripped = stripComments(sql).trim();
  if (stripped.length === 0) {
    throw new AxiError("SQL is empty after stripping comments", "VALIDATION_ERROR");
  }

  rejectGoTerminator(stripped);
  rejectForbiddenKeywords(stripped);

  // Split on `;` to detect stacked statements. Trailing empty tail is fine.
  const statements = splitStatements(stripped);
  if (statements.length === 0) {
    throw new AxiError("SQL is empty", "VALIDATION_ERROR");
  }

  // SET SHOWPLAN_XML ON; <SELECT>; SET SHOWPLAN_XML OFF;
  if (statements.length === 3 && isShowplanSequence(statements)) {
    return { kind: "showplan", selectSql: statements[1]! };
  }

  if (statements.length > 1) {
    throw new AxiError(
      "stacked statements are not allowed (use a single statement)",
      "READ_ONLY",
      ["Combine into one SELECT, or use a WITH cte"],
    );
  }

  const only = statements[0]!;
  return classifySingleStatement(only);
}

function classifySingleStatement(stmt: string): ReadOnlyPlan {
  const tokens = tokenize(stmt);
  if (tokens.length === 0) {
    throw new AxiError("SQL is empty", "VALIDATION_ERROR");
  }
  const head = tokens[0]!.toUpperCase();
  if (head === "SELECT") {
    return { kind: "select", sql: stmt, withCte: false };
  }
  if (head === "WITH") {
    // Allow `WITH cte AS (...), cte2 AS (...) SELECT ...`
    if (!/SELECT\b/i.test(stmt)) {
      throw new AxiError("WITH clause must end with a SELECT", "READ_ONLY");
    }
    return { kind: "select", sql: stmt, withCte: true };
  }
  if (head === "EXPLAIN") {
    return { kind: "explain", sql: stmt, withCte: false };
  }
  throw new AxiError(
    `only SELECT, WITH, EXPLAIN, or SET SHOWPLAN_XML are allowed (got '${head}')`,
    "READ_ONLY",
    [
      "Use SELECT to read data",
      "Use WITH cte AS (...) SELECT ... for CTEs",
      "Use `mssql-axi execute --sql ...` for mutations (requires --confirm and --execute)",
    ],
  );
}

function rejectGoTerminator(sql: string): void {
  // Match `;GO` optionally surrounded by whitespace at start of a statement,
  // or a line that is just `GO`.
  if (/(^|\s|;)GO\s*($|;)/i.test(sql)) {
    throw new AxiError("`GO` terminators are not allowed", "READ_ONLY", [
      "Send a single statement without GO",
    ]);
  }
}

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "DROP",
  "TRUNCATE",
  "EXEC",
  "EXECUTE",
  "GRANT",
  "REVOKE",
  "DENY",
  "ALTER",
  "CREATE",
  "BACKUP",
  "RESTORE",
  "KILL",
  "DBCC",
  "BULK",
  "OPENROWSET",
  "OPENDATASOURCE",
  "OPENQUERY",
  "XP_",
  "SP_",
] as const;

function rejectForbiddenKeywords(sql: string): void {
  // We use a regex that requires word boundaries to avoid matching `inserted` as
  // a column alias. The check is conservative: any of the keywords at any
  // position triggers rejection. Legitimate SELECTs that reference a column
  // named "inserted" (the magic column in triggers) are not affected because
  // we're matching whole words, but a SELECT that filters on `WHERE inserted
  // = 1` would be rejected. This is a false-positive worth living with for
  // the safety guarantee.
  const upper = sql.toUpperCase();
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`(^|[^A-Z0-Z_])${kw}([^A-Z0-Z_]|$)`, "i");
    if (re.test(upper)) {
      throw new AxiError(
        `forbidden keyword '${kw}' in read-only context`,
        "READ_ONLY",
        [
          "Use `mssql-axi execute --sql ...` for mutations (requires --confirm and --execute)",
        ],
      );
    }
  }
}

function isShowplanSequence(parts: readonly string[]): boolean {
  if (parts.length !== 3) return false;
  const head = parts[0]!.trim().toUpperCase();
  const tail = parts[2]!.trim().toUpperCase();
  if (head !== "SET SHOWPLAN_XML ON") return false;
  if (tail !== "SET SHOWPLAN_XML OFF") return false;
  const middle = parts[1]!.trim();
  if (!/^SELECT\b/i.test(middle)) return false;
  // The middle SELECT is itself validated recursively (cheap; rejects stacked
  // statements inside it).
  validateReadOnly(middle);
  return true;
}

function splitStatements(stmt: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  let inString: false | "'" | '"' = false;
  for (let i = 0; i < stmt.length; i++) {
    const ch = stmt[i]!;
    if (inString) {
      current += ch;
      if (ch === inString) {
        // SQL Server doubles quotes for escaping: '' inside a '...'
        if (stmt[i + 1] === inString) {
          current += stmt[i + 1]!;
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) out.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed.length > 0) out.push(trimmed);
  return out;
}

function tokenize(stmt: string): string[] {
  // Cheap tokenizer: collapse whitespace and split on whitespace.
  return stmt.split(/\s+/).filter((s) => s.length > 0);
}

function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      // line comment: skip to EOL
      i += 2;
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      // block comment: skip until */
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
