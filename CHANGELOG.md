# Changelog

All notable changes to mssql-axi are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

### Changed

- CI: added `concurrency` with `cancel-in-progress`, a job timeout, a typecheck step, and
  bumped `actions/checkout` / `actions/setup-node` to v5.
- Dependencies: `@toon-format/toon` 2 → 4, `vitest` 2 → 4, TypeScript 5.9, `tsx` 4.20.
  The Node engine requirement stays at `>=20`.
- README rewritten (why-not-MCP framing, agent/skill integration, configuration and
  safety sections).
- `SKILL.md` and per-command help now document the positional shorthand.

### Fixed

- `mssql-axi inspect table Users` used the kind positional as the object name, so it
  looked up a table literally called `table`.

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

[0.1.0]: https://github.com/jeffreyhaen/mssql-axi/releases/tag/v0.1.0
