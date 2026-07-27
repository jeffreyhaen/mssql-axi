import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { AxiError } from "axi-sdk-js";
import { isOdbcConnectionString } from "./driver/index.js";

/**
 * Resolves an ODBC connection string from the user's inputs.
 *
 * Resolution order (first non-empty wins):
 *   1. `--connection-string <s>` flag
 *   2. `MSSQL_CONNECTION_STRING` environment variable
 *   3. Named connection in `mssql-axi.config.json` (or `--config <path>`):
 *        a. `--connection <name>` selects a specific entry
 *        b. `default` field selects the default entry
 *
 * Every value the user supplies must look like an ODBC connection string
 * (i.e. contain `Driver={...}`). Plain host/user/password flags were dropped
 * with the `mssql` driver — pass the full string instead.
 */

export interface ResolverFlags {
  connectionString?: string;
  connectionName?: string;
  configPath?: string;
}

export interface ResolvedConfig {
  connectionString: string;
  source: "flags" | "env" | "named" | "default";
  configPath?: string;
  namedConnection?: string;
}

const DEFAULT_CONFIG_FILES = ["mssql-axi.config.json", "mssql-axi.config.local.json"];

export function resolveConnection(flags: ResolverFlags = {}): ResolvedConfig {
  // 1. Explicit flag wins.
  if (flags.connectionString) {
    return assertOdbc(flags.connectionString, { source: "flags" });
  }

  // 2. Env var.
  const envCs = process.env.MSSQL_CONNECTION_STRING;
  if (envCs) {
    return assertOdbc(envCs, { source: "env" });
  }

  // 3. Config file (named or default).
  const { path: configPath, config } = loadConfigFile(flags.configPath);
  if (config) {
    const entries = config.connections;
    const target = flags.connectionName ?? config.default;
    if (!target) {
      throw new AxiError(
        "config file has no 'default' connection and --connection was not provided",
        "DB_AMBIGUOUS",
        [
          "Set 'default' in the config file",
          "Or pass --connection <name> to pick a connection",
          `Available connections: ${Object.keys(entries).join(", ") || "(none defined)"}`,
        ],
      );
    }
    const entry = entries[target];
    if (!entry) {
      throw new AxiError(
        `connection '${target}' not found in config`,
        "VALIDATION_ERROR",
        [
          `Available connections: ${Object.keys(entries).join(", ")}`,
          "Add the connection or pass --connection <existing-name>",
        ],
      );
    }
    return assertOdbc(entry, {
      source: flags.connectionName ? "named" : "default",
      configPath,
      namedConnection: target,
    });
  }

  throw new AxiError(
    "no connection configured",
    "AUTH_REQUIRED",
    [
      "Pass --connection-string \"<ODBC string>\" (must contain `Driver={...}`)",
      "Or set MSSQL_CONNECTION_STRING to a full ODBC connection string",
      "Or create mssql-axi.config.json in the working directory with named connections",
      "Run `mssql-axi setup config` for an example",
    ],
  );
}

function assertOdbc(
  connectionString: string,
  meta: {
    source: ResolvedConfig["source"];
    configPath?: string;
    namedConnection?: string;
  },
): ResolvedConfig {
  if (!isOdbcConnectionString(connectionString)) {
    throw new AxiError(
      "mssql-axi requires an ODBC-style connection string (with `Driver={...}`)",
      "VALIDATION_ERROR",
      [
        "Local SQL Server with Windows Auth:  Driver={ODBC Driver 17 for SQL Server};Server=localhost\\SQLEXPRESS;Database=app;Trusted_Connection=Yes;",
        "Azure SQL with AAD:                     Driver={ODBC Driver 18 for SQL Server};Server=tcp:host.database.windows.net,1433;Initial Catalog=app;Authentication=ActiveDirectoryInteractive;Encrypt=Yes;",
        "Run `mssql-axi setup config` for an example",
      ],
    );
  }
  return { connectionString, ...meta };
}

interface ConfigFile {
  default?: string;
  connections: Record<string, string>;
}

function loadConfigFile(
  explicitPath?: string,
): { path?: string; config?: ConfigFile } {
  const candidates = explicitPath
    ? [resolvePath(explicitPath)]
    : DEFAULT_CONFIG_FILES.map((p) => resolvePath(process.cwd(), p));

  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(raw) as ConfigFile;
      if (!parsed || typeof parsed !== "object" || !parsed.connections) {
        throw new AxiError(
          `Config file at ${candidate} is missing required 'connections' object`,
          "VALIDATION_ERROR",
          [
            "Run `mssql-axi setup config` for an example",
            "The file must be JSON of shape { connections: { dev: 'Driver={...}' } }",
          ],
        );
      }
      return { path: candidate, config: parsed };
    } catch (err) {
      if (err instanceof AxiError) throw err;
      if (isNotFound(err)) continue;
      if (err instanceof SyntaxError) {
        throw new AxiError(
          `Config file at ${candidate} is not valid JSON: ${err.message}`,
          "VALIDATION_ERROR",
          ["Fix the JSON syntax or delete the file to fall back to env vars"],
        );
      }
      throw err;
    }
  }
  return {};
}

function isNotFound(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err && (err as { code: string }).code === "ENOENT",
  );
}
