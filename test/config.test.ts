import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AxiError } from "axi-sdk-js";
import { resolveConnection } from "../src/lib/config.js";
import { collectSecretStrings, redactSecrets, redactOdbcConnectionString } from "../src/lib/redact.js";

const ENV_KEYS = [
  "MSSQL_CONNECTION_STRING",
];

const ENV_BACKUP: Record<string, string | undefined> = {};

const ODBC_DEV = "Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=app;Trusted_Connection=Yes;Trust Server Certificate=Yes;";
const ODBC_AZURE = "Driver={ODBC Driver 18 for SQL Server};Server=tcp:host.database.windows.net,1433;Initial Catalog=app;Authentication=ActiveDirectoryInteractive;Encrypt=Yes;";

beforeEach(() => {
  for (const k of ENV_KEYS) {
    ENV_BACKUP[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = ENV_BACKUP[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("resolveConnection (flags)", () => {
  it("returns an ODBC string passed via --connection-string", () => {
    const out = resolveConnection({ connectionString: ODBC_DEV });
    expect(out.source).toBe("flags");
    expect(out.connectionString).toBe(ODBC_DEV);
  });

  it("rejects a string without `Driver={...}`", () => {
    expect(() =>
      resolveConnection({ connectionString: "Server=localhost;Database=app" }),
    ).toThrow(AxiError);
  });
});

describe("resolveConnection (env)", () => {
  it("uses MSSQL_CONNECTION_STRING when set", () => {
    process.env.MSSQL_CONNECTION_STRING = ODBC_AZURE;
    const out = resolveConnection();
    expect(out.source).toBe("env");
    expect(out.connectionString).toBe(ODBC_AZURE);
  });
});

describe("resolveConnection (config file)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mssql-axi-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses the `default` connection when --connection is omitted", () => {
    writeFileSync(
      join(dir, "mssql-axi.config.json"),
      JSON.stringify({
        default: "dev",
        connections: { dev: ODBC_DEV, azure: ODBC_AZURE },
      }),
    );
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const out = resolveConnection();
      expect(out.source).toBe("default");
      expect(out.namedConnection).toBe("dev");
      expect(out.connectionString).toBe(ODBC_DEV);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("uses --connection to pick a non-default entry", () => {
    writeFileSync(
      join(dir, "mssql-axi.config.json"),
      JSON.stringify({
        default: "dev",
        connections: { dev: ODBC_DEV, azure: ODBC_AZURE },
      }),
    );
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      const out = resolveConnection({ connectionName: "azure" });
      expect(out.source).toBe("named");
      expect(out.namedConnection).toBe("azure");
      expect(out.connectionString).toBe(ODBC_AZURE);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("rejects an unknown connection name", () => {
    writeFileSync(
      join(dir, "mssql-axi.config.json"),
      JSON.stringify({
        default: "dev",
        connections: { dev: ODBC_DEV },
      }),
    );
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(() => resolveConnection({ connectionName: "nope" })).toThrow(/not found/);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("rejects a config entry that is not an ODBC string", () => {
    writeFileSync(
      join(dir, "mssql-axi.config.json"),
      JSON.stringify({
        default: "dev",
        connections: { dev: "Server=localhost;Database=app" },
      }),
    );
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(() => resolveConnection()).toThrow(/ODBC-style/);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("errors when the file is missing the connections object", () => {
    writeFileSync(join(dir, "mssql-axi.config.json"), JSON.stringify({ default: "x" }));
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      expect(() => resolveConnection()).toThrow(/missing required 'connections'/);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("resolveConnection (no source)", () => {
  it("throws AUTH_REQUIRED with helpful next steps when nothing is configured", () => {
    expect(() => resolveConnection()).toThrow(AxiError);
  });
});

describe("redactSecrets", () => {
  it("scrubs ODBC connection strings from any field's value when passed as additional secret", () => {
    const cs = "Driver={ODBC Driver 17 for SQL Server};Server=x;Password=TopSecret123";
    const out = redactSecrets({ error: `connection failed: ${cs}` }, [cs]);
    expect((out as { error: string }).error).toContain("***REDACTED***");
    expect((out as { error: string }).error).not.toContain("TopSecret123");
  });

  it("scrubs a connectionString field automatically", () => {
    const out = redactSecrets({
      connectionString: "Driver={x};Server=y;Password=abc",
    });
    expect((out as { connectionString: string }).connectionString).toContain("***REDACTED***");
    expect((out as { connectionString: string }).connectionString).not.toContain("abc");
  });
});

describe("redactOdbcConnectionString", () => {
  it("redacts Password in ODBC strings", () => {
    expect(redactOdbcConnectionString("Driver={ODBC Driver 18 for SQL Server};Server=x;Password=TopSecret123;")).toBe(
      "Driver={ODBC Driver 18 for SQL Server};Server=x;Password=***REDACTED***;",
    );
  });

  it("redacts Pwd", () => {
    expect(redactOdbcConnectionString("Driver={x};Pwd=secret;")).toBe("Driver={x};Pwd=***REDACTED***;");
  });

  it("leaves non-sensitive keys alone", () => {
    expect(redactOdbcConnectionString("Driver={x};Server=localhost;Database=app;")).toBe(
      "Driver={x};Server=localhost;Database=app;",
    );
  });

  it("is case-insensitive on the key", () => {
    expect(redactOdbcConnectionString("Driver={x};password=low;")).toBe("Driver={x};password=***REDACTED***;");
  });
});

describe("collectSecretStrings", () => {
  it("collects ODBC connection string values", () => {
    const obj = { connectionString: ODBC_DEV };
    const found = collectSecretStrings(obj);
    expect(found).toContain(ODBC_DEV);
  });
});
