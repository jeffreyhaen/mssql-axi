import { describe, expect, it } from "vitest";
import { AxiError } from "axi-sdk-js";
import { homeCommand } from "../src/commands/home.js";
import { listCommand } from "../src/commands/list.js";
import { inspectCommand } from "../src/commands/inspect.js";
import { sampleCommand } from "../src/commands/sample.js";
import { CONNECTION_ARGS, useFakeDb, type QueryRule } from "./fakeDb.js";

const SERVER_RULES: QueryRule[] = [
  [/@@VERSION/i, [{ version: "Microsoft SQL Server 2022\nMore lines", serverName: "SRV01" }]],
  [/DB_NAME\(\)/i, [{ dbName: "app", dbId: 5 }]],
];

describe("home command", () => {
  it("summarises server, database and the largest tables", async () => {
    const db = useFakeDb({
      rules: [
        ...SERVER_RULES,
        [
          /FROM sys\.tables t JOIN sys\.schemas/i,
          [
            { schema: "dbo", name: "Users", rows: 42 },
            { schema: "dbo", name: "Orders", rows: 7 },
          ],
        ],
        [/COUNT\(\*\) AS total/i, [{ total: 12 }]],
      ],
    });

    const out = await homeCommand(CONNECTION_ARGS);

    expect(out.server).toBe("SRV01");
    expect(out.database).toBe("app");
    expect(out.version).toBe("Microsoft SQL Server 2022");
    expect(out.totalTables).toBe(12);
    expect(out.topTables).toEqual([
      { schema: "dbo", name: "Users", rows: 42 },
      { schema: "dbo", name: "Orders", rows: 7 },
    ]);
    expect(out.help).toBeInstanceOf(Array);
    expect(db.closed).toBe(1);
  });

  it("clamps --top into the query", async () => {
    const db = useFakeDb({ rules: SERVER_RULES });
    await homeCommand([...CONNECTION_ARGS, "--top", "999"]);
    expect(db.queries.some((q) => /SELECT TOP 50 /.test(q))).toBe(true);
  });

  it("wraps driver failures in a structured CONNECTION_FAILED error", async () => {
    useFakeDb({ openError: new Error("login failed for user 'sa'") });
    await expect(homeCommand(CONNECTION_ARGS)).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
  });

  it("rejects unknown flags", async () => {
    useFakeDb();
    await expect(homeCommand([...CONNECTION_ARGS, "--nope"])).rejects.toMatchObject({
      code: "UNKNOWN_FLAG",
    });
  });

  it("rejects positional arguments", async () => {
    useFakeDb();
    await expect(homeCommand([...CONNECTION_ARGS, "extra"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("list command", () => {
  it("lists tables with counts and totals", async () => {
    const db = useFakeDb({
      rules: [
        [
          /FROM sys\.tables t /i,
          [
            { schema: "dbo", name: "Users", rows: 3 },
            { schema: "dbo", name: "Orders", rows: 0 },
          ],
        ],
        [/COUNT\(\*\) AS total/i, [{ total: 2 }]],
      ],
    });

    const out = await listCommand([...CONNECTION_ARGS, "--kind", "tables"]);

    expect(out.kind).toBe("tables");
    expect(out.count).toBe(2);
    expect(out.totalCount).toBe(2);
    expect(out.tables).toEqual([
      { schema: "dbo", name: "Users", rows: 3 },
      { schema: "dbo", name: "Orders", rows: 0 },
    ]);
    expect(db.closed).toBe(1);
  });

  it("accepts the kind as a positional", async () => {
    const db = useFakeDb({
      rules: [
        [/COUNT\(\*\) AS total FROM sys\.views/i, [{ total: 1 }]],
        [/FROM sys\.views/i, [{ schema: "dbo", name: "vUsers" }]],
      ],
    });
    const out = await listCommand([...CONNECTION_ARGS, "views"]);
    expect(out.kind).toBe("views");
    expect(out.views).toEqual([{ schema: "dbo", name: "vUsers" }]);
    expect(db.queries.some((q) => /FROM sys\.views/.test(q))).toBe(true);
  });

  it("reports the real totalCount for views when --limit cuts the list", async () => {
    useFakeDb({
      rules: [
        [/COUNT\(\*\) AS total FROM sys\.views/i, [{ total: 42 }]],
        [/FROM sys\.views/i, [{ schema: "dbo", name: "vUsers" }]],
      ],
    });
    const out = await listCommand([...CONNECTION_ARGS, "views", "--limit", "1"]);
    expect(out.count).toBe(1);
    expect(out.totalCount).toBe(42);
  });

  it("reports the real totalCount for indexes and schemas too", async () => {
    useFakeDb({
      rules: [
        [/COUNT\(\*\) AS total FROM sys\.indexes/i, [{ total: 30 }]],
        [/FROM sys\.indexes/i, [{ schema: "dbo", table: "Users", name: "IX_1", typeDesc: "NONCLUSTERED" }]],
      ],
    });
    const idx = await listCommand([...CONNECTION_ARGS, "indexes", "--limit", "1"]);
    expect(idx.totalCount).toBe(30);
    expect(idx.count).toBe(1);

    useFakeDb({
      rules: [
        [/COUNT\(\*\) AS total FROM sys\.schemas/i, [{ total: 9 }]],
        [/FROM sys\.schemas/i, [{ name: "dbo", tables: 3 }]],
      ],
    });
    const sch = await listCommand([...CONNECTION_ARGS, "schemas", "--limit", "1"]);
    expect(sch.totalCount).toBe(9);
    expect(sch.count).toBe(1);
  });

  it("passes --schema through as a filter and applies --limit", async () => {
    const db = useFakeDb();
    await listCommand([...CONNECTION_ARGS, "--kind", "tables", "--schema", "sales", "--limit", "7"]);
    expect(db.queries[0]).toContain("SELECT TOP 7");
    expect(db.queries[0]).toContain("s.name = 'sales'");
  });

  it("rejects an unknown kind", async () => {
    useFakeDb();
    await expect(listCommand([...CONNECTION_ARGS, "--kind", "sprockets"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a non-positive --limit", async () => {
    useFakeDb();
    await expect(
      listCommand([...CONNECTION_ARGS, "--kind", "tables", "--limit", "0"]),
    ).rejects.toBeInstanceOf(AxiError);
  });

  it("rejects a second positional kind", async () => {
    useFakeDb();
    await expect(
      listCommand([...CONNECTION_ARGS, "tables", "views"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("no longer accepts the unused --full flag", async () => {
    useFakeDb();
    await expect(
      listCommand([...CONNECTION_ARGS, "tables", "--full"]),
    ).rejects.toMatchObject({ code: "UNKNOWN_FLAG" });
  });
});

const TABLE_RULES: QueryRule[] = [
  [/FROM sys\.tables t JOIN sys\.schemas/i, [{ objectId: 111, rows: 5 }]],
  [
    /FROM sys\.columns c JOIN sys\.types/i,
    [
      { name: "id", type: "int", maxLength: 4, nullable: false, default: null },
      { name: "email", type: "nvarchar", maxLength: 200, nullable: true, default: null },
    ],
  ],
  [/is_primary_key = 1/i, [{ columnName: "id" }]],
  [
    /FROM sys\.foreign_keys/i,
    [
      {
        name: "FK_Orders_Users",
        columnName: "userId",
        refSchema: "dbo",
        refTable: "Users",
        refColumn: "id",
      },
    ],
  ],
];

describe("inspect command", () => {
  it("returns columns, primary key and foreign keys for a table", async () => {
    useFakeDb({ rules: TABLE_RULES });

    const out = await inspectCommand([
      ...CONNECTION_ARGS,
      "--kind",
      "table",
      "--schema",
      "dbo",
      "--name",
      "Users",
    ]);

    expect(out.kind).toBe("table");
    expect(out.rows).toBe(5);
    expect(out.primaryKey).toEqual(["id"]);
    expect(out.foreignKeys).toEqual([
      { name: "FK_Orders_Users", column: "userId", references: "dbo.Users.id" },
    ]);
    expect(out.columns).toHaveLength(2);
  });

  it("accepts `inspect table dbo.Users` positionally", async () => {
    const db = useFakeDb({ rules: TABLE_RULES });
    const out = await inspectCommand([...CONNECTION_ARGS, "table", "dbo.Users"]);
    expect(out).toMatchObject({ kind: "table", schema: "dbo", name: "Users" });
    expect(db.queries[0]).toContain("s.name = 'dbo'");
    expect(db.queries[0]).toContain("t.name = 'Users'");
  });

  it("defaults to a table and to the dbo schema for a bare positional", async () => {
    useFakeDb({ rules: TABLE_RULES });
    const out = await inspectCommand([...CONNECTION_ARGS, "Users"]);
    expect(out).toMatchObject({ kind: "table", schema: "dbo", name: "Users" });
  });

  it("unwraps bracketed identifiers", async () => {
    const db = useFakeDb({ rules: TABLE_RULES });
    await inspectCommand([...CONNECTION_ARGS, "[sales].[Order Lines]"]);
    expect(db.queries[0]).toContain("s.name = 'sales'");
    expect(db.queries[0]).toContain("t.name = 'Order Lines'");
  });

  it("reports NOT_FOUND for a missing table", async () => {
    useFakeDb({ rules: [] });
    await expect(
      inspectCommand([...CONNECTION_ARGS, "--kind", "table", "--name", "Ghost"]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("requires an object name", async () => {
    useFakeDb();
    await expect(inspectCommand([...CONNECTION_ARGS, "--kind", "table"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects an unknown kind", async () => {
    useFakeDb();
    await expect(
      inspectCommand([...CONNECTION_ARGS, "--kind", "procedure", "--name", "x"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a third positional", async () => {
    useFakeDb();
    await expect(
      inspectCommand([...CONNECTION_ARGS, "table", "dbo.Users", "extra"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  const VIEW_DEF = "CREATE VIEW dbo.vBig AS SELECT " + "col, ".repeat(1000) + "1 FROM dbo.T";
  const VIEW_RULES: QueryRule[] = [
    [/FROM sys\.views v/i, [{ objectId: 7, definition: VIEW_DEF }]],
    [/FROM sys\.columns c JOIN sys\.types/i, [{ name: "id", type: "int", maxLength: 4, nullable: false }]],
  ];

  it("truncates a long view definition by default", async () => {
    useFakeDb({ rules: VIEW_RULES });
    const out = await inspectCommand([...CONNECTION_ARGS, "view", "dbo.vBig"]);
    expect(out.definitionTruncated).toBe(true);
    expect(out.definitionChars).toBe(VIEW_DEF.length);
    expect(String(out.definition).length).toBeLessThan(VIEW_DEF.length);
    expect(String(out.definition)).toContain("use --full");
  });

  it("returns the full view definition with --full", async () => {
    useFakeDb({ rules: VIEW_RULES });
    const out = await inspectCommand([...CONNECTION_ARGS, "view", "dbo.vBig", "--full"]);
    expect(out.definition).toBe(VIEW_DEF);
    expect(out.definitionTruncated).toBeUndefined();
  });
});

const SAMPLE_RULES: QueryRule[] = [
  [/FROM sys\.objects o/i, [{ kind: "USER_TABLE" }]],
  [
    /FROM sys\.columns c JOIN sys\.types/i,
    [
      { name: "id", type: "int", maxLength: 4 },
      { name: "email", type: "nvarchar", maxLength: 200 },
    ],
  ],
  [
    /^SELECT TOP /i,
    [
      { id: 1, email: "a@example.com" },
      { id: 2, email: "b@example.com" },
    ],
  ],
];

describe("sample command", () => {
  it("previews rows for `sample dbo.Users`", async () => {
    const db = useFakeDb({ rules: SAMPLE_RULES });

    const out = await sampleCommand([...CONNECTION_ARGS, "dbo.Users"]);

    expect(out).toMatchObject({ schema: "dbo", name: "Users", count: 2 });
    expect(out.rows).toEqual([
      { id: 1, email: "a@example.com" },
      { id: 2, email: "b@example.com" },
    ]);
    expect(db.queries.some((q) => /FROM \[dbo\]\.\[Users\]/.test(q))).toBe(true);
  });

  it("flags truncation when more rows exist than --limit", async () => {
    useFakeDb({
      rules: [
        [/FROM sys\.objects o/i, [{ kind: "USER_TABLE" }]],
        [/FROM sys\.columns c JOIN sys\.types/i, [{ name: "id", type: "int", maxLength: 4 }]],
        [/^SELECT TOP /i, [{ id: 1 }, { id: 2 }]],
      ],
    });

    const out = await sampleCommand([...CONNECTION_ARGS, "dbo.Users", "--limit", "1"]);

    expect(out.count).toBe(1);
    expect(out.truncated).toBe(true);
    expect(out.truncatedAt).toBe(1);
  });

  it("appends a --where clause", async () => {
    const db = useFakeDb({ rules: SAMPLE_RULES });
    await sampleCommand([...CONNECTION_ARGS, "dbo.Users", "--where", "id > 10"]);
    expect(db.queries.some((q) => /WHERE \(id > 10\)/.test(q))).toBe(true);
  });

  it("rejects a stacked statement in --where before opening a connection", async () => {
    const db = useFakeDb({ rules: SAMPLE_RULES });
    await expect(
      sampleCommand([...CONNECTION_ARGS, "dbo.Users", "--where", "1=1); DELETE FROM dbo.Users; --"]),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(db.opened).toBe(0);
    expect(db.queries).toHaveLength(0);
  });

  it("rejects a SELECT INTO breakout in --where before opening a connection", async () => {
    const db = useFakeDb({ rules: SAMPLE_RULES });
    await expect(
      sampleCommand([
        ...CONNECTION_ARGS,
        "dbo.Users",
        "--where",
        "1=1) INTO dbo.Stolen FROM dbo.Users WHERE (1=1",
      ]),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(db.opened).toBe(0);
  });

  it("rejects forbidden keywords in --where before opening a connection", async () => {
    const db = useFakeDb({ rules: SAMPLE_RULES });
    await expect(
      sampleCommand([...CONNECTION_ARGS, "dbo.Users", "--where", "id = 1; EXEC xp_cmdshell 'dir'"]),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(db.opened).toBe(0);
  });

  it("reports NOT_FOUND for a missing object", async () => {
    useFakeDb({ rules: [] });
    await expect(sampleCommand([...CONNECTION_ARGS, "dbo.Ghost"])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("requires a name", async () => {
    useFakeDb();
    await expect(sampleCommand([...CONNECTION_ARGS])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a second positional object", async () => {
    useFakeDb();
    await expect(
      sampleCommand([...CONNECTION_ARGS, "dbo.Users", "dbo.Orders"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
