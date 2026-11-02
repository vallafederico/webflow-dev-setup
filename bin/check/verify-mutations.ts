/**
 * Proves the full-tier checks fail when the code is broken. It copies the
 * repo to a temp folder (node_modules included, not linked), breaks the copy
 * in one way at a time, runs the real command, and says whether the expected
 * check and rule caught it. Slow and needs Chromium, so it is not a *.test.ts:
 *
 *   bun run bin/check/verify-mutations.ts [--only <name>] [--list]
 *
 * Exit 0 when every mutation was caught, 1 when one slipped through, 2 when
 * the harness itself broke.
 */
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
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

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
  checks: {
    name: string;
    ok: boolean;
    findings: {
      rule: string;
      severity: string;
      file: string;
      message: string;
    }[];
  }[];
}

interface Mutation {
  name: string;
  /** What the done check says must fail. */
  step: string;
  /** Files to write, or delete with null, in the copy. A function gets the current text. */
  files?: Record<string, string | null | ((text: string) => string)>;
  env?: Record<string, string>;
  /** Commands run in the copy before the mutation's own command. */
  setup?: string[][];
  /** "all" runs --all --json, "runtime" runs the runtime check alone. */
  command?: "all" | "runtime";
  /** Returns a reason it was NOT caught, or null when it was. */
  verify(outcome: Outcome): string | null;
}

function finding(
  outcome: Outcome,
  check: string,
  rule: string,
  includes?: string
) {
  return outcome.checks
    .find((c) => c.name === check)
    ?.findings.find(
      (f) =>
        f.rule === rule &&
        (!includes || (f.message + f.file).includes(includes))
    );
}

const caught =
  (check: string, rule: string, includes?: string, exit = 1) =>
  (outcome: Outcome) =>
    outcome.code !== exit
      ? `exit ${outcome.code}, expected ${exit}`
      : finding(outcome, check, rule, includes)
        ? null
        : `no ${check} finding ${rule}${includes ? ` mentioning "${includes}"` : ""}. Saw: ${JSON.stringify(
            outcome.checks
              .filter((c) => !c.ok)
              .map((c) => [c.name, c.findings.map((f) => f.rule)])
          )}`;

const TEMPLATE_MODULE = (body: string, imports = "") => `${imports}
export default function (element: HTMLElement) {
${body}
}
`;

const CLOUDFLARE = [
  [
    "./node_modules/.bin/bun",
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

export const MUTATIONS: Mutation[] = [
  {
    name: "baseline",
    step: "an untouched copy passes every full-tier check",
    verify: (o) => {
      const failing = o.checks.filter((c) => !c.ok).map((c) => c.name);
      return failing.every((name) => name === "skills") && o.checks.length >= 10
        ? null
        : `failing checks: ${failing.join(", ") || "(none ran)"}; exit ${o.code}`;
    },
  },
  {
    name: "leak-helper",
    step: "leak test: a subscription through a helper with no cleanup",
    command: "runtime",
    files: {
      "src/modules/leaky.ts": TEMPLATE_MODULE(
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
    files: {
      "src/modules/boom.ts": TEMPLATE_MODULE('  throw new Error("boom");'),
    },
    verify: (o) => {
      const result = caught("runtime", "runtime/normal-load", "boom")(o);
      return result;
    },
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
    verify: (o) =>
      caught("runtime", "runtime/early-load", "Cannot read")(o) ??
      (finding(o, "runtime", "runtime/normal-load")
        ? "normal load failed too, it should only fail early"
        : null),
  },
  {
    name: "editor-no-release",
    step: "leak test: handleEditor without release",
    command: "runtime",
    files: {
      "src/modules/editorleak.ts": TEMPLATE_MODULE(
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
      "src/modules/stateleak.ts": TEMPLATE_MODULE(
        '  listen("X", () => {});',
        'import State from "@lib/hey";\nconst listen = (name: string, fn: () => void) => State.on(name, fn);\n'
      ),
    },
    verify: caught("runtime", "runtime/leak", "State"),
  },
  {
    name: "killed-tween-hook",
    step: "leak test phase timeout: an awaited GSAP tween that was killed",
    command: "runtime",
    files: {
      "checks.config.json": (text) =>
        text.replace('"hookTimeoutMs": 10000', '"hookTimeoutMs": 4000'),
      "src/modules/hang.ts": TEMPLATE_MODULE(
        `  onPageIn(async () => {
    const tween = gsap.to(element, { opacity: 0, duration: 5 });
    gsap.killTweensOf(element);
    await tween;
  });`,
        'import gsap from "@lib/gsap";\nimport { onPageIn } from "@/modules/_";\n'
      ),
    },
    verify: caught("runtime", "runtime/hook-timeout", "runPageIn"),
  },
  {
    name: "localhost-in-js",
    step: "bundle: a localhost string in a built JS",
    files: {
      "src/modules/local.ts": TEMPLATE_MODULE(
        '  console.log("fetching http://localhost:3000/api");'
      ),
    },
    verify: caught("bundle", "bundle/localhost", "localhost:3000"),
  },
  {
    name: "secret-in-dist",
    step: "bundle: a 16-character hook value from .env in dist",
    files: {
      ".env":
        'DEPLOY_HOOK="https://example.com/hook/0123456789abcdef"\nUSE_SSL=true\n',
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
    files: {
      "bin/build.ts": (text) =>
        text.replace(
          "Content-Type: model/gltf-binary",
          "Content-Type: application/octet-stream"
        ),
    },
    verify: (o) =>
      caught("host", "host/headers", "/*.glb")(o) ??
      (finding(o, "host", "host/serving", "check-model.glb")
        ? null
        : "local serving did not catch the glb content type"),
  },
  {
    name: "cloudflare-passes",
    step: "host on Cloudflare: config, dry run and local serving all pass",
    setup: CLOUDFLARE,
    verify: (o) => {
      const host = o.checks.find((c) => c.name === "host");
      return host?.ok && !host.findings.some((f) => f.severity === "error")
        ? null
        : `host did not pass: ${JSON.stringify(host?.findings)}`;
    },
  },
  {
    name: "chromium-missing",
    step: "runtime: Chromium path broken gives exit 2",
    command: "runtime",
    env: { PLAYWRIGHT_BROWSERS_PATH: "/nonexistent-playwright-browsers" },
    verify: (o) =>
      o.code === 2 && o.stdout.includes("playwright install chromium")
        ? null
        : `exit ${o.code}; expected 2 with the install command in the message`,
  },
];

function run(dir: string, args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(args, {
    cwd: dir,
    env: { ...process.env, AGENT_CHECK_ACTIVE: "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: proc.exitCode ?? 2,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function makeCopy(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mutation-"));
  for (const name of Bun.spawnSync(["ls", "-A", REPO])
    .stdout.toString()
    .split("\n")
    .filter(Boolean)) {
    if (SKIP.has(name)) continue;
    // Real copies, cloned where the filesystem can: node_modules must not be a link.
    const clone = Bun.spawnSync(["cp", "-cR", path.join(REPO, name), dir]);
    if (clone.exitCode !== 0)
      cpSync(path.join(REPO, name), path.join(dir, name), { recursive: true });
  }
  return dir;
}

function applyFiles(dir: string, files: NonNullable<Mutation["files"]>) {
  const saved = new Map<string, string | null>();
  for (const [name, change] of Object.entries(files)) {
    const file = path.join(dir, name);
    saved.set(file, existsSync(file) ? readFileSync(file, "utf8") : null);
    if (change === null) rmSync(file, { force: true });
    else {
      mkdirSync(path.dirname(file), { recursive: true });
      const current = saved.get(file) ?? "";
      writeFileSync(
        file,
        typeof change === "function" ? change(current) : change
      );
    }
  }
  return () => {
    for (const [file, text] of saved) {
      if (text === null) rmSync(file, { force: true });
      else writeFileSync(file, text);
    }
  };
}

function parse(result: {
  code: number;
  stdout: string;
  stderr: string;
}): Outcome {
  let checks: Outcome["checks"] = [];
  try {
    checks = JSON.parse(result.stdout).checks;
  } catch {
    // Left empty: verify() reports what it expected.
  }
  return { ...result, checks };
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
  {
    for (const mutation of selected) {
      // Each mutation gets its own fresh copy, so none sees another's files.
      const dir = makeCopy();
      for (const setup of mutation.setup ?? []) {
        const result = run(dir, setup);
        if (result.code !== 0) {
          console.error(
            `setup failed for ${mutation.name}: ${result.stderr || result.stdout}`
          );
          process.exit(2);
        }
      }
      if (mutation.files) applyFiles(dir, mutation.files);
      const command =
        mutation.command === "runtime"
          ? ["./node_modules/.bin/bun", "run", "bin/check/runtime.ts", "--json"]
          : [
              "./node_modules/.bin/bun",
              "run",
              "bin/check/index.ts",
              "--all",
              "--json",
            ];
      const started = Date.now();
      const outcome = parse(run(dir, command, mutation.env));
      const reason = mutation.verify(outcome);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (reason) slipped += 1;
      console.log(
        `${reason ? "SLIPPED" : "caught "}  ${mutation.name}  (exit ${outcome.code}, ${seconds}s)  ${mutation.step}`
      );
      if (reason) console.log(`         ${reason}`);
      rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(
    slipped === 0
      ? "\nEvery mutation was caught."
      : `\n${slipped} mutation(s) slipped through.`
  );
  process.exit(slipped === 0 ? 0 : 1);
}
