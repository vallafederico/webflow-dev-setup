import { describe, expect, test } from "bun:test";
import { exec } from "./tools";
import { ToolFailure } from "./types";

describe("exec", () => {
  test("returns output and the exit code", async () => {
    const result = await exec(["sh", "-c", "echo out; echo err >&2; exit 3"], {
      cwd: "/",
    });
    expect(result).toEqual({ code: 3, stdout: "out\n", stderr: "err\n" });
  });

  test("a tool that outlives its timeout is killed and is a tool failure, not a hang", async () => {
    const started = Date.now();
    await expect(
      exec(["sleep", "4"], { cwd: "/", timeoutMs: 300 })
    ).rejects.toBeInstanceOf(ToolFailure);
    expect(Date.now() - started).toBeLessThan(3800);
  });

  test("a grandchild holding the pipes open can't extend the timeout", async () => {
    const started = Date.now();
    await expect(
      exec(["sh", "-c", "sleep 4 & sleep 4"], { cwd: "/", timeoutMs: 300 })
    ).rejects.toThrow("did not finish within");
    expect(Date.now() - started).toBeLessThan(3800);
  });

  test("CHECK_TOOL_TIMEOUT_MS shortens the default", async () => {
    process.env.CHECK_TOOL_TIMEOUT_MS = "300";
    try {
      await expect(exec(["sleep", "4"], { cwd: "/" })).rejects.toBeInstanceOf(
        ToolFailure
      );
    } finally {
      delete process.env.CHECK_TOOL_TIMEOUT_MS;
    }
  });
});
