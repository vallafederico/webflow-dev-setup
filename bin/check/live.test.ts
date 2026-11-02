import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type LiveDeps, main, parseArgs, parseDuration } from "./live";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface World {
  /** git answers by subcommand. */
  status?: string;
  head?: string;
  upstream?: string | null;
  branch?: string;
  /** url -> response factory, or a list of them used in order. */
  routes: Record<string, () => Response | Promise<Response>>;
}

const manifest = (commit: string | null, extra: object = {}) =>
  Response.json({
    commit,
    javascript: {
      files: [
        { path: "app.js" },
        { path: "pages/about.js" },
        { path: "app.js.map" },
      ],
    },
    css: { files: [{ path: "app.css" }] },
    ...extra,
  });

const ok =
  (type: string, cors: string | null = "*") =>
  () =>
    new Response("body", {
      headers: {
        "content-type": type,
        ...(cors === null ? {} : { "access-control-allow-origin": cors }),
      },
    });

const FILES = {
  "https://acme.example.com/app.js": ok("text/javascript; charset=utf-8"),
  "https://acme.example.com/pages/about.js": ok("application/javascript"),
  "https://acme.example.com/app.css": ok("text/css"),
};

function run(
  world: World,
  argv: string[],
  configUrl: string | null = "https://acme.example.com"
) {
  const root = mkdtempSync(path.join(tmpdir(), "live-check-"));
  dirs.push(root);
  if (configUrl) {
    writeFileSync(
      path.join(root, "project.config.json"),
      JSON.stringify({
        host: "cloudflare",
        name: "acme",
        deployUrl: configUrl,
        mediaUrl: null,
        previewHostSuffix: "-acme.team.workers.dev",
      })
    );
  }
  let clock = 0;
  const fetched: string[] = [];
  const deps: Partial<LiveDeps> = {
    git: async (args) => {
      const key = args.join(" ");
      if (key === "status --porcelain")
        return { code: 0, stdout: world.status ?? "" };
      if (key === "rev-parse HEAD")
        return { code: 0, stdout: `${world.head ?? HEAD}\n` };
      if (key === "rev-parse @{u}") {
        return world.upstream === null
          ? { code: 128, stdout: "" }
          : { code: 0, stdout: `${world.upstream ?? world.head ?? HEAD}\n` };
      }
      if (key === "rev-parse --abbrev-ref HEAD")
        return { code: 0, stdout: `${world.branch ?? "main"}\n` };
      throw new Error(`unexpected git ${key}`);
    },
    fetch: async (url) => {
      fetched.push(url);
      const route = world.routes[url];
      if (!route) return new Response("nope", { status: 404 });
      return route();
    },
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
  return quietMain(argv, { deps, root }).then((result) => ({
    ...result,
    fetched,
    elapsed: clock,
  }));
}

/** Runs `main` with stdout and stderr captured, so the suite's own output stays clean. */
async function quietMain(...args: Parameters<typeof main>) {
  const out: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const sink = ((chunk: string) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = sink;
  process.stderr.write = sink;
  try {
    return { code: await main(...args), out: out.join("") };
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}

const MANIFEST_URL = "https://acme.example.com/build-manifest.json";

describe("pnpm check:live", () => {
  test("a deployment of HEAD with good files passes", async () => {
    const result = await run(
      { routes: { [MANIFEST_URL]: () => manifest(HEAD), ...FILES } },
      ["--json"]
    );
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toEqual({
      ok: true,
      checks: [{ name: "live", ok: true, findings: [] }],
    });
    // The map is not a served entry, the others are all fetched.
    expect(
      result.fetched.filter((u) => !u.endsWith("build-manifest.json"))
    ).toEqual([
      "https://acme.example.com/app.js",
      "https://acme.example.com/pages/about.js",
      "https://acme.example.com/app.css",
    ]);
  });

  test("an older commit fails after the timeout, naming both commits", async () => {
    const result = await run(
      { routes: { [MANIFEST_URL]: () => manifest(OLD) } },
      ["--json", "--timeout", "30"]
    );
    expect(result.code).toBe(1);
    const [finding] = JSON.parse(result.out).checks[0].findings;
    expect(finding.rule).toBe("live/stale");
    expect(finding.message).toContain(OLD);
    expect(finding.message).toContain(HEAD);
    expect(result.elapsed).toBe(30_000);
  });

  test("retries until the deployment catches up", async () => {
    let calls = 0;
    const result = await run(
      {
        routes: {
          [MANIFEST_URL]: () => manifest(++calls < 4 ? OLD : HEAD),
          ...FILES,
        },
      },
      ["--json"]
    );
    expect(result.code).toBe(0);
    expect(calls).toBe(4);
    expect(result.elapsed).toBe(15_000);
  });

  test("a null commit is its own clear finding", async () => {
    const result = await run(
      { routes: { [MANIFEST_URL]: () => manifest(null) } },
      ["--json", "--timeout", "10"]
    );
    expect(result.code).toBe(1);
    const [finding] = JSON.parse(result.out).checks[0].findings;
    expect(finding.rule).toBe("live/no-commit");
    expect(finding.message).toContain("null");
  });

  test("an unreachable deployment fails with the reason", async () => {
    const result = await run({ routes: {} }, ["--json", "--timeout", "5"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).checks[0].findings[0].message).toContain(
      "build-manifest.json returned 404"
    );
  });

  test("a file with the wrong status, type or CORS header is named", async () => {
    const result = await run(
      {
        routes: {
          [MANIFEST_URL]: () => manifest(HEAD),
          "https://acme.example.com/app.js": ok("text/html"),
          "https://acme.example.com/pages/about.js": () =>
            new Response("", { status: 404 }),
          "https://acme.example.com/app.css": ok("text/css", null),
        },
      },
      ["--json"]
    );
    expect(result.code).toBe(1);
    const findings = JSON.parse(result.out).checks[0].findings;
    expect(
      findings.map((f: { rule: string; file: string }) => `${f.rule} ${f.file}`)
    ).toEqual([
      "live/cors app.css",
      "live/content-type app.js",
      "live/file-status pages/about.js",
    ]);
  });

  test("an absolute path in the manifest is reported, not fetched", async () => {
    const result = await run(
      {
        routes: {
          [MANIFEST_URL]: () =>
            manifest(HEAD, {
              javascript: { files: [{ path: "/Users/me/dist/app.js" }] },
              css: { files: [] },
            }),
        },
      },
      ["--json"]
    );
    expect(JSON.parse(result.out).checks[0].findings[0].rule).toBe(
      "live/manifest-path"
    );
    expect(result.fetched).toEqual([MANIFEST_URL]);
  });

  test("the manifest is requested without caching", async () => {
    let init: RequestInit | undefined;
    const root = mkdtempSync(path.join(tmpdir(), "live-check-"));
    dirs.push(root);
    await quietMain(["--url", "https://acme.example.com"], {
      root,
      deps: {
        git: async (args) => ({
          code: 0,
          stdout:
            args[0] === "status"
              ? ""
              : args.includes("--abbrev-ref")
                ? "feat\n"
                : `${HEAD}\n`,
        }),
        fetch: async (_url, options) => {
          init = options;
          return manifest(HEAD, {
            javascript: { files: [] },
            css: { files: [] },
          });
        },
        sleep: async () => {},
        now: () => 0,
      },
    });
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toMatchObject({ "cache-control": "no-cache" });
  });
});

describe("pnpm check:live exits 2 without fetching anything", () => {
  const routes = { [MANIFEST_URL]: () => manifest(HEAD), ...FILES };

  test("on a dirty tree", async () => {
    const result = await run({ status: " M src/app.ts\n", routes }, ["--json"]);
    expect(result.code).toBe(2);
    expect(result.fetched).toEqual([]);
    expect(JSON.parse(result.out).checks[0].findings[0].message).toContain(
      "uncommitted"
    );
  });

  test("when HEAD isn't what the upstream has", async () => {
    const result = await run({ upstream: OLD, routes }, ["--json"]);
    expect(result.code).toBe(2);
    expect(result.fetched).toEqual([]);
  });

  test("when the branch has no upstream", async () => {
    expect((await run({ upstream: null, routes }, [])).code).toBe(2);
  });

  test("on a branch other than main without --url", async () => {
    const result = await run({ branch: "feat/x", routes }, ["--json"]);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.out).checks[0].findings[0].message).toContain(
      "feat/x"
    );
    expect(result.fetched).toEqual([]);
  });

  test("on main with no config and no --url", async () => {
    expect((await run({ routes }, [], null)).code).toBe(2);
  });

  test("with an unreadable config", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "live-check-"));
    dirs.push(root);
    writeFileSync(path.join(root, "project.config.json"), "{");
    const { code } = await quietMain([], {
      root,
      deps: {
        git: async (a) => ({
          code: 0,
          stdout:
            a[0] === "status"
              ? ""
              : a.includes("--abbrev-ref")
                ? "main\n"
                : `${HEAD}\n`,
        }),
      },
    });
    expect(code).toBe(2);
  });

  test("with a bad --url, --timeout or option", async () => {
    expect((await run({ routes }, ["--url", "not a url"])).code).toBe(2);
    expect((await run({ routes }, ["--timeout", "soon"])).code).toBe(2);
    expect((await run({ routes }, ["--nope"])).code).toBe(2);
  });
});

describe("branches", () => {
  test("a branch with --url checks that deployment, not deployUrl", async () => {
    const preview = "https://feat-acme.team.workers.dev";
    const result = await run(
      {
        branch: "feat/x",
        routes: {
          [`${preview}/build-manifest.json`]: () => manifest(HEAD),
          [`${preview}/app.js`]: ok("text/javascript"),
          [`${preview}/pages/about.js`]: ok("text/javascript"),
          [`${preview}/app.css`]: ok("text/css"),
        },
      },
      ["--url", `${preview}/`]
    );
    expect(result.code).toBe(0);
    expect(result.fetched.every((u) => u.startsWith(preview))).toBe(true);
  });
});

describe("arguments", () => {
  test("durations", () => {
    expect(parseDuration("300")).toBe(300_000);
    expect(parseDuration("90s")).toBe(90_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("1500ms")).toBe(1500);
    expect(parseDuration("-1")).toBeNull();
  });

  test("defaults to five minutes and accepts --flag=value", () => {
    expect(parseArgs([])).toMatchObject({
      options: { timeoutMs: 300_000 },
      json: false,
    });
    expect(
      parseArgs(["--url=https://x.dev", "--timeout=2m", "--json"])
    ).toMatchObject({
      options: { url: "https://x.dev", timeoutMs: 120_000 },
      json: true,
    });
  });
});
