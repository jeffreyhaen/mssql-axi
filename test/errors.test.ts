import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/lib/errors.js";

describe("errorMessage", () => {
  it("returns the plain message for ordinary errors", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("string failure")).toBe("string failure");
  });

  it("appends the first ODBC diagnostic to the generic odbc message", () => {
    const err = Object.assign(new Error("[odbc] Error connecting to the database"), {
      odbcErrors: [
        { state: "08001", code: 53, message: "[Microsoft][ODBC Driver 18 for SQL Server]Named Pipes Provider: Could not open a connection to SQL Server [53]." },
        { state: "HYT00", code: 0, message: "Login timeout expired" },
      ],
    });
    const msg = errorMessage(err);
    expect(msg).toContain("Error connecting to the database");
    expect(msg).toContain("Named Pipes Provider");
    expect(msg).toContain("(+1 more ODBC diagnostics)");
  });

  it("omits the counter when there is exactly one diagnostic", () => {
    const err = Object.assign(new Error("[odbc] Error"), {
      odbcErrors: [{ state: "28000", code: 18456, message: "Login failed for user 'sa'." }],
    });
    expect(errorMessage(err)).toBe("[odbc] Error — Login failed for user 'sa'.");
  });

  it("does not duplicate a diagnostic already in the base message", () => {
    const err = Object.assign(new Error("Login failed for user 'sa'."), {
      odbcErrors: [{ state: "28000", code: 18456, message: "Login failed for user 'sa'." }],
    });
    expect(errorMessage(err)).toBe("Login failed for user 'sa'.");
  });
});
