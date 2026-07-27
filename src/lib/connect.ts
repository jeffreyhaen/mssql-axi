import { openDatabase, type Database } from "./driver/index.js";

/**
 * Opens an ODBC connection to the server, runs the caller's work, and closes
 * the connection on exit. The single argument is the resolved ODBC connection
 * string (e.g. `Driver={ODBC Driver 18 for SQL Server};Server=...;...`).
 */
export async function withDatabase<T>(
  connectionString: string,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const db = await openDatabase({ connectionString });
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
