# Connection string cheat sheet for mssql-axi

mssql-axi uses the [Microsoft ODBC Driver for SQL Server](https://learn.microsoft.com/en-us/sql/connect/odbc/microsoft-odbc-driver-for-sql-server)
on Windows (or `unixodbc` on Linux/macOS). The driver is installed by the npm
[`odbc`](https://www.npmjs.com/package/odbc) package automatically.

## Minimum required

Every connection string **must** contain `Driver={...}` so mssql-axi can route it to
ODBC. The values you set after that depend on the driver version and your auth flow.

| Use case | Driver | Connection string |
|----------|--------|-------------------|
| Local SQL Server, Windows user, integrated auth | 17 or 18 | `Driver={ODBC Driver 17 for SQL Server};Server=localhost\SQLEXPRESS;Database=app;Trusted_Connection=Yes;Trust Server Certificate=Yes;` |
| Local SQL Server, named instance on `HOSTNAME` | 17 or 18 | `Driver={ODBC Driver 17 for SQL Server};Server=HOSTNAME\INSTANCENAME;Database=app;Trusted_Connection=Yes;Trust Server Certificate=Yes;` |
| Azure SQL, federated AAD (on-prem AD ↔ AAD trust) | 17 or 18 | `Driver={ODBC Driver 17 for SQL Server};Server=tcp:host.database.windows.net,1433;Initial Catalog=app;Authentication=ActiveDirectoryIntegrated;Encrypt=True;TrustServerCertificate=True;` |
| Azure SQL, managed AAD, interactive sign-in | 18 | `Driver={ODBC Driver 18 for SQL Server};Server=tcp:host.database.windows.net,1433;Initial Catalog=app;Authentication=ActiveDirectoryInteractive;Encrypt=Yes;` |
| Azure SQL, managed AAD, cached token (no prompt) | **18.2+** | `Driver={ODBC Driver 18 for SQL Server};Server=tcp:host.database.windows.net,1433;Initial Catalog=app;Authentication=ActiveDirectoryDefault;Encrypt=Yes;` |
| Azure SQL, service principal (CI/CD) | 18 | `Driver={ODBC Driver 18 for SQL Server};Server=tcp:host.database.windows.net,1433;Initial Catalog=app;Authentication=ActiveDirectoryServicePrincipal;UID=<client-id>;PWD=<client-secret>;Encrypt=Yes;` |
| SQL auth (user + password) | 17 or 18 | `Driver={ODBC Driver 17 for SQL Server};Server=host;Database=app;UID=agent_reader;PWD=<password>;` |

## `Encrypt` values: ODBC 17 vs 18

| Value | ODBC 17 | ODBC 18 |
|-------|---------|---------|
| `Encrypt=True` / `Encrypt=False` | ✓ | ✗ — driver says "Invalid value" |
| `Encrypt=Yes` / `Encrypt=No` / `Encrypt=Strict` | ✓ | ✓ |

ODBC Driver 18 is strict: only `Yes`, `No`, or `Strict`. `True`/`False` work in Driver 17
but the upgrade breaks them.

## `Authentication` values: ODBC 17 vs 18 vs .NET

`Authentication=Active Directory Default` (with spaces) is a .NET `SqlConnection` keyword
that runs a chain (`ManagedIdentity → Integrated → Interactive → ...`). ODBC does not have
that chain — you pick one explicit value. The mapping:

| Goal | .NET | ODBC 17 | ODBC 18 (older builds) | ODBC 18.2+ |
|------|------|---------|------------------------|------------|
| Use cached AAD token from `az login` / VS / VS Code | `Active Directory Default` | ✗ | ✗ | `ActiveDirectoryDefault` |
| Federated AAD (Windows user → AAD) | `Active Directory Integrated` | `ActiveDirectoryIntegrated` | `ActiveDirectoryIntegrated` | `ActiveDirectoryIntegrated` |
| Managed AAD (browser sign-in) | `Active Directory Interactive` | `ActiveDirectoryInteractive` | `ActiveDirectoryInteractive` | `ActiveDirectoryInteractive` |
| Service principal | `Active Directory Service Principal` | `ActiveDirectoryServicePrincipal` | `ActiveDirectoryServicePrincipal` | `ActiveDirectoryServicePrincipal` |
| Device code flow | `Active Directory Device Code Flow` | `ActiveDirectoryDeviceCodeFlow` | `ActiveDirectoryDeviceCodeFlow` | `ActiveDirectoryDeviceCodeFlow` |
| Managed identity | `Active Directory Managed Identity` / `MSI` | `ActiveDirectoryManagedIdentity` / `ActiveDirectoryMSI` | `ActiveDirectoryManagedIdentity` / `ActiveDirectoryMSI` | `ActiveDirectoryManagedIdentity` / `ActiveDirectoryMSI` |
| Username + password AAD | `Active Directory Password` | `ActiveDirectoryPassword` | `ActiveDirectoryPassword` | `ActiveDirectoryPassword` |
| SQL auth | `SQL Password` / `User ID=...;Password=...` | `UID=...;PWD=...` | `UID=...;PWD=...` | `UID=...;PWD=...` |

ODBC keyword names: **no spaces**, case-insensitive (the driver normalises them).

## Checking which drivers are installed

```powershell
Get-ItemProperty 'HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Driver 17 for SQL Server' | Select-Object Driver
Get-ItemProperty 'HKLM:\SOFTWARE\ODBC\ODBCINST.INI\ODBC Driver 18 for SQL Server' | Select-Object Driver
```

The driver DLLs live in `C:\Windows\System32\msodbcsql17.dll` and `msodbcsql18.dll`.

## Verifying the install from mssql-axi

The easiest check: run `mssql-axi doctor` against a known-good string.

```bash
mssql-axi doctor --connection-string 'Driver={ODBC Driver 18 for SQL Server};Server=tcp:host.database.windows.net,1433;Initial Catalog=app;Authentication=ActiveDirectoryInteractive;Encrypt=Yes;'
```

Expected on success:

```
status: ok
driver: odbc
ping: true
user: <your-aad-user>
```

If `ping` is `false` and the error mentions `Invalid value specified for connection string
attribute`, you've hit the `Encrypt=True` / `Authentication=Active Directory Default`
traps — see the tables above.
