import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { listApiRoutes } from "../generate-worker";
import { type ProjectConfig, readProjectConfig } from "../project-config";
import { apiExportProblems } from "./api-exports";
import { listFiles } from "./bundle";
import { buildBlocked, requireBuild } from "./build";
import {
  diffRules,
  parseHeadersFile,
  type VercelHeaderEntry,
  vercelRules,
} from "./headers";
import { type Row, runServeChecks } from "./serve-check";
import { type Check, type Finding, toResult } from "./types";
import { dryRun, makeSandbox } from "./wrangler";

const WORKER_FILE = ".generated/worker.ts";

type Draft = Omit<Finding, "severity" | "line"> & {
  line?: number;
  severity?: Finding["severity"];
};

function readJsonc(file: string): { value?: any; error?: string } {
  try {
    return { value: Bun.JSONC.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    return { error: (error as Error).message.split("\n")[0] };
  }
}

/** Does the path (relative to the repo) point at `expected` once resolved? */
const sameFile = (root: string, actual: unknown, expected: string) =>
  typeof actual === "string" &&
  path.resolve(root, actual) === path.resolve(root, expected);

async function checkApi(root: string, add: (finding: Draft) => void) {
  for (const name of await listApiRoutes(path.join(root, "api"))) {
    const file = `api/${name}.ts`;
    const source = readFileSync(path.join(root, file), "utf8");
    for (const problem of apiExportProblems(file, source)) {
      add({
        rule: "host/api-export",
        file,
        line: problem.line,
        message: `${file} ${problem.message}`,
        fix: `Export only ${"GET, HEAD, POST, PUT, PATCH, DELETE or OPTIONS"} from api/*.ts. Move shared code to api/_${name}.ts or api/utils/ and import it`,
      });
    }
  }
}

function checkHeaders(root: string, add: (finding: Draft) => void) {
  const vercelFile = path.join(root, "vercel.json");
  const headersFile = path.join(root, "dist", "_headers");
  if (!existsSync(headersFile)) {
    add({
      rule: "host/headers",
      file: "dist/_headers",
      message:
        "dist/_headers was not written by the build, so Cloudflare would serve no CORS headers",
      fix: "Make bin/build.ts write dist/_headers when host is cloudflare, then run pnpm build",
    });
    return;
  }
  const parsed = readJsonc(vercelFile);
  if (parsed.error || !parsed.value) {
    add({
      rule: "host/headers",
      file: "vercel.json",
      message: `vercel.json can't be read, so dist/_headers has nothing to match (${parsed.error ?? "missing"})`,
      fix: "Restore vercel.json: it is the source of the CORS and .glb/.gltf rules",
    });
    return;
  }
  const entries: VercelHeaderEntry[] = parsed.value.headers ?? [];
  const expected = vercelRules(entries);
  for (const source of expected.unsupported) {
    add({
      rule: "host/headers",
      file: "vercel.json",
      message: `vercel.json header source "${source}" uses a pattern this check can't compare with dist/_headers`,
      fix: "Use only /(.*) and /(.*\\.ext) sources in vercel.json, or extend bin/check/headers.ts",
    });
  }
  const actual = parseHeadersFile(readFileSync(headersFile, "utf8"));
  for (const problem of diffRules(expected.rules, actual)) {
    add({
      rule: "host/headers",
      file: "dist/_headers",
      message: `dist/_headers does not match vercel.json: ${problem}`,
      fix: "Keep HEADERS_FILE in bin/build.ts identical to the rules in vercel.json, then run pnpm build",
    });
  }
}

/** The two wrangler runs, injectable so unit tests don't start wrangler. */
export interface HostDeps {
  dryRun: typeof dryRun;
  serve: typeof runServeChecks;
}

async function checkCloudflare(
  root: string,
  config: ProjectConfig,
  add: (finding: Draft) => void,
  deps: HostDeps
) {
  const wranglerPath = path.join(root, "wrangler.jsonc");
  if (!existsSync(wranglerPath)) {
    add({
      rule: "host/wrangler",
      file: "wrangler.jsonc",
      message:
        "wrangler.jsonc is missing, so Workers Builds has nothing to deploy",
      fix: "Run pnpm connect cloudflare",
    });
    return;
  }
  const wrangler = readJsonc(wranglerPath);
  if (
    wrangler.error ||
    typeof wrangler.value !== "object" ||
    wrangler.value === null
  ) {
    add({
      rule: "host/wrangler",
      file: "wrangler.jsonc",
      message: `wrangler.jsonc can't be parsed: ${wrangler.error ?? "it is not an object"}`,
      fix: "Fix the JSONC syntax in wrangler.jsonc, or run pnpm connect cloudflare to rewrite it",
    });
    return;
  }
  const w = wrangler.value;
  let usable = true;

  if (w.name !== config.name) {
    add({
      rule: "host/wrangler",
      file: "wrangler.jsonc",
      message: `wrangler.jsonc name is ${JSON.stringify(w.name)}, but project.config.json name is "${config.name}"`,
      fix: `Set name to "${config.name}" in wrangler.jsonc, or run pnpm connect cloudflare`,
    });
  }

  const domain = new URL(config.deployUrl).hostname;
  const routes: unknown[] = [
    ...(Array.isArray(w.routes) ? w.routes : []),
    ...(w.route ? [w.route] : []),
  ];
  const hasDomain = routes.some(
    (route) =>
      typeof route === "object" &&
      route !== null &&
      (route as any).custom_domain === true &&
      (route as any).pattern === domain
  );
  if (!hasDomain) {
    add({
      rule: "host/wrangler",
      file: "wrangler.jsonc",
      message: `wrangler.jsonc has no custom_domain route for ${domain}, the deployUrl host in project.config.json`,
      fix: `Add { "pattern": "${domain}", "custom_domain": true } to routes in wrangler.jsonc`,
    });
  }
  if (!sameFile(root, w.main, WORKER_FILE)) {
    usable = false;
    add({
      rule: "host/wrangler",
      file: "wrangler.jsonc",
      message: `wrangler.jsonc main is ${JSON.stringify(w.main)}, not ${WORKER_FILE}`,
      fix: `Set "main" to "${WORKER_FILE}"`,
    });
  }
  if (!sameFile(root, w.assets?.directory, "dist")) {
    usable = false;
    add({
      rule: "host/wrangler",
      file: "wrangler.jsonc",
      message: `wrangler.jsonc assets.directory is ${JSON.stringify(w.assets?.directory)}, not ./dist`,
      fix: 'Set "assets": { "directory": "./dist" }',
    });
  }

  if (!existsSync(path.join(root, WORKER_FILE))) {
    usable = false;
    add({
      rule: "host/worker",
      file: WORKER_FILE,
      message: `${WORKER_FILE} was not generated by the build, so the API routes would not be deployed`,
      fix: "Make bin/build.ts run generateWorker() when host is cloudflare, then run pnpm build",
    });
  }

  checkHeaders(root, add);

  if (!usable) return;

  const sandbox = makeSandbox(root);
  try {
    const result = await deps.dryRun(root, sandbox.dir);
    if (!result.ok) {
      add({
        rule: "host/dry-run",
        file: "wrangler.jsonc",
        message: `wrangler deploy --dry-run failed: ${result.message}`,
        fix: "Run ./node_modules/.bin/wrangler deploy --dry-run and fix what it reports",
      });
    }
  } finally {
    sandbox.cleanup();
  }

  // Static files are always probed. Only the template's own api/test.ts probes
  // depend on that file, and skipping them is said out loud.
  const api = existsSync(path.join(root, "api", "test.ts"));
  if (!api) {
    add({
      severity: "warning",
      rule: "host/serving-skipped",
      file: "api/test.ts",
      message:
        "api/test.ts does not exist, so the /api/test probes (GET, OPTIONS, POST and HEAD) were skipped. Static files and /api/nope were still checked",
      fix: "Restore api/test.ts from the template if the API routes should be covered by this check",
    });
  }
  const rows: Row[] = await deps.serve(
    root,
    listFiles(path.join(root, "dist")),
    {
      api,
    }
  );
  for (const row of rows.filter((r) => !r.ok)) {
    add({
      rule: "host/serving",
      file: "wrangler.jsonc",
      message: `wrangler dev: ${row.request} should give ${row.expected}, but gave ${row.actual}`,
      fix: "Run ./node_modules/.bin/bun run bin/check/serve-check.ts for the full table, then fix dist/_headers, the Worker router or wrangler.jsonc",
    });
  }
}

function checkVercel(root: string, add: (finding: Draft) => void) {
  const vercelFile = path.join(root, "vercel.json");
  if (!existsSync(vercelFile)) {
    add({
      rule: "host/vercel",
      file: "vercel.json",
      message:
        "vercel.json is missing, so Vercel would not build with pnpm build or add CORS headers",
      fix: "Restore vercel.json from the template",
    });
  } else if (readJsonc(vercelFile).error) {
    add({
      rule: "host/vercel",
      file: "vercel.json",
      message: `vercel.json can't be parsed: ${readJsonc(vercelFile).error}`,
      fix: "Fix the JSON syntax in vercel.json",
    });
  }
  for (const leftover of ["dist/_headers", "dist/.generated", ".generated"]) {
    if (existsSync(path.join(root, leftover))) {
      add({
        rule: "host/vercel",
        file: leftover,
        message: `${leftover} exists in a Vercel build, and would be served or deployed publicly`,
        fix: "Only write dist/_headers and .generated/ when host is cloudflare in bin/build.ts",
      });
    }
  }
}

export function makeHost(
  deps: HostDeps = { dryRun, serve: runServeChecks }
): Check {
  return {
    name: "host",
    tier: "all",
    async run({ root }) {
      const blocked = buildBlocked(root, "host");
      if (blocked) return blocked;
      requireBuild(root);
      const findings: Finding[] = [];
      const add = (draft: Draft) =>
        findings.push({ severity: "error", line: 1, ...draft });

      await checkApi(root, add);

      let config: ProjectConfig | null = null;
      try {
        config = readProjectConfig(root);
      } catch (error) {
        add({
          rule: "host/config",
          file: "project.config.json",
          message: (error as Error).message,
          fix: "Fix project.config.json, or run pnpm connect cloudflare or pnpm connect vercel to rewrite it",
        });
        return toResult("host", findings);
      }

      if (!config) {
        add({
          severity: "warning",
          rule: "host/not-connected",
          file: "project.config.json",
          message:
            "project.config.json does not exist: the project is not connected to a host, so only the API exports were checked",
          fix: "Run pnpm connect cloudflare or pnpm connect vercel, then run pnpm check:all again",
        });
        return toResult("host", findings);
      }

      if (config.host === "cloudflare") {
        await checkCloudflare(root, config, add, deps);
      } else checkVercel(root, add);
      return toResult("host", findings);
    },
  };
}

export const host = makeHost();
