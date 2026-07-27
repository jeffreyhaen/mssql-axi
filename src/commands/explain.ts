import { AxiError } from "axi-sdk-js";
import { parseArgs } from "../lib/args.js";
import { resolveConnection } from "../lib/config.js";
import { withDatabase } from "../lib/connect.js";
import { redactSecrets } from "../lib/redact.js";
import { validateReadOnly } from "../lib/readOnlyGuard.js";

const KNOWN_FLAGS = [
  "connection-string",
  "connection",
  "config",
  "sql",
  "full",
];

export async function explainCommand(args: readonly string[]): Promise<Record<string, unknown>> {
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
    throw new AxiError("--sql is required for explain", "VALIDATION_ERROR", [
      "Pass --sql \"SELECT ...\"",
    ]);
  }
  const full = parsed.flags.full === true;

  const plan = validateReadOnly(sqlText);
  let selectSql: string;
  if (plan.kind === "select") {
    selectSql = plan.sql;
  } else if (plan.kind === "showplan") {
    selectSql = plan.selectSql;
  } else if (plan.kind === "explain") {
    selectSql = plan.sql.replace(/^\s*EXPLAIN\s+/i, "");
  } else {
    throw new AxiError(
      "explain only accepts a SELECT (or SET SHOWPLAN_XML ... SELECT ...)",
      "READ_ONLY",
      ["Use `mssql-axi query --sql ...` for a non-explain run"],
    );
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
      await db.query("SET SHOWPLAN_XML ON");
      try {
        const result = await db.query(selectSql);
        const first = result[0] ?? {};
        const xmlValue = Object.values(first)[0];
        const xml = typeof xmlValue === "string" ? xmlValue : null;
        const summary = summarizePlan(xml);
        const out: Record<string, unknown> = {
          ...summary,
          help: [
            "Add --full to include the full Showplan XML in `fullXml`",
            "Run `mssql-axi query --sql \"...\"` to execute the query and see actual rows",
          ],
        };
        if (full && xml) out.fullXml = xml;
        return out;
      } finally {
        try {
          await db.query("SET SHOWPLAN_XML OFF");
        } catch {
          // best-effort reset
        }
      }
    });
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AxiError(
      `explain failed: ${redactSecrets(message, [resolved.connectionString])}`,
      "CONNECTION_FAILED",
      [
        "Check the SQL, your --connection-string, and credentials",
        "Run `mssql-axi doctor` to verify connectivity",
      ],
    );
  }
}

function summarizePlan(xml: string | null): Record<string, unknown> {
  if (!xml) return { physicalOps: [], estimatedCost: null, fullXmlChars: 0 };
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
