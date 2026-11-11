import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HEADERS_FILE } from "./build";

const BUILD = resolve(import.meta.dir, "build.ts");

const config = (host: "cloudflare" | "vercel") => ({
  host,
  name: "acme",
  deployUrl:
    host === "cloudflare"
      ? "https://acme.itsoffbrand.dev"
      : "https://acme.vercel.app",
  mediaUrl: null,
  previewHostSuffix: "-acme.team.workers.dev",
});

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "build-"));
  mkdirSync(join(dir, "src", "styles"), { recursive: true });
  mkdirSync(join(dir, "api"));
  // Uses the real helper, so the origin define ends up in the bundle.
  writeFileSync(
    join(dir, "src", "app.ts"),
    `import { PUBLIC_ASSET_ORIGIN } from ${JSON.stringify(resolve(import.meta.dir, "..", "src/utils/public-asset.ts"))};
console.log(PUBLIC_ASSET_ORIGIN);
`
  );
  writeFileSync(join(dir, "src", "styles", "app.css"), "body{margin:0}\n");
  writeFileSync(
    join(dir, "api", "test.ts"),
    "export const GET = () => new Response('x');\n"
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the real production build in the temp project. */
function build(
  env: Record<string, string> = {},
  host?: "cloudflare" | "vercel"
) {
  if (host)
    writeFileSync(
      join(dir, "project.config.json"),
      JSON.stringify(config(host))
    );
  const clean = { ...process.env };
  for (const k of ["VERCEL", "VERCEL_URL", "WORKERS_CI", "PUBLIC_ASSET_ORIGIN"])
    delete clean[k];
  const proc = Bun.spawnSync(["bun", "run", BUILD], {
    cwd: dir,
    env: { ...clean, NODE_ENV: "production", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode,
    out: proc.stdout.toString() + proc.stderr.toString(),
    js: () => readFileSync(join(dir, "dist", "app.js"), "utf8"),
    manifest: () =>
      JSON.parse(
        readFileSync(join(dir, "dist", "build-manifest.json"), "utf8")
      ),
  };
}

describe("_headers", () => {
  test("carries the same rules as vercel.json", () => {
    const vercel = JSON.parse(
      readFileSync(resolve(import.meta.dir, "..", "vercel.json"), "utf8")
    );
    const rules = Object.fromEntries(
      vercel.headers.map((h: any) => [
        h.source.replace(/\(\.\*(.*)\)$/, "*$1").replace(/\\\./g, "."),
        Object.fromEntries(h.headers.map((x: any) => [x.key, x.value])),
      ])
    );
    const parsed: Record<string, Record<string, string>> = {};
    let current = "";
    for (const line of HEADERS_FILE.split("\n")) {
      if (!line.trim()) continue;
      if (!line.startsWith(" ")) {
        current = line;
        parsed[current] = {};
      } else {
        const [key, ...value] = line.trim().split(": ");
        parsed[current][key] = value.join(": ");
      }
    }
    expect(parsed).toEqual(rules);
  });
});

describe("pnpm build", () => {
  test("cloudflare writes dist/_headers and the worker router", () => {
    const b = build({}, "cloudflare");
    expect(b.code).toBe(0);
    expect(readFileSync(join(dir, "dist", "_headers"), "utf8")).toBe(
      HEADERS_FILE
    );
    const worker = readFileSync(join(dir, ".generated", "worker.ts"), "utf8");
    expect(worker).toContain('"/api/test"');
    expect(b.js()).toContain("https://acme.itsoffbrand.dev");
    expect(b.manifest().distFiles.map((f: any) => f.path)).not.toContain(
      "_headers"
    );
  });

  test("vercel writes neither", () => {
    const b = build({}, "vercel");
    expect(b.code).toBe(0);
    expect(existsSync(join(dir, "dist", "_headers"))).toBe(false);
    expect(existsSync(join(dir, ".generated"))).toBe(false);
    expect(b.js()).toContain("https://acme.vercel.app");
  });

  test("no config writes neither and warns", () => {
    const b = build();
    expect(b.code).toBe(0);
    expect(existsSync(join(dir, "dist", "_headers"))).toBe(false);
    expect(existsSync(join(dir, ".generated"))).toBe(false);
    expect(b.out).toContain("pnpm connect");
  });

  test("no config on Workers Builds fails", () => {
    const b = build({ WORKERS_CI: "1" });
    expect(b.code).not.toBe(0);
    expect(b.out).toContain("pnpm connect cloudflare");
  });

  test("no config on Vercel bakes in the automatic VERCEL_URL", () => {
    const b = build({ VERCEL: "1", VERCEL_URL: "x.vercel.app" });
    expect(b.code).toBe(0);
    expect(b.js()).toContain("https://x.vercel.app");
  });

  test("an invalid config fails the build", () => {
    writeFileSync(
      join(dir, "project.config.json"),
      JSON.stringify({ host: "netlify" })
    );
    const b = build();
    expect(b.code).not.toBe(0);
    expect(b.out).toContain("project.config.json is invalid");
  });

  test("the manifest has paths relative to dist and the commit", () => {
    const b = build(
      { WORKERS_CI_COMMIT_SHA: "abc123abc123abc123abc123abc123abc123abc1" },
      "cloudflare"
    );
    const m = b.manifest();
    expect(m.commit).toBe("abc123abc123abc123abc123abc123abc123abc1");
    expect(m.javascript.files.map((f: any) => f.path)).toContain("app.js");
    expect(m.css.files.map((f: any) => f.path)).toEqual(["app.css"]);
    for (const f of [...m.javascript.files, ...m.css.files]) {
      expect(f.path.startsWith("/")).toBe(false);
    }
  });

  test("the manifest commit falls back to Vercel's, then null", () => {
    expect(
      build(
        { VERCEL_GIT_COMMIT_SHA: "def456def456def456def456def456def456def4" },
        "vercel"
      ).manifest().commit
    ).toBe("def456def456def456def456def456def456def4");
    expect(build({}, "vercel").manifest().commit).toBeNull();
  });
});

describe("buildCommit", () => {
  const { buildCommit } = require("./manifest") as typeof import("./manifest");
  const sha = "4c9adbbf993358274f410a9850b6cafcc6bb4e90";
  test("uses the host's hash", () => {
    expect(buildCommit({ WORKERS_CI_COMMIT_SHA: sha }, () => undefined)).toBe(
      sha
    );
    expect(buildCommit({ VERCEL_GIT_COMMIT_SHA: sha }, () => undefined)).toBe(
      sha
    );
  });
  test("a branch name in the variable falls back to git in CI", () => {
    expect(
      buildCommit({ WORKERS_CI: "1", WORKERS_CI_COMMIT_SHA: "main" }, () => sha)
    ).toBe(sha);
  });
  test("outside CI, or with nothing usable, it's null", () => {
    expect(buildCommit({}, () => sha)).toBeNull();
    expect(
      buildCommit({ WORKERS_CI: "1", WORKERS_CI_COMMIT_SHA: "main" }, () => "")
    ).toBeNull();
  });
});
