import type { AxiError } from "axi-sdk-js";

export const TOP_LEVEL_HELP = [
  "mssql-axi                       # home view: server, DB, top tables",
  "mssql-axi doctor                # connectivity + read-only role check",
  "mssql-axi list --kind <kind>    # tables | views | indexes | schemas",
  "mssql-axi inspect --kind <kind> --schema <s> --name <n>",
  "mssql-axi sample  --schema <s> --name <n> [--where \"...\"] [--limit N]",
  "mssql-axi query  --sql \"...\"    [--limit N] [--full]",
  "mssql-axi plan   --sql \"...\"    # show the T-SQL without executing",
  "mssql-axi execute --sql \"...\"   # mutating; requires --confirm <sql> and --execute",
  "mssql-axi explain --sql \"...\"   # SET SHOWPLAN_XML ON",
  "mssql-axi setup role            # prints T-SQL to create agent_reader",
  "mssql-axi setup hooks           # installs SessionStart hooks",
  "mssql-axi setup config          # writes example mssql-axi.config.json",
  "mssql-axi update                # self-update",
  "mssql-axi update --check        # check for newer version",
  "",
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
    "mssql-axi list --kind <kind> [--schema <s>]",
    "",
    "Kinds: tables | views | indexes | schemas",
  ].join("\n"),
  inspect: [
    "mssql-axi inspect --kind <kind> --schema <s> --name <n>",
    "",
    "Kinds: table | view | index",
  ].join("\n"),
  sample: [
    "mssql-axi sample --schema <s> --name <n> [--where \"...\"] [--limit N] [--full]",
  ].join("\n"),
  query: ["mssql-axi query --sql \"...\" [--limit N] [--full]"].join("\n"),
  plan: ["mssql-axi plan --sql \"INSERT ...\"", "", "Shows the T-SQL, does not execute."].join(
    "\n",
  ),
  execute: [
    "mssql-axi execute --sql \"...\" --confirm \"<exact sql>\" [--execute] [--allow-destructive]",
    "",
    "Mutating; dry-run by default. Add --execute after reviewing the T-SQL.",
    "Destructive patterns (DROP/TRUNCATE/DELETE-no-WHERE/UPDATE-no-WHERE) require --allow-destructive.",
  ].join("\n"),
  explain: ["mssql-axi explain --sql \"SELECT ...\"", "", "Runs SET SHOWPLAN_XML ON."].join("\n"),
  setup: [
    "mssql-axi setup <subcommand>",
    "",
    "Subcommands: role | hooks | config",
  ].join("\n"),
};

export type { AxiError };
