import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import type { Browser, Page } from "playwright";
import { onTerminate } from "./cleanup";
import { readChecksConfig } from "./checks-config";
import { installCounters } from "./leak-patches";
import {
  allMarkup,
  earlyPage,
  editorPage,
  entrySource,
  FAVICON,
  fixtureProblems,
  leakPage,
  listModules,
  moduleMarkup,
  normalPage,
  requireModules,
  taxiPage,
} from "./runtime-pages";
import {
  classifyConsole,
  type Counts,
  compareCounts,
  type CycleCounts,
  type FixtureApi,
  leakFix,
} from "./runtime-rules";
import { exec, excerpt, localBin } from "./tools";
import { type Check, type Finding, ToolFailure, toResult } from "./types";

const INSTALL = "pnpm exec playwright install chromium";
/** After `load`: lets timers, animation frames and the first page hooks run and fail. */
const SETTLE_MS = 800;
/** After the editor marker is added or removed: a frame, then the observer callbacks. */
const FLIP_SETTLE_MS = 150;
const NAVIGATION_TIMEOUT_MS = 15_000;
const RUN_TIMEOUT_MS = 240_000;

/** `window` in the test bundle. This file never loads fixture-entry.ts, so the type is spelled out. */
type Fixture = Window & { __wdsCheck: FixtureApi };
const CYCLES = 3;

type Draft = Omit<Finding, "severity" | "line" | "file"> & {
  line?: number;
  file?: string;
  severity?: Finding["severity"];
};

interface Problem {
  rule: string;
  message: string;
  fix: string;
  file?: string;
  severity?: Finding["severity"];
}

/** `data-module` name -> repo-relative file, to point a module's failure at its file. */
type ModuleFiles = Map<string, string>;

/** Collects what a page reports about itself, as problems of the given step. */
function watch(
  page: Page,
  step: string,
  rule: string,
  file: string,
  out: Problem[],
  files: ModuleFiles
) {
  const seen = new Set<string>();
  const push = (problem: Problem) => {
    const key = `${problem.severity ?? "error"}|${problem.file ?? file}|${problem.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(problem);
  };
  page.on("pageerror", (error) => {
    push({
      rule,
      file,
      message: `${step}: uncaught error: ${error.name}: ${error.message}`,
      fix: "Find the code that throws while the bundle loads and guard it, as src/webflow/detect-editor.ts guards document.body",
    });
  });
  page.on("console", (message) => {
    const verdict = classifyConsole({
      type: message.type(),
      text: message.text(),
    });
    if (verdict.kind === "ignore") return;
    if (verdict.kind === "warning") {
      push({
        rule: "runtime/console-warning",
        severity: "warning",
        file,
        message: `${step}: ${verdict.message}`,
        fix: "Fix what the warning describes, or remove the console.warn if it is expected",
      });
      return;
    }
    push({
      rule,
      file: verdict.module
        ? (files.get(verdict.module) ?? "src/modules")
        : file,
      message: `${step}: ${verdict.message}`,
      fix: verdict.module
        ? `Fix src/modules/${verdict.module}: its default function throws when it runs, and createCycles only logs that`
        : "Fix the error the console shows",
    });
  });
  page.on("response", (response) => {
    const request = response.request();
    if (request.resourceType() === "script" && response.status() >= 400) {
      const url = new URL(response.url());
      push({
        rule,
        file,
        message: `${step}: ${url.pathname} returned ${response.status()}`,
        fix: "Make sure the bundle is built and served at that path",
      });
    }
  });
}

/** What a step reports when the page stops answering: the page's fault, not the tool's. */
const isTimeout = (error: unknown) =>
  (error as Error)?.name === "TimeoutError" ||
  /Timeout \d+ms exceeded/.test(String((error as Error)?.message));

const stuck = (
  rule: string,
  step: string,
  file: string,
  what: string
): Problem => ({
  rule,
  file,
  message: `${step}: ${what}, so the page stopped responding`,
  fix: "Look for a module or page hook that loops forever, or blocks the main thread, while it loads or runs",
});

/** Modules in the page that createCycles never started. */
const notStarted = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-module]"))
      .filter((element) => !element._moduleInitialized)
      .map((element) => element.dataset.module ?? "")
  );

interface VisitOptions {
  /** Fail when a `[data-module]` element was left unstarted after loading. */
  expectStarted?: boolean;
  /** Runs after the page has settled, for checks that change the page. */
  after?: (page: Page) => Promise<void>;
}

async function visit(
  browser: Browser,
  url: string,
  step: string,
  rule: string,
  file: string,
  files: ModuleFiles,
  options: VisitOptions = {}
) {
  const context = await browser.newContext();
  const problems: Problem[] = [];
  try {
    const page = await context.newPage();
    watch(page, step, rule, file, problems, files);
    try {
      await page.goto(url, {
        waitUntil: "load",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      await page.waitForTimeout(SETTLE_MS);
      if (options.expectStarted) {
        const unstarted = await notStarted(page);
        if (unstarted.length > 0) {
          problems.push({
            rule,
            file,
            message: `${step}: ${unstarted.join(", ")} never started, so the bundle loaded without running createCycles()`,
            fix: "Make sure the entry imports the app (src/app.ts, which calls createCycles, runPageIn and runMount)",
          });
        }
      }
      await options.after?.(page);
    } catch (error) {
      if (!isTimeout(error)) throw error;
      problems.push(
        stuck(
          rule,
          step,
          file,
          `the page did not finish within ${NAVIGATION_TIMEOUT_MS}ms`
        )
      );
    }
  } finally {
    await context.close();
  }
  return problems;
}

/**
 * The editor turning on and off after load, as it does when the Designer
 * switches mode. The marker is the first child of <body>; the shared
 * MutationObserver then calls every onEditor callback.
 */
async function flipEditor(page: Page) {
  for (const marked of [true, false]) {
    await page.evaluate((on) => {
      if (on) {
        const node = document.createElement("div");
        node.className = "w-editor-publish-node";
        document.body.prepend(node);
      } else {
        document.querySelector(".w-editor-publish-node")?.remove();
      }
    }, marked);
    await page.evaluate(
      () =>
        new Promise((done) =>
          requestAnimationFrame(() => requestAnimationFrame(done))
        )
    );
    await page.waitForTimeout(FLIP_SETTLE_MS);
  }
}

const NAMES = ["createCycles", "runPageIn", "runMount"] as const;
const EFFECT: Record<(typeof NAMES)[number], string> = {
  createCycles: "no module would start",
  runPageIn: "onPageIn hooks would never run",
  runMount: "onMount hooks would never run",
};

/**
 * The calls the app entry must make on load. Nothing in the page shows that
 * onMount hooks ran, so this reads the source: `createCycles()`, `runPageIn()`
 * and `runMount()` must be called in src/app.ts, directly or through
 * `runInitial()` in src/lib/pages.ts. A call in a comment doesn't count.
 */
export function bootProblems(root: string): string[] {
  const callsIn = (file: string): Set<string> | null => {
    const full = path.join(root, file);
    if (!existsSync(full)) return null;
    const source = ts.createSourceFile(
      file,
      readFileSync(full, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const calls = new Set<string>();
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression))
        calls.add(node.expression.text);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return calls;
  };
  const appFile =
    ["src/app.ts", "src/app.js"].find((f) => existsSync(path.join(root, f))) ??
    "src/app.ts";
  const calls = callsIn(appFile);
  if (!calls) return [`${appFile} does not exist`];
  if (calls.has("runInitial")) {
    // runInitial() calls them for the app, so count what it calls.
    for (const call of callsIn("src/lib/pages.ts") ?? []) calls.add(call);
  }
  return NAMES.filter((name) => !calls.has(name)).map(
    (name) => `${appFile} never calls ${name}(), so ${EFFECT[name]}`
  );
}

const isFailure = (problem: Problem) =>
  problem.severity !== "warning" && problem.rule !== "runtime/console-warning";

const fixtureApi = (page: Page) => ({
  counts: () =>
    page.evaluate(() => (window as unknown as Fixture).__wdsCheck.counts()),
  setFixture: (html: string) =>
    page.evaluate(
      (value) => (window as unknown as Fixture).__wdsCheck.setFixture(value),
      html
    ),
  cycles: () =>
    page.evaluate(() => (window as unknown as Fixture).__wdsCheck.cycles()),
  pageIn: () =>
    page.evaluate(() => (window as unknown as Fixture).__wdsCheck.pageIn()),
  mount: () =>
    page.evaluate(() => (window as unknown as Fixture).__wdsCheck.mount()),
  pageOut: () =>
    page.evaluate(() => (window as unknown as Fixture).__wdsCheck.pageOut()),
  destroy: () =>
    page.evaluate(() => (window as unknown as Fixture).__wdsCheck.destroy()),
});

/** The lifecycle, driven directly because Taxi is off and real navigation would never call onDestroy. */
async function leakRun(
  browser: Browser,
  origin: string,
  markup: string,
  hookTimeoutMs: number,
  options: { editor: boolean; step: string; rule: string; files: ModuleFiles }
): Promise<Problem[]> {
  const { step, rule } = options;
  const context = await browser.newContext();
  const problems: Problem[] = [];
  try {
    await context.addInitScript(installCounters);
    const page = await context.newPage();
    watch(page, step, rule, "src/modules", problems, options.files);
    const api = fixtureApi(page);

    /** One call into the page. A call that never returns is the page's problem, so it is a finding. */
    const call = async <T>(
      name: string,
      run: () => Promise<T>
    ): Promise<{ value: T } | null> => {
      const timeout = Symbol("timeout");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const pending = run();
      try {
        const result = await Promise.race([
          pending,
          new Promise<typeof timeout>((resolve) => {
            timer = setTimeout(() => resolve(timeout), hookTimeoutMs);
          }),
        ]);
        if (result === timeout) {
          void pending.catch(() => {});
          problems.push(
            name === "runPageIn" || name === "runPageOut"
              ? {
                  rule: "runtime/hook-timeout",
                  file: "src/modules",
                  message: `${step}: ${name} did not settle within ${hookTimeoutMs}ms, so a page hook never resolves`,
                  fix: "Find the onPageIn or onPageOut hook that awaits something that never finishes, such as a GSAP tween that was killed. Finish a tween with progress(1) instead of kill()",
                }
              : stuck(
                  rule,
                  step,
                  "src/modules",
                  `${name} did not return within ${hookTimeoutMs}ms`
                )
          );
          return null;
        }
        return { value: result as T };
      } catch (error) {
        problems.push({
          rule,
          file: "src/modules",
          message: `${step}: ${name} threw: ${String((error as Error).message).split("\n")[0]}`,
          fix: "Fix the onMount or onDestroy callback that throws",
        });
        return null;
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      await page.goto(
        `${origin}/__page/${options.editor ? "leak-editor" : "leak"}.html`,
        { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS }
      );
    } catch (error) {
      if (!isTimeout(error)) throw error;
      problems.push(
        stuck(
          rule,
          step,
          "src/modules",
          `the page did not finish within ${NAVIGATION_TIMEOUT_MS}ms`
        )
      );
      return problems;
    }

    const baseline = (await call("counts", api.counts))?.value;
    const cycles: CycleCounts[] = [];
    for (let i = 0; baseline && i < CYCLES; i++) {
      if (!(await call("setFixture", () => api.setFixture(markup)))) break;
      const started = (await call("createCycles", api.cycles))?.value;
      if (!started) break;
      if (started.called === 0 || started.uninitialized.length > 0) {
        // A module that threw was already reported with its own message.
        if (!problems.some(isFailure)) {
          problems.push({
            rule,
            file: "src/modules",
            message: `${step}: createCycles did not start ${started.uninitialized.join(", ") || "any module"}, so nothing was tested`,
            fix: "Check that src/modules/_/create.ts finds the modules and that each fixture has its data-module element",
          });
        }
        break;
      }
      if (!(await call("runPageIn", api.pageIn))) break;
      if (!(await call("runMount", api.mount))) break;
      const mounted = (await call("counts", api.counts))?.value;
      if (!mounted) break;
      if (!(await call("runPageOut", api.pageOut))) break;
      if (!(await call("runDestroy", api.destroy))) break;
      const destroyed = (await call("counts", api.counts))?.value;
      if (!destroyed) break;
      cycles.push({ mounted, destroyed });
    }

    if (process.env.CHECK_DEBUG) {
      process.stderr.write(
        `${step}: baseline ${JSON.stringify(baseline)}\n${cycles.map((c, i) => `  cycle ${i + 1}: mounted ${JSON.stringify(c.mounted)} destroyed ${JSON.stringify(c.destroyed)}\n`).join("")}`
      );
    }

    // Counts after an aborted cycle say nothing about leaks.
    if (baseline && cycles.length === CYCLES && !problems.some(isFailure)) {
      for (const problem of compareCounts(baseline, cycles)) {
        problems.push({
          rule: "runtime/leak",
          file: "src/modules",
          message: `${step}: ${problem.message}`,
          fix: `A module registers something on mount and never undoes it: ${leakFix(problem.count)}`,
        });
      }
    }
  } finally {
    await context.close();
  }
  return problems;
}

async function taxiRun(
  browser: Browser,
  origin: string,
  files: ModuleFiles
): Promise<Problem[]> {
  const step = "Taxi navigation";
  const rule = "runtime/taxi";
  const context = await browser.newContext();
  const problems: Problem[] = [];
  try {
    const page = await context.newPage();
    watch(page, step, rule, "src/lib/pages.ts", problems, files);
    try {
      await page.goto(`${origin}/__taxi/a.html`, {
        waitUntil: "load",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      await page.waitForTimeout(SETTLE_MS);
      await page.evaluate(() => {
        (window as unknown as { __taxiMarker: string }).__taxiMarker =
          "same document";
      });

      for (const target of ["b", "a"]) {
        await page.click("#taxi-link", { timeout: NAVIGATION_TIMEOUT_MS });
        try {
          await page.waitForFunction(
            (title) =>
              document.querySelector("#taxi-title")?.textContent === title,
            `Taxi page ${target}`,
            { timeout: NAVIGATION_TIMEOUT_MS }
          );
        } catch {
          problems.push({
            rule,
            file: "src/lib/pages.ts",
            message: `${step}: following the link to page ${target} did not show page ${target} within ${NAVIGATION_TIMEOUT_MS}ms`,
            fix: "Check that links are not excluded in PAGES_CONFIG, that both pages have data-taxi and data-taxi-view, and that the transition calls done()",
          });
          break;
        }
        await page.waitForTimeout(SETTLE_MS);
        const marker = await page.evaluate(
          () => (window as unknown as { __taxiMarker?: string }).__taxiMarker
        );
        if (marker !== "same document") {
          problems.push({
            rule,
            file: "src/lib/pages.ts",
            message: `${step}: the link to page ${target} did a full page load, so Taxi is not handling navigation`,
            fix: "Make sure new _Pages() runs (src/lib/pages.ts, src/app.ts) and that the page wraps its content in data-taxi and data-taxi-view",
          });
          break;
        }
      }
    } catch (error) {
      if (!isTimeout(error)) throw error;
      problems.push(
        stuck(rule, step, "src/lib/pages.ts", "a step did not finish in time")
      );
    }
  } finally {
    await context.close();
  }
  return problems;
}

function productionEntries(outputs: string[]): string[] {
  return outputs.filter((file) => file.endsWith(".js")).sort();
}

async function buildBundles(
  root: string,
  productionDir: string,
  testDir: string
) {
  const result = await exec(
    [
      localBin(root, "bun"),
      "run",
      path.join(import.meta.dir, "runtime-build.ts"),
      productionDir,
      testDir,
    ],
    { cwd: root, env: { NODE_ENV: "production" } }
  );
  if (result.code === 2) {
    throw new ToolFailure(
      `could not start the bundle build: ${excerpt(result.stderr)}`
    );
  }
  if (result.code !== 0)
    return { error: excerpt(`${result.stderr}\n${result.stdout}`, 3) };
  const last = result.stdout.trim().split("\n").pop() ?? "";
  try {
    const parsed = JSON.parse(last) as { production: string[]; test: string[] };
    return { entries: productionEntries(parsed.production) };
  } catch {
    throw new ToolFailure(
      `bundle build printed something unexpected: ${excerpt(result.stdout)}`
    );
  }
}

export const runtime: Check = {
  name: "runtime",
  tier: "all",
  async run({ root }) {
    const config = readChecksConfig(root);
    const modules = listModules(root);
    requireModules(modules);
    const files: ModuleFiles = new Map(modules.map((m) => [m.name, m.file]));

    const findings: Finding[] = [];
    const add = (draft: Draft) =>
      findings.push({ severity: "error", line: 1, file: "src", ...draft });

    const fixtures = fixtureProblems(root, modules);
    for (const message of fixtures) {
      add({
        rule: "runtime/fixture",
        file: "src/modules",
        message,
        fix: "Put an element with the module's data-module attribute in the .fixture.html file, or delete the file",
      });
    }
    if (fixtures.length > 0) return toResult("runtime", findings);

    const tmp = mkdtempSync(path.join(tmpdir(), "runtime-check-"));
    // A killed run must not leave Chromium or its folder behind.
    const forget = onTerminate(async () => {
      await browser?.close().catch(() => {});
      rmSync(tmp, { recursive: true, force: true });
    });
    const productionDir = path.join(tmp, "production");
    const testDir = path.join(tmp, "test");
    let browser: Browser | undefined;
    let server: ReturnType<typeof Bun.serve> | undefined;
    // Closing the browser ends whatever step is stuck, and the catch below says why.
    let timedOut = false;
    const watchdog = setTimeout(() => {
      timedOut = true;
      void browser?.close().catch(() => {});
    }, RUN_TIMEOUT_MS);
    const emit = (problems: Problem[]) => {
      for (const { rule, message, fix, file, severity } of problems) {
        add({
          rule,
          message,
          fix,
          ...(file ? { file } : {}),
          ...(severity ? { severity } : {}),
        });
      }
    };

    try {
      const built = await buildBundles(root, productionDir, testDir);
      if (!built.entries) {
        add({
          rule: "runtime/build",
          file: "src",
          message: `Building the bundles for the browser run failed: ${built.error}`,
          fix: "Run pnpm build and fix the error it prints",
        });
        return toResult("runtime", findings);
      }
      const entries = built.entries;
      if (!entries.includes("app.js")) {
        add({
          rule: "runtime/build",
          file: "src/app.ts",
          message: "The production build made no app.js",
          fix: "Make sure src/app.ts exists",
        });
        return toResult("runtime", findings);
      }

      // -- Pages and server
      const markup = allMarkup(root, modules);
      const pageFor = (pathname: string): string | null => {
        const [, kind, id] =
          /^\/__page\/([a-z-]+)(?:\/(\d+))?\.html$/.exec(pathname) ?? [];
        const entry = id ? entries[Number(id)] : undefined;
        switch (kind) {
          case "normal":
            return entry ? normalPage(`/${entry}`, markup, config.taxi) : null;
          case "early":
            return entry ? earlyPage(`/${entry}`, markup, config.taxi) : null;
          case "editor":
            return entry ? editorPage(`/${entry}`, markup, config.taxi) : null;
          case "leak":
            return leakPage("/__test/fixture-entry.js", false, config.taxi);
          case "leak-editor":
            return leakPage("/__test/fixture-entry.js", true, config.taxi);
          default:
            return null;
        }
      };
      server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(request) {
          const { pathname } = new URL(request.url);
          const html = (body: string) =>
            new Response(body, {
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          if (pathname === "/favicon.ico")
            return new Response(FAVICON, {
              headers: { "content-type": "image/png" },
            });
          const taxi = /^\/__taxi\/([ab])\.html$/.exec(pathname);
          if (taxi)
            return html(taxiPage("/app.js", taxi[1] as "a" | "b", markup));
          const generated = pageFor(pathname);
          if (generated) return html(generated);
          const dir = pathname.startsWith("/__test/") ? testDir : productionDir;
          const relative = pathname
            .replace(/^\/__test\//, "")
            .replace(/^\//, "");
          const file = path.resolve(dir, relative);
          if (
            file.startsWith(dir + path.sep) &&
            existsSync(file) &&
            file.endsWith(".js")
          ) {
            return new Response(Bun.file(file), {
              headers: { "content-type": "text/javascript; charset=utf-8" },
            });
          }
          return new Response("Not found", { status: 404 });
        },
      });
      const origin = `http://127.0.0.1:${server.port}`;

      // -- Browser
      try {
        const { chromium } = await import("playwright");
        browser = await chromium.launch();
      } catch (error) {
        throw new ToolFailure(
          `Chromium could not start: ${String((error as Error).message).split("\n")[0]}. Install it with: ${INSTALL}`,
          { fix: INSTALL }
        );
      }
      const chromium = browser;

      // 1. Normal load, then 2. early load, for every built entry
      for (const message of bootProblems(root)) {
        add({
          rule: "runtime/normal-load",
          file: entrySource(root, "app.js"),
          message: `Normal load: ${message}`,
          fix: "Call createCycles(), runPageIn() and runMount() from src/app.ts, as the template does",
        });
      }
      await Promise.all(
        entries.flatMap((entry, index) => {
          const file = entrySource(root, entry);
          return [
            visit(
              chromium,
              `${origin}/__page/normal/${index}.html`,
              `Normal load (${entry})`,
              "runtime/normal-load",
              file,
              files,
              { expectStarted: true }
            ).then(emit),
            visit(
              chromium,
              `${origin}/__page/early/${index}.html`,
              `Early load (${entry})`,
              "runtime/early-load",
              file,
              files
            ).then(emit),
          ];
        })
      );

      // 3. Leak test with the test bundle, 4. then the same lifecycle with the editor marker present
      const lifecycle = async (options: {
        editor: boolean;
        step: string;
        rule: string;
      }) => {
        const run = (markupOf: string, step: string) =>
          leakRun(chromium, origin, markupOf, config.hookTimeoutMs, {
            ...options,
            step,
            files,
          });
        const combined = await run(markup, options.step);
        if (!combined.some(isFailure)) return emit(combined);

        // Run each module alone to say which one it is.
        let attributed = false;
        for (const module of modules) {
          const alone = await run(
            moduleMarkup(root, module),
            `${options.step} (${module.name})`
          );
          if (alone.some(isFailure)) attributed = true;
          emit(
            alone.map((p) => ({
              ...p,
              file: p.file === "src/modules" ? module.file : p.file,
            }))
          );
        }
        if (!attributed) {
          emit(
            combined.map((p) => ({
              ...p,
              message: `${p.message} (only when the modules run together)`,
            }))
          );
        }
      };
      await lifecycle({
        editor: false,
        step: "Leak test",
        rule: "runtime/leak",
      });

      // 4. Editor load of every entry, then the editor turning on and off after load, then the lifecycle once more
      await Promise.all(
        entries.flatMap((entry, index) => {
          const file = entrySource(root, entry);
          return [
            visit(
              chromium,
              `${origin}/__page/editor/${index}.html`,
              `Editor load (${entry})`,
              "runtime/editor-load",
              file,
              files,
              { expectStarted: true }
            ).then(emit),
            visit(
              chromium,
              `${origin}/__page/normal/${index}.html`,
              `Editor switch (${entry})`,
              "runtime/editor-load",
              file,
              files,
              { after: flipEditor }
            ).then(emit),
          ];
        })
      );
      await lifecycle({
        editor: true,
        step: "Editor lifecycle",
        rule: "runtime/editor-load",
      });

      // 5. Taxi navigation, only when the project has turned Taxi on
      if (config.taxi) emit(await taxiRun(chromium, origin, files));
    } catch (error) {
      if (timedOut) {
        throw new ToolFailure(
          `the browser run did not finish within ${RUN_TIMEOUT_MS / 1000}s`
        );
      }
      throw error;
    } finally {
      forget();
      clearTimeout(watchdog);
      await browser?.close().catch(() => {});
      server?.stop(true);
      rmSync(tmp, { recursive: true, force: true });
    }
    return toResult("runtime", findings);
  },
};
