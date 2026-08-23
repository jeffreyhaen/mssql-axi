import { describe, expect, it } from "vitest";
import { queryCommand } from "../src/commands/query.js";
import { explainCommand } from "../src/commands/explain.js";
import { planCommand } from "../src/commands/plan.js";
import { executeCommand } from "../src/commands/execute.js";
import { doctorCommand } from "../src/commands/doctor.js";
import { CONNECTION_ARGS, useFakeDb, type QueryRule } from "./fakeDb.js";

const SHOWPLAN_XML =
  '<ShowPlanXML><Stmt><QueryPlan><RelOp PhysicalOp="Clustered Index Scan" ' +
  'EstimatedTotalSubtreeCost="0.0032831"/><RelOp PhysicalOp="Nested Loops"/></QueryPlan></Stmt></ShowPlanXML>';

describe("query command", () => {
  it("runs a SELECT passed as a positional", async () => {
    const db = useFakeDb({
      rules: [[/FROM dbo\.Users/i, [{ id: 1, email: "a@example.com" }]]],
    });

    const out = await queryCommand([...CONNECTION_ARGS, "SELECT id, email FROM dbo.Users"]);

    expect(out.count).toBe(1);
    expect(out.rows).toEqual([{ id: 1, email: "a@example.com" }]);
    expect(db.queries).toEqual(["SELECT id, email FROM dbo.Users"]);
    expect(db.closed).toBe(1);
  });

  it("treats --sql and the positional form identically", async () => {
    const rules: QueryRule[] = [[/SELECT 1/i, [{ one: 1 }]]];
    const viaFlag = useFakeDb({ rules });
    const a = await queryCommand([...CONNECTION_ARGS, "--sql", "SELECT 1 AS one"]);
    const viaPositional = useFakeDb({ rules });
    const b = await queryCommand([...CONNECTION_ARGS, "SELECT 1 AS one"]);

    expect(a).toEqual(b);
    expect(viaFlag.queries).toEqual(viaPositional.queries);
  });

  it("caps rows at --limit and reports the total", async () => {
    useFakeDb({
      rules: [[/FROM dbo\.Users/i, [{ id: 1 }, { id: 2 }, { id: 3 }]]],
    });

    const out = await queryCommand([...CONNECTION_ARGS, "SELECT id FROM dbo.Users", "--limit", "2"]);

    expect(out.count).toBe(2);
    expect(out.truncated).toBe(true);
    expect(out.truncatedAt).toBe(2);
    expect(out.totalCount).toBe(3);
  });

  it("truncates long cells unless --full is given", async () => {
    const long = "x".repeat(1000);
    useFakeDb({ rules: [[/FROM dbo\.Notes/i, [{ body: long }]]] });
    const truncated = await queryCommand([...CONNECTION_ARGS, "SELECT body FROM dbo.Notes"]);
    expect(truncated.cellTruncated).toBe(true);

    useFakeDb({ rules: [[/FROM dbo\.Notes/i, [{ body: long }]]] });
    const full = await queryCommand([...CONNECTION_ARGS, "SELECT body FROM dbo.Notes", "--full"]);
    expect(full.cellTruncated).toBeUndefined();
    expect((full.rows as Array<{ body: string }>)[0]?.body).toHaveLength(1000);
  });

  it("refuses writes before touching the connection", async () => {
    const db = useFakeDb();
    await expect(
      queryCommand([...CONNECTION_ARGS, "DELETE FROM dbo.Users"]),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(db.queries).toEqual([]);
  });

  it("requires a statement", async () => {
    useFakeDb();
    await expect(queryCommand([...CONNECTION_ARGS])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects a second positional instead of ignoring it", async () => {
    const db = useFakeDb();
    await expect(
      queryCommand([...CONNECTION_ARGS, "SELECT 1", "SELECT 2"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(db.opened).toBe(0);
  });

  it("summarises a SET SHOWPLAN_XML sequence without the raw XML by default", async () => {
    useFakeDb({ rules: [[/FROM dbo\.Users/i, [{ xml: SHOWPLAN_XML }]]] });
    const out = await queryCommand([
      ...CONNECTION_ARGS,
      "SET SHOWPLAN_XML ON; SELECT id FROM dbo.Users; SET SHOWPLAN_XML OFF",
    ]);
    expect(out.plan).toBe("showplan");
    expect(out.physicalOps).toEqual(["Clustered Index Scan", "Nested Loops"]);
    expect(out.fullXml).toBeUndefined();
    expect((out.help as string[]).some((h) => h.includes("--full"))).toBe(true);
  });

  it("returns the full Showplan XML for a showplan sequence with --full", async () => {
    useFakeDb({ rules: [[/FROM dbo\.Users/i, [{ xml: SHOWPLAN_XML }]]] });
    const out = await queryCommand([
      ...CONNECTION_ARGS,
      "SET SHOWPLAN_XML ON; SELECT id FROM dbo.Users; SET SHOWPLAN_XML OFF",
      "--full",
    ]);
    expect(out.plan).toBe("showplan");
    expect(out.fullXml).toBe(SHOWPLAN_XML);
  });

  it("wraps server errors and redacts the connection string", async () => {
    useFakeDb({ failOn: /SELECT/i, failWith: new Error("Invalid object name 'dbo.Ghost'") });
    await expect(
      queryCommand([...CONNECTION_ARGS, "SELECT * FROM dbo.Ghost"]),
    ).rejects.toMatchObject({ code: "CONNECTION_FAILED" });
  });
});

describe("explain command", () => {
  it("summarises the showplan and always resets SHOWPLAN_XML", async () => {
    const db = useFakeDb({ rules: [[/FROM dbo\.Users/i, [{ xml: SHOWPLAN_XML }]]] });

    const out = await explainCommand([...CONNECTION_ARGS, "SELECT id FROM dbo.Users"]);

    expect(out.physicalOps).toEqual(["Clustered Index Scan", "Nested Loops"]);
    expect(out.estimatedCost).toBeCloseTo(0.0032831);
    expect(out.fullXml).toBeUndefined();
    expect(db.queries[0]).toBe("SET SHOWPLAN_XML ON");
    expect(db.queries.at(-1)).toBe("SET SHOWPLAN_XML OFF");
  });

  it("includes the raw XML with --full", async () => {
    useFakeDb({ rules: [[/FROM dbo\.Users/i, [{ xml: SHOWPLAN_XML }]]] });
    const out = await explainCommand([...CONNECTION_ARGS, "SELECT id FROM dbo.Users", "--full"]);
    expect(out.fullXml).toBe(SHOWPLAN_XML);
  });

  it("refuses a non-SELECT", async () => {
    const db = useFakeDb();
    await expect(
      explainCommand([...CONNECTION_ARGS, "UPDATE dbo.Users SET email = 'x' WHERE id = 1"]),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
    expect(db.queries).toEqual([]);
  });

  it("rejects a second positional instead of ignoring it", async () => {
    useFakeDb();
    await expect(
      explainCommand([...CONNECTION_ARGS, "SELECT 1", "SELECT 2"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("plan command", () => {
  it("shows the normalised SQL without connecting", async () => {
    const db = useFakeDb();

    const out = await planCommand(["UPDATE dbo.Users   SET email = 'x'\n WHERE id = 1"]);

    expect(out.status).toBe("plan");
    expect(out.destructive).toBe(false);
    expect(out.normalised).toBe("UPDATE dbo.Users SET email = 'x' WHERE id = 1");
    expect(db.queries).toEqual([]);
  });

  it("flags destructive SQL with a reason", async () => {
    const out = await planCommand(["--sql", "DELETE FROM dbo.Users"]);
    expect(out.destructive).toBe(true);
    expect(out.reason).toBeTruthy();
  });

  it("requires a statement", async () => {
    await expect(planCommand([])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a second positional", async () => {
    await expect(
      planCommand(["SELECT 1", "SELECT 2"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses connection flags it would only ignore", async () => {
    for (const flag of [
      "--server",
      "--database",
      "--user",
      "--password",
      "--connection",
      "--connection-string",
    ]) {
      await expect(planCommand(["SELECT 1", flag, "x"])).rejects.toMatchObject({
        code: "UNKNOWN_FLAG",
      });
    }
  });
});

describe("execute command", () => {
  const SQL = "UPDATE dbo.Users SET email = 'x' WHERE id = 1";

  it("is a dry run by default and never opens a connection", async () => {
    const db = useFakeDb();

    const out = await executeCommand([...CONNECTION_ARGS, SQL, "--confirm", SQL]);

    expect(out.status).toBe("dry-run");
    expect(db.executed).toEqual([]);
    expect(db.closed).toBe(0);
  });

  it("runs the statement with --execute and reports rowsAffected", async () => {
    const db = useFakeDb({ rowsAffected: [3] });

    const out = await executeCommand([...CONNECTION_ARGS, SQL, "--confirm", SQL, "--execute"]);

    expect(out).toMatchObject({ status: "ok", rowsAffected: 3, destructive: false });
    expect(db.executed).toEqual([SQL]);
    expect(db.closed).toBe(1);
  });

  it("requires --confirm to match after normalisation", async () => {
    useFakeDb();
    await expect(
      executeCommand([...CONNECTION_ARGS, SQL, "--confirm", "UPDATE dbo.Users SET email = 'y'"]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a second positional", async () => {
    useFakeDb();
    await expect(
      executeCommand([...CONNECTION_ARGS, SQL, "extra", "--confirm", SQL]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("accepts --confirm that differs only in whitespace", async () => {
    useFakeDb({ rowsAffected: [1] });
    const out = await executeCommand([
      ...CONNECTION_ARGS,
      SQL,
      "--confirm",
      "UPDATE dbo.Users   SET email = 'x'\n\tWHERE id = 1",
      "--execute",
    ]);
    expect(out.status).toBe("ok");
  });

  it("refuses destructive SQL without --allow-destructive", async () => {
    const db = useFakeDb();
    const destructive = "DELETE FROM dbo.Users";
    await expect(
      executeCommand([...CONNECTION_ARGS, destructive, "--confirm", destructive, "--execute"]),
    ).rejects.toMatchObject({ code: "DESTRUCTIVE_REFUSED" });
    expect(db.executed).toEqual([]);
  });

  it("refuses stacked statements", async () => {
    useFakeDb();
    const stacked = "UPDATE dbo.Users SET email = 'x' WHERE id = 1; DROP TABLE dbo.Users";
    await expect(
      executeCommand([...CONNECTION_ARGS, stacked, "--confirm", stacked]),
    ).rejects.toMatchObject({ code: "READ_ONLY" });
  });

  it("redirects SELECT to the query command", async () => {
    useFakeDb();
    const select = "SELECT 1";
    await expect(
      executeCommand([...CONNECTION_ARGS, select, "--confirm", select]),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("refuses to report success above --max-rows-affected", async () => {
    useFakeDb({ rowsAffected: [5000] });
    await expect(
      executeCommand([
        ...CONNECTION_ARGS,
        SQL,
        "--confirm",
        SQL,
        "--execute",
        "--max-rows-affected",
        "10",
      ]),
    ).rejects.toMatchObject({ code: "ROW_LIMIT" });
  });
});

describe("doctor command", () => {
  const ROLE_OK: QueryRule[] = [
    [/SELECT 1 AS one/i, [{ one: 1 }]],
    [/IS_MEMBER/i, [{ isReader: 1, isDenydatawriter: 1, userName: "agent" }]],
    [
      /SYSDATETIMEOFFSET/i,
      [{ serverTime: "2026-01-01T10:00:00", utc: "2026-01-01T09:00:00", offsetMinutes: 60 }],
    ],
  ];

  it("reports a healthy connection with no warnings", async () => {
    useFakeDb({ rules: ROLE_OK });

    const out = await doctorCommand(CONNECTION_ARGS);

    expect(out).toMatchObject({
      status: "ok",
      driver: "odbc",
      ping: true,
      agentReader: true,
      dbDenydatawriter: true,
      user: "agent",
      tzOffsetMinutes: 60,
    });
    expect(out.warnings).toEqual([]);
  });

  it("warns when the agent_reader role is missing", async () => {
    useFakeDb({
      rules: [
        [/SELECT 1 AS one/i, [{ one: 1 }]],
        [/IS_MEMBER/i, [{ isReader: 0, isDenydatawriter: 0, userName: "sa" }]],
      ],
    });

    const out = await doctorCommand(CONNECTION_ARGS);

    expect(out.agentReader).toBe(false);
    expect(out.warnings).toHaveLength(1);
  });

  it("returns a structured unreachable result instead of throwing", async () => {
    useFakeDb({ openError: new Error("server not found") });
    await expect(doctorCommand(CONNECTION_ARGS)).rejects.toMatchObject({
      code: "CONNECTION_FAILED",
    });
  });

  it("rejects positional arguments", async () => {
    useFakeDb();
    await expect(doctorCommand([...CONNECTION_ARGS, "extra"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
