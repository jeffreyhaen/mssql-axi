import { AxiError } from "axi-sdk-js";
import { parseArgs } from "../lib/args.js";
import { resolveConnection } from "../lib/config.js";
import { withDatabase } from "../lib/connect.js";
import { redactSecrets } from "../lib/redact.js";
import { sqlIdentifier, sqlString } from "../lib/sql.js";
import { DEFAULT_CELL_CAP, truncateRow } from "../lib/truncate.js";

const KNOWN_FLAGS = [
  "connection-string",
  "connection",
  "config",
  "schema",
  "name",
  "where",
  "limit",
  "full",
];

const MAX_LIMIT = 1000;

export async function sampleCommand(args: readonly string[]): Promise<Record<string, unknown>> {
  const parsed = parseArgs(args);
  for (const key of Object.keys(parsed.flags)) {
    if (!KNOWN_FLAGS.includes(key)) {
      throw new AxiError(`unknown flag --${key}`, "UNKNOWN_FLAG", [
        `Known flags: ${KNOWN_FLAGS.join(", ")}`,
      ]);
    }
  }

  const schema = typeof parsed.flags.schema === "string" ? parsed.flags.schema : "dbo";
  const name =
    typeof parsed.flags.name === "string" ? parsed.flags.name : parsed.positionals[0];
  if (!name) {
    throw new AxiError("--name is required for sample", "VALIDATION_ERROR", [
      "Pass --name <table-or-view-name>",
    ]);
  }
  const where = typeof parsed.flags.where === "string" ? parsed.flags.where : undefined;
  const full = parsed.flags.full === true;
  const limit = clampLimit(parsed.flags.limit);

  const resolved = resolveConnection({
    connectionString:
      typeof parsed.flags["connection-string"] === "string"
        ? parsed.flags["connection-string"]
        : undefined,
    connectionName:
      typeof parsed.flags.connection === "string" ? parsed.flags.connection : undefined,
    configPath: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
  });

  try {
    return await withDatabase(resolved.connectionString, async (db) => {
      const cap = full ? Number.MAX_SAFE_INTEGER : DEFAULT_CELL_CAP;
      const objectExists = await db.query<{ kind: string }>(
        "SELECT TOP 1 o.type_desc AS kind " +
          "FROM sys.objects o " +
          "JOIN sys.schemas s ON o.schema_id = s.schema_id " +
          `WHERE s.name = ${sqlString(schema)} AND o.name = ${sqlString(name)}`,
      );
      if (objectExists.length === 0) {
        throw new AxiError(`'${schema}.${name}' not found`, "NOT_FOUND", [
          `Run \`mssql-axi list --kind tables --schema ${schema}\` to see available objects`,
        ]);
      }
      const top = Math.max(1, Math.min(1_000_000, Math.floor(limit) + 1));
      const whereClause = where ? `WHERE (${where})` : "";
      const quoted = `${sqlIdentifier(schema)}.${sqlIdentifier(name)}`;
      const result = await db.query<Record<string, unknown>>(
        `SELECT TOP ${top} * FROM ${quoted} ${whereClause}`,
      );
      const truncated = result.slice(0, limit);
      const hasMore = result.length > limit;
      const rows: Record<string, unknown>[] = [];
      let anyTruncated = false;
      for (const r of truncated) {
        const out = truncateRow(r, cap);
        rows.push(out.row);
        if (out.anyTruncated) anyTruncated = true;
      }
      return {
        schema,
        name,
        ...(where ? { where } : {}),
        count: rows.length,
        ...(hasMore ? { truncated: true, truncatedAt: limit } : {}),
        ...(anyTruncated && !full ? { cellTruncated: true } : {}),
        rows,
        help: [
          `Run \`mssql-axi inspect --kind table --schema ${schema} --name ${name}\` to see columns and keys`,
          `Run \`mssql-axi query --sql "SELECT ... FROM ${quoted} WHERE ..."\` for custom queries`,
        ],
      };
    });
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AxiError(
      `sample failed: ${redactSecrets(message, [resolved.connectionString])}`,
      "CONNECTION_FAILED",
      ["Check the object name, schema, and connection string"],
    );
  }
}

function clampLimit(value: string | boolean | undefined): number {
  if (value === undefined) return 5;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AxiError("--limit expects a positive number", "VALIDATION_ERROR", [
      "Pass --limit 5 for example",
    ]);
  }
  return Math.min(MAX_LIMIT, Math.floor(n));
}
