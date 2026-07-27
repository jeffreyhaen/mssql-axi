/**
 * SQL escaping + value-inlining helpers. We inline parameters into SQL text
 * rather than passing them as bound values so the same code works against
 * both the `mssql` driver (which accepts `@name`) and the `odbc` driver
 * (which only accepts `?` positional). Object names that originate from
 * `sys.tables` are trusted; user-supplied identifiers (table name, schema
 * name) are run through `sqlEscapeString` first to neutralise quote chars.
 */

const SINGLE_QUOTE_REGEX = /'/g;

/** Escapes a string for inclusion inside a single-quoted SQL literal. */
export function sqlEscapeString(value: string): string {
  return value.replace(SINGLE_QUOTE_REGEX, "''");
}

/** Escapes a T-SQL identifier (e.g. `dbo`, `My Table`) for `[]` quoting. */
export function sqlEscapeIdentifier(value: string): string {
  return value.replace(/]/g, "]]");
}

/** Wraps a string in `[]` after escaping `]`. */
export function sqlIdentifier(value: string): string {
  return `[${sqlEscapeIdentifier(value)}]`;
}

/** Inlines a value as a single-quoted SQL literal (escaped). */
export function sqlString(value: string): string {
  return `'${sqlEscapeString(value)}'`;
}

/** Inlines a value as a number, or `NULL` if it's not a finite number. */
export function sqlNumber(value: number | undefined | null): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return "NULL";
  return String(Math.trunc(value));
}
