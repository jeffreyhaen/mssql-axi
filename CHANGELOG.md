# Changelog

All notable changes to mssql-axi are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Publish the CLI as `@jeffreyhaen/mssql-axi` with a GitHub Actions npm release workflow

## [0.2.0] - 2026-08-23

### Added

- Positional arguments: `query "SELECT ..."`, `explain "SELECT ..."`, `plan "..."`, and
  `execute "..."` now accept the statement without `--sql`; `inspect [kind] <dbo.Table>`
  and `sample <dbo.Table>` accept a qualified object name (including `[bracketed].[names]`).
  An explicit `--schema` still overrides the qualifier, and the flag forms keep working.
- Command-layer tests against an injected fake ODBC driver (`test/fakeDb.ts`), covering
  `home`, `list`, `inspect`, `sample`, `query`, `explain`, `plan`, `execute`, and `doctor`
  without a live SQL Server.
- `pnpm run typecheck` script, run in CI.
- Explicit `vitest.config.ts`.
- `inspect view` truncates the definition at 2000 chars by default (`definitionTruncated`
  + `definitionChars` in the output); `--full` returns the complete definition.
- `mssql-axi home` is also registered as an explicit command, so the home view can be
  combined with connection flags (`mssql-axi home --connection-string ...`).
- Errors wrapping an `odbc` failure now append the first ODBC diagnostic (SQLSTATE,
  native message) instead of only the generic `[odbc] Error ...` line.
- Connection strings containing .NET `SqlConnection` keywords (`Data Source`,
  `Initial Catalog`, `Integrated Security`, `MultipleActiveResultSets`, and for
  Driver 18 the spaced `Trust Server Certificate`) are rejected up front with the ODBC
  equivalent in the error. Previously `Initial Catalog` was silently ignored by the
  driver and the session landed in `master` instead of the requested database.
- `doctor` connectivity help now covers the Driver 18 `Encrypt=Mandatory` /
  `TrustServerCertificate` (no spaces) gotcha for local and named instances.
- `docs/connection-strings.md`: troubleshooting section for Driver 18 encryption
  defaults, the `TrustServerCertificate` spelling, and named-instance/dynamic-port
  resolution via SQL Browser.

### Changed

- CI: added `concurrency` with `cancel-in-progress`, a job timeout, a typecheck step, and
  bumped `actions/checkout` / `actions/setup-node` to v5.
- Dependencies: `@toon-format/toon` 2 → 4, `vitest` 2 → 4, TypeScript 5.9, `tsx` 4.20.
  The Node engine requirement stays at `>=20`.
- README rewritten (why-not-MCP framing, agent/skill integration, configuration and
  safety sections).
- `SKILL.md` and per-command help now document the positional shorthand.
- Command handlers are lazy-loaded in the CLI entrypoint, so `--version` and `--help`
  no longer load the ODBC driver or any command code.
- `setup role`/`hooks`/`config` each accept only the flags they actually use
  (`--output`, `--marker`); the unused shared `--name` flag is removed. `setup --help`
  (also shown for `setup hooks --help`, which the SDK intercepts) now lists every
  subcommand with its flags.
- Example connection strings use `TrustServerCertificate` (no spaces), the only spelling
  Driver 18 accepts.

### Fixed

- `mssql-axi inspect table Users` used the kind positional as the object name, so it
  looked up a table literally called `table`.
- **Read-only enforcement:** `SELECT ... INTO` (which writes a new table) and `WAITFOR`
  are now rejected by `validateReadOnly()`, and a `;` inside parentheses is treated as a
  stacked statement (T-SQL never allows a terminator inside an expression). Bracketed
  identifiers containing `;` remain valid.
- **`sample --where` is validated read-only before a connection opens**: the fragment is
  validated as part of the composed SELECT, so stacked statements, hidden terminators,
  `SELECT INTO` breakouts, and forbidden keywords fail fast with a structured
  `READ_ONLY` error (exit 2).
- **No more silently ignored input:** every command rejects extra positional arguments
  (`VALIDATION_ERROR`). `plan` no longer accepts connection flags it never used, and
  `list` no longer accepts the unused `--full` flag — both now fail with
  `UNKNOWN_FLAG`.
- `list views|indexes|schemas --limit N` now reports the real `totalCount` via a COUNT
  query instead of echoing the returned row count.
- `query --full` with a `SET SHOWPLAN_XML` sequence now actually returns the full XML in
  `fullXml`, matching its own help text (previously only `explain --full` did).

## [0.1.0] - 2025-07-27

Initial release.

### Added

- `mssql-axi` (no args) — home view: server, DB, version, top tables by row count
- `mssql-axi doctor` — connectivity + read-only role check
- `mssql-axi list --kind tables|views|indexes|schemas [--schema <s>]` — enumerate objects
- `mssql-axi inspect --kind table|view|index --schema <s> --name <n>` — column/keys/definition
- `mssql-axi sample --schema <s> --name <n> [--where "..."] [--limit N] [--full]` — preview rows
- `mssql-axi query --sql "..." [--limit N] [--full]` — capped read-only query
- `mssql-axi explain --sql "..." [--full]` — showplan (only physical ops + estimated cost by default)
- `mssql-axi plan --sql "INSERT ..." [--allow-destructive]` — preview without executing
- `mssql-axi execute --sql "..." --confirm "<sql>" [--execute] [--allow-destructive] [--timeout N] [--max-rows-affected N]` — mutating
- `mssql-axi setup role` — prints T-SQL to create the read-only `agent_reader` role
- `mssql-axi setup hooks` — installs SessionStart hooks (Claude Code, Codex, OpenCode)
- `mssql-axi setup config` — writes an example `mssql-axi.config.json`
- `mssql-axi update` — self-update via the `axi-sdk-js` built-in
- Connection resolution: `--connection-string` flag → `MSSQL_CONNECTION_STRING` env var → named entry in `mssql-axi.config.json` (selected via `--connection <name>` or the `default` field)
- Transport: native Microsoft ODBC Driver 17/18 via the [`odbc`](https://www.npmjs.com/package/odbc) Node package. Connection strings are passed through verbatim — no translation.
- Auth: SQL password, Windows Auth (`Trusted_Connection=Yes`), and all Azure AD flows supported by ODBC (`ActiveDirectoryIntegrated|Interactive|Default|ServicePrincipal|Password|ManagedIdentity|DeviceCodeFlow`)
- Two-layer read-only safety: app-side SQL validator + documented DB-side role grants
- Secret redaction in error messages (`Password=...`, `Pwd=...`, `UID=...`)
- Per-cell 200-char truncation (override with `--full`)
- TOON output via [`@toon-format/toon`](https://www.npmjs.com/package/@toon-format/toon)

### Known limitations

- `execute` always reports `rowsAffected: [0]` because the ODBC driver's `query` does not surface a row count. Use `query` to verify, or run `SELECT @@ROWCOUNT` after the mutation.
- No integration tests against a real SQL Server in CI; validation has been done manually against a local SQL Server instance and an Azure SQL database.

[0.2.0]: https://github.com/jeffreyhaen/mssql-axi/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jeffreyhaen/mssql-axi/releases/tag/v0.1.0
