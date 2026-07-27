/**
 * The only driver: `odbc` (IBM) wraps the native Microsoft ODBC Driver 17/18
 * on Windows and unixODBC elsewhere. It supports:
 *   - SQL Server + Azure SQL over TCP and Shared Memory
 *   - Windows Auth via `Trusted_Connection=Yes` (local + AAD-federated)
 *   - Azure AD via `Authentication=ActiveDirectoryIntegrated|Interactive|
 *     Default|ServicePrincipal|Password|ManagedIdentity|DeviceCodeFlow`
 *   - Named instances and dynamic ports (via the SQL Browser service)
 *
 * Connection strings are passed through verbatim — the user is responsible
 * for matching the right `Driver={...}` to their environment.
 */
import odbc from "odbc";

export type OdbcConnection = Awaited<ReturnType<typeof odbc.connect>>;

export interface Database {
  driver: "odbc";
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  execute(sql: string): Promise<{ rowsAffected: number[] }>;
  close(): Promise<void>;
}

export interface OdbcOptions {
  /** Connection string (with `Driver={...}`). */
  connectionString: string;
}

export async function openOdbcDatabase(options: OdbcOptions): Promise<Database> {
  const connection = (await odbc.connect(options.connectionString)) as OdbcConnection;
  return {
    driver: "odbc",
    async query<T = Record<string, unknown>>(sqlText: string): Promise<T[]> {
      const result = await connection.query(sqlText);
      return Array.isArray(result) ? (result as T[]) : [];
    },
    async execute(sqlText: string) {
      const result = await connection.query(sqlText);
      const rows = Array.isArray(result) ? (result as unknown[]) : [];
      return { rowsAffected: [rows.length] };
    },
    async close() {
      await connection.close();
    },
  };
}

/** True when the string looks like an ODBC connection string (contains `Driver={...}`). */
export function isOdbcConnectionString(s: string): boolean {
  return /(?:^|;)Driver\s*=\s*\{/i.test(s);
}
