import { AxiError } from "axi-sdk-js";
import { parseArgs } from "../lib/args.js";
import { resolveConnection } from "../lib/config.js";
import { withDatabase } from "../lib/connect.js";
import { redactSecrets } from "../lib/redact.js";
import { sqlString } from "../lib/sql.js";

const KINDS = ["tables", "views", "indexes", "schemas"] as const;
type Kind = (typeof KINDS)[number];

const KNOWN_FLAGS = [
  "connection-string",
  "connection",
  "config",
  "kind",
  "schema",
  "limit",
  "full",
];

const HELP_TEXT = [
  "Run `mssql-axi inspect --kind <table|view|index> --schema <s> --name <n>` to see details",
  "Run `mssql-axi sample --schema <s> --name <n> --limit 5` to preview rows",
];

export async function listCommand(args: readonly string[]): Promise<Record<string, unknown>> {
  const parsed = parseArgs(args);
  for (const key of Object.keys(parsed.flags)) {
    if (!KNOWN_FLAGS.includes(key)) {
      throw new AxiError(`unknown flag --${key}`, "UNKNOWN_FLAG", [
        `Known flags: ${KNOWN_FLAGS.join(", ")}`,
      ]);
    }
  }

  const kind = pickKind(parsed);

  const resolved = resolveConnection({
    connectionString:
      typeof parsed.flags["connection-string"] === "string"
        ? parsed.flags["connection-string"]
        : undefined,
    connectionName:
      typeof parsed.flags.connection === "string" ? parsed.flags.connection : undefined,
    configPath: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
  });

  const schema = typeof parsed.flags.schema === "string" ? parsed.flags.schema : undefined;
  const limit = clampLimit(parsed.flags.limit);

  try {
    return await withDatabase(resolved.connectionString, async (db) => {
      const result = await runListQuery(db, kind, schema, limit);
      return {
        kind,
        ...(schema ? { schema } : {}),
        count: result.items.length,
        totalCount: result.total,
        [kind]: result.items,
        help: HELP_TEXT,
      };
    });
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AxiError(
      `list failed: ${redactSecrets(message, [resolved.connectionString])}`,
      "CONNECTION_FAILED",
      [
        "Check your --connection-string for correctness",
        "Run `mssql-axi doctor` for a connectivity diagnosis",
      ],
    );
  }
}

function pickKind(parsed: { positionals: string[]; flags: Record<string, string | boolean> }): Kind {
  const fromFlag = typeof parsed.flags.kind === "string" ? parsed.flags.kind : undefined;
  const fromPos = parsed.positionals[0];
  const raw = (fromFlag ?? fromPos ?? "tables").toLowerCase();
  if ((KINDS as readonly string[]).includes(raw)) return raw as Kind;
  throw new AxiError(
    `unknown --kind '${raw}'`,
    "VALIDATION_ERROR",
    [`Kinds: ${KINDS.join(", ")}`],
  );
}

function clampLimit(value: string | boolean | undefined): number {
  if (value === undefined) return 200;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AxiError(`--limit expects a positive number`, "VALIDATION_ERROR", [
      "Pass --limit 50 for example",
    ]);
  }
  return Math.min(1000, Math.floor(n));
}

interface ListResult {
  items: Array<Record<string, unknown>>;
  total: number;
}

async function runListQuery(
  db: import("../lib/driver/index.js").Database,
  kind: Kind,
  schema: string | undefined,
  limit: number,
): Promise<ListResult> {
  if (kind === "tables") return listTables(db, schema, limit);
  if (kind === "views") return listViews(db, schema, limit);
  if (kind === "indexes") return listIndexes(db, schema, limit);
  return listSchemas(db, limit);
}

async function listTables(
  db: import("../lib/driver/index.js").Database,
  schema: string | undefined,
  limit: number,
): Promise<ListResult> {
  const top = Math.max(1, Math.min(1_000_000, Math.floor(limit)));
  const schemaFilter = schema ? ` AND s.name = ${sqlString(schema)}` : "";
  const rows = await db.query<{ schema: string; name: string; rows: number }>(
    `SELECT TOP ${top} s.name AS [schema], t.name AS name, ` +
      `  CAST(SUM(p.rows) AS BIGINT) AS rows ` +
      `FROM sys.tables t ` +
      `JOIN sys.schemas s ON t.schema_id = s.schema_id ` +
      `LEFT JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1) ` +
      `WHERE t.is_ms_shipped = 0${schemaFilter} ` +
      `GROUP BY s.name, t.name ` +
      `ORDER BY s.name, t.name`,
  );
  const totalRes = schema
    ? await db.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM sys.tables t JOIN sys.schemas s ON t.schema_id = s.schema_id WHERE t.is_ms_shipped = 0 AND s.name = ${sqlString(schema)}`,
      )
    : await db.query<{ total: number }>(
        "SELECT COUNT(*) AS total FROM sys.tables WHERE is_ms_shipped = 0",
      );
  return {
    items: rows.map((r) => ({
      schema: r.schema,
      name: r.name,
      rows: Number(r.rows ?? 0),
    })),
    total: Number(totalRes[0]?.total ?? 0),
  };
}

async function listViews(
  db: import("../lib/driver/index.js").Database,
  schema: string | undefined,
  limit: number,
): Promise<ListResult> {
  const top = Math.max(1, Math.min(1_000_000, Math.floor(limit)));
  const schemaFilter = schema ? ` AND s.name = ${sqlString(schema)}` : "";
  const rows = await db.query<{ schema: string; name: string }>(
    `SELECT TOP ${top} s.name AS [schema], v.name AS name ` +
      `FROM sys.views v ` +
      `JOIN sys.schemas s ON v.schema_id = s.schema_id ` +
      `WHERE v.is_ms_shipped = 0${schemaFilter} ` +
      `ORDER BY s.name, v.name`,
  );
  return {
    items: rows.map((r) => ({ schema: r.schema, name: r.name })),
    total: rows.length,
  };
}

async function listIndexes(
  db: import("../lib/driver/index.js").Database,
  schema: string | undefined,
  limit: number,
): Promise<ListResult> {
  const top = Math.max(1, Math.min(1_000_000, Math.floor(limit)));
  const schemaFilter = schema ? ` AND s.name = ${sqlString(schema)}` : "";
  const rows = await db.query<{ schema: string; table: string; name: string; typeDesc: string }>(
    `SELECT TOP ${top} s.name AS [schema], o.name AS [table], i.name AS name, i.type_desc AS typeDesc ` +
      `FROM sys.indexes i ` +
      `JOIN sys.objects o ON i.object_id = o.object_id ` +
      `JOIN sys.schemas s ON o.schema_id = s.schema_id ` +
      `WHERE i.is_hypothetical = 0 AND i.is_disabled = 0 AND o.is_ms_shipped = 0${schemaFilter} ` +
      `ORDER BY s.name, o.name, i.name`,
  );
  return {
    items: rows.map((r) => ({
      schema: r.schema,
      table: r.table,
      name: r.name,
      type: r.typeDesc,
    })),
    total: rows.length,
  };
}

async function listSchemas(
  db: import("../lib/driver/index.js").Database,
  limit: number,
): Promise<ListResult> {
  const top = Math.max(1, Math.min(1_000_000, Math.floor(limit)));
  const rows = await db.query<{ name: string; tables: number }>(
    `SELECT TOP ${top} s.name AS name, ` +
      `  (SELECT COUNT(*) FROM sys.tables t WHERE t.schema_id = s.schema_id AND t.is_ms_shipped = 0) AS tables ` +
      `FROM sys.schemas s ` +
      `WHERE s.principal_id = 1 ` +
      `ORDER BY s.name`,
  );
  return {
    items: rows.map((r) => ({ name: r.name, tables: Number(r.tables) })),
    total: rows.length,
  };
}
