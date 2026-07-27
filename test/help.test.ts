import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, "..", "dist", "bin", "mssql-axi.js");

describe("mssql-axi CLI (built)", () => {
  it("--version prints the package version", async () => {
    const { stdout } = await execFileAsync("node", [bin, "--version"]);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("--help includes every documented command", async () => {
    const { stdout } = await execFileAsync("node", [bin, "--help"]);
    for (const cmd of [
      "doctor",
      "list",
      "inspect",
      "sample",
      "query",
      "plan",
      "execute",
      "explain",
      "setup",
      "update",
    ]) {
      expect(stdout).toContain(cmd);
    }
    // Removed aspirational commands
    expect(stdout).not.toContain("discover");
    expect(stdout).not.toContain("services");
  });

  it("unknown command exits with code 2 and a structured error", async () => {
    let code: number | null = null;
    let stdout = "";
    try {
      await execFileAsync("node", [bin, "definitely-not-a-command"]);
    } catch (err) {
      const e = err as { code?: number; stdout?: string };
      code = e.code ?? null;
      stdout = e.stdout ?? "";
    }
    expect(code).toBe(2);
    expect(stdout).toContain("error");
    expect(stdout).toContain("VALIDATION_ERROR");
  });
});
