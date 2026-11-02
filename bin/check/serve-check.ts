import { existsSync } from "node:fs";
import path from "node:path";
import { onTerminate } from "./cleanup";
import { localBin, toolTimeoutMs } from "./tools";
import { ToolFailure } from "./types";
import { addServingFixtures, makeSandbox, wranglerEnv } from "./wrangler";

const READY_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 10_000;

type HeaderRule =
  | { name: string; equals: string }
  | { name: string; startsWith: string }
  | { name: string; present: true };

export interface Probe {
  method: string;
  path: string;
  status: number;
  headers?: HeaderRule[];
  /** The body must parse as JSON. */
  json?: boolean;
}

export interface Row {
  request: string;
  expected: string;
  actual: string;
  ok: boolean;
}

const CORS: HeaderRule = { name: "access-control-allow-origin", equals: "*" };

/** Done check 4 of Part 1, as data. `pages` is the page entry to request. */
export function probes(pages: string | null, api = true): Probe[] {
  return [
    { method: "GET", path: "/app.js", status: 200, headers: [CORS] },
    ...(pages
      ? [{ method: "GET", path: `/${pages}`, status: 200, headers: [CORS] }]
      : []),
    {
      method: "GET",
      path: "/check-model.glb",
      status: 200,
      headers: [{ name: "content-type", equals: "model/gltf-binary" }],
    },
    {
      method: "GET",
      path: "/check-model.gltf",
      status: 200,
      headers: [{ name: "content-type", equals: "model/gltf+json" }],
    },
    { method: "GET", path: "/_headers", status: 404 },
    { method: "GET", path: "/nope.js", status: 404 },
    { method: "GET", path: "/api/nope", status: 404 },
    ...(api ? API_PROBES : []),
  ];
}

/** Probes of the template's api/test.ts. Skipped when a project deleted it. */
const API_PROBES: Probe[] = [
  {
    method: "GET",
    path: "/api/test",
    status: 200,
    headers: [{ name: "content-type", startsWith: "application/json" }],
    json: true,
  },
  {
    method: "OPTIONS",
    path: "/api/test",
    status: 200,
    headers: [CORS, { name: "access-control-allow-methods", present: true }],
  },
  { method: "POST", path: "/api/test", status: 405 },
  { method: "HEAD", path: "/api/test", status: 405 },
];

function describeRule(rule: HeaderRule): string {
  if ("equals" in rule) return `${rule.name}: ${rule.equals}`;
  if ("startsWith" in rule) return `${rule.name}: ${rule.startsWith}...`;
  return `${rule.name} set`;
}

function ruleHolds(rule: HeaderRule, have: string | null): boolean {
  if (have === null) return false;
  if ("equals" in rule) return have === rule.equals;
  if ("startsWith" in rule) return have.startsWith(rule.startsWith);
  return have !== "";
}

async function runProbe(origin: string, probe: Probe): Promise<Row> {
  const request = `${probe.method} ${probe.path}`;
  const expected = [
    String(probe.status),
    ...(probe.headers ?? []).map(describeRule),
    ...(probe.json ? ["JSON body"] : []),
  ].join(", ");

  let response: Response;
  try {
    response = await fetch(origin + probe.path, {
      method: probe.method,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      request,
      expected,
      actual: `no response (${(error as Error).name})`,
      ok: false,
    };
  }

  const actual = [String(response.status)];
  let ok = response.status === probe.status;
  for (const rule of probe.headers ?? []) {
    const have = response.headers.get(rule.name);
    if (!ruleHolds(rule, have)) ok = false;
    actual.push(
      have === null ? `${rule.name} missing` : `${rule.name}: ${have}`
    );
  }
  if (probe.json) {
    try {
      JSON.parse(await response.text());
      actual.push("JSON body");
    } catch {
      ok = false;
      actual.push("body is not JSON");
    }
  } else {
    await response.body?.cancel();
  }
  return { request, expected, actual: actual.join(", "), ok };
}

/** Starts `wrangler dev` in a sandbox on a free port and resolves with its origin. */
async function startDev(root: string, sandbox: string) {
  const proc = Bun.spawn(
    [
      localBin(root, "wrangler"),
      "dev",
      "--port",
      "0",
      "--ip",
      "127.0.0.1",
      "--inspector-port",
      "0",
    ],
    {
      cwd: sandbox,
      env: { ...process.env, ...wranglerEnv(sandbox) },
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const stop = async () => {
    forget();
    proc.kill();
    // wrangler stops its workerd child on SIGTERM; a wrangler that ignores it is killed.
    const force = setTimeout(() => proc.kill(9), 3000);
    await proc.exited;
    clearTimeout(force);
  };
  const forget = onTerminate(() => {
    proc.kill();
  });

  let log = "";
  const decoder = new TextDecoder();
  const readyTimeout = Math.min(READY_TIMEOUT_MS, toolTimeoutMs());
  let origin: string;
  try {
    origin = await waitUntilReady();
  } catch (error) {
    await stop();
    throw error;
  }
  return { origin, stop };

  function waitUntilReady() {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new ToolFailure(
              `wrangler dev was not ready after ${Math.round(readyTimeout / 1000)}s: ${tail(log)}`
            )
          ),
        readyTimeout
      );
      const pump = async (stream: ReadableStream<Uint8Array>) => {
        for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
          log += decoder.decode(chunk);
          const ready = /Ready on (http:\/\/[\d.]+:\d+)/.exec(log);
          if (ready) {
            clearTimeout(timer);
            resolve(ready[1] as string);
          }
        }
      };
      void pump(proc.stdout as ReadableStream<Uint8Array>);
      void pump(proc.stderr as ReadableStream<Uint8Array>);
      void proc.exited.then((code) => {
        clearTimeout(timer);
        reject(
          new ToolFailure(
            `wrangler dev exited with ${code} before it was ready: ${tail(log)}`
          )
        );
      });
    });
  }
}

function tail(log: string): string {
  return log
    .split("\n")
    .filter((line) => line.trim())
    .slice(-4)
    .join(" | ")
    .replaceAll(/\/(?:private\/)?(?:var|tmp)\/[^\s|]+/g, ".");
}

/** The page entry to request: `pages/about.js` if it was built, else the first page. */
export function pickPage(distFiles: string[]): string | null {
  if (distFiles.includes("pages/about.js")) return "pages/about.js";
  return distFiles.find((file) => /^pages\/[^/]+\.js$/.test(file)) ?? null;
}

/**
 * Serves the build with the local `wrangler dev` and asserts headers, routes
 * and methods. Only meaningful for a Cloudflare project that has run its
 * build, so it throws a ToolFailure when `.generated/worker.ts` or dist/ is missing.
 */
export async function runServeChecks(
  root: string,
  distFiles: string[],
  options: { api?: boolean } = {}
): Promise<Row[]> {
  for (const needed of [
    "wrangler.jsonc",
    path.join(".generated", "worker.ts"),
    path.join("dist", "app.js"),
  ]) {
    if (!existsSync(path.join(root, needed))) {
      throw new ToolFailure(
        `${needed} is missing, so there is nothing to serve`,
        {
          fix: "Run pnpm build with the Cloudflare config in project.config.json",
        }
      );
    }
  }
  const sandbox = makeSandbox(root);
  try {
    addServingFixtures(sandbox.dir);
    const dev = await startDev(root, sandbox.dir);
    try {
      const rows: Row[] = [];
      for (const probe of probes(pickPage(distFiles), options.api ?? true))
        rows.push(await runProbe(dev.origin, probe));
      return rows;
    } finally {
      await dev.stop();
    }
  } finally {
    sandbox.cleanup();
  }
}

export function formatTable(rows: Row[]): string {
  const width = (pick: (row: Row) => string, title: string) =>
    Math.max(title.length, ...rows.map((row) => pick(row).length));
  const a = width((r) => r.request, "request");
  const b = width((r) => r.expected, "expected");
  const lines = [
    `${"".padEnd(2)} ${"request".padEnd(a)}  ${"expected".padEnd(b)}  actual`,
  ];
  for (const row of rows) {
    lines.push(
      `${row.ok ? "ok" : "XX"} ${row.request.padEnd(a)}  ${row.expected.padEnd(b)}  ${row.actual}`
    );
  }
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  // Standalone: `./node_modules/.bin/bun run bin/check/serve-check.ts` after a Cloudflare build.
  const root = path.resolve(import.meta.dir, "..", "..");
  const { listFiles } = await import("./bundle");
  try {
    const rows = await runServeChecks(
      root,
      listFiles(path.join(root, "dist")),
      {
        api: existsSync(path.join(root, "api", "test.ts")),
      }
    );
    process.stdout.write(formatTable(rows));
    process.exit(rows.every((row) => row.ok) ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    process.exit(2);
  }
}
