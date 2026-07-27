# mssql-axi

Agent-ergonomic CLI for **Microsoft SQL Server** and **Azure SQL** — read-by-default,
token-efficient [TOON](https://toonformat.dev/) output. An [AXI](https://axi.md/) (Agent
eXperience Interface) backed by the native Microsoft ODBC driver.

> Inspired by [`sqlite-axi`](https://github.com/SSBrouhard/sqlite-axi) and
> [`pg-axi`](https://github.com/thatdudealso/pg-axi). Read-by-default, mutating operations
> are dry-run, secrets never touch disk.

## Why

MCP servers overload the agent's schema window (~185K input tokens/task). Raw `sqlcmd`
works but is free-form and offers no read-only enforcement. `mssql-axi` is a small,
predictable CLI with **TOON output, read-only by construction, combined operations**, and
**contextual `help[]` after every command** — designed for agents, validated by the AXI
principles.

## Driver

`mssql-axi` is built on the [`odbc`](https://www.npmjs.com/package/odbc) Node package,
which wraps the native Microsoft ODBC Driver 17/18 on Windows (and `unixodbc` on
Linux/macOS). The `mssql` Node package was dropped because it cannot speak Shared Memory
to a local SQL Server, cannot use the current Windows identity, and the ODBC driver
covers every scenario it does.

What you get with ODBC:
- **Local SQL Server** via Shared Memory + Windows Auth (`Trusted_Connection=Yes`)
- **Azure SQL** via `Authentication=ActiveDirectoryInteractive|Integrated|Default|
  ServicePrincipal|Password|ManagedIdentity|DeviceCodeFlow`
- **Named instances** (e.g. `Server=HOSTNAME\INSTANCENAME`) without manual port lookup
- **Connection strings pass through verbatim** — paste the same string you use in
  `sqlcmd`, SSMS, or .NET; no translation, no flag dance.

## Install

```bash
# Install path: npx from the GitHub repo (the `prepare` script builds dist/ on first install)
npx github:jeffreyhaen/mssql-axi <command>

# Or, for a single command without keeping the install:
npx -y github:jeffreyhaen/mssql-axi doctor --connection-string '...'

# From a local clone:
git clone https://github.com/jeffreyhaen/mssql-axi.git
cd mssql-axi
pnpm install   # runs `prepare` → `tsc -p tsconfig.json`
node dist/bin/mssql-axi.js <command>
```

## Quick start (5 minutes)

1. **Pick a connection string** — local SQL Server with Windows Auth:

   ```text
   Driver={ODBC Driver 17 for SQL Server};Server=localhost\SQLEXPRESS;Database=app;Trusted_Connection=Yes;Trust Server Certificate=Yes;
   ```

   Or Azure SQL with interactive AAD sign-in (opens browser once):

   ```text
   Driver={ODBC Driver 18 for SQL Server};Server=tcp:myapp.database.windows.net,1433;Initial Catalog=app;Authentication=ActiveDirectoryInteractive;Encrypt=Yes;
   ```

   See [`docs/connection-strings.md`](docs/connection-strings.md) for the keyword
   differences between ODBC 17 vs 18, and between .NET `Authentication=Active Directory
   Default` (a chain) and the explicit ODBC `Authentication=ActiveDirectory...` values.

2. **Verify connectivity**:

   ```bash
   mssql-axi doctor --connection-string 'Driver={ODBC Driver 17 for SQL Server};Server=HOSTNAME\INSTANCENAME;Database=YOUR_DB;Trusted_Connection=Yes;Trust Server Certificate=Yes;'
   ```

3. **Inspect and query** (flags must come **after** the subcommand):

   ```bash
   mssql-axi list --kind tables --connection-string '...'
   mssql-axi inspect --kind table --schema dbo --name Users --connection-string '...'
   mssql-axi sample --schema dbo --name Users --limit 5 --connection-string '...'
   mssql-axi query --sql "SELECT TOP 10 id, email FROM dbo.Users" --connection-string '...'
   ```

4. **(Optional) Install SessionStart hooks** so the agent starts each session with the
   active connection's home view:

   ```bash
   mssql-axi setup hooks
   ```

5. **(Optional) Save the string in a config file** so you don't have to repeat it:

   ```bash
   mssql-axi setup config > mssql-axi.config.json
   # edit the file, replacing the example server/database/auth values
   mssql-axi --connection dev list --kind tables
   ```

## Usage

```text
mssql-axi                       # home view: server, DB, top tables
mssql-axi doctor                # connectivity + read-only role check
mssql-axi list --kind <kind>    # tables | views | indexes | schemas
mssql-axi inspect --kind <kind> --schema <s> --name <n>
mssql-axi sample  --schema <s> --name <n> [--where "..."] [--limit N]
mssql-axi query  --sql "..."    [--limit N] [--full]
mssql-axi plan   --sql "..."    # show the T-SQL without executing
mssql-axi execute --sql "..."   # mutating; requires --confirm <sql> and --execute
mssql-axi explain --sql "..."   # SET SHOWPLAN_XML ON
mssql-axi setup role            # prints T-SQL to create agent_reader
mssql-axi setup hooks           # installs SessionStart hooks
mssql-axi setup config          # writes example mssql-axi.config.json
mssql-axi update                # self-update
mssql-axi update --check        # check for newer version
```

### Connection resolution

In order of precedence (first non-empty wins):

1. **`--connection-string "<ODBC string>"`** flag — the value is passed to ODBC verbatim.
2. **`MSSQL_CONNECTION_STRING`** environment variable — same shape.
3. **`mssql-axi.config.json`** in the working directory or `--config <path>`. Each
   `connections.<name>` entry is a full ODBC connection string. `--connection <name>`
   picks a non-default entry.

Config file shape:

```json
{
  "default": "dev",
  "connections": {
    "dev":   "Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=app;Trusted_Connection=Yes;",
    "azure": "Driver={ODBC Driver 18 for SQL Server};Server=tcp:myapp.database.windows.net,1433;Initial Catalog=app;Authentication=ActiveDirectoryInteractive;Encrypt=Yes;"
  }
}
```

Secrets live in the connection string itself, in env vars interpolated by your shell
(e.g. `"...Password=${MSSQL_AGENT_PWD};..."`), or in a secret manager that writes
`MSSQL_CONNECTION_STRING` to the environment before launching `mssql-axi`. The redactor
scrubs `Password=...`, `Pwd=...`, `UID=...` from any error message that bubbles up.

## Read-only guarantee (two layers)

1. **Database-side** — a dedicated `agent_reader` role with `db_datareader` and
   `db_denydatawriter`. Set up once with `mssql-axi setup role`.
2. **Application-side** — a SQL validator on every `query` call. Only `SELECT` (with
   optional `WITH cte AS (...) SELECT ...`), `EXPLAIN`, and `SET SHOWPLAN_XML ON` are
   accepted. `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `DROP`, `TRUNCATE`, `EXEC`, stacked
   statements, and `;GO` are refused with a structured error.

Mutating operations go through `execute`, which is **dry-run by default** and requires
both `--confirm <exact sql>` and `--execute`.

## Development

```bash
pnpm install
pnpm run build
pnpm run dev -- list --kind tables --connection-string '...'
pnpm test
```

CI runs on Node 20 and 22 via GitHub Actions (`.github/workflows/ci.yml`).

## License

MIT © Jeffrey Haen
