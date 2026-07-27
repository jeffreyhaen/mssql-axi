import { AxiError } from "axi-sdk-js";
import { parseArgs } from "../lib/args.js";
import { resolveConnection } from "../lib/config.js";
import { withDatabase } from "../lib/connect.js";
import { redactSecrets } from "../lib/redact.js";
import { validateReadOnly } from "../lib/readOnlyGuard.js";
import { DEFAULT_CELL_CAP, truncateRow } from "../lib/truncate.js";

const KNOWN_FLAGS = [
  "connection-string",
  "connection",
  "config",
  "sql",
  "limit",
  "full",
];

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000;

export async function queryCommand(args: readonly string[]): Promise<Record<string, unknown>> {
  const parsed = parseArgs(args);
  for (const key of Object.keys(parsed.flags)) {
    if (!KNOWN_FLAGS.includes(key)) {
      throw new AxiError(`unknown flag --${key}`, "UNKNOWN_FLAG", [
        `Known flags: ${KNOWN_FLAGS.join(", ")}`,
      ]);
    }
  }

  const sqlText = typeof parsed.flags.sql === "string" ? parsed.flags.sql : undefined;
  if (!sqlText) {
    throw new AxiError("--sql is required for query", "VALIDATION_ERROR", [
      "Pass --sql \"SELECT ...\"",
    ]);
  }
  const full = parsed.flags.full === true;
  const limit = clampLimit(parsed.flags.limit);

  const plan = validateReadOnly(sqlText);

  const resolved = resolveConnection({
    connectionString:
      typeof parsed.flags["connection-string"] === "string"
        ? parsed.flags["connection-string"]
        : undefined,
    connectionName:
      typeof parsed.flags.connection === "string" ? parsed.flags.connection : undefined,
    configPath: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
  });

  const cap = full ? Number.MAX_SAFE_INTEGER : DEFAULT_CELL_CAP;

  try {
    return await withDatabase(resolved.connectionString, async (db) => {
      if (plan.kind === "showplan") {
        await db.query("SET SHOWPLAN_XML ON");
        try {
          const result = await db.query(plan.selectSql);
          const first = result[0] ?? {};
          const xml = typeof first["Microsoft SQL Server 2000 XML Showplan"] === "string"
            ? (first["Microsoft SQL Server 2000 XML Showplan"] as string)
            : Object.values(first)[0];
          await db.query("SET SHOWPLAN_XML OFF");
          return {
            plan: "showplan",
            ...summarizePlan(typeof xml === "string" ? xml : null),
            help: [
              "Use --full to see the full Showplan XML",
              "Run `mssql-axi query --sql \"...\"` to execute the SELECT normally",
            ],
          };
        } catch (err) {
          try {
            await db.query("SET SHOWPLAN_XML OFF");
          } catch {
            // best-effort reset
          }
          throw err;
        }
      }
      const result = await db.query(plan.sql);
      const total = result.length;
      const truncated = result.slice(0, limit);
      const hasMore = total > limit;
      const rows: Record<string, unknown>[] = [];
      let anyTruncated = false;
      for (const r of truncated) {
        const out = truncateRow(r, cap);
        rows.push(out.row);
        if (out.anyTruncated) anyTruncated = true;
      }
      return {
        driver: db.driver,
        count: rows.length,
        ...(hasMore ? { truncated: true, truncatedAt: limit, totalCount: total } : {}),
        ...(anyTruncated && !full ? { cellTruncated: true } : {}),
        rows,
        help: [
          "Run `mssql-axi inspect --kind table --schema <s> --name <n>` to see column metadata",
          "Use --full to disable per-cell truncation",
          "Use `mssql-axi explain --sql \"...\"` to see the query plan",
        ],
      };
    });
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AxiError(
      `query failed: ${redactSecrets(message, [resolved.connectionString])}`,
      "CONNECTION_FAILED",
      [
        "Check the SQL, your --connection-string, and credentials",
        "Run `mssql-axi doctor` to verify connectivity",
      ],
    );
  }
}

function summarizePlan(xml: string | null): Record<string, unknown> {
  if (!xml) return { physicalOps: [], estimatedCost: null };
  const ops: string[] = [];
  const physicalOpRe = /PhysicalOp="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = physicalOpRe.exec(xml)) !== null) {
    ops.push(m[1]!);
  }
  const costMatch = /EstimatedTotalSubtreeCost="([^"]+)"/.exec(xml);
  return {
    physicalOps: ops,
    estimatedCost: costMatch ? Number(costMatch[1]) : null,
    fullXmlChars: xml.length,
  };
}

function clampLimit(value: string | boolean | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AxiError("--limit expects a positive number", "VALIDATION_ERROR", [
      "Pass --limit 100 for example",
    ]);
  }
  return Math.min(MAX_LIMIT, Math.floor(n));
}
