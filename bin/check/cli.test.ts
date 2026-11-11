import { afterAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NESTED_ENV, tests } from "./tests";
import { ToolFailure } from "./types";

const REPO = path.resolve(import.meta.dir, "..", "..");
const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/**
 * A repo with the check tool but none of its tests, so running the checks in
 * it can't start this test again.
 */
function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "check-cli-"));
  created.push(root);
  symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"));
  cpSync(path.join(REPO, "biome.json"), path.join(root, "biome.json"));
  cpSync(path.join(REPO, "tsconfig.json"), path.join(root, "tsconfig.json"));
  cpSync(path.join(REPO, "bin", "check"), path.join(root, "bin", "check"), {
    recursive: true,
    // The browser run's entries import the real src/, which this repo lacks.
    filter: (source) =>
      !source.includes("fixtures") &&
      !source.endsWith(".test.ts") &&
      !source.endsWith("fixture-entry.ts") &&
      !source.endsWith("runtime-build.ts"),
  });
  // The tier "all" checks import these when the registry loads.
  for (const name of [
    "sync-skills.ts",
    "new-module.ts",
    "generate-worker.ts",
    "project-config.ts",
    "wrangler-routes.ts",
  ]) {
    cpSync(path.join(REPO, "bin", name), path.join(root, "bin", name));
  }
  const defaults: Record<string, string> = {
    "bin/ok.test.ts":
      'import { expect, test } from "bun:test";\ntest("ok", () => expect(1).toBe(1));\n',
    ".claude/skills/one/SKILL.md": "skill\n",
    ".codex/skills/one/SKILL.md": "skill\n",
    ".cursor/skills/one/SKILL.md": "skill\n",
    "src/a.ts": "export const a = 1;\n",
  };
  for (const [file, text] of Object.entries({ ...defaults, ...files })) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

/** The command the docs give agents for machine-readable output. */
function documented(root: string, ...args: string[]) {
  const proc = Bun.spawnSync(
    ["./node_modules/.bin/bun", "run", "bin/check/index.ts", ...args],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      // Cleared, because this test itself runs inside `pnpm check`.
      env: { ...process.env, [NESTED_ENV]: "" },
    }
  );
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("the documented JSON command", () => {
  test("parses at exit 1, and two runs are byte-identical", () => {
    const root = makeRepo({ "src/a.ts": "export const a   = 1\n" });
    const first = documented(root, "--json");
    const second = documented(root, "--json");
    expect(first.code).toBe(1);
    const parsed = JSON.parse(first.stdout);
    expect(parsed.ok).toBe(false);
    expect(
      parsed.checks.find((c: { name: string }) => c.name === "format").findings
    ).toHaveLength(1);
    expect(second.stdout).toBe(first.stdout);
  });

  test("parses at exit 0", () => {
    const root = makeRepo({});
    const run = documented(root, "--json");
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout).ok).toBe(true);
  });

  test("--all in a repo that can't build is exit 2, never a pass", () => {
    // The stripped repo has no bin/build.ts, so the build check fails and
    // bundle and host are blocked. It has no modules either, which stops the
    // browser run: a tool failure.
    const run = documented(makeRepo({}), "--all", "--json");
    expect(run.code).toBe(2);
    const checks = JSON.parse(run.stdout).checks as {
      name: string;
      ok: boolean;
    }[];
    const byName = Object.fromEntries(checks.map((c) => [c.name, c.ok]));
    expect(Object.keys(byName).slice(-4)).toEqual([
      "build",
      "bundle",
      "host",
      "runtime",
    ]);
    expect(byName.build).toBe(false);
    expect(byName.bundle).toBe(false);
    expect(byName.host).toBe(false);
  });
});

describe("a tool that can't be trusted is exit 2, never a pass", () => {
  test("deleting .claude/skills", () => {
    const root = makeRepo({});
    rmSync(path.join(root, ".claude"), { recursive: true });
    expect(documented(root).code).toBe(2);
  });

  test("deleting src/", () => {
    const root = makeRepo({});
    rmSync(path.join(root, "src"), { recursive: true });
    expect(documented(root).code).toBe(2);
  });
});

describe("the tests check", () => {
  const run = (testFile: string) => {
    const root = makeRepo({ "bin/ok.test.ts": testFile });
    return tests.run({ root, all: false });
  };
  const header = 'import { expect, test } from "bun:test";\n';

  test("a failing test is a finding", async () => {
    const result = await run(
      `${header}test("bad", () => expect(1).toBe(2));\n`
    );
    expect(result.ok).toBe(false);
    expect(result.findings[0]?.message).toContain("bad");
  });

  test("passing tests pass", async () => {
    expect((await run(`${header}test("ok", () => {});\n`)).ok).toBe(true);
  });

  test("a failing test then top-level process.exit(0) is not a pass", async () => {
    await expect(
      run(
        `${header}test("bad", () => expect(1).toBe(2));\ntest("ok", () => {});\nprocess.exit(0);\n`
      )
    ).rejects.toBeInstanceOf(ToolFailure);
  });

  test("process.exit(0) in the first test is not a pass", async () => {
    await expect(
      run(
        `${header}test("exits", () => process.exit(0));\ntest("x", () => {});\n`
      )
    ).rejects.toBeInstanceOf(ToolFailure);
  });

  test("a skipped suite is not a pass", async () => {
    await expect(
      run(`${header}test.skip("later", () => expect(1).toBe(2));\n`)
    ).rejects.toBeInstanceOf(ToolFailure);
  });

  test("an empty test file is not a pass", async () => {
    await expect(run("export {};\n")).rejects.toBeInstanceOf(ToolFailure);
  });

  test("a focused test can't hide a failing one, because lint rejects it", async () => {
    const root = makeRepo({
      "bin/ok.test.ts": `${header}test("bad", () => expect(1).toBe(2));\ntest.only("ok", () => {});\n`,
    });
    const run = documented(root, "--json");
    expect(run.code).toBe(1);
    const lint = JSON.parse(run.stdout).checks.find(
      (c: { name: string }) => c.name === "lint"
    );
    expect(lint.findings.map((f: { rule: string }) => f.rule)).toContain(
      "lint/suspicious/noFocusedTests"
    );
  });
});
