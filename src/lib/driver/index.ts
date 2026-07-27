/**
 * Driver entry point. mssql-axi now uses the `odbc` driver exclusively; the
 * `mssql` Node package was dropped because (a) it cannot speak Shared Memory
 * for local SQL Server and (b) it cannot use the current Windows identity
 * without explicit credentials. ODBC covers both.
 *
 * Connection strings are passed through verbatim — no translation, no
 * parsing. The user owns the full ODBC string (or named connection in
 * the config file).
 */
import { AxiError } from "axi-sdk-js";
import { openOdbcDatabase, type Database, isOdbcConnectionString } from "./odbc.js";

export interface OpenDatabaseOptions {
  connectionString: string;
}

export async function openDatabase(options: OpenDatabaseOptions): Promise<Database> {
  if (!isOdbcConnectionString(options.connectionString)) {
    throw new AxiError(
      "mssql-axi requires an ODBC-style connection string (with `Driver={...}`). Pass it via --connection-string or set MSSQL_CONNECTION_STRING.",
      "VALIDATION_ERROR",
      [
        "Local SQL Server with Windows Auth:  Driver={ODBC Driver 17 for SQL Server};Server=localhost\\SQLEXPRESS;Database=app;Trusted_Connection=Yes;",
        "Azure SQL with AAD:                     Driver={ODBC Driver 18 for SQL Server};Server=tcp:host.database.windows.net,1433;Initial Catalog=app;Authentication=ActiveDirectoryInteractive;Encrypt=Yes;",
        "Or run `mssql-axi setup config` to generate an example",
      ],
    );
  }
  return openOdbcDatabase({ connectionString: options.connectionString });
}

export { isOdbcConnectionString };
export type { Database };
