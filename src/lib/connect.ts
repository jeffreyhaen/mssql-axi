import { openDatabase, type Database } from "./driver/index.js";

export type DatabaseOpener = (connectionString: string) => Promise<Database>;

const defaultOpener: DatabaseOpener = (connectionString) => openDatabase({ connectionString });

let opener: DatabaseOpener = defaultOpener;

/**
 * Test seam: replaces the driver used by `withDatabase`. Production code never
 * calls this — the command layer is exercised against a fake `Database` in the
 * unit tests so no live SQL Server is required.
 */
export function setDatabaseOpener(fn: DatabaseOpener): void {
  opener = fn;
}

export function resetDatabaseOpener(): void {
  opener = defaultOpener;
}

/**
 * Opens an ODBC connection to the server, runs the caller's work, and closes
 * the connection on exit. The single argument is the resolved ODBC connection
 * string (e.g. `Driver={ODBC Driver 18 for SQL Server};Server=...;...`).
 */
export async function withDatabase<T>(
  connectionString: string,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const db = await opener(connectionString);
  try {
    return await fn(db);
  } finally {
    try {
      await db.close();
    } catch {
      // best-effort close; ignore secondary errors
    }
  }
}
