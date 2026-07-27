#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encode } from "@toon-format/toon";
import { AxiError, runAxiCli } from "axi-sdk-js";
import { doctorCommand } from "../commands/doctor.js";
import { executeCommand } from "../commands/execute.js";
import { explainCommand } from "../commands/explain.js";
import { homeCommand } from "../commands/home.js";
import { inspectCommand } from "../commands/inspect.js";
import { listCommand } from "../commands/list.js";
import { planCommand } from "../commands/plan.js";
import { queryCommand } from "../commands/query.js";
import { sampleCommand } from "../commands/sample.js";
import { setupCommand } from "../commands/setup.js";
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

await runAxiCli({
  description: "Inspect and query Microsoft SQL Server and Azure SQL databases",
  version,
  topLevelHelp: TOP_LEVEL_HELP,
  getCommandHelp: (command) => COMMAND_HELP[command] ?? null,
  formatError,
  home: (args) => homeCommand(args),
  commands: {
    doctor: (args) => doctorCommand(args),
    list: (args) => listCommand(args),
    inspect: (args) => inspectCommand(args),
    sample: (args) => sampleCommand(args),
    query: (args) => queryCommand(args),
    explain: (args) => explainCommand(args),
    plan: (args) => planCommand(args),
    execute: (args) => executeCommand(args),
    setup: (args) => setupCommand(args),
  },
});
