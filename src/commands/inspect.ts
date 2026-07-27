import { AxiError } from "axi-sdk-js";
import { parseArgs } from "../lib/args.js";
import { resolveConnection } from "../lib/config.js";
import { withDatabase } from "../lib/connect.js";
import { redactSecrets } from "../lib/redact.js";
import { sqlString } from "../lib/sql.js";

const KINDS = ["table", "view", "index"] as const;
type Kind = (typeof KINDS)[number];

const KNOWN_FLAGS = [
  "connection-string",
  "connection",
  "config",
  "kind",
  "schema",
  "name",
];

export async function inspectCommand(args: readonly string[]): Promise<Record<string, unknown>> {
  const parsed = parseArgs(args);
  for (const key of Object.keys(parsed.flags)) {
    if (!KNOWN_FLAGS.includes(key)) {
      throw new AxiError(`unknown flag --${key}`, "UNKNOWN_FLAG", [
        `Known flags: ${KNOWN_FLAGS.join(", ")}`,
      ]);
    }
  }

  const kind = pickKind(parsed);
  const schema = typeof parsed.flags.schema === "string" ? parsed.flags.schema : undefined;
  const name =
    typeof parsed.flags.name === "string"
      ? parsed.flags.name
      : parsed.positionals[0];
  if (!name) {
    throw new AxiError(`--name is required for inspect ${kind}`, "VALIDATION_ERROR", [
      "Pass --name <object-name>",
    ]);
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

  try {
    return await withDatabase(resolved.connectionString, async (db) => {
      const targetSchema = schema ?? "dbo";
      if (kind === "table") return await inspectTable(db, targetSchema, name);
      if (kind === "view") return await inspectView(db, targetSchema, name);
      return await inspectIndex(db, targetSchema, name);
    });
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AxiError(
      `inspect failed: ${redactSecrets(message, [resolved.connectionString])}`,
      "CONNECTION_FAILED",
      [
        "Check your --connection-string for correctness",
        `Verify ${kind} '${name}' exists in schema '${schema ?? "dbo"}'`,
      ],
    );
  }
}

function pickKind(parsed: { positionals: string[]; flags: Record<string, string | boolean> }): Kind {
  const fromFlag = typeof parsed.flags.kind === "string" ? parsed.flags.kind : undefined;
  const fromPos = parsed.positionals[0];
  const raw = (fromFlag ?? fromPos ?? "table").toLowerCase();
  if ((KINDS as readonly string[]).includes(raw)) return raw as Kind;
  throw new AxiError(
    `unknown --kind '${raw}'`,
    "VALIDATION_ERROR",
    [`Kinds: ${KINDS.join(", ")}`],
  );
}

async function inspectTable(
  db: import("../lib/driver/index.js").Database,
  schema: string,
  name: string,
): Promise<Record<string, unknown>> {
  const schemaLit = sqlString(schema);
  const nameLit = sqlString(name);
  const exists = await db.query<{ objectId: number; rows: number }>(
    "SELECT t.object_id AS objectId, " +
      "  (SELECT CAST(SUM(p.rows) AS BIGINT) FROM sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0,1)) AS rows " +
      "FROM sys.tables t " +
      "JOIN sys.schemas s ON t.schema_id = s.schema_id " +
      `WHERE s.name = ${schemaLit} AND t.name = ${nameLit}`,
  );
  const obj = exists[0];
  if (!obj) {
    throw new AxiError(`table '${schema}.${name}' not found`, "NOT_FOUND", [
      "Run `mssql-axi list --kind tables --schema " + schema + "` to see available tables",
    ]);
  }
  const objectIdLit = String(obj.objectId);

  const columns = await db.query<{
    name: string;
    type: string;
    maxLength: number;
    nullable: boolean;
    default: string | null;
  }>(
    "SELECT c.name AS name, ty.name AS type, c.max_length AS maxLength, " +
      "  c.is_nullable AS nullable, " +
      "  OBJECT_DEFINITION(c.default_object_id) AS [default] " +
      "FROM sys.columns c " +
      "JOIN sys.types ty ON c.user_type_id = ty.user_type_id " +
      `WHERE c.object_id = ${objectIdLit} ` +
      "ORDER BY c.column_id",
  );

  const primaryKey = await db.query<{ columnName: string }>(
    "SELECT c.name AS columnName " +
      "FROM sys.indexes i " +
      "JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id " +
      "JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id " +
      `WHERE i.object_id = ${objectIdLit} AND i.is_primary_key = 1 ` +
      "ORDER BY ic.key_ordinal",
  );

  const foreignKeys = await db.query<{
    name: string;
    columnName: string;
    refSchema: string;
    refTable: string;
    refColumn: string;
  }>(
    "SELECT fk.name AS name, c1.name AS columnName, " +
      "  SCHEMA_NAME(fk.schema_id) AS refSchema, OBJECT_NAME(fk.referenced_object_id) AS refTable, " +
      "  c2.name AS refColumn " +
      "FROM sys.foreign_keys fk " +
      "JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id " +
      "JOIN sys.columns c1 ON fkc.parent_object_id = c1.object_id AND fkc.parent_column_id = c1.column_id " +
      "JOIN sys.columns c2 ON fkc.referenced_object_id = c2.object_id AND fkc.referenced_column_id = c2.column_id " +
      `WHERE fk.parent_object_id = ${objectIdLit}`,
  );

  return {
    kind: "table",
    schema,
    name,
    rows: Number(obj.rows ?? 0),
    columns: columns.map((c) => ({
      name: c.name,
      type: formatType(c.type, c.maxLength),
      nullable: c.nullable,
      default: c.default,
    })),
    primaryKey: primaryKey.map((p) => p.columnName),
    foreignKeys: foreignKeys.map((f) => ({
      name: f.name,
      column: f.columnName,
      references: `${f.refSchema}.${f.refTable}.${f.refColumn}`,
    })),
    help: [
      `Run \`mssql-axi sample --schema ${schema} --name ${name} --limit 5\` to preview rows`,
      `Run \`mssql-axi query --sql "SELECT TOP 10 * FROM ${schema}.${name}"\` to inspect data`,
    ],
  };
}

async function inspectView(
  db: import("../lib/driver/index.js").Database,
  schema: string,
  name: string,
): Promise<Record<string, unknown>> {
  const schemaLit = sqlString(schema);
  const nameLit = sqlString(name);
  const exists = await db.query<{ objectId: number; definition: string | null }>(
    "SELECT v.object_id AS objectId, OBJECT_DEFINITION(v.object_id) AS definition " +
      "FROM sys.views v " +
      "JOIN sys.schemas s ON v.schema_id = s.schema_id " +
      `WHERE s.name = ${schemaLit} AND v.name = ${nameLit}`,
  );
  const obj = exists[0];
  if (!obj) {
    throw new AxiError(`view '${schema}.${name}' not found`, "NOT_FOUND", [
      "Run `mssql-axi list --kind views --schema " + schema + "` to see available views",
    ]);
  }
  const objectIdLit = String(obj.objectId);
  const columns = await db.query<{ name: string; type: string; maxLength: number; nullable: boolean }>(
    "SELECT c.name AS name, ty.name AS type, c.max_length AS maxLength, c.is_nullable AS nullable " +
      "FROM sys.columns c JOIN sys.types ty ON c.user_type_id = ty.user_type_id " +
      `WHERE c.object_id = ${objectIdLit} ORDER BY c.column_id`,
  );
  return {
    kind: "view",
    schema,
    name,
    columns: columns.map((c) => ({
      name: c.name,
      type: formatType(c.type, c.maxLength),
      nullable: c.nullable,
    })),
    definition: obj.definition,
    help: [
      `Run \`mssql-axi query --sql "SELECT TOP 10 * FROM ${schema}.${name}"\` to inspect data`,
    ],
  };
}

async function inspectIndex(
  db: import("../lib/driver/index.js").Database,
  schema: string,
  name: string,
): Promise<Record<string, unknown>> {
  const schemaLit = sqlString(schema);
  const nameLit = sqlString(name);
  const exists = await db.query<{
    objectId: number;
    tableName: string;
    typeDesc: string;
    isUnique: boolean;
    isPrimaryKey: boolean;
  }>(
    "SELECT i.object_id AS objectId, OBJECT_NAME(i.object_id) AS tableName, " +
      "  i.type_desc AS typeDesc, i.is_unique AS isUnique, i.is_primary_key AS isPrimaryKey " +
      "FROM sys.indexes i " +
      "JOIN sys.objects o ON i.object_id = o.object_id " +
      "JOIN sys.schemas s ON o.schema_id = s.schema_id " +
      `WHERE s.name = ${schemaLit} AND i.name = ${nameLit}`,
  );
  const obj = exists[0];
  if (!obj) {
    throw new AxiError(`index '${schema}.${name}' not found`, "NOT_FOUND", [
      "Run `mssql-axi list --kind indexes --schema " + schema + "` to see available indexes",
    ]);
  }
  const objectIdLit = String(obj.objectId);
  const columns = await db.query<{ columnName: string; keyOrdinal: number; isDescendingKey: boolean }>(
    "SELECT c.name AS columnName, ic.key_ordinal AS keyOrdinal, ic.is_descending_key AS isDescendingKey " +
      "FROM sys.indexes i " +
      "JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id " +
      "JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id " +
      `WHERE i.object_id = ${objectIdLit} AND i.name = ${nameLit} ` +
      "ORDER BY ic.key_ordinal",
  );
  return {
    kind: "index",
    schema,
    name,
    table: obj.tableName,
    type: obj.typeDesc,
    unique: obj.isUnique,
    primaryKey: obj.isPrimaryKey,
    columns: columns.map((c) => ({
      name: c.columnName,
      descending: c.isDescendingKey,
    })),
    help: [
      `Run \`mssql-axi query --sql "SELECT * FROM ${schema}.${obj.tableName} WITH (INDEX(${name}))"\` (if applicable)`,
    ],
  };
}

function formatType(type: string, maxLength: number): string {
  if (type === "nvarchar" || type === "varchar" || type === "char" || type === "nchar") {
    if (maxLength === -1) return `${type}(max)`;
    const display = type.startsWith("n") ? Math.floor(maxLength / 2) : maxLength;
    return `${type}(${display})`;
  }
  if (type === "decimal" || type === "numeric") return type;
  return type;
}
