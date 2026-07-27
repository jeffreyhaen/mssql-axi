---
name: mssql-axi
description: Use mssql-axi to inspect, query, and safely execute against Microsoft SQL Server and Azure SQL databases through token-efficient TOON output. Use when the task involves SQL Server, Azure SQL, T-SQL, schema discovery, table inspection, sample rows, query planning, EXPLAIN, or read-only database analysis.
---

# mssql-axi

Agent-ergonomic CLI for Microsoft SQL Server and Azure SQL. Built on the native Microsoft
ODBC Driver 17/18 via the [`odbc`](https://www.npmjs.com/package/odbc) Node package.
Connection strings are passed through verbatim — paste the same string you use in
`sqlcmd`, SSMS, or .NET, no translation.

## Critical safety contract

1. **Reads are free.** `home`, `doctor`, `list`, `inspect`, `sample`, `query`, `plan`,
   `explain` are read-only and safe to call with no extra flags. An app-side SQL
   validator refuses `INSERT`/`UPDATE`/`DELETE`/`MERGE`/`DROP`/`TRUNCATE`/`EXEC`,
   stacked statements, and `;GO` from any read command.
2. **Mutations are double-gated.** `execute` is **dry-run by default**. To actually
   run, pass **both** `--confirm "<exact sql>"` **and** `--execute`. The `--confirm`
   value must match `--sql` byte-for-byte.
3. **Destructive patterns need a third flag.** `DROP` / `TRUNCATE` / `DELETE` without
   `WHERE` / `UPDATE` without `WHERE` also require `--allow-destructive`.
4. **Recommend a read-only role for routine work.** The connection should use a
   `db_datareader` + `db_denydatawriter` user. Run `npx -y mssql-axi setup role` to
   print the T-SQL the DBA runs once.
5. **No agent should ever write without explicit user instruction.** A user asking
   "what's in the Users table" never implies a write. A user asking "fix the slow
   query" implies a query change, not a schema change. When in doubt, ask.

## Install + connection

```bash
# One-off invocation (no install needed)
npx -y github:jeffreyhaen/mssql-axi --version

# Verify connectivity and role
npx -y mssql-axi doctor --connection-string 'Driver={ODBC Driver 17 for SQL Server};Server=HOSTNAME\INSTANCENAME;Database=YOUR_DB;Trusted_Connection=Yes;Trust Server Certificate=Yes;'
```

Connection resolution (first non-empty wins):

1. `--connection-string "<ODBC string>"` — must contain `Driver={...}`
2. `MSSQL_CONNECTION_STRING` env var
3. Named entry in `mssql-axi.config.json` (selected via `--connection <name>` or the
   file's `default` field; `--config <path>` to point elsewhere)
4. `npx -y mssql-axi setup config` writes an example config

**Important constraint for the `home` view (no-args invocation):** the SDK
strips leading flags, so `mssql-axi --connection-string '...'` is rejected
before the home handler runs. For the no-args home view you must use option
2 (env var) or option 3 (config file with a `default` in the cwd). For every
other command (`doctor`, `list`, `inspect`, `sample`, `query`, etc.) the
flag form works fine.

ODBC 18 is strict: only `Encrypt=Yes|No|Strict` (not `True`/`False`). ODBC 17 accepts
both. See [`docs/connection-strings.md`](docs/connection-strings.md) for the full
cheat sheet including Azure AD modes.

## Read commands

| Command | Purpose | Example |
| --- | --- | --- |
| `home` (no args) | server, DB, version, top tables by row count | `npx -y mssql-axi` |
| `doctor` | connectivity + read-only role check | `npx -y mssql-axi doctor` |
| `list` | tables, views, indexes, or schemas | `npx -y mssql-axi list --kind tables` |
| `inspect` | columns, keys, definition of one object | `npx -y mssql-axi inspect --kind table --schema dbo --name Users` |
| `sample` | preview rows (per-cell 200-char truncation, override with `--full`) | `npx -y mssql-axi sample --schema dbo --name Users --limit 5` |
| `query` | capped read (validator refuses writes) | `npx -y mssql-axi query --sql "SELECT TOP 10 id, email FROM dbo.Users"` |
| `plan` | show T-SQL without executing | `npx -y mssql-axi plan --sql "INSERT ..."` |
| `explain` | `SET SHOWPLAN_XML ON` | `npx -y mssql-axi explain --sql "SELECT ..."` |

## Mutating command

```bash
# Dry run (default — no rows change)
npx -y mssql-axi execute --sql "UPDATE dbo.Users SET active = 0 WHERE id = 42"

# Actually run — both flags required, --confirm must match --sql byte-for-byte
npx -y mssql-axi execute \
  --sql "UPDATE dbo.Users SET active = 0 WHERE id = 42" \
  --confirm "UPDATE dbo.Users SET active = 0 WHERE id = 42" \
  --execute

# Destructive patterns (DROP / TRUNCATE / DELETE-no-WHERE / UPDATE-no-WHERE) also need:
#   --allow-destructive
```

`rowsAffected` is always `[0]` because the ODBC driver's `query` does not surface
a row count. Verify with `query` after the mutation:

```bash
npx -y mssql-axi query --sql "SELECT @@ROWCOUNT AS affected"
npx -y mssql-axi query --sql "SELECT * FROM dbo.Users WHERE id = 42"
```

## Common workflows

**Discover → inspect → query** (the standard read sequence)

```bash
npx -y mssql-axi list --kind tables                                  # what's there?
npx -y mssql-axi inspect --kind table --schema dbo --name Users      # columns, keys, indexes
npx -y mssql-axi sample --schema dbo --name Users --limit 5          # what do rows look like?
npx -y mssql-axi query --sql "SELECT TOP 10 ..."                     # run the analysis
```

**Investigate a slow query**

```bash
npx -y mssql-axi explain --sql "SELECT ..."                          # see the showplan + estimated cost
npx -y mssql-axi inspect --kind indexes --schema dbo --name Users    # which indexes exist?
npx -y mssql-axi query --sql "SET STATISTICS IO ON; SELECT ..."      # logical reads per statement
```

**Plan and apply a schema change**

```bash
# 1. Preview the T-SQL
npx -y mssql-axi plan --sql "ALTER TABLE dbo.Users ADD email_confirmed_at DATETIME2 NULL"

# 2. Dry-run the execute (default)
npx -y mssql-axi execute --sql "ALTER TABLE dbo.Users ADD email_confirmed_at DATETIME2 NULL"

# 3. Apply it (gated)
npx -y mssql-axi execute \
  --sql "ALTER TABLE dbo.Users ADD email_confirmed_at DATETIME2 NULL" \
  --confirm "ALTER TABLE dbo.Users ADD email_confirmed_at DATETIME2 NULL" \
  --execute
```

## Output format

stdout is [TOON](https://toonformat.dev/) — ~40% smaller than equivalent JSON while
remaining parseable. Per-cell truncation defaults to 200 chars (use `--full` to
bypass). Errors are structured `{ error, code, help[] }` on stdout, never on stderr.

## Known limitations

- Requires the Microsoft ODBC Driver 17 or 18 on the host. Windows: install from
  Microsoft. Linux/macOS: `unixodbc` + the Microsoft driver.
- `execute` always reports `rowsAffected: [0]`. Verify with `query` after.
- `npx` from `github:jeffreyhaen/mssql-axi` runs the `prepare` script on first
  install (downloads deps, runs `tsc`); allow a few extra seconds the first time.
- `SELECT *` against tables with `varbinary`, `varbinary(max)`, or
  `uniqueidentifier` columns fails with `[odbc] Error retrieving the result
  set from the statement`. This is a known limitation of the
  [`odbc`](https://www.npmjs.com/package/odbc) Node package — explicit
  column lists work fine, and `query` succeeds once the offending columns
  are listed explicitly. `sample` builds a `SELECT TOP n *` internally, so
  on tables with these column types use `query` with an explicit column
  list (or `query --sql "SELECT TOP 5 <cols-without-varbinary-or-uid> FROM dbo.X"`)
  until the dynamic-column-list fix lands.

## Reference

- [README](README.md) — install, auth model, dev workflow
- [docs/connection-strings.md](docs/connection-strings.md) — ODBC 17 vs 18 keyword
  cheat sheet, Azure AD modes, and a one-liner per supported auth flow
- [kunchenguid/axi](https://github.com/kunchenguid/axi) — the 10 AXI design
  principles this CLI follows
