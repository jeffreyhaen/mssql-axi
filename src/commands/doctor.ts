import { AxiError } from "axi-sdk-js";
import { parseArgs } from "../lib/args.js";
import { resolveConnection } from "../lib/config.js";
import { withDatabase } from "../lib/connect.js";
import { redactSecrets } from "../lib/redact.js";

const KNOWN_FLAGS = [
  "connection-string",
  "connection",
  "config",
];

export async function doctorCommand(args: readonly string[]): Promise<Record<string, unknown>> {
  const parsed = parseArgs(args);
  for (const key of Object.keys(parsed.flags)) {
    if (!KNOWN_FLAGS.includes(key)) {
      throw new AxiError(`unknown flag --${key}`, "UNKNOWN_FLAG", [
        `Known flags: ${KNOWN_FLAGS.join(", ")}`,
      ]);
    }
  }

  let resolved: ReturnType<typeof resolveConnection>;
  try {
    resolved = resolveConnection({
      connectionString:
        typeof parsed.flags["connection-string"] === "string"
          ? parsed.flags["connection-string"]
          : undefined,
      connectionName:
        typeof parsed.flags.connection === "string" ? parsed.flags.connection : undefined,
      configPath: typeof parsed.flags.config === "string" ? parsed.flags.config : undefined,
    });
  } catch (err) {
    if (err instanceof AxiError) {
      return {
        status: "unreachable",
        error: err.message,
        code: err.code,
        help: err.suggestions,
      };
    }
    throw err;
  }

  try {
    return await withDatabase(resolved.connectionString, async (db) => {
      const ping = await db.query("SELECT 1 AS one");
      const role = await db.query<{ isReader: number; isDenydatawriter: number; userName: string }>(
        "SELECT IS_MEMBER('agent_reader') AS isReader, " +
          "IS_MEMBER('db_denydatawriter') AS isDenydatawriter, " +
          "USER_NAME() AS userName",
      );
      const time = await db.query<{
        serverTime: string;
        utc: string;
        offsetMinutes: number;
      }>(
        "SELECT CAST(SYSDATETIMEOFFSET() AS DATETIME) AS serverTime, " +
          "CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'UTC' AS DATETIME) AS utc, " +
          "DATEDIFF(MINUTE, SYSDATETIMEOFFSET() AT TIME ZONE 'UTC', SYSDATETIMEOFFSET()) AS offsetMinutes",
      );
      const roleRow = role[0];
      const agentReader = roleRow?.isReader === 1;
      return {
        status: "ok",
        driver: db.driver,
        connection: resolved.namedConnection ?? null,
        source: resolved.source,
        ping: ping[0]?.one === 1,
        agentReader,
        dbDenydatawriter: roleRow?.isDenydatawriter === 1,
        user: roleRow?.userName ?? null,
        serverTime: time[0]?.serverTime ?? null,
        utc: time[0]?.utc ?? null,
        tzOffsetMinutes: time[0]?.offsetMinutes ?? 0,
        warnings: agentReader
          ? []
          : ["agent_reader role is not granted; this user may have write access"],
        help: [
          "Run `mssql-axi list --kind tables` to enumerate tables",
          "If agentReader is false, run `mssql-axi setup role` and grant the role",
          "If ping is false, the server is unreachable or auth is wrong",
        ],
      };
    });
  } catch (err) {
    if (err instanceof AxiError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AxiError(
      `connection failed: ${redactSecrets(message, [resolved.connectionString])}`,
      "CONNECTION_FAILED",
      [
        "Check your --connection-string for correctness",
        "Verify the ODBC driver is installed (ODBC Driver 17 or 18 for SQL Server)",
        "Run `mssql-axi setup config` to generate a known-good example",
      ],
    );
  }
}
