/**
 * Proves the full-tier checks fail when the code is broken. It copies the
 * repo to a temp folder (node_modules included, not linked), breaks the copy
 * in one way at a time, runs the real command, and says which check and rule
 * caught it. Slow and needs Chromium, so it is not a *.test.ts and stays out
 * of CI:
 *
 *   pnpm check:mutations [--only <name>] [--list]
 *
 * A mutation counts as caught only when the expected rule fired and no other
 * rule did, so a check can't pass for the wrong reason. Exit 0 when every
 * mutation was caught, 1 when one slipped through, 2 when the harness broke.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dir, "..", "..");
const SKIP = new Set([
  ".git",
  "dist",
  ".generated",
  ".wrangler",
  "tsconfig.tsbuildinfo",
]);
const SETUP_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 600_000;
const BUN = "./node_modules/.bin/bun";

interface Finding {
  rule: string;
  severity: string;
  file: string;
  message: string;
}

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
  seconds: number;
  checks: { name: string; ok: boolean; findings: Finding[] }[];
}

interface Mutation {
  name: string;
  /** What the done check says must fail. */
  step: string;
  /** Files to write, or delete with null, in the copy. A function gets the current text. */
  files?: Record<string, string | null | ((text: string) => string)>;
  /** Files to make executable after they are written. */
  executable?: string[];
  env?: Record<string, string>;
  /** Commands run in the copy before the mutation's own command. */
  setup?: string[][];
  /** What to run. Default is the whole `--all`. */
  command?: "all" | "runtime" | "host";
  /** Replaces running the command, for cases that signal the run. */
  custom?: (dir: string, env: Record<string, string>) => Promise<Outcome>;
  verify(outcome: Outcome): string | null;
}

/** What the last `caught` matched, for the report. */
let matched = "";

function findings(outcome: Outcome, check: string): Finding[] {
  return outcome.checks.find((c) => c.name === check)?.findings ?? [];
}

/**
 * Caught: exit 1 (or `exit`), a finding with `rule` that mentions `includes`,
 * and no finding with any rule outside `rule` and `allow`.
 */
const caught =
  (
    check: string,
    rule: string,
    includes?: string,
    options: { exit?: number; allow?: string[]; alsoFails?: string[] } = {}
  ) =>
  (outcome: Outcome) => {
    const { exit = 1, allow = [], alsoFails = [] } = options;
    if (outcome.code !== exit) return `exit ${outcome.code}, expected ${exit}`;
    const all = findings(outcome, check).filter((f) => f.severity === "error");
    const hit = all.find(
      (f) =>
        f.rule === rule &&
        (!includes || (f.message + f.file).includes(includes))
    );
    if (!hit) {
      return `no ${check} finding ${rule}${includes ? ` mentioning "${includes}"` : ""}. Saw: ${JSON.stringify(all.map((f) => [f.rule, f.file]))}`;
    }
    const stray = all.filter((f) => f.rule !== rule && !allow.includes(f.rule));
    if (stray.length > 0) {
      return `${check} also fired rules that don't belong to this case: ${[...new Set(stray.map((f) => f.rule))].join(", ")}`;
    }
    const others = outcome.checks
      .filter(
        (c) =>
          c.name !== check &&
          c.name !== "skills" &&
          !alsoFails.includes(c.name) &&
          !c.ok
      )
      .map((c) => c.name);
    if (others.length > 0)
      return `other checks failed too: ${others.join(", ")}`;
    matched = `${check} ${hit.rule} (${hit.file})`;
    return null;
  };

const MODULE = (body: string, imports = "") => `${imports}
export default function (element: HTMLElement) {
${body}
}
`;

const CLOUDFLARE = [
  [
    BUN,
    "run",
    "bin/connect.ts",
    "cloudflare",
    "--name",
    "acme",
    "--domain",
    "itsoffbrand.dev",
    "--subdomain",
    "team",
    "--account-id",
    "0123456789abcdef0123456789abcdef",
    "--yes",
  ],
];
const BUILD = [["env", "NODE_ENV=production", BUN, "run", "bin/build.ts"]];

const BREAK_GLB = (text: string) =>
  text.replace(
    "Content-Type: model/gltf-binary",
    "Content-Type: application/octet-stream"
  );

/** Two lines of src/app.ts, removed. */
const WITHOUT = (call: string) => (text: string) => {
  if (!text.includes(call)) throw new Error(`src/app.ts has no ${call}`);
  return text.replace(call, "");
};

/** The steps in docs/component-lifecycle.md that turn Taxi on, applied to src/app.ts. */
const TAXI_APP = (text: string) =>
  text
    .replace(
      '// import { Pages } from "@lib/pages";',
      'import { Pages } from "@lib/pages";'
    )
    .replace('import type { _Pages } from "@lib/pages";\n', "")
    .replace(/ *\/\/ Set by `pages = Pages`[^\n]*\n/, "")
    .replace("  pages?: _Pages;\n", "")
    .replace("// pages = Pages;", "pages = Pages;");
const TAXI_PAGES = (text: string) =>
  text.replace(
    "// export const Pages = new _Pages();",
    "export const Pages = new _Pages();"
  );
// Taxi and its dependencies add about 3.4kB gzip, so its budgets go up with it.
const TAXI_ON = (text: string) =>
  text
    .replace('"taxi": false', '"taxi": true')
    .replace(/"(app\.js|pages\/\*\.js)": 63850/g, '"$1": 70000');

export const MUTATIONS: Mutation[] = [
  {
    name: "baseline",
    step: "an untouched copy passes every check, exit 0",
    verify: (o) => {
      const failing = o.checks.filter((c) => !c.ok).map((c) => c.name);
      matched = `${o.checks.length} checks, exit ${o.code}`;
      return o.code === 0 && o.checks.length >= 10
        ? null
        : `exit ${o.code}; failing checks: ${failing.join(", ") || "(none ran)"}`;
    },
  },
  {
    name: "cloudflare-passes",
    step: "host on Cloudflare: config, dry run and local serving pass, exit 0",
    setup: CLOUDFLARE,
    verify: (o) => {
      const host = o.checks.find((c) => c.name === "host");
      matched = `host ok=${host?.ok}, exit ${o.code}`;
      return o.code === 0 && host?.ok
        ? null
        : `exit ${o.code}; host: ${JSON.stringify(host?.findings)}`;
    },
  },
  {
    name: "leak-helper",
    step: "leak test: a subscription through a helper with no cleanup",
    command: "runtime",
    files: {
      "src/modules/leaky.ts": MODULE(
        "  subscribe(() => {});",
        'import { Raf } from "@lib/subs";\nconst subscribe = (fn: () => void) => Raf.add(fn);\n'
      ),
    },
    verify: caught("runtime", "runtime/leak", "Raf"),
  },
  {
    name: "throw-in-module",
    step: "normal load: a throw in a module",
    command: "runtime",
    files: { "src/modules/boom.ts": MODULE('  throw new Error("boom");') },
    // createCycles only warns, so the other steps see the same module fail.
    verify: caught("runtime", "runtime/normal-load", "boom", {
      allow: ["runtime/editor-load", "runtime/leak"],
    }),
  },
  {
    name: "early-load",
    step: "early load: document.body.firstChild read at the top level of a module",
    command: "runtime",
    files: {
      "src/modules/early.ts": `const firstNode = () => document.body.firstChild;
export const kind = firstNode()?.nodeType;
export default function (element: HTMLElement) {}
`,
    },
    verify: caught("runtime", "runtime/early-load", "Cannot read"),
  },
  {
    name: "editor-no-release",
    step: "leak test: handleEditor without release",
    command: "runtime",
    files: {
      "src/modules/editorleak.ts": MODULE(
        "  handleEditor(() => {});",
        'import { handleEditor } from "@webflow/detect-editor";\n'
      ),
    },
    verify: caught("runtime", "runtime/leak", "editor"),
  },
  {
    name: "state-on-helper",
    step: "leak test: a State.on kept through a helper",
    command: "runtime",
    files: {
      "src/modules/stateleak.ts": MODULE(
        '  listen("X", () => {});',
        'import State from "@lib/hey";\nconst listen = (name: string, fn: () => void) => State.on(name, fn);\n'
      ),
    },
    verify: caught("runtime", "runtime/leak", "State"),
  },
  {
    name: "interval-leak",
    step: "leak test: a setInterval that is never cleared",
    command: "runtime",
    files: { "src/modules/timer.ts": MODULE("  setInterval(() => {}, 1000);") },
    verify: caught("runtime", "runtime/leak", "timers"),
  },
  {
    name: "window-listener-leak",
    step: "leak test: a window listener that is never removed",
    command: "runtime",
    files: {
      "src/modules/listener.ts": MODULE(
        '  window.addEventListener("scroll", () => {});'
      ),
    },
    verify: caught("runtime", "runtime/leak", "listeners"),
  },
  {
    name: "observer-leak",
    step: "leak test: an IntersectionObserver that is never disconnected",
    command: "runtime",
    files: {
      "src/modules/watcher.ts": MODULE(
        "  new IntersectionObserver(() => {}).observe(element);"
      ),
    },
    verify: caught("runtime", "runtime/leak", "observers"),
  },
  {
    name: "killed-tween-hook",
    step: "leak test phase timeout: an awaited GSAP tween that was killed",
    command: "runtime",
    files: {
      "checks.config.json": (text) =>
        text.replace('"hookTimeoutMs": 10000', '"hookTimeoutMs": 4000'),
      // One second would resolve well inside the timeout: only the kill hangs it.
      "src/modules/hang.ts": MODULE(
        `  onPageIn(async () => {
    const tween = gsap.to(element, { opacity: 0, duration: 1 });
    gsap.killTweensOf(element);
    await tween;
  });`,
        'import gsap from "@lib/gsap";\nimport { onPageIn } from "@/modules/_";\n'
      ),
    },
    verify: caught("runtime", "runtime/hook-timeout", "runPageIn"),
  },
  {
    name: "no-run-mount",
    step: "normal load: runMount() deleted from src/app.ts",
    command: "runtime",
    files: { "src/app.ts": WITHOUT("runMount();") },
    verify: caught("runtime", "runtime/normal-load", "runMount"),
  },
  {
    name: "no-run-page-in",
    step: "normal load: runPageIn() deleted from src/app.ts",
    command: "runtime",
    files: { "src/app.ts": WITHOUT("runPageIn();") },
    verify: caught("runtime", "runtime/normal-load", "runPageIn"),
  },
  {
    name: "no-create-cycles",
    step: "normal load: createCycles() deleted from src/app.ts, so no module starts",
    command: "runtime",
    files: { "src/app.ts": WITHOUT("createCycles();") },
    // The editor load runs the same check on the same bundle.
    verify: caught("runtime", "runtime/normal-load", "never started", {
      allow: ["runtime/editor-load"],
    }),
  },
  {
    name: "page-entry-without-app",
    step: "normal load: a page entry that doesn't import the app",
    command: "runtime",
    files: { "src/pages/home.js": "console.log('home');\n" },
    verify: caught("runtime", "runtime/normal-load", "pages/home.js", {
      allow: ["runtime/editor-load"],
    }),
  },
  {
    name: "editor-in-page-entry",
    step: "editor load: a page entry that throws in the editor, which app.js doesn't",
    command: "runtime",
    files: {
      "src/pages/about.js": `import "../app";
import { handleEditor } from "@webflow/detect-editor";
handleEditor((isEditor) => {
  if (isEditor) throw new Error("page entry in the editor");
});
`,
    },
    verify: caught(
      "runtime",
      "runtime/editor-load",
      "Editor load (pages/about.js)",
      {
        allow: [],
      }
    ),
  },
  {
    name: "editor-flip",
    step: "editor switch: an onEditor callback that throws only when the editor turns on after load",
    command: "runtime",
    files: {
      "src/modules/flipper.ts": MODULE(
        `  let seen = false;
  onEditor((isEditor) => {
    if (isEditor && seen) throw new Error("flipped on");
    seen = true;
  });`,
        'import { onEditor } from "@/modules/_";\n'
      ),
    },
    verify: (o) => {
      const result = caught("runtime", "runtime/editor-load", "Editor switch", {
        allow: [],
      })(o);
      if (result) return result;
      // Loaded with the marker already there, it must not throw.
      return findings(o, "runtime").some((f) =>
        f.message.includes("Editor load (")
      )
        ? "the plain editor load failed too: the callback should throw only on the change"
        : null;
    },
  },
  {
    name: "taxi-docs-steps",
    step: 'Taxi enabled with the docs\' steps and "taxi": true passes check:all, navigation included, exit 0',
    files: {
      "src/app.ts": TAXI_APP,
      "src/lib/pages.ts": TAXI_PAGES,
      "checks.config.json": TAXI_ON,
    },
    verify: (o) => {
      const runtime = o.checks.find((c) => c.name === "runtime");
      matched = `runtime ok=${runtime?.ok}, exit ${o.code}`;
      return o.code === 0 && runtime?.ok
        ? null
        : `exit ${o.code}; ${JSON.stringify(o.checks.filter((c) => !c.ok).map((c) => [c.name, c.findings.map((f) => f.message)]))}`;
    },
  },
  {
    name: "taxi-links-not-handled",
    step: "Taxi navigation: links Taxi doesn't handle are full page loads",
    command: "runtime",
    files: {
      "src/app.ts": TAXI_APP,
      "src/lib/pages.ts": (text) =>
        TAXI_PAGES(text).replace(/links: "[^\n]*",/, 'links: "a.nope",'),
      "checks.config.json": TAXI_ON,
    },
    verify: caught("runtime", "runtime/taxi", "full page load"),
  },
  {
    name: "localhost-in-js",
    step: "bundle: a localhost string in a built JS",
    files: {
      "src/modules/local.ts": MODULE(
        '  console.log("fetching http://localhost:3000/api");'
      ),
    },
    verify: caught("bundle", "bundle/localhost", "localhost:3000"),
  },
  {
    name: "secret-in-dist",
    step: "bundle: a 16-character hook value from .env in dist",
    files: {
      ".env": 'DEPLOY_HOOK="https://example.com/hook/0123456789abcdef"\n',
      "public/oops.txt": "hook is https://example.com/hook/0123456789abcdef",
    },
    verify: caught("bundle", "bundle/secret", "DEPLOY_HOOK"),
  },
  {
    name: "over-budget",
    step: "bundle: gzip budget exceeded",
    files: {
      "checks.config.json": (text) =>
        text.replace('"app.js": 63850', '"app.js": 1000'),
    },
    verify: caught("bundle", "bundle/over-budget", "app.js"),
  },
  {
    name: "wrong-wrangler-name",
    step: "host: wrong name in wrangler.jsonc",
    setup: CLOUDFLARE,
    files: {
      "wrangler.jsonc": (text) =>
        text.replace(/"name": "acme"/, '"name": "not-acme"'),
    },
    verify: caught("host", "host/wrangler", "not-acme"),
  },
  {
    name: "api-export-foo",
    step: "host: an api file exporting foo",
    files: {
      "api/extra.ts":
        "export function GET() { return new Response('x'); }\nexport const foo = 1;\n",
    },
    verify: caught("host", "host/api-export", "foo"),
  },
  {
    name: "broken-headers",
    step: "host on Cloudflare: a broken _headers rule",
    setup: CLOUDFLARE,
    files: { "bin/build.ts": BREAK_GLB },
    // Local serving sees the same wrong content type.
    verify: (o) =>
      caught("host", "host/headers", "/*.glb", {
        allow: ["host/serving"],
        alsoFails: ["tests"], // headers.test.ts compares the same rules
      })(o) ??
      (findings(o, "host").some(
        (f) =>
          f.rule === "host/serving" && f.message.includes("check-model.glb")
      )
        ? null
        : "local serving did not catch the glb content type"),
  },
  {
    name: "api-test-deleted",
    step: "host on Cloudflare: api/test.ts deleted still probes static files, and says the API probes were skipped",
    setup: CLOUDFLARE,
    files: { "api/test.ts": null, "bin/build.ts": BREAK_GLB },
    verify: (o) => {
      const host = findings(o, "host");
      const skipped = host.find((f) => f.rule === "host/serving-skipped");
      if (skipped?.severity !== "warning")
        return "no host/serving-skipped warning";
      return (
        caught("host", "host/headers", "/*.glb", {
          allow: ["host/serving"],
          alsoFails: ["tests"],
        })(o) ??
        (host.some(
          (f) =>
            f.rule === "host/serving" && f.message.includes("check-model.glb")
        )
          ? null
          : "static serving was skipped along with the API probes")
      );
    },
  },
  {
    name: "wrangler-hangs",
    step: "host: a wrangler that sleeps is a tool failure within the timeout, not a hang",
    command: "host",
    setup: [...CLOUDFLARE, ...BUILD],
    env: { CHECK_TOOL_TIMEOUT_MS: "8000" },
    files: { "node_modules/.bin/wrangler": "#!/bin/sh\nexec sleep 600\n" },
    executable: ["node_modules/.bin/wrangler"],
    verify: (o) => {
      const failure = findings(o, "host").find(
        (f) => f.rule === "tool/failure"
      );
      matched = `host tool/failure after ${o.seconds}s`;
      if (o.code !== 2 || !failure)
        return `exit ${o.code}, expected 2 with a tool failure`;
      if (o.seconds > 60) return `took ${o.seconds}s, the timeout was 8s`;
      return failure.message.includes("did not finish")
        ? null
        : `message: ${failure.message}`;
    },
  },
  {
    name: "signal-during-host",
    step: "a SIGTERM during host leaves no process or temp folder behind",
    setup: [...CLOUDFLARE, ...BUILD],
    custom: signalDuringHost,
    verify: (o) => {
      matched = o.stdout.trim();
      return o.code === 0 ? null : o.stderr.trim() || `exit ${o.code}`;
    },
  },
  {
    name: "chromium-missing",
    step: "runtime: Chromium path broken gives exit 2",
    command: "runtime",
    env: { PLAYWRIGHT_BROWSERS_PATH: "/nonexistent-playwright-browsers" },
    verify: (o) => {
      matched = "runtime tool/failure";
      return o.code === 2 && o.stdout.includes("playwright install chromium")
        ? null
        : `exit ${o.code}; expected 2 with the install command in the message`;
    },
  },
];

function run(
  dir: string,
  args: string[],
  env: Record<string, string> = {},
  timeout = RUN_TIMEOUT_MS
) {
  const started = Date.now();
  const proc = Bun.spawnSync(args, {
    cwd: dir,
    env: { ...process.env, AGENT_CHECK_ACTIVE: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
    timeout,
  });
  if (proc.exitCode === null) {
    throw new Error(
      `${args.join(" ")} did not finish within ${timeout / 1000}s`
    );
  }
  return {
    code: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    seconds: Math.round((Date.now() - started) / 1000),
  };
}

function makeCopy(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mutation-"));
  for (const name of readdirSync(REPO)) {
    if (SKIP.has(name)) continue;
    // Real copies, cloned where the filesystem can: node_modules must not be a link.
    const clone = Bun.spawnSync(["cp", "-cR", path.join(REPO, name), dir]);
    if (clone.exitCode !== 0)
      cpSync(path.join(REPO, name), path.join(dir, name), { recursive: true });
  }
  return dir;
}

function applyFiles(dir: string, mutation: Mutation) {
  const written: string[] = [];
  for (const [name, change] of Object.entries(mutation.files ?? {})) {
    const file = path.join(dir, name);
    if (change === null) {
      rmSync(file, { force: true });
      continue;
    }
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    mkdirSync(path.dirname(file), { recursive: true });
    // An existing file may be a clone of the repo's; replace it, never write through.
    rmSync(file, { force: true });
    writeFileSync(
      file,
      typeof change === "function" ? change(current) : change
    );
    if (/\.(ts|js)$/.test(name)) written.push(name);
  }
  // Written as the Biome style asks, so the format check fails only for a mutation that means to.
  if (written.length > 0) {
    run(
      dir,
      ["./node_modules/.bin/biome", "format", "--write", ...written],
      {},
      SETUP_TIMEOUT_MS
    );
  }
  for (const name of mutation.executable ?? [])
    chmodSync(path.join(dir, name), 0o755);
}

function parse(result: Omit<Outcome, "checks">): Outcome {
  let checks: Outcome["checks"] = [];
  try {
    checks = JSON.parse(result.stdout).checks;
  } catch {
    // Left empty: verify() reports what it expected.
  }
  return { ...result, checks };
}

/** Process ids whose working directory is inside `dir`. */
function processesIn(dir: string): number[] {
  const out = Bun.spawnSync(["lsof", "-d", "cwd", "-Fpn"]).stdout.toString();
  const pids: number[] = [];
  let pid = 0;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && line.slice(1).startsWith(dir))
      pids.push(pid);
  }
  return pids;
}

/**
 * Starts the host check with its own TMPDIR, waits until wrangler dev is
 * serving, sends SIGTERM, and checks that nothing started by the run is left:
 * no process whose working directory is in that TMPDIR, and no folder in it.
 */
async function signalDuringHost(
  dir: string,
  env: Record<string, string>
): Promise<Outcome> {
  const tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "signal-tmp-")));
  const proc = Bun.spawn([BUN, "run", "bin/check/index.ts", "--only", "host"], {
    cwd: dir,
    env: { ...process.env, ...env, TMPDIR: tmp, AGENT_CHECK_ACTIVE: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const fail = (message: string): Outcome => {
    proc.kill(9);
    for (const pid of processesIn(tmp)) process.kill(pid, 9);
    rmSync(tmp, { recursive: true, force: true });
    return { code: 1, stdout: "", stderr: message, seconds: 0, checks: [] };
  };

  // wrangler dev is the process whose working directory is the sandbox, and
  // its workerd child shares it; two processes there means it is serving.
  const deadline = Date.now() + 90_000;
  let before: number[] = [];
  while (Date.now() < deadline) {
    before = processesIn(tmp);
    if (before.length >= 2) break;
    await Bun.sleep(250);
  }
  if (before.length < 2)
    return fail("wrangler dev never started under the run's TMPDIR");

  proc.kill("SIGTERM");
  const exitDeadline = Date.now() + 20_000;
  while (proc.exitCode === null && Date.now() < exitDeadline)
    await Bun.sleep(100);
  if (proc.exitCode === null) return fail("the run ignored SIGTERM");
  const code = proc.exitCode;

  await Bun.sleep(2000);
  const left = processesIn(tmp);
  const folders = existsSync(tmp) ? readdirSync(tmp) : [];
  for (const pid of left) process.kill(pid, 9);
  rmSync(tmp, { recursive: true, force: true });
  const problems = [
    code === 143 ? "" : `exit ${code}, expected 143`,
    left.length > 0 ? `${left.length} process(es) left running` : "",
    folders.length > 0 ? `folders left in TMPDIR: ${folders.join(", ")}` : "",
  ].filter(Boolean);
  return {
    code: problems.length === 0 ? 0 : 1,
    stdout: `SIGTERM with ${before.length} processes running: exit ${code}, ${left.length} left, ${folders.length} folders left`,
    stderr: problems.join("; "),
    seconds: 0,
    checks: [],
  };
}

async function runMutation(mutation: Mutation): Promise<Outcome> {
  const dir = makeCopy();
  try {
    for (const setup of mutation.setup ?? []) {
      const result = run(dir, setup, {}, SETUP_TIMEOUT_MS);
      if (result.code !== 0) {
        throw new Error(
          `setup ${setup.join(" ")} failed: ${result.stderr || result.stdout}`
        );
      }
    }
    applyFiles(dir, mutation);
    const env = mutation.env ?? {};
    if (mutation.custom) return await mutation.custom(dir, env);
    const command =
      mutation.command === "runtime"
        ? [BUN, "run", "bin/check/index.ts", "--only", "runtime", "--json"]
        : mutation.command === "host"
          ? [BUN, "run", "bin/check/index.ts", "--only", "host", "--json"]
          : [BUN, "run", "bin/check/index.ts", "--all", "--json"];
    return parse(run(dir, command, env));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes("--list")) {
    for (const m of MUTATIONS) console.log(`${m.name}: ${m.step}`);
    process.exit(0);
  }
  const only = argv.includes("--only")
    ? argv[argv.indexOf("--only") + 1]
    : null;
  const selected = MUTATIONS.filter((m) => !only || m.name === only);
  if (selected.length === 0) {
    console.error(`No mutation named ${only}. Try --list`);
    process.exit(2);
  }

  let slipped = 0;
  for (const mutation of selected) {
    matched = "";
    let outcome: Outcome;
    try {
      outcome = await runMutation(mutation);
    } catch (error) {
      console.error(
        `${mutation.name}: the harness broke: ${(error as Error).message}`
      );
      process.exit(2);
    }
    const reason = mutation.verify(outcome);
    if (reason) slipped += 1;
    console.log(
      `${reason ? "SLIPPED" : "caught "}  ${mutation.name}  (exit ${outcome.code}, ${outcome.seconds}s)  ${mutation.step}`
    );
    console.log(`         ${reason ? reason : `by ${matched}`}`);
  }
  console.log(
    slipped === 0
      ? "\nEvery mutation was caught."
      : `\n${slipped} mutation(s) slipped through.`
  );
  process.exit(slipped === 0 ? 0 : 1);
}
