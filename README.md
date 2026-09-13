# mssql-axi (SQL Server axi)

[![ci](https://github.com/jeffreyhaen/mssql-axi/actions/workflows/ci.yml/badge.svg)](https://github.com/jeffreyhaen/mssql-axi/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40jeffreyhaen%2Fmssql-axi.svg)](https://www.npmjs.com/package/@jeffreyhaen/mssql-axi)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

<p align="center">
  <img src="assets/readme-header.png" alt="mssql-axi header">
</p>


Agent-ergonomic CLI for **Microsoft SQL Server** and **Azure SQL** — schema discovery,
row previews, read-only queries, showplans, and gated mutations, in token-efficient
[TOON](https://toonformat.dev/) output.

`mssql-axi` is a SQL Server [AXI](https://github.com/kunchenguid/axi) (Agent eXperience
Interface): a CLI designed for autonomous agents rather than humans. It talks to the
server through the native Microsoft ODBC driver, passes connection strings through
verbatim, is read-by-default, and answers with minimal schemas plus contextual next-step
hints.

## Why AXI: CLI vs MCP vs AXI

Across extensive [AXI benchmark studies](https://axi.md/) (over 900 runs), agent-first CLIs achieve **100% task success** at **~50% fewer turns** and **50–66% lower cost** than MCP:

| Interface | Context (Turn 0) | Output | Measured Payload | Write Safety | Guidance |
|---|---|---|---|---|---|
| **`mssql-axi`** | **~55 tokens** (on-demand) | **TOON** | **-34.8% vs ASCII, -53.3% vs JSON** (weighted avg) | ✅ **Read-only by default**; double-gated dry-run | Structured hints (`help[]`) |
| **Raw CLI** (`sqlcmd`) | ~0 tokens | Wide ASCII | Baseline (whitespace padding & uncapped dumps) | ❌ Direct execution, no read-only guarantee | Human error text / generic codes |
| **Database MCP** | ~5k–10k tokens (15–30 schemas) | JSON-RPC | Highest cost (~185k input tokens/task across turns) | Varies | Schema validation errors |

## Install

Install globally (recommended for repeated use):

```sh
npm install -g @jeffreyhaen/mssql-axi
mssql-axi --help
```

For a one-off invocation without installing:

```sh
npx -y @jeffreyhaen/mssql-axi --help
```

**Prerequisite:** the Microsoft ODBC Driver 17 or 18 for SQL Server on the host
(Windows: the MSI from Microsoft; Linux/macOS: `unixodbc` + the Microsoft driver).

## Agent integration

Install the skill so an agent loads the usage guide on demand:

```sh
npx skills add jeffreyhaen/mssql-axi --skill mssql-axi -g
```

Omit `-g` to install the skill for the current project only. To have the agent start
each session with the active connection's home view:

```sh
mssql-axi setup hooks
```

## Configure

A connection is resolved in this order (first non-empty wins):

1. `--connection-string "<ODBC string>"` — passed to ODBC verbatim
2. `MSSQL_CONNECTION_STRING` — same shape
3. `mssql-axi.config.json` in the working directory (or `--config <path>`), with
   `--connection <name>` to pick a non-default entry

```sh
mssql-axi setup config > mssql-axi.config.json   # writes an example to edit
mssql-axi doctor --connection dev
```

```json
{
  "default": "dev",
  "connections": {
    "dev": "Driver={ODBC Driver 17 for SQL Server};Server=localhost\\SQLEXPRESS;Database=app;Trusted_Connection=Yes;TrustServerCertificate=Yes;",
    "azure": "Driver={ODBC Driver 18 for SQL Server};Server=tcp:myapp.database.windows.net,1433;Database=app;Authentication=ActiveDirectoryInteractive;Encrypt=Yes;"
  }
}
```

- **Local SQL Server** works over Shared Memory with Windows Auth
  (`Trusted_Connection=Yes`), including named instances (`Server=HOST\INSTANCE`).
- **Azure SQL** works with `Authentication=ActiveDirectoryInteractive|Integrated|
  Default|ServicePrincipal|Password|ManagedIdentity|DeviceCodeFlow`.
- Secrets live in the connection string, in a shell-interpolated env var
  (`"...Password=${MSSQL_AGENT_PWD};..."`), or in a secret manager that exports
  `MSSQL_CONNECTION_STRING`. `Password=`, `Pwd=`, and `UID=` are redacted from every
  error message.
- See [`docs/connection-strings.md`](docs/connection-strings.md) for the ODBC 17 vs 18
  keyword differences and one line per supported auth flow.

The `mssql` Node package was dropped in favour of [`odbc`](https://www.npmjs.com/package/odbc):
it cannot speak Shared Memory to a local SQL Server, cannot use the current Windows
identity, and ODBC covers every scenario it does.

## Use

```sh
mssql-axi                                    # home: server, database, largest tables
mssql-axi doctor                             # connectivity + read-only role check
mssql-axi list tables                        # tables | views | indexes | schemas
mssql-axi list views --schema sales --limit 50
mssql-axi inspect dbo.Users                  # columns, primary key, foreign keys
mssql-axi inspect view dbo.vActiveUsers
mssql-axi sample dbo.Users --limit 5
mssql-axi sample dbo.Users --where "createdAt > '2026-01-01'" --full
mssql-axi query "SELECT TOP 10 id, email FROM dbo.Users"
mssql-axi explain "SELECT * FROM dbo.Users WHERE email = 'a@b.c'"
mssql-axi plan "ALTER TABLE dbo.Users ADD nickname NVARCHAR(50) NULL"
mssql-axi execute "UPDATE dbo.Users SET active = 0 WHERE id = 42" \
  --confirm "UPDATE dbo.Users SET active = 0 WHERE id = 42" --execute
mssql-axi setup role                         # T-SQL to create the agent_reader role
mssql-axi update --check                     # check for a newer version
```

Every command supports `--help`. SQL and object names may be passed positionally
(`query "SELECT 1"`, `inspect dbo.Users`) or through flags (`--sql`, `--schema`/`--name`);
`[bracketed].[names]` are accepted and the schema defaults to `dbo`. Lists support
`--limit`; row output truncates long cells at 200 characters unless `--full` is given.

### Read-only guarantee (two layers)

1. **Database-side** — a dedicated `agent_reader` role with `db_datareader` and
   `db_denydatawriter`. Set up once with `mssql-axi setup role`; `mssql-axi doctor`
   reports whether the current login is a member.
2. **Application-side** — a validator on every read command. Only `SELECT` (optionally
   with a leading `WITH cte AS (...)`), `EXPLAIN`, and `SET SHOWPLAN_XML ON` are
   accepted. `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `DROP`, `TRUNCATE`, `EXEC`, stacked
   statements, and `;GO` are refused with a structured error before any connection is
   opened.

### Safe mutations

`execute` is **dry-run by default** and prints the normalised T-SQL. Committing requires
`--confirm "<the same statement>"` (compared after comments are stripped and whitespace
is normalised) **and** `--execute`. Destructive shapes — `DROP`, `TRUNCATE`, and
`DELETE`/`UPDATE` without a `WHERE` — additionally require `--allow-destructive`.
`--max-rows-affected` (default 10,000) refuses to report success for a runaway
statement, and `--timeout` (default 30s) bounds the run.

## Design

Built against the ten AXI principles: TOON output, minimal default schemas, truncation
with `--full`, pre-computed aggregates (row counts, totals), definitive empty states,
structured errors on stdout with exit code 2 for usage errors, a content-first
no-argument home view, contextual next-step hints, and concise per-command help.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run build
pnpm test
pnpm run dev -- list tables --connection-string '...'
```

Tests run the command layer against an injected fake ODBC driver (`test/fakeDb.ts`), so
no live SQL Server is needed. CI runs build, typecheck, tests, and a CLI smoke test on
Node 20 and 22 (Linux) and Node 20 (Windows).

- [AXI — agent eXperience interface](https://axi.md/) · [kunchenguid/axi](https://github.com/kunchenguid/axi)
- [TOON — token-optimized object notation](https://toonformat.dev/) · [toonformat/toon](https://github.com/toonformat/toon)

## License

MIT © Jeffrey Haen

See [CHANGELOG.md](CHANGELOG.md) for release notes.
