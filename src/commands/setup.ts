import { AxiError, installSessionStartHooks } from "axi-sdk-js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../lib/args.js";

const KNOWN_FLAGS = ["output", "marker", "name"];

const ROLE_TSQL = `-- ============================================================================
-- mssql-axi: agent_reader role (one-time setup, run as sysadmin)
-- ============================================================================
-- This script creates a low-privilege login for read-only agent access.
-- It grants db_datareader (read every table/view) and db_denydatawriter
-- (block INSERT/UPDATE/DELETE/MERGE) on every database the agent should see.
--
-- Run in SQL Server Management Studio, sqlcmd, or Azure Data Studio.
-- Review every line before executing.
-- ----------------------------------------------------------------------------

USE [master];
GO

-- 1) Server-level login. Replace the password with a strong one.
--    Stash it in the environment so it never lands in a config file.
CREATE LOGIN [agent_reader]
    WITH PASSWORD = N'<replace-with-strong-password>';
GO

-- 2) For every database the agent needs, create a user mapped to the login
--    and grant the read-only role pair. Repeat this block per database.
--
--    DECLARE @db SYSNAME = N'<database-name>';
--    DECLARE @sql NVARCHAR(MAX) = N'USE ' + QUOTENAME(@db) + N';
--        IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N''agent_reader'')
--            CREATE USER [agent_reader] FOR LOGIN [agent_reader];
--        ALTER ROLE [db_datareader] ADD MEMBER [agent_reader];
--        ALTER ROLE [db_denydatawriter] ADD MEMBER [agent_reader];';
--    EXEC sp_executesql @sql;
--    GO

-- Example for a single database 'app':
USE [app];
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'agent_reader')
    CREATE USER [agent_reader] FOR LOGIN [agent_reader];
GO
ALTER ROLE [db_datareader] ADD MEMBER [agent_reader];
ALTER ROLE [db_denydatawriter] ADD MEMBER [agent_reader];
GO

-- ----------------------------------------------------------------------------
-- Revoke (when done with the role)
-- ----------------------------------------------------------------------------
-- USE [app];
-- GO
-- ALTER ROLE [db_datareader] DROP MEMBER [agent_reader];
-- ALTER ROLE [db_denydatawriter] DROP MEMBER [agent_reader];
-- DROP USER [agent_reader];
-- GO
-- USE [master];
-- GO
-- DROP LOGIN [agent_reader];
-- GO
`;

const CONFIG_EXAMPLE = {
  default: "dev",
  connections: {
    dev: "Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=app;Trusted_Connection=Yes;Trust Server Certificate=Yes;",
    azure: "Driver={ODBC Driver 18 for SQL Server};Server=tcp:myapp.database.windows.net,1433;Initial Catalog=app;Authentication=ActiveDirectoryInteractive;Encrypt=Yes;",
  },
};

export async function setupCommand(
  args: readonly string[],
): Promise<string | Record<string, unknown>> {
  const sub = args[0];
  if (!sub) {
    throw new AxiError("setup requires a subcommand", "VALIDATION_ERROR", [
      "Run `mssql-axi setup role | hooks | config`",
    ]);
  }
  switch (sub) {
    case "role":
      return runSetupRole(args.slice(1));
    case "hooks":
      return runSetupHooks(args.slice(1));
    case "config":
      return runSetupConfig(args.slice(1));
    default:
      throw new AxiError(`unknown setup subcommand '${sub}'`, "VALIDATION_ERROR", [
        "Run `mssql-axi setup role | hooks | config`",
      ]);
  }
}

function runSetupRole(args: readonly string[]): string | Record<string, unknown> {
  const parsed = parseArgs(args);
  for (const key of Object.keys(parsed.flags)) {
    if (!KNOWN_FLAGS.includes(key)) {
      throw new AxiError(`unknown flag --${key}`, "UNKNOWN_FLAG", [
        `Known flags: ${KNOWN_FLAGS.join(", ")}`,
      ]);
    }
  }
  const output = typeof parsed.flags.output === "string" ? parsed.flags.output : undefined;
  if (output) {
    writeFileSync(output, ROLE_TSQL, "utf8");
    return {
      status: "ok",
      writtenTo: output,
      note: "T-SQL was written, NOT executed. Open the file, review, then run as sysadmin.",
      help: [
        "Open the file in your editor and review the CREATE LOGIN / CREATE USER statements",
        "Replace <replace-with-strong-password> with a strong password",
        "Set the env var MSSQL_AGENT_PWD to the same value before running mssql-axi",
        "Run the script in SQL Server Management Studio or `sqlcmd -S ... -i <file>`",
      ],
    };
  }
  // Without --output, the T-SQL is returned as a plain string. The SDK
  // renders string AxiRenderable values verbatim, so the script is printed
  // directly to stdout (pipeable to `mssql-axi setup role > agent-reader.sql`).
  return ROLE_TSQL;
}

function runSetupHooks(args: readonly string[]): Record<string, unknown> {
  const parsed = parseArgs(args);
  for (const key of Object.keys(parsed.flags)) {
    if (!KNOWN_FLAGS.includes(key)) {
      throw new AxiError(`unknown flag --${key}`, "UNKNOWN_FLAG", [
        `Known flags: ${KNOWN_FLAGS.join(", ")}`,
      ]);
    }
  }
  const marker = typeof parsed.flags.marker === "string" ? parsed.flags.marker : "mssql-axi";
  installSessionStartHooks({ marker, binaryNames: [marker] });
  return {
    status: "ok",
    marker,
    note: "Hooks installed (or already up to date) for Claude Code, Codex, and OpenCode.",
    help: [
      "Restart your agent session to see the home view at session start",
      "Run `mssql-axi setup hooks --help` to see flags",
      "Re-run this command to repair hooks after a binary path change",
    ],
  };
}

function runSetupConfig(args: readonly string[]): Record<string, unknown> {
  const parsed = parseArgs(args);
  for (const key of Object.keys(parsed.flags)) {
    if (!KNOWN_FLAGS.includes(key)) {
      throw new AxiError(`unknown flag --${key}`, "UNKNOWN_FLAG", [
        `Known flags: ${KNOWN_FLAGS.join(", ")}`,
      ]);
    }
  }
  const output =
    typeof parsed.flags.output === "string"
      ? parsed.flags.output
      : join(process.cwd(), "mssql-axi.config.json");
  const json = JSON.stringify(CONFIG_EXAMPLE, null, 2) + "\n";
  writeFileSync(output, json, "utf8");
  return {
    status: "ok",
    writtenTo: output,
    note: "Each connection value is a full ODBC connection string. Edit to point at your servers; secrets should live in env vars and be substituted by your wrapper, or the connection string can be passed directly via --connection-string.",
    help: [
      "Edit the file: replace server, database, and any auth values per connection",
      "Run with `mssql-axi --connection dev <command>` to pick the dev connection",
      "Or set `default` to the name you want used when --connection is omitted",
      "Or skip the config file and use `--connection-string \"<ODBC string>\"` directly",
    ],
  };
}
