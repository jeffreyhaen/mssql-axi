import { AxiError } from "axi-sdk-js";
import { parseArgs } from "../lib/args.js";
import { resolveConnection } from "../lib/config.js";
import { withDatabase } from "../lib/connect.js";
import { redactSecrets } from "../lib/redact.js";

const KNOWN_FLAGS = [
  "connection-string",
  "connection",
  "config",
  "top",
];

export async function homeCommand(args: readonly string[]): Promise<Record<string, unknown>> {
  const parsed = parseArgs(args);
  for (const key of Object.keys(parsed.flags)) {
    if (!KNOWN_FLAGS.includes(key)) {
      throw new AxiError(`unknown flag --${key}`, "UNKNOWN_FLAG", [
        `Known flags: ${KNOWN_FLAGS.join(", ")}`,
      ]);
    }
  }

  const resolved = resolveConnection({
    connectionString:
      typeof parsed.flags["connection-string"] === "string"
        ? parsed.flags["connection-string"]
        : undefined,
    connectionName:
      typeof parsed.flags.connection === "string" ? parsed.flags.connection : undefined,
    configPath: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
  });

  const top =
    typeof parsed.flags.top === "string"
      ? Math.max(1, Math.min(50, Number(parsed.flags.top) || 5))
      : 5;

  try {
    return await withDatabase(resolved.connectionString, async (db) =>
      renderHome(db, top, resolved.namedConnection),
    );
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AxiError(
      `connection failed: ${redactSecrets(message, [resolved.connectionString])}`,
      "CONNECTION_FAILED",
      [
        "Check your --connection-string for correctness",
        "Run `mssql-axi doctor --connection-string \"...\"` for a connectivity diagnosis",
        "Verify the target server is reachable and the firewall allows this client",
      ],
    );
  }
}

async function renderHome(
  db: import("../lib/driver/index.js").Database,
  top: number,
  namedConnection: string | undefined,
): Promise<Record<string, unknown>> {
  const topLit = Math.max(1, Math.min(1_000_000, Math.floor(top)));
  const serverInfo = await db.query<{ version: string; serverName: string }>(
    "SELECT @@VERSION AS version, @@SERVERNAME AS serverName",
  );
  const dbInfo = await db.query<{ dbName: string; dbId: number }>(
    "SELECT DB_NAME() AS dbName, DB_ID() AS dbId",
  );
  const topTables = await db.query<{ schema: string; name: string; rows: number }>(
    `SELECT TOP ${topLit} s.name AS [schema], t.name AS name, ` +
      `  CAST(SUM(p.rows) AS BIGINT) AS rows ` +
      `FROM sys.tables t ` +
      `JOIN sys.schemas s ON t.schema_id = s.schema_id ` +
      `JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1) ` +
      `WHERE t.is_ms_shipped = 0 ` +
      `GROUP BY s.name, t.name, t.object_id ` +
      `ORDER BY rows DESC, name ASC`,
  );
  const totalCount = await db.query<{ total: number }>(
    "SELECT COUNT(*) AS total FROM sys.tables WHERE is_ms_shipped = 0",
  );

  const version = (serverInfo[0]?.version ?? "").split("\n")[0]?.trim() ?? "";
  const dbRow = dbInfo[0];
  const tables = topTables.map((t) => ({
    schema: t.schema,
    name: t.name,
    rows: Number(t.rows ?? 0),
  }));

  const body: Record<string, unknown> = {
    driver: db.driver,
    server: serverInfo[0]?.serverName ?? null,
    database: dbRow?.dbName ?? null,
    version: version || null,
    tables: tables.length,
    totalTables: Number(totalCount[0]?.total ?? 0),
    topTables: tables,
  };
  if (namedConnection) body.connection = namedConnection;

  return {
    ...body,
    help: [
      "Run `mssql-axi list --kind tables` to enumerate all tables",
      "Run `mssql-axi inspect --kind table --schema <s> --name <n>` for columns and keys",
      "Run `mssql-axi sample --schema <s> --name <n> --limit 5` to preview rows",
      "Run `mssql-axi doctor` to check the read-only role and connection health",
    ],
  };
}
