/**
 * Tiny flag parser. Returns a map of `flag-name -> value-or-true`.
 * Supports `--key value`, `--key=value`, and bare `--key` (value: true).
 * Positional args are accessible via `parsePositional()`.
 */
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
