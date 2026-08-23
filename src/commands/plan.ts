import { AxiError } from "axi-sdk-js";
import { assertMaxPositionals, parseArgs, sqlArgument } from "../lib/args.js";
import { isDestructive, normaliseSql } from "../lib/normalize.js";

// plan never opens a connection, so connection flags are intentionally NOT
// accepted: accepting-and-ignoring them would imply they affect the output.
const KNOWN_FLAGS = ["sql", "allow-destructive"];

export async function planCommand(args: readonly string[]): Promise<Record<string, unknown>> {
  const parsed = parseArgs(args);
  for (const key of Object.keys(parsed.flags)) {
    if (!KNOWN_FLAGS.includes(key)) {
      throw new AxiError(`unknown flag --${key}`, "UNKNOWN_FLAG", [
        `Known flags: ${KNOWN_FLAGS.join(", ")}`,
      ]);
    }
  }

  const sqlText = sqlArgument(parsed);
  assertMaxPositionals(
    parsed,
    1,
    "plan",
    "Pass exactly one SQL statement: `mssql-axi plan \"UPDATE ...\"`",
  );
  if (!sqlText) {
    throw new AxiError("a SQL statement is required for plan", "VALIDATION_ERROR", [
      "Pass it positionally: `mssql-axi plan \"INSERT ...\"`",
      "Or with the flag: `mssql-axi plan --sql \"INSERT ...\"`",
    ]);
  }
  const allowDestructive = parsed.flags["allow-destructive"] === true;

  const dest = isDestructive(sqlText);
  if (dest.destructive && !allowDestructive) {
    return {
      status: "plan",
      destructive: true,
      reason: dest.reason,
      sql: sqlText,
      normalised: normaliseSql(sqlText),
      help: [
        "Add --allow-destructive to `execute` to run this anyway",
        "Or rewrite the SQL to add a WHERE clause (for UPDATE/DELETE) or remove the DROP/TRUNCATE",
        "Run `mssql-axi execute --sql \"...\" --confirm \"<same sql>\" --allow-destructive --execute` to commit",
      ],
    };
  }

  return {
    status: "plan",
    destructive: dest.destructive,
    sql: sqlText,
    normalised: normaliseSql(sqlText),
    help: [
      "Run `mssql-axi execute --sql \"...\" --confirm \"<same sql>\" [--execute] [--allow-destructive]` to commit",
      "The --confirm value must match the SQL after stripping comments and normalising whitespace",
    ],
  };
}
