---
name: mssql-axi
description: Use mssql-axi to inspect, query, and safely execute against Microsoft SQL Server and Azure SQL databases through token-efficient TOON output. Use when the task involves SQL Server, Azure SQL, T-SQL, schema discovery, table inspection, sample rows, query planning, EXPLAIN, or read-only database analysis.
---

# mssql-axi

Agent-ergonomic CLI for Microsoft SQL Server and Azure SQL. Built on the native Microsoft
ODBC Driver 17/18 via the [`odbc`](https://www.npmjs.com/package/odbc) Node package.
Connection strings must be **ODBC-style** (`Driver={...}`) — see
[`docs/connection-strings.md`](docs/connection-strings.md) for the cheat sheet; .NET
`SqlConnection` strings are not accepted verbatim.

## Critical safety contract

1. **Reads are free.** `home`, `doctor`, `list`, `inspect`, `sample`, `query`, `plan`,
   `explain` are read-only and safe to call with no extra flags. An app-side SQL
   validator refuses `INSERT`/`UPDATE`/`DELETE`/`MERGE`/`DROP`/`TRUNCATE`/`EXEC`,
   stacked statements, and `;GO` from any read command.
2. **Mutations are double-gated.** `execute` is **dry-run by default**. To actually
   run, pass **both** `--confirm "<exact sql>"` **and** `--execute`. The `--confirm`
   value must match the statement after comments are stripped and whitespace is
   normalised.
3. **Destructive patterns need a third flag.** `DROP` / `TRUNCATE` / `DELETE` without
   `WHERE` / `UPDATE` without `WHERE` also require `--allow-destructive`.
4. **Recommend a read-only role for routine work.** The connection should use a
   `db_datareader` + `db_denydatawriter` user. Run `mssql-axi setup role` to print the T-SQL
   the DBA runs once.
5. **No agent should ever write without explicit user instruction.** A user asking
   "what's in the Users table" never implies a write. A user asking "fix the slow
   query" implies a query change, not a schema change. When in doubt, ask.

## Install + connection

```bash
# One-off invocation (no install needed)
npx -y @jeffreyhaen/mssql-axi --version

# Recommended for repeated use
npm install -g @jeffreyhaen/mssql-axi

# Verify connectivity and role
mssql-axi doctor --connection-string 'Driver={ODBC Driver 17 for SQL Server};Server=HOSTNAME\INSTANCENAME;Database=YOUR_DB;Trusted_Connection=Yes;TrustServerCertificate=Yes;'
```

Connection resolution (first non-empty wins):

1. `--connection-string "<ODBC string>"` — must contain `Driver={...}`
2. `MSSQL_CONNECTION_STRING` env var
3. Named entry in `mssql-axi.config.json` (selected via `--connection <name>` or the
   file's `default` field; `--config <path>` to point elsewhere)
4. `mssql-axi setup config` writes an example config

**Important constraint for the `home` view (no-args invocation):** the SDK
strips leading flags, so `mssql-axi --connection-string '...'` is rejected
before the home handler runs. Use `mssql-axi home --connection-string '...'`
(the explicit `home` command), or option 2 (env var) / 3 (config file with a
`default` in the cwd). For every other command (`doctor`, `list`, `inspect`,
`sample`, `query`, etc.) the flag form works fine.

Connection-string gotchas (Driver 18 encryption defaults, `TrustServerCertificate`
spelling, rejected .NET keywords, named instances): see
[`docs/connection-strings.md`](docs/connection-strings.md). mssql-axi rejects known-bad
strings up front and appends the driver's own diagnostic to connection errors.

## Read commands

| Command | Purpose | Example |
| --- | --- | --- |
| `home` (no args) | server, DB, version, top tables by row count | `mssql-axi` |
| `doctor` | connectivity + read-only role check | `mssql-axi doctor` |
| `list` | tables, views, indexes, or schemas | `mssql-axi list tables` |
| `inspect` | columns, keys, definition of one object | `mssql-axi inspect dbo.Users` |
| `sample` | preview rows (per-cell 200-char truncation, override with `--full`) | `mssql-axi sample dbo.Users --limit 5` |
| `query` | capped read (validator refuses writes) | `mssql-axi query "SELECT TOP 10 id, email FROM dbo.Users"` |
| `plan` | show T-SQL without executing | `mssql-axi plan "INSERT ..."` |
| `explain` | `SET SHOWPLAN_XML ON` | `mssql-axi explain "SELECT ..."` |

### Positional shorthand

SQL and object names may be passed positionally — shorter and cheaper than the flag form:

| Long form | Shorthand |
| --- | --- |
| `list --kind tables` | `list tables` |
| `inspect --kind table --schema dbo --name Users` | `inspect dbo.Users` |
| `inspect --kind view --schema dbo --name vUsers` | `inspect view dbo.vUsers` |
| `sample --schema dbo --name Users` | `sample dbo.Users` |
| `query --sql "SELECT 1"` | `query "SELECT 1"` |

`[bracketed].[names]` are accepted; an explicit `--schema` overrides the qualifier. The
schema defaults to `dbo`.

## Mutating command

```bash
# Dry run (default — no rows change)
mssql-axi execute "UPDATE dbo.Users SET active = 0 WHERE id = 42"

# Actually run — both flags required, --confirm must match the SQL after
# comments are stripped and whitespace is normalised
mssql-axi execute "UPDATE dbo.Users SET active = 0 WHERE id = 42" \
  --confirm "UPDATE dbo.Users SET active = 0 WHERE id = 42" \
  --execute

# Destructive patterns (DROP / TRUNCATE / DELETE-no-WHERE / UPDATE-no-WHERE) also need:
#   --allow-destructive
```

`rowsAffected` is always `[0]` because the ODBC driver's `query` does not surface
a row count. Verify with `query` after the mutation:

```bash
mssql-axi query "SELECT @@ROWCOUNT AS affected"
mssql-axi query "SELECT * FROM dbo.Users WHERE id = 42"
```

## Common workflows

**Discover → inspect → query** (the standard read sequence)

```bash
mssql-axi list tables                     # what's there?
mssql-axi inspect dbo.Users               # columns, keys, indexes
mssql-axi sample dbo.Users --limit 5      # what do rows look like?
mssql-axi query "SELECT TOP 10 ..."       # run the analysis
```

**Investigate a slow query**

```bash
mssql-axi explain "SELECT ..."                # see the showplan + estimated cost
mssql-axi list indexes --schema dbo           # which indexes exist?
mssql-axi query "SET STATISTICS IO ON; SELECT ..."  # logical reads per statement
```

**Plan and apply a schema change**

```bash
# 1. Preview the T-SQL
mssql-axi plan "ALTER TABLE dbo.Users ADD email_confirmed_at DATETIME2 NULL"

# 2. Dry-run the execute (default)
mssql-axi execute "ALTER TABLE dbo.Users ADD email_confirmed_at DATETIME2 NULL"

# 3. Apply it (gated)
mssql-axi execute "ALTER TABLE dbo.Users ADD email_confirmed_at DATETIME2 NULL" \
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
- The first `npx` invocation may take a few seconds while npm downloads the package and its dependencies.
- `SELECT *` against tables with `varbinary`, `varbinary(max)`,
  `nvarchar(max)`, `varchar(max)`, or `uniqueidentifier` columns fails with
  `[odbc] Error retrieving the result set from the statement`. This is a
  known limitation of the [`odbc`](https://www.npmjs.com/package/odbc) Node
  package — explicit column lists work fine, and `query` succeeds once the
  offending columns are listed explicitly. `sample` automatically
  rewrites the internal `SELECT *` to an explicit column list with the
  problematic types CAST to a fixed bound (`uniqueidentifier` →
  `VARCHAR(36)`, `varbinary(max)` → `VARBINARY(256)`, `nvarchar(max)` →
  `NVARCHAR(4000)`, `varchar(max)` → `VARCHAR(8000)`), so it works
  transparently on these tables. `query` does not rewrite user SQL, so
  when using `query` against a `SELECT *` that hits this issue, list the
  problematic columns explicitly with a CAST.

## Reference

- [README](README.md) — install, auth model, dev workflow
- [docs/connection-strings.md](docs/connection-strings.md) — canonical ODBC cheat
  sheet: keyword differences 17 vs 18, Azure AD modes, troubleshooting (encryption
  defaults, named instances, .NET-keyword rejection)
- [kunchenguid/axi](https://github.com/kunchenguid/axi) — the 10 AXI design
  principles this CLI follows
