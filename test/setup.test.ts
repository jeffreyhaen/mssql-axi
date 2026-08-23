import { describe, expect, it } from "vitest";
import { setupCommand } from "../src/commands/setup.js";

describe("setup command", () => {
  it("requires a subcommand", async () => {
    await expect(setupCommand([])).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects an unknown subcommand", async () => {
    await expect(setupCommand(["sprockets"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("only accepts flags that the subcommand actually uses", async () => {
    // --output belongs to role/config, --marker to hooks, --name is gone.
    await expect(setupCommand(["hooks", "--output", "x"])).rejects.toMatchObject({
      code: "UNKNOWN_FLAG",
    });
    await expect(setupCommand(["role", "--marker", "x"])).rejects.toMatchObject({
      code: "UNKNOWN_FLAG",
    });
    await expect(setupCommand(["config", "--marker", "x"])).rejects.toMatchObject({
      code: "UNKNOWN_FLAG",
    });
    await expect(setupCommand(["role", "--name", "x"])).rejects.toMatchObject({
      code: "UNKNOWN_FLAG",
    });
    await expect(setupCommand(["hooks", "--name", "x"])).rejects.toMatchObject({
      code: "UNKNOWN_FLAG",
    });
  });

  it("rejects positional arguments on subcommands", async () => {
    await expect(setupCommand(["hooks", "extra"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(setupCommand(["role", "extra"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});
