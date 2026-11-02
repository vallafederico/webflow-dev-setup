import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Browser, Page } from "playwright";
import { readChecksConfig } from "./checks-config";
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

async function visit(
  browser: Browser,
  url: string,
  step: string,
  rule: string,
  file: string,
  files: ModuleFiles
) {
  const context = await browser.newContext();
  const problems: Problem[] = [];
  try {
    const page = await context.newPage();
    watch(page, step, rule, file, problems, files);
    await page.goto(url, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
  } finally {
    await context.close();
  }
  return problems;
}

type Phase = "runPageIn" | "runPageOut";

const isFailure = (problem: Problem) =>
  problem.severity !== "warning" && problem.rule !== "runtime/console-warning";

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
    const page = await context.newPage();
    watch(page, step, rule, "src/modules", problems, options.files);
    await page.goto(
      `${origin}/__page/${options.editor ? "leak-editor" : "leak"}.html`,
      {
        waitUntil: "load",
        timeout: NAVIGATION_TIMEOUT_MS,
      }
    );

    const counts = () =>
      page.evaluate(() =>
        (window as unknown as Fixture).__wdsCheck.counts()
      ) as Promise<Counts>;
    const baseline = await counts();
    const cycles: CycleCounts[] = [];

    const hook = async (phase: Phase): Promise<boolean> => {
      const call =
        phase === "runPageIn"
          ? page.evaluate(() =>
              (window as unknown as Fixture).__wdsCheck.pageIn()
            )
          : page.evaluate(() =>
              (window as unknown as Fixture).__wdsCheck.pageOut()
            );
      const timeout = Symbol("timeout");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        call.then(() => "settled" as const),
        new Promise<typeof timeout>((resolve) => {
          timer = setTimeout(() => resolve(timeout), hookTimeoutMs);
        }),
      ]);
      clearTimeout(timer);
      if (result === timeout) {
        void call.catch(() => {});
        problems.push({
          rule: "runtime/hook-timeout",
          file: "src/modules",
          message: `${step}: ${phase} did not settle within ${hookTimeoutMs}ms, so a page hook never resolves`,
          fix: "Find the onPageIn or onPageOut hook that awaits something that never finishes, such as a GSAP tween that was killed. Finish a tween with progress(1) instead of kill()",
        });
        return false;
      }
      return true;
    };

    const sync = async (
      name: string,
      run: () => Promise<unknown>
    ): Promise<boolean> => {
      try {
        await run();
        return true;
      } catch (error) {
        problems.push({
          rule,
          file: "src/modules",
          message: `${step}: ${name} threw: ${String((error as Error).message).split("\n")[0]}`,
          fix: "Fix the onMount or onDestroy callback that throws",
        });
        return false;
      }
    };

    for (let i = 0; i < CYCLES; i++) {
      await page.evaluate(
        (html) => (window as unknown as Fixture).__wdsCheck.setFixture(html),
        markup
      );
      const started = await page.evaluate(() =>
        (window as unknown as Fixture).__wdsCheck.cycles()
      );
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
      if (!(await hook("runPageIn"))) break;
      if (
        !(await sync("runMount", () =>
          page.evaluate(() => (window as unknown as Fixture).__wdsCheck.mount())
        ))
      )
        break;
      const mounted = await counts();
      if (!(await hook("runPageOut"))) break;
      if (
        !(await sync("runDestroy", () =>
          page.evaluate(() =>
            (window as unknown as Fixture).__wdsCheck.destroy()
          )
        ))
      )
        break;
      cycles.push({ mounted, destroyed: await counts() });
    }

    if (process.env.CHECK_DEBUG) {
      process.stderr.write(
        `${step}: baseline ${JSON.stringify(baseline)}\n${cycles.map((c, i) => `  cycle ${i + 1}: mounted ${JSON.stringify(c.mounted)} destroyed ${JSON.stringify(c.destroyed)}\n`).join("")}`
      );
    }

    // Counts after an aborted cycle say nothing about leaks.
    if (cycles.length === CYCLES && !problems.some(isFailure)) {
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

/** Wiring Taxi needs, read from source so a failure can say what's missing. */
export function taxiWiringProblems(root: string): string[] {
  const live = (file: string) => {
    const full = path.join(root, file);
    if (!existsSync(full)) return null;
    return readFileSync(full, "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
  };
  const problems: string[] = [];
  const app = live("src/app.ts") ?? live("src/app.js");
  const pages = live("src/lib/pages.ts");
  if (!pages || !/export\s+const\s+Pages\s*=\s*new\s+_Pages\s*\(/.test(pages)) {
    problems.push(
      "src/lib/pages.ts does not create Pages (`export const Pages = new _Pages();` is missing or commented out)"
    );
  }
  if (!app || !/\bpages\s*=\s*Pages\b/.test(app)) {
    problems.push(
      "src/app.ts does not set `pages = Pages` (it is missing or commented out)"
    );
  }
  if (
    !app ||
    !/import\s*\{[^}]*\bPages\b[^}]*\}\s*from\s*["']@lib\/pages["']/.test(app)
  ) {
    problems.push(
      'src/app.ts does not import { Pages } from "@lib/pages" (missing or commented out)'
    );
  }
  return problems;
}

async function taxiRun(
  browser: Browser,
  origin: string,
  root: string,
  files: ModuleFiles
): Promise<Problem[]> {
  const step = "Taxi navigation";
  const rule = "runtime/taxi";
  const wiring = taxiWiringProblems(root);
  if (wiring.length > 0) {
    return [
      {
        rule,
        file: "src/app.ts",
        message: `${step}: checks.config.json has "taxi": true, but Taxi is not wired: ${wiring.join("; ")}`,
        fix: 'Enable Taxi (see the webflow-page-transitions skill), or set "taxi" to false in checks.config.json',
      },
    ];
  }
  const context = await browser.newContext();
  const problems: Problem[] = [];
  try {
    const page = await context.newPage();
    watch(page, step, rule, "src/lib/pages.ts", problems, files);
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
      await page.click("#taxi-link");
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
          fix: "Make sure new _Pages() runs (src/lib/pages.ts) and that the page wraps its content in data-taxi and data-taxi-view",
        });
        break;
      }
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
            return editorPage("/app.js", markup, config.taxi);
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
              files
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

      // 4. Editor load: the production bundle, and the lifecycle once more
      emit(
        await visit(
          chromium,
          `${origin}/__page/editor/0.html`,
          "Editor load",
          "runtime/editor-load",
          "src/app.ts",
          files
        )
      );
      await lifecycle({
        editor: true,
        step: "Editor lifecycle",
        rule: "runtime/editor-load",
      });

      // 5. Taxi navigation, only when the project has turned Taxi on
      if (config.taxi) emit(await taxiRun(chromium, origin, root, files));
    } catch (error) {
      if (timedOut) {
        throw new ToolFailure(
          `the browser run did not finish within ${RUN_TIMEOUT_MS / 1000}s`
        );
      }
      throw error;
    } finally {
      clearTimeout(watchdog);
      await browser?.close().catch(() => {});
      server?.stop(true);
      rmSync(tmp, { recursive: true, force: true });
    }
    return toResult("runtime", findings);
  },
};

if (import.meta.main) {
  // `pnpm check:runtime`: this check alone, with the same output and exit codes as pnpm check.
  // Not awaited at the top level: index.ts imports the registry, which imports
  // this file, and a pending top-level await here would deadlock that cycle.
  void import("./single")
    .then(({ main }) => main(runtime, process.argv.slice(2)))
    .then((code) => process.exit(code));
}
