import { afterEach } from "vitest";
import type { Database } from "../src/lib/driver/index.js";
import { resetDatabaseOpener, setDatabaseOpener } from "../src/lib/connect.js";

/** A syntactically valid ODBC string so `resolveConnection` accepts it. */
export const TEST_CONNECTION_STRING =
  "Driver={ODBC Driver 18 for SQL Server};Server=tcp:test,1433;Database=app;Trusted_Connection=Yes;";

export const CONNECTION_ARGS = ["--connection-string", TEST_CONNECTION_STRING];

export type QueryRule = [RegExp, unknown[] | (() => unknown[])];

export interface FakeDbOptions {
  /** First matching rule wins; unmatched queries return an empty result set. */
  rules?: QueryRule[];
  /** Result for `db.execute(...)`. */
  rowsAffected?: number[];
  /** Throw for any query matching this pattern (simulates a server error). */
  failOn?: RegExp;
  failWith?: Error;
  /** Reject the connection itself. */
  openError?: Error;
}

export interface FakeDb {
  /** Every SQL string the command sent, in order. */
  queries: string[];
  executed: string[];
  /** How many times a connection was opened. */
  opened: number;
  closed: number;
}

/**
 * Installs a fake `Database` so the command layer can be tested without a live
 * SQL Server. Automatically restored after each test.
 */
export function useFakeDb(options: FakeDbOptions = {}): FakeDb {
  const state: FakeDb = { queries: [], executed: [], opened: 0, closed: 0 };
  const rules = options.rules ?? [];

  setDatabaseOpener(async () => {
    state.opened += 1;
    if (options.openError) throw options.openError;
    const db: Database = {
      driver: "odbc",
      async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
        state.queries.push(sql);
        if (options.failOn?.test(sql)) {
          throw options.failWith ?? new Error("simulated server failure");
        }
        for (const [pattern, rows] of rules) {
          if (pattern.test(sql)) {
            return (typeof rows === "function" ? rows() : rows) as T[];
          }
        }
        return [] as T[];
      },
      async execute(sql: string) {
        state.executed.push(sql);
        if (options.failOn?.test(sql)) {
          throw options.failWith ?? new Error("simulated server failure");
        }
        return { rowsAffected: options.rowsAffected ?? [1] };
      },
      async close() {
        state.closed += 1;
      },
    };
    return db;
  });

  return state;
}

afterEach(() => {
  resetDatabaseOpener();
});
