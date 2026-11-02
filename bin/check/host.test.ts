import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HEADERS_FILE } from "../build";
import { type HostDeps, makeHost } from "./host";
import { ToolFailure } from "./types";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const VERCEL = {
  headers: [
    {
      source: "/(.*)",
      headers: [
        { key: "Access-Control-Allow-Origin", value: "*" },
        { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
        { key: "Access-Control-Allow-Headers", value: "Content-Type" },
      ],
    },
    {
      source: "/(.*\\.glb)",
      headers: [{ key: "Content-Type", value: "model/gltf-binary" }],
    },
    {
      source: "/(.*\\.gltf)",
      headers: [{ key: "Content-Type", value: "model/gltf+json" }],
    },
  ],
};

const CONFIG = {
  host: "cloudflare",
  name: "acme",
  deployUrl: "https://acme.itsoffbrand.dev",
  mediaUrl: null,
  previewHostSuffix: "-acme.team.workers.dev",
};

const WRANGLER = `{
  // comments are allowed
  "name": "acme",
  "main": ".generated/worker.ts",
  "assets": { "directory": "./dist", "run_worker_first": ["/api/*"] },
  "routes": [{ "pattern": "acme.itsoffbrand.dev", "custom_domain": true }],
}`;

/** A built repo. `null` removes a default file. */
function repo(files: Record<string, string | object | null> = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), "host-check-"));
  dirs.push(root);
  const defaults: Record<string, string | object | null> = {
    "dist/build-manifest.json": "{}",
    "dist/_headers": HEADERS_FILE,
    ".generated/worker.ts": "export default {};",
    "vercel.json": VERCEL,
    "wrangler.jsonc": WRANGLER,
    "project.config.json": CONFIG,
    "api/test.ts": "export function GET() { return new Response('x'); }",
  };
  for (const [name, content] of Object.entries({ ...defaults, ...files })) {
    if (content === null) continue;
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      typeof content === "string" ? content : JSON.stringify(content)
    );
  }
  return root;
}

const calls: string[] = [];
let serveOptions: { api?: boolean } | undefined;
const deps: HostDeps = {
  dryRun: async () => {
    calls.push("dryRun");
    return { ok: true, message: "" };
  },
  serve: async (_root, _files, options) => {
    calls.push("serve");
    serveOptions = options;
    return [];
  },
};
const host = makeHost(deps);

async function findings(root: string) {
  calls.length = 0;
  return (await host.run({ root, all: true })).findings;
}
const summary = async (root: string) =>
  (await findings(root)).map((f) => `${f.severity} ${f.rule} ${f.file}`).sort();

describe("host: no project.config.json", () => {
  test("is a pass with a warning, and still checks the API", async () => {
    const root = repo({ "project.config.json": null });
    const result = await host.run({ root, all: true });
    expect(result.ok).toBe(true);
    expect(result.findings.map((f) => `${f.severity} ${f.rule}`)).toEqual([
      "warning host/not-connected",
    ]);
    expect(calls).toEqual([]);
  });

  test("an API problem still fails", async () => {
    const root = repo({
      "project.config.json": null,
      "api/bad.ts": "export const foo = 1;",
    });
    expect(await summary(root)).toEqual([
      "error host/api-export api/bad.ts",
      "warning host/not-connected project.config.json",
    ]);
  });
});

describe("host: api/*.ts", () => {
  test("helpers, tests and subfolders are skipped like the Worker generator skips them", async () => {
    const root = repo({
      "api/_helper.ts": "export const foo = 1;",
      "api/x.test.ts": "export const foo = 1;",
      "api/types.d.ts": "export const foo = 1;",
      "api/utils/shared.ts": "export const foo = 1;",
    });
    expect(await summary(root)).toEqual([]);
  });

  test("an export named foo fails, naming the file and line", async () => {
    const root = repo({
      "api/bad.ts": "export function GET() {}\nexport const foo = 1;",
    });
    const [finding] = await findings(root);
    expect(finding?.file).toBe("api/bad.ts");
    expect(finding?.line).toBe(2);
    expect(finding?.message).toContain('"foo"');
  });
});

describe("host: project.config.json", () => {
  test("an invalid file is a finding and stops host-specific checks", async () => {
    const root = repo({
      "project.config.json": { ...CONFIG, name: "Not Valid" },
    });
    expect(await summary(root)).toEqual([
      "error host/config project.config.json",
    ]);
  });

  test("invalid JSON is a finding too", async () => {
    expect(await summary(repo({ "project.config.json": "{" }))).toEqual([
      "error host/config project.config.json",
    ]);
  });
});

describe("host: cloudflare", () => {
  test("a matching setup passes and runs the dry run and local serving", async () => {
    expect(await summary(repo())).toEqual([]);
    expect(calls).toEqual(["dryRun", "serve"]);
  });

  test("without api/test.ts static serving still runs, and only the /api/test probes are skipped, with a warning", async () => {
    const root = repo({ "api/test.ts": null });
    expect(await summary(root)).toEqual([
      "warning host/serving-skipped api/test.ts",
    ]);
    expect(calls).toEqual(["dryRun", "serve"]);
    expect(serveOptions).toEqual({ api: false });
  });

  test("a wrong name in wrangler.jsonc fails", async () => {
    const root = repo({
      "wrangler.jsonc": WRANGLER.replace('"acme"', '"other"'),
    });
    const [finding] = await findings(root);
    expect(finding?.rule).toBe("host/wrangler");
    expect(finding?.message).toContain('"other"');
  });

  test("a wrong custom domain fails, and so does a route that isn't a custom domain", async () => {
    const wrong = repo({
      "wrangler.jsonc": WRANGLER.replace(
        "acme.itsoffbrand.dev",
        "x.example.com"
      ),
    });
    expect((await findings(wrong))[0]?.message).toContain(
      "acme.itsoffbrand.dev"
    );
    const plain = repo({
      "wrangler.jsonc": WRANGLER.replace(
        '"custom_domain": true',
        '"zone_name": "z"'
      ),
    });
    expect(await summary(plain)).toEqual([
      "error host/wrangler wrangler.jsonc",
    ]);
  });

  test("a main or assets directory that isn't the generated Worker and dist fails and skips wrangler", async () => {
    const root = repo({
      "wrangler.jsonc": WRANGLER.replace(
        ".generated/worker.ts",
        "src/worker.ts"
      ).replace("./dist", "./build"),
    });
    expect(await summary(root)).toEqual([
      "error host/wrangler wrangler.jsonc",
      "error host/wrangler wrangler.jsonc",
    ]);
    expect(calls).toEqual([]);
  });

  test("a missing or unparseable wrangler.jsonc fails", async () => {
    expect(await summary(repo({ "wrangler.jsonc": null }))).toEqual([
      "error host/wrangler wrangler.jsonc",
    ]);
    expect(await summary(repo({ "wrangler.jsonc": "{ nope" }))).toEqual([
      "error host/wrangler wrangler.jsonc",
    ]);
  });

  test("a Worker the build did not generate fails", async () => {
    expect(await summary(repo({ ".generated/worker.ts": null }))).toEqual([
      "error host/worker .generated/worker.ts",
    ]);
  });

  test("a _headers rule that differs from vercel.json fails", async () => {
    const broken = HEADERS_FILE.replace(
      "model/gltf-binary",
      "application/octet-stream"
    );
    const root = repo({ "dist/_headers": broken });
    const result = await findings(root);
    expect(result.map((f) => f.rule)).toEqual(["host/headers"]);
    expect(result[0]?.message).toContain("/*.glb");
  });

  test("a build that wrote no _headers fails", async () => {
    expect(await summary(repo({ "dist/_headers": null }))).toEqual([
      "error host/headers dist/_headers",
    ]);
  });

  test("a failing dry run and a failing serving row are findings", async () => {
    const failing = makeHost({
      dryRun: async () => ({ ok: false, message: "bad config" }),
      serve: async () => [
        { request: "GET /app.js", expected: "200", actual: "404", ok: false },
      ],
    });
    const result = await failing.run({ root: repo(), all: true });
    expect(result.findings.map((f) => f.rule)).toEqual([
      "host/dry-run",
      "host/serving",
    ]);
    expect(result.findings[1]?.message).toContain("GET /app.js");
  });

  test("a build that failed is a tool failure", async () => {
    const root = repo({ "dist/build-manifest.json": null });
    await expect(host.run({ root, all: true })).rejects.toBeInstanceOf(
      ToolFailure
    );
  });
});

describe("host: vercel", () => {
  const vercel = {
    ".generated/worker.ts": null,
    "project.config.json": {
      ...CONFIG,
      host: "vercel",
      deployUrl: "https://acme.vercel.app",
    },
  };

  test("a clean build passes without running wrangler", async () => {
    expect(
      await summary(
        repo({ ...vercel, "dist/_headers": null, "wrangler.jsonc": null })
      )
    ).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("vercel.json is required", async () => {
    expect(
      await summary(
        repo({ ...vercel, "dist/_headers": null, "vercel.json": null })
      )
    ).toEqual(["error host/vercel vercel.json"]);
  });

  test("a _headers or .generated left in a Vercel build fails", async () => {
    const root = repo({ ...vercel, ".generated/worker.ts": "x" });
    expect(await summary(root)).toEqual([
      "error host/vercel .generated",
      "error host/vercel dist/_headers",
    ]);
  });
});
