#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "@toon-format/toon";
import { AxiError, runAxiCli } from "axi-sdk-js";
import { COMMAND_HELP, TOP_LEVEL_HELP } from "../help.js";

const USAGE_CODES = new Set([
  "VALIDATION_ERROR",
  "READ_ONLY",
  "UNKNOWN_FLAG",
  "DB_AMBIGUOUS",
  "AUTH_REQUIRED",
  "NOT_IMPLEMENTED",
  "NOT_FOUND",
  "DESTRUCTIVE_REFUSED",
  "ROW_LIMIT",
]);

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "../../package.json"), "utf8")) as {
      version?: string;
    };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function formatError(error: unknown): { output: string; exitCode: number } {
  if (error instanceof AxiError) {
    const out: Record<string, unknown> = {
      error: error.message,
      code: error.code,
    };
    if (error.suggestions.length > 0) out.help = error.suggestions;
    return { output: `${encode(out)}\n`, exitCode: USAGE_CODES.has(error.code) ? 2 : 1 };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { output: `${encode({ error: message, code: "UNKNOWN" })}\n`, exitCode: 1 };
}

const version = readVersion();

// Command modules are lazy-loaded so the fast paths (--version, --help) never
// pull in the ODBC driver or database code.
async function doctorHandler(args: string[]) {
  return (await import("../commands/doctor.js")).doctorCommand(args);
}

async function listHandler(args: string[]) {
  return (await import("../commands/list.js")).listCommand(args);
}

async function inspectHandler(args: string[]) {
  return (await import("../commands/inspect.js")).inspectCommand(args);
}

async function sampleHandler(args: string[]) {
  return (await import("../commands/sample.js")).sampleCommand(args);
}

async function queryHandler(args: string[]) {
  return (await import("../commands/query.js")).queryCommand(args);
}

async function explainHandler(args: string[]) {
  return (await import("../commands/explain.js")).explainCommand(args);
}

async function planHandler(args: string[]) {
  return (await import("../commands/plan.js")).planCommand(args);
}

async function executeHandler(args: string[]) {
  return (await import("../commands/execute.js")).executeCommand(args);
}

async function setupHandler(args: string[]) {
  return (await import("../commands/setup.js")).setupCommand(args);
}

async function homeHandler(args: string[]) {
  return (await import("../commands/home.js")).homeCommand(args);
}

await runAxiCli({
  description: "Inspect and query Microsoft SQL Server and Azure SQL databases",
  version,
  topLevelHelp: TOP_LEVEL_HELP,
  getCommandHelp: (command) => COMMAND_HELP[command] ?? null,
  formatError,
  home: homeHandler,
  commands: {
    home: homeHandler,
    doctor: doctorHandler,
    list: listHandler,
    inspect: inspectHandler,
    sample: sampleHandler,
    query: queryHandler,
    explain: explainHandler,
    plan: planHandler,
    execute: executeHandler,
    setup: setupHandler,
  },
});
