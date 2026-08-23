/**
 * Tiny flag parser. Returns a map of `flag-name -> value-or-true`.
 * Supports `--key value`, `--key=value`, and bare `--key` (value: true).
 * Positional args are accessible via `parsePositional()`.
 */
import { AxiError } from "axi-sdk-js";

export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  positionals: string[];
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    let key: string;
    let value: string | boolean;
    if (eq >= 0) {
      key = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else {
      key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i++;
      } else {
        value = true;
      }
    }
    flags[key] = value;
  }
  return { flags, positionals };
}

/**
 * The SQL text for a command: `--sql "..."` or the first positional, so
 * `mssql-axi query "SELECT 1"` works like `mssql-axi query --sql "SELECT 1"`.
 */
export function sqlArgument(args: ParsedArgs, positionalIndex = 0): string | undefined {
  const fromFlag = args.flags.sql;
  if (typeof fromFlag === "string" && fromFlag.trim() !== "") return fromFlag;
  const fromPositional = args.positionals[positionalIndex];
  if (typeof fromPositional === "string" && fromPositional.trim() !== "") return fromPositional;
  return undefined;
}

/**
 * Splits a possibly qualified object name into schema and name.
 * Accepts `Users`, `dbo.Users`, `[dbo].[Users]`, and `[my.schema].[my.table]`.
 */
export function splitQualifiedName(raw: string): { schema?: string; name: string } {
  const parts: string[] = [];
  let current = "";
  let inBrackets = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "[" && !inBrackets) {
      inBrackets = true;
      continue;
    }
    if (ch === "]" && inBrackets) {
      if (raw[i + 1] === "]") {
        current += "]";
        i++;
        continue;
      }
      inBrackets = false;
      continue;
    }
    if (ch === "." && !inBrackets) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  const nonEmpty = parts.filter((p) => p !== "");
  if (nonEmpty.length >= 2) {
    return { schema: nonEmpty[nonEmpty.length - 2], name: nonEmpty[nonEmpty.length - 1]! };
  }
  return { name: nonEmpty[0] ?? raw };
}

/**
 * Resolves a table/view target from `--schema`/`--name` or a positional that may
 * be qualified (`dbo.Users`). An explicit `--schema` always wins.
 */
export function objectTarget(
  args: ParsedArgs,
  positionalIndex = 0,
): { schema?: string; name?: string } {
  const schemaFlag = typeof args.flags.schema === "string" ? args.flags.schema : undefined;
  const nameFlag = typeof args.flags.name === "string" ? args.flags.name : undefined;
  const raw = nameFlag ?? args.positionals[positionalIndex];
  if (raw === undefined) return { schema: schemaFlag, name: undefined };
  const split = splitQualifiedName(raw);
  return { schema: schemaFlag ?? split.schema, name: split.name };
}

export function flagString(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags[name];
  return typeof v === "string" ? v : undefined;
}

export function flagBool(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true;
}

export function flagNumber(args: ParsedArgs, name: string): number | undefined {
  const v = args.flags[name];
  if (typeof v !== "string") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`flag --${name} expects a number, got '${v}'`);
  }
  return n;
}

/**
 * Refuses extra positional arguments so the agent never believes input was
 * used when it was silently dropped (AXI principle 6). `max` is the number of
 * positionals the command actually consumes.
 */
export function assertMaxPositionals(
  args: ParsedArgs,
  max: number,
  commandName: string,
  usage: string,
): void {
  if (args.positionals.length <= max) return;
  throw new AxiError(
    `too many arguments for '${commandName}': got ${args.positionals.length}, expected at most ${max} (unexpected: '${args.positionals[max]}')`,
    "VALIDATION_ERROR",
    [usage],
  );
}

/**
 * Refuses unknown flags up-front so the agent learns immediately rather than
 * silently ignoring them. Pass the set of known flag names.
 */
export function assertKnownFlags(
  args: ParsedArgs,
  known: readonly string[],
  commandName: string,
): void {
  const knownSet = new Set(known);
  for (const key of Object.keys(args.flags)) {
    if (!knownSet.has(key)) {
      throw new Error(
        `unknown flag --${key} for command '${commandName}' (known: ${known.join(", ")})`,
      );
    }
  }
}
