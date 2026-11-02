import { describe, expect, test } from "bun:test";
import { exitCodeFor, main, runChecks, toHuman, toJson } from "./index";
import { NESTED_ENV } from "./tests";
import { type Check, type Finding, ToolFailure, toResult } from "./types";

const ctx = { root: "/repo/example", all: false };

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  rule: "demo/rule",
  severity: "error",
  file: "src/a.ts",
  line: 1,
  message: "message",
  fix: "fix",
  ...overrides,
});

const check = (name: string, findings: Finding[]): Check => ({
  name,
  tier: "fast",
  run: async () => toResult(name, findings),
});

describe("runChecks", () => {
  test("keeps registry order and sorts findings by file, line, rule", async () => {
    const outcome = await runChecks(
      [
        check("second", [finding()]),
        check("first", [
          finding({ file: "src/b.ts", line: 1, rule: "z" }),
          finding({ file: "src/a.ts", line: 9, rule: "a" }),
          finding({ file: "src/a.ts", line: 2, rule: "b" }),
          finding({ file: "src/a.ts", line: 2, rule: "a" }),
        ]),
      ],
      ctx
    );
    expect(outcome.results.map((r) => r.name)).toEqual(["second", "first"]);
    expect(
      outcome.results[1]?.findings.map((f) => `${f.file}:${f.line}:${f.rule}`)
    ).toEqual(["src/a.ts:2:a", "src/a.ts:2:b", "src/a.ts:9:a", "src/b.ts:1:z"]);
  });

  test("results do not depend on which check finishes first", async () => {
    const slow: Check = {
      name: "slow",
      tier: "fast",
      run: async () => {
        await Bun.sleep(30);
        return toResult("slow", []);
      },
    };
    const outcome = await runChecks([slow, check("fast", [])], ctx);
    expect(outcome.results.map((r) => r.name)).toEqual(["slow", "fast"]);
  });

  test("absolute paths never reach the output", async () => {
    const outcome = await runChecks(
      [
        check("paths", [
          finding({
            message: "bad at /repo/example/src/a.ts",
            fix: "edit /repo/example/src/a.ts",
          }),
        ]),
      ],
      ctx
    );
    expect(toJson(outcome)).not.toContain("/repo/example");
    expect(toHuman(outcome)).not.toContain("/repo/example");
  });
});

describe("exit codes", () => {
  test("0 passed, and warnings do not fail", async () => {
    const outcome = await runChecks(
      [check("a", [finding({ severity: "warning" })])],
      ctx
    );
    expect(outcome.results[0]?.ok).toBe(true);
    expect(exitCodeFor(outcome)).toBe(0);
  });

  test("1 for any error finding", async () => {
    const outcome = await runChecks([check("a", [finding()])], ctx);
    expect(exitCodeFor(outcome)).toBe(1);
  });

  test("2 when a tool failed, even if another check has findings", async () => {
    const broken: Check = {
      name: "broken",
      tier: "fast",
      run: async () => {
        throw new ToolFailure("biome.json is invalid", { file: "biome.json" });
      },
    };
    const outcome = await runChecks([check("a", [finding()]), broken], ctx);
    expect(exitCodeFor(outcome)).toBe(2);
    expect(outcome.results[1]?.ok).toBe(false);
    expect(outcome.results[1]?.findings[0]).toMatchObject({
      rule: "tool/failure",
      file: "biome.json",
    });
  });

  test("2 when a check crashes, so a crash can't read as a pass", async () => {
    const crashing: Check = {
      name: "crashing",
      tier: "fast",
      run: async () => {
        throw new TypeError("boom");
      },
    };
    const outcome = await runChecks([crashing], ctx);
    expect(exitCodeFor(outcome)).toBe(2);
    expect(outcome.results[0]?.findings[0]?.message).toContain("boom");
  });
});

describe("--json", () => {
  test("has exactly the documented shape and is identical across runs", async () => {
    const checks = [
      check("a", [finding({ file: "src/z.ts" }), finding()]),
      check("b", []),
    ];
    const first = toJson(await runChecks(checks, ctx));
    const second = toJson(await runChecks(checks, ctx));
    expect(first).toBe(second);

    const parsed = JSON.parse(first);
    expect(Object.keys(parsed)).toEqual(["ok", "checks"]);
    expect(parsed.ok).toBe(false);
    expect(Object.keys(parsed.checks[0])).toEqual(["name", "ok", "findings"]);
    expect(Object.keys(parsed.checks[0].findings[0])).toEqual([
      "rule",
      "severity",
      "file",
      "line",
      "message",
      "fix",
    ]);
  });
});

describe("main", () => {
  test("refuses to run from inside the test run", async () => {
    const before = process.env[NESTED_ENV];
    process.env[NESTED_ENV] = "1";
    try {
      expect(await main([])).toBe(2);
    } finally {
      if (before === undefined) delete process.env[NESTED_ENV];
      else process.env[NESTED_ENV] = before;
    }
  });

  test("an unknown option is a usage error, not a pass", async () => {
    expect(await main(["--nope"])).toBe(2);
  });
});

describe("sequential tier", () => {
  test("runs one check at a time, in order, so a later check can read an earlier one's output", async () => {
    const order: string[] = [];
    const step = (name: string, ms: number): Check => ({
      name,
      tier: "all",
      run: async () => {
        order.push(`start ${name}`);
        await Bun.sleep(ms);
        order.push(`end ${name}`);
        return toResult(name, []);
      },
    });
    const outcome = await runChecks([step("slow", 30), step("quick", 0)], ctx, {
      sequential: true,
    });
    expect(order).toEqual([
      "start slow",
      "end slow",
      "start quick",
      "end quick",
    ]);
    expect(outcome.results.map((r) => r.name)).toEqual(["slow", "quick"]);
  });

  test("a check that throws doesn't stop the ones after it, and the run is exit 2", async () => {
    const broken: Check = {
      name: "build",
      tier: "all",
      run: async () => {
        throw new ToolFailure("no dist");
      },
    };
    const outcome = await runChecks([broken, check("after", [])], ctx, {
      sequential: true,
    });
    expect(outcome.results.map((r) => r.name)).toEqual(["build", "after"]);
    expect(exitCodeFor(outcome)).toBe(2);
  });
});

describe("--only", () => {
  test("a name that isn't a check is a usage error", async () => {
    expect(await main(["--only", "nope"])).toBe(2);
    expect(await main(["--only"])).toBe(2);
  });
});
