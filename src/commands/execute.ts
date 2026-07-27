import { AxiError } from "axi-sdk-js";
import { parseArgs } from "../lib/args.js";
import { resolveConnection } from "../lib/config.js";
import { withDatabase } from "../lib/connect.js";
import { redactSecrets } from "../lib/redact.js";
import { isDestructive, normaliseSql } from "../lib/normalize.js";

const KNOWN_FLAGS = [
  "connection-string",
  "connection",
  "config",
  "sql",
  "confirm",
  "execute",
  "allow-destructive",
  "timeout",
  "max-rows-affected",
];

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_MAX_ROWS_AFFECTED = 10_000;

export async function executeCommand(args: readonly string[]): Promise<Record<string, unknown>> {
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
    throw new AxiError("--sql is required for execute", "VALIDATION_ERROR", [
      "Pass --sql \"INSERT ...\"",
    ]);
  }
  const confirm = typeof parsed.flags.confirm === "string" ? parsed.flags.confirm : undefined;
  if (!confirm) {
    throw new AxiError(
      "--confirm <sql> is required for execute (must match --sql after normalising)",
      "VALIDATION_ERROR",
      [
        "Run `mssql-axi plan --sql \"...\"` to see the normalised form",
        "Then re-run with `--confirm \"<the exact same sql>\"` (whitespace is normalised)",
      ],
    );
  }
  const executeNow = parsed.flags.execute === true;
  const allowDestructive = parsed.flags["allow-destructive"] === true;
  const timeoutMs = clampNumber(parsed.flags.timeout, "timeout", DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxRows = clampNumber(
    parsed.flags["max-rows-affected"],
    "max-rows-affected",
    DEFAULT_MAX_ROWS_AFFECTED,
    Number.MAX_SAFE_INTEGER,
  );

  rejectUnsafe(sqlText);
  if (/^\s*SELECT\b/i.test(normaliseSql(sqlText))) {
    throw new AxiError("SELECT is not a mutation; use `mssql-axi query`", "VALIDATION_ERROR", [
      "Use `mssql-axi query --sql \"SELECT ...\"` for reads",
    ]);
  }

  const target = normaliseSql(sqlText);
  const given = normaliseSql(confirm);
  if (target !== given) {
    throw new AxiError(
      "--confirm does not match --sql (whitespace and comments are normalised; they must be otherwise identical)",
      "VALIDATION_ERROR",
      [
        "Run `mssql-axi plan --sql \"...\"` to see the expected normalised form",
        "Copy the SQL exactly (or paste it back) and pass it via --confirm",
      ],
    );
  }

  const dest = isDestructive(sqlText);
  if (dest.destructive && !allowDestructive) {
    throw new AxiError(
      `destructive SQL refused: ${dest.reason}`,
      "DESTRUCTIVE_REFUSED",
      [
        "Add --allow-destructive to run this anyway",
        "Or rewrite the SQL to add a WHERE clause (for UPDATE/DELETE) or remove the DROP/TRUNCATE",
      ],
    );
  }

  if (!executeNow) {
    return {
      status: "dry-run",
      sql: sqlText,
      normalised: target,
      destructive: dest.destructive,
      help: [
        "Add --execute to actually run the SQL",
        "Run `mssql-axi plan --sql \"...\"` first to preview",
      ],
    };
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
      const result = await withTimeout(db.execute(sqlText), timeoutMs);
      const rowsAffected = (result.rowsAffected ?? [0]).reduce((a, b) => a + b, 0);
      if (rowsAffected > maxRows) {
        throw new AxiError(
          `rowsAffected ${rowsAffected.toLocaleString()} exceeds --max-rows-affected ${maxRows.toLocaleString()}; refusing to report a successful run`,
          "ROW_LIMIT",
          [
            "Increase --max-rows-affected if this is intentional",
            "Or add a WHERE clause / TOP N to the SQL",
          ],
        );
      }
      return {
        status: "ok",
        driver: db.driver,
        sql: sqlText,
        rowsAffected,
        timeoutMs,
        destructive: dest.destructive,
        help: [
          "Run `mssql-axi query --sql \"SELECT ...\"` to verify the change",
          "Run `mssql-axi execute --help` to see all safety flags",
        ],
      };
    });
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AxiError(
      `execute failed: ${redactSecrets(message, [resolved.connectionString])}`,
      "CONNECTION_FAILED",
      [
        "Check the SQL, your --connection-string, and credentials",
        "Run `mssql-axi doctor` to verify connectivity",
      ],
    );
  }
}

function rejectUnsafe(sql: string): void {
  if (/(^|\s|;)GO\s*($|;)/i.test(sql)) {
    throw new AxiError("`GO` terminators are not allowed", "READ_ONLY", [
      "Send a single statement without GO",
    ]);
  }
  if (/;/.test(normaliseSql(sql))) {
    const stripped = normaliseSql(sql).replace(/;\s*$/, "");
    if (/;/.test(stripped)) {
      throw new AxiError("stacked statements are not allowed", "READ_ONLY", [
        "Use a single statement",
      ]);
    }
  }
}

function clampNumber(
  value: string | boolean | undefined,
  name: string,
  defaultValue: number,
  ceiling: number,
): number {
  if (value === undefined) return defaultValue;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AxiError(`--${name} expects a positive number`, "VALIDATION_ERROR", [
      `Pass --${name} <number>`,
    ]);
  }
  return Math.min(ceiling, Math.floor(n));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new AxiError(`query exceeded --timeout ${ms}ms`, "TIMEOUT", [
        "Increase --timeout",
        "Optimize the SQL (add a WHERE / index hint)",
      ]));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
