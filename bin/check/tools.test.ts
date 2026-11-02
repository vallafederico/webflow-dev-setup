import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { format, lint } from "./biome";
import { fix } from "./fix";
import { analyzeSource } from "./house-rules";
import { skills } from "./skills";
import { types } from "./tsc";
import { ToolFailure } from "./types";
import { findDrift, syncSkills } from "../sync-skills";
import { moduleSource } from "../new-module";

const REPO = path.resolve(import.meta.dir, "..", "..");
const created: string[] = [];

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** A small repo that borrows the real node_modules. */
function makeRepo(files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "check-test-"));
  created.push(root);
  symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"));
  cpSync(path.join(REPO, "biome.json"), path.join(root, "biome.json"));
  writeFileSync(
    path.join(root, "tsconfig.json"),
    `{
  "include": ["src"],
  "compilerOptions": { "strict": true, "noEmit": true, "module": "esnext" }
}
`
  );
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

const ctx = (root: string) => ({ root, all: false });

describe("Biome", () => {
  test("an invalid biome.json is a tool failure, not a pass", async () => {
    const root = makeRepo({ "src/a.ts": "export const a = 1;\n" });
    writeFileSync(path.join(root, "biome.json"), '{ "linter": { "nope": 1 } }');
    await expect(format.run(ctx(root))).rejects.toBeInstanceOf(ToolFailure);
    await expect(lint.run(ctx(root))).rejects.toBeInstanceOf(ToolFailure);
  });

  test("a non-zero exit with no error in any file is a tool failure", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "check-fake-biome-"));
    created.push(root);
    mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
    const fake = path.join(root, "node_modules", ".bin", "biome");
    writeFileSync(fake, "#!/bin/sh\necho '{\"diagnostics\":[]}'\nexit 1\n");
    chmodSync(fake, 0o755);
    await expect(format.run(ctx(root))).rejects.toBeInstanceOf(ToolFailure);
    await expect(lint.run(ctx(root))).rejects.toBeInstanceOf(ToolFailure);
  });

  test("unformatted code is a format finding, and nothing is written", async () => {
    const text = "export const a   = 1\n";
    const root = makeRepo({ "src/a.ts": text });
    const result = await format.run(ctx(root));
    expect(result.findings.map((f) => [f.rule, f.file])).toEqual([
      ["format", "src/a.ts"],
    ]);
    expect(readFileSync(path.join(root, "src/a.ts"), "utf8")).toBe(text);
  });

  test("lint reports errors and warnings with a line", async () => {
    const root = makeRepo({ "src/a.ts": "import { x } from './x';\nlet y;\n" });
    const result = await lint.run(ctx(root));
    expect(result.ok).toBe(false);
    const byRule = Object.fromEntries(result.findings.map((f) => [f.rule, f]));
    expect(byRule["lint/correctness/noUnusedImports"]).toMatchObject({
      severity: "warning",
      line: 1,
    });
    expect(byRule["lint/suspicious/noImplicitAnyLet"]).toMatchObject({
      severity: "error",
      line: 2,
    });
  });
});

describe("tsc", () => {
  test("a type error becomes a finding with file and line", async () => {
    const root = makeRepo({ "src/a.ts": "export const a: number = 'x';\n" });
    const result = await types.run(ctx(root));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      rule: "tsc/TS2322",
      file: "src/a.ts",
      line: 1,
    });
  });

  test("an unreadable tsconfig is a tool failure", async () => {
    const root = makeRepo({ "src/a.ts": "export const a = 1;\n" });
    writeFileSync(path.join(root, "tsconfig.json"), "{ nope");
    await expect(types.run(ctx(root))).rejects.toBeInstanceOf(ToolFailure);
  });

  test("clean code passes", async () => {
    const root = makeRepo({ "src/a.ts": "export const a = 1;\n" });
    expect((await types.run(ctx(root))).findings).toEqual([]);
  });
});

describe("skills", () => {
  function skillRepo(source: string, copies: Record<string, string>) {
    const files: Record<string, string> = {
      ".claude/skills/one/SKILL.md": source,
    };
    for (const [folder, text] of Object.entries(copies)) {
      files[`${folder}/one/SKILL.md`] = text;
    }
    return makeRepo(files);
  }

  test("matching copies pass", async () => {
    const root = skillRepo("a", {
      ".codex/skills": "a",
      ".cursor/skills": "a",
    });
    expect((await skills.run(ctx(root))).findings).toEqual([]);
  });

  test("an edit only in .claude is reported for both copies", async () => {
    const root = skillRepo("new", {
      ".codex/skills": "old",
      ".cursor/skills": "old",
    });
    const result = await skills.run(ctx(root));
    expect(result.ok).toBe(false);
    expect(result.findings.map((f) => [f.rule, f.file]).sort()).toEqual([
      ["skills/drift", ".codex/skills/one/SKILL.md"],
      ["skills/drift", ".cursor/skills/one/SKILL.md"],
    ]);
  });

  test("an extra copy is an error, not a warning", async () => {
    const root = skillRepo("a", {
      ".codex/skills": "a",
      ".cursor/skills": "a",
    });
    writeFileSync(path.join(root, ".cursor/skills/one/old.md"), "stale");
    const result = await skills.run(ctx(root));
    expect(result.ok).toBe(false);
    expect(result.findings[0]).toMatchObject({
      rule: "skills/extra",
      severity: "error",
    });
  });

  test("an empty or missing source is a tool failure", async () => {
    const root = skillRepo("a", {
      ".codex/skills": "a",
      ".cursor/skills": "a",
    });
    rmSync(path.join(root, ".claude"), { recursive: true });
    await expect(skills.run(ctx(root))).rejects.toBeInstanceOf(ToolFailure);
  });

  test("a .DS_Store is not a skill file", async () => {
    const root = skillRepo("a", {
      ".codex/skills": "a",
      ".cursor/skills": "a",
    });
    writeFileSync(path.join(root, ".claude/skills/one/.DS_Store"), "x");
    writeFileSync(path.join(root, ".codex/skills/one/.DS_Store"), "y");
    expect((await skills.run(ctx(root))).findings).toEqual([]);
  });

  test("a missing copy and an orphan are told apart, and sync fixes the first", () => {
    const root = skillRepo("a", { ".codex/skills": "a" });
    writeFileSync(path.join(root, ".codex/skills/one/old.md"), "stale");
    expect(
      findDrift(root)
        .map((d) => [d.kind, d.file])
        .sort()
    ).toEqual([
      ["extra", ".codex/skills/one/old.md"],
      ["missing", ".cursor/skills/one/SKILL.md"],
    ]);
    expect(syncSkills(root)).toEqual([".cursor/skills/one/SKILL.md"]);
    expect(findDrift(root).map((d) => d.kind)).toEqual(["extra"]);
    expect(syncSkills(root)).toEqual([]);
  });
});

describe("pnpm fix", () => {
  const messy = [
    'import { Raf } from "@/lib/subs";',
    "export   const stop = Raf.add(() => {})",
    "",
  ].join("\n");

  test("fixes imports and formatting, then a second run changes nothing", async () => {
    const root = makeRepo({
      "src/utils/loop.ts": messy,
      // Out of scope on purpose: fix must leave it alone.
      "docs/loop.ts": messy,
    });
    const first = await fix(root);
    expect(first.importEdits).toBe(1);
    const fixed = readFileSync(path.join(root, "src/utils/loop.ts"), "utf8");
    expect(fixed).toBe(
      'import { Raf } from "@lib/subs";\nexport const stop = Raf.add(() => {});\n'
    );
    expect(readFileSync(path.join(root, "docs/loop.ts"), "utf8")).toBe(messy);

    const second = await fix(root);
    expect(second).toEqual({
      importEdits: 0,
      importFiles: 0,
      lintChanged: 0,
      formatChanged: 0,
    });
    expect(readFileSync(path.join(root, "src/utils/loop.ts"), "utf8")).toBe(
      fixed
    );
  });

  test("an invalid biome.json stops it with a tool failure", async () => {
    const root = makeRepo({ "src/a.ts": "export const a = 1;\n" });
    writeFileSync(path.join(root, "biome.json"), "{ nope");
    await expect(fix(root)).rejects.toBeInstanceOf(ToolFailure);
  });
});

describe("pnpm new:module", () => {
  test("the template passes every rule, Biome and tsc", async () => {
    expect(
      analyzeSource("src/modules/demo.ts", moduleSource()).findings
    ).toEqual([]);
    const root = makeRepo({ "src/modules/demo.ts": moduleSource() });
    expect((await format.run(ctx(root))).findings).toEqual([]);
    expect((await lint.run(ctx(root))).findings).toEqual([]);
  });

  function run(root: string, ...args: string[]) {
    const proc = Bun.spawnSync(
      [process.execPath, "bin/new-module.ts", ...args],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    return {
      code: proc.exitCode,
      out: `${proc.stdout}${proc.stderr}`,
    };
  }

  test("validates the name and refuses to overwrite", () => {
    const root = makeRepo({ "src/modules/existing.ts": "// mine\n" });
    cpSync(path.join(REPO, "bin"), path.join(root, "bin"), {
      recursive: true,
      filter: (source) => !source.includes("fixtures"),
    });

    expect(run(root).code).toBe(1);
    expect(run(root, "CamelCase").code).toBe(1);
    expect(run(root, "snake_case").code).toBe(1);
    expect(run(root, "module").code).toBe(1);
    expect(run(root, "existing").code).toBe(1);
    expect(
      readFileSync(path.join(root, "src/modules/existing.ts"), "utf8")
    ).toBe("// mine\n");

    const made = run(root, "hero-video");
    expect(made.code).toBe(0);
    expect(made.out).toContain('data-module="hero-video"');
    expect(existsSync(path.join(root, "src/modules/hero-video.ts"))).toBe(true);
    expect(run(root, "hero-video").code).toBe(1);
  });
});
