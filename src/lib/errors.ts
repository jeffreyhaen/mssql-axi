/**
 * Extracts a useful single-line message from a thrown error. The `odbc` npm
 * package throws a generic `Error("[odbc] Error connecting to the database")`
 * and stashes the real SQLSTATE diagnostics on `err.odbcErrors[]` — without
 * them the caller cannot tell auth, encryption, and network failures apart.
 * The first diagnostic is appended so AXI errors stay one line and
 * token-cheap; a "(+N more)" suffix hints at the rest.
 */
export function errorMessage(err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  const details = (err as { odbcErrors?: Array<{ message?: string }> } | null)?.odbcErrors;
  if (!Array.isArray(details) || details.length === 0) return base;
  const first = details.map((d) => d?.message?.trim()).find((m) => m);
  if (!first || base.includes(first)) return base;
  const more = details.length > 1 ? ` (+${details.length - 1} more ODBC diagnostics)` : "";
  return `${base} — ${first}${more}`;
}
