import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { bundle, budgetFor, gzipSize, parseEnv, readSecrets } from "./bundle";
import { ToolFailure } from "./types";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const HOOK = "https://api.vercel.com/hook/AbCdEfGhIjKlMnOp";
const APP_JS = "console.log('app');\n";

/** A repo with a built dist/. `files` are written under dist/, `env` is the .env. */
function repo(
  files: Record<string, string> = {},
  { env, budgets }: { env?: string; budgets?: Record<string, number> } = {}
): string {
  const root = mkdtempSync(path.join(tmpdir(), "bundle-check-"));
  dirs.push(root);
  const all: Record<string, string> = {
    "app.js": APP_JS,
    "app.js.txt": APP_JS,
    "app.css": "html{}",
    ...files,
  };
  for (const [name, text] of Object.entries(all)) {
    const file = path.join(root, "dist", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const entries = Object.keys(all).filter((n) => /\.(js|css)$/.test(n));
  writeFileSync(
    path.join(root, "dist", "build-manifest.json"),
    JSON.stringify({
      javascript: {
        files: entries
          .filter((n) => n.endsWith(".js"))
          .map((p) => ({ path: p })),
      },
      css: {
        files: entries
          .filter((n) => n.endsWith(".css"))
          .map((p) => ({ path: p })),
      },
    })
  );
  writeFileSync(
    path.join(root, "checks.config.json"),
    JSON.stringify({
      budgets: budgets ?? { "**/*.js": 1000, "**/*.css": 1000 },
    })
  );
  if (env !== undefined) writeFileSync(path.join(root, ".env"), env);
  return root;
}

const run = (root: string) => bundle.run({ root, all: true });
const rules = async (root: string) =>
  (await run(root)).findings.map((f) => `${f.rule} ${f.file}`);

describe("bundle", () => {
  test("a clean build passes", async () => {
    const result = await run(repo());
    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("localhost in a JS, CSS or TXT file fails and names the file", async () => {
    const root = repo(
      {
        "pages/home.js": "fetch('http://localhost:6546/api/x')",
        "pages/home.js.txt": "see http://localhost:6546",
        "other.css": "a{background:url(//LocalHost/x.png)}",
      },
      { budgets: { "**": 1000 } }
    );
    expect(await rules(root)).toEqual([
      "bundle/localhost dist/other.css",
      "bundle/localhost dist/pages/home.js",
      "bundle/localhost dist/pages/home.js.txt",
    ]);
  });

  test("localhost in a source map is fine, since maps aren't served as code", async () => {
    expect(
      await rules(
        repo({ "app.js.map": '{"sources":["http://localhost/a.ts"]}' })
      )
    ).toEqual([]);
  });

  test.each([
    "__PUBLIC_ASSET_ORIGIN__",
    "__MEDIA_ORIGIN__",
    "__API_DEV_ORIGIN__",
    "__PREVIEW_HOST_SUFFIX__",
  ])("a leftover %s fails", async (placeholder) => {
    const root = repo({ "app.js": `const a = ${placeholder};` });
    const findings = (await run(root)).findings;
    expect(findings.map((f) => f.rule)).toEqual(["bundle/placeholder"]);
    expect(findings[0]?.message).toContain(placeholder);
  });

  test("reports the line of the first match", async () => {
    const root = repo({ "app.js": "a\nb\nconst x = 'localhost';" });
    expect((await run(root)).findings[0]?.line).toBe(3);
  });

  test("a secret from .env fails anywhere in dist, maps and binaries included, and the value is never printed", async () => {
    const root = repo(
      {
        "app.js.map": `{"x":"${HOOK}"}`,
        "public/data.bin": `\u0000\u0001${HOOK}\u0002`,
      },
      { env: `VERCEL_DEPLOY_HOOK="${HOOK}"\nUSE_SSL=true\n` }
    );
    const result = await run(root);
    expect(result.findings.map((f) => `${f.rule} ${f.file}`)).toEqual([
      "bundle/secret dist/app.js.map",
      "bundle/secret dist/public/data.bin",
    ]);
    for (const finding of result.findings) {
      expect(finding.message).toContain("VERCEL_DEPLOY_HOOK");
      expect(finding.message + finding.fix).not.toContain("AbCdEfGh");
    }
  });

  test("a JSON-escaped secret in a source map is found too", async () => {
    const secret = 'abc"defghijklmnopqrstuv';
    const root = repo(
      { "app.js.map": JSON.stringify({ v: secret }) },
      { env: `API_TOKEN='${secret}'\n` }
    );
    expect(await rules(root)).toEqual(["bundle/secret dist/app.js.map"]);
  });

  test("only key/hook/token/secret names with 16+ characters count", () => {
    const secrets = readSecrets(
      repo(
        {},
        {
          env: [
            "USE_SSL=true",
            "SHORT_TOKEN=abc123",
            "NAME=aaaaaaaaaaaaaaaaaaaa",
            "# COMMENTED_KEY=aaaaaaaaaaaaaaaaaaaa",
            "export MY_SECRET=bbbbbbbbbbbbbbbbbbbb # trailing",
            "SOME_API_KEY = 'cccccccccccccccc'",
          ].join("\n"),
        }
      )
    );
    expect([...secrets]).toEqual([
      [".env:MY_SECRET", "bbbbbbbbbbbbbbbbbbbb"],
      [".env:SOME_API_KEY", "cccccccccccccccc"],
    ]);
  });

  test("the same name in two env files is two secrets, and both are looked for", async () => {
    const root = repo(
      {
        "a.js": "const a = 'first-value-first-value'",
        "b.js": "const b = 'second-value-second-val'",
      },
      { env: "MY_TOKEN=first-value-first-value\n" }
    );
    writeFileSync(
      path.join(root, ".env.production"),
      "MY_TOKEN=second-value-second-val\n"
    );
    const result = await run(root);
    expect(result.findings.map((f) => `${f.file} ${f.message}`).sort()).toEqual(
      [
        "dist/a.js dist/a.js contains the value of MY_TOKEN from .env",
        "dist/b.js dist/b.js contains the value of MY_TOKEN from .env.production",
      ]
    );
  });

  test("no .env means nothing to scan for", async () => {
    expect(
      await rules(repo({ "x.js": "const t = 'aaaaaaaaaaaaaaaaaaaaaaaa';" }))
    ).toEqual([]);
  });

  test("a bundle over its gzip budget fails with both sizes", async () => {
    const big = Array.from(
      { length: 4000 },
      (_, i) => `v${i}=${Math.sin(i)};`
    ).join("");
    const size = gzipSize(Buffer.from(big));
    const result = await run(
      repo(
        { "app.js": big },
        { budgets: { "app.js": size - 1, "app.css": 1000 } }
      )
    );
    expect(result.findings.map((f) => f.rule)).toEqual(["bundle/over-budget"]);
    expect(result.findings[0]?.message).toContain(`${size} bytes gzipped`);
    expect(result.findings[0]?.message).toContain(
      `budget of ${size - 1} bytes`
    );
  });

  test("a bundle exactly at its budget passes", async () => {
    const size = gzipSize(Buffer.from(APP_JS));
    expect(
      await rules(repo({}, { budgets: { "app.js": size, "app.css": 1000 } }))
    ).toEqual([]);
  });

  test("an entry with no budget fails, so a new page can't skip the check", async () => {
    const root = repo(
      { "pages/new.js": "x" },
      { budgets: { "app.js": 1000, "app.css": 1000 } }
    );
    expect(await rules(root)).toEqual(["bundle/no-budget dist/pages/new.js"]);
  });

  test("an exact budget for a file that wasn't built fails, a glob only warns", async () => {
    const result = await run(
      repo(
        {},
        {
          budgets: {
            "app.js": 1000,
            "app.css": 1000,
            "gone.js": 5,
            "none/*.js": 5,
          },
        }
      )
    );
    expect(result.findings.map((f) => `${f.severity} ${f.rule}`)).toEqual([
      "error bundle/unused-budget",
      "warning bundle/unused-budget",
    ]);
    expect(result.ok).toBe(false);
  });

  test("a missing manifest is a tool failure, not a pass", async () => {
    const root = repo();
    rmSync(path.join(root, "dist", "build-manifest.json"));
    await expect(run(root)).rejects.toBeInstanceOf(ToolFailure);
  });
});

describe("budgetFor", () => {
  const budgets = { "app.js": 1, "pages/*.js": 2, "*.css": 3 };
  test("an exact key wins, then a glob", () => {
    expect(budgetFor(budgets, "app.js")).toEqual({ key: "app.js", bytes: 1 });
    expect(budgetFor(budgets, "pages/about.js")).toEqual({
      key: "pages/*.js",
      bytes: 2,
    });
    expect(budgetFor(budgets, "app.css")).toEqual({ key: "*.css", bytes: 3 });
    expect(budgetFor(budgets, "other.js")).toBeNull();
  });
});

describe("parseEnv", () => {
  test("handles quotes, export, comments and blank lines", () => {
    expect(
      parseEnv("A=\"x y\"\nexport B=1\n\n# c\nC='q'\nD=v # note\nbad line")
    ).toEqual({
      A: "x y",
      B: "1",
      C: "q",
      D: "v",
    });
  });
});
