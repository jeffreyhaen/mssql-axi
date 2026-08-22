import type { AxiError } from "axi-sdk-js";

export const TOP_LEVEL_HELP = [
  "mssql-axi                       # home view: server, DB, top tables",
  "mssql-axi doctor                # connectivity + read-only role check",
  "mssql-axi list <kind>           # tables | views | indexes | schemas",
  "mssql-axi inspect [kind] <dbo.Table>",
  "mssql-axi sample  <dbo.Table>   [--where \"...\"] [--limit N]",
  "mssql-axi query  \"SELECT ...\"  [--limit N] [--full]",
  "mssql-axi plan   \"UPDATE ...\"  # show the T-SQL without executing",
  "mssql-axi execute \"UPDATE ...\" # mutating; requires --confirm <sql> and --execute",
  "mssql-axi explain \"SELECT ...\" # SET SHOWPLAN_XML ON",
  "mssql-axi setup role            # prints T-SQL to create agent_reader",
  "mssql-axi setup hooks           # installs SessionStart hooks",
  "mssql-axi setup config          # writes example mssql-axi.config.json",
  "mssql-axi update                # self-update",
  "mssql-axi update --check        # check for newer version",
  "",
  "SQL and object names may be passed positionally or as --sql / --schema + --name.",
  "Connection: --connection-string \"<ODBC string>\" (must contain `Driver={...}`)",
  "            --connection <name> | --config <path> | $MSSQL_CONNECTION_STRING",
].join("\n");

export const COMMAND_HELP: Record<string, string> = {
  doctor: [
    "mssql-axi doctor",
    "",
    "Test connectivity, assert agent_reader role, report server time + UTC offset.",
    "Pass --connection-string \"<ODBC string>\" (with `Driver={...}`).",
  ].join("\n"),
  list: [
    "mssql-axi list <kind> [--schema <s>] [--limit N]",
    "",
    "Kinds: tables | views | indexes | schemas (also accepted as --kind <kind>)",
    "",
    "Examples:",
    "  mssql-axi list tables",
    "  mssql-axi list views --schema sales",
  ].join("\n"),
  inspect: [
    "mssql-axi inspect [kind] <dbo.Object>",
    "",
    "Kinds: table | view | index (default: table). Flags --kind/--schema/--name also work.",
    "",
    "Examples:",
    "  mssql-axi inspect dbo.Users",
    "  mssql-axi inspect view dbo.vActiveUsers",
    "  mssql-axi inspect --kind table --schema sales --name Orders",
  ].join("\n"),
  sample: [
    "mssql-axi sample <dbo.Table> [--where \"...\"] [--limit N] [--full]",
    "",
    "Previews rows (default 5). Cells over 200 chars truncate unless --full is given.",
    "",
    "Examples:",
    "  mssql-axi sample dbo.Users",
    "  mssql-axi sample dbo.Users --where \"createdAt > '2026-01-01'\" --limit 20",
  ].join("\n"),
  query: [
    "mssql-axi query \"SELECT ...\" [--limit N] [--full]",
    "",
    "Read-only: only SELECT (optionally with a leading WITH cte), EXPLAIN, and",
    "SET SHOWPLAN_XML ON are accepted. The SQL may also be passed as --sql.",
    "",
    "Examples:",
    "  mssql-axi query \"SELECT TOP 10 id, email FROM dbo.Users\"",
    "  mssql-axi query --sql \"SELECT COUNT(*) FROM dbo.Orders\" --limit 1",
  ].join("\n"),
  plan: [
    "mssql-axi plan \"INSERT ...\"",
    "",
    "Shows the T-SQL, does not execute. Never opens a connection.",
  ].join("\n"),
  execute: [
    "mssql-axi execute \"<sql>\" --confirm \"<exact sql>\" [--execute] [--allow-destructive]",
    "",
    "Mutating; dry-run by default. Add --execute after reviewing the T-SQL.",
    "Destructive patterns (DROP/TRUNCATE/DELETE-no-WHERE/UPDATE-no-WHERE) require --allow-destructive.",
  ].join("\n"),
  explain: [
    "mssql-axi explain \"SELECT ...\" [--full]",
    "",
    "Runs SET SHOWPLAN_XML ON and summarises the physical operators and cost.",
  ].join("\n"),
  setup: [
    "mssql-axi setup <subcommand>",
    "",
    "Subcommands: role | hooks | config",
  ].join("\n"),
};

export type { AxiError };
