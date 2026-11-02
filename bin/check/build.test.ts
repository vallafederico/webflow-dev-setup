import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, requireBuild } from "./build";
import { ToolFailure } from "./types";

const REPO = path.resolve(import.meta.dir, "..", "..");
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** A repo whose bin/build.ts is the given script, with the real bun linked in. */
function repo(script: string, files: Record<string, string> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "build-check-"));
  dirs.push(root);
  symlinkSync(path.join(REPO, "node_modules"), path.join(root, "node_modules"));
  mkdirSync(path.join(root, "bin"));
  writeFileSync(path.join(root, "bin", "build.ts"), script);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  return root;
}

const GOOD = `
  import { mkdirSync, writeFileSync } from "node:fs";
  mkdirSync("dist", { recursive: true });
  writeFileSync("dist/app.js", process.env.NODE_ENV ?? "");
  writeFileSync("dist/build-manifest.json", JSON.stringify({ javascript: { files: [{ path: "app.js" }] } }));
`;

describe("the build check", () => {
  test("runs the build in production mode and passes", async () => {
    const root = repo(GOOD);
    const result = await build.run({ root, all: true });
    expect(result.ok).toBe(true);
    expect(await Bun.file(path.join(root, "dist/app.js")).text()).toBe(
      "production"
    );
    expect(() => requireBuild(root)).not.toThrow();
  });

  test("deletes stale output first, so a file the build stopped making can't keep passing", async () => {
    const root = repo(GOOD, {
      "dist/stale.js": "old",
      ".generated/worker.ts": "old",
    });
    await build.run({ root, all: true });
    expect(await Bun.file(path.join(root, "dist/stale.js")).exists()).toBe(
      false
    );
    expect(
      await Bun.file(path.join(root, ".generated/worker.ts")).exists()
    ).toBe(false);
  });

  test("a failing build is a finding that names the file, and later checks refuse to read dist/", async () => {
    const root = repo(
      'console.error("error: bad thing in src/modules/x.ts:3"); process.exit(1);',
      { "dist/build-manifest.json": "{}" }
    );
    const result = await build.run({ root, all: true });
    expect(result.ok).toBe(false);
    expect(result.findings[0]).toMatchObject({
      rule: "build/failed",
      file: "src/modules/x.ts",
    });
    expect(() => requireBuild(root)).toThrow(ToolFailure);
  });

  test("exit 0 without a manifest or an entry is still a failure", async () => {
    expect(
      (await build.run({ root: repo("// does nothing"), all: true })).ok
    ).toBe(false);
    const empty = repo(
      'import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("dist"); writeFileSync("dist/build-manifest.json", "{}");'
    );
    expect(
      (await build.run({ root: empty, all: true })).findings[0]?.message
    ).toContain("no JavaScript entry");
  });

  test("a manifest entry that was not written is reported", async () => {
    const root = repo(
      'import { mkdirSync, writeFileSync } from "node:fs"; mkdirSync("dist"); writeFileSync("dist/build-manifest.json", JSON.stringify({ javascript: { files: [{ path: "gone.js" }] } }));'
    );
    expect(
      (await build.run({ root, all: true })).findings[0]?.message
    ).toContain("dist/gone.js");
  });
});

describe("requireBuild", () => {
  test("with no build recorded, it needs a manifest on disk", () => {
    const root = repo("");
    expect(() => requireBuild(root)).toThrow(ToolFailure);
    mkdirSync(path.join(root, "dist"));
    writeFileSync(path.join(root, "dist/build-manifest.json"), "{}");
    expect(() => requireBuild(root)).not.toThrow();
  });
});
