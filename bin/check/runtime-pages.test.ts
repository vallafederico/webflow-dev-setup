import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  allMarkup,
  earlyPage,
  editorPage,
  leakPage,
  entrySource,
  fixtureProblems,
  listModules,
  moduleMarkup,
  normalPage,
  requireModules,
  taxiPage,
} from "./runtime-pages";
import { bootProblems } from "./runtime";
import { ToolFailure } from "./types";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), "runtime-pages-"));
  dirs.push(root);
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

describe("listModules", () => {
  test("is what the module glob would load, minus tests and declarations", () => {
    const root = repo({
      "src/modules/nav.ts": "",
      "src/modules/slider.js": "",
      "src/modules/nav.test.ts": "",
      "src/modules/types.d.ts": "",
      "src/modules/nav.fixture.html": "<div></div>",
      "src/modules/_/runner.ts": "",
      "src/modules/.hidden.ts": "",
    });
    expect(listModules(root)).toEqual([
      { name: "nav", file: "src/modules/nav.ts" },
      { name: "slider", file: "src/modules/slider.js" },
    ]);
  });

  test("an empty module list is a tool failure, since the run would test nothing", () => {
    expect(() => requireModules(listModules(repo({})))).toThrow(ToolFailure);
    expect(() =>
      requireModules(listModules(repo({ "src/modules/_/a.ts": "" })))
    ).toThrow(ToolFailure);
  });
});

describe("fixtures", () => {
  const root = repo({
    "src/modules/nav.ts": "",
    "src/modules/form.ts": "",
    "src/modules/form.fixture.html": '<form data-module="form"><input></form>',
    "src/modules/bad.ts": "",
    "src/modules/bad.fixture.html": "<div>no module here</div>",
  });
  const modules = listModules(root);

  test("a module gets one element, or its own fixture markup", () => {
    const byName = Object.fromEntries(modules.map((m) => [m.name, m]));
    const { nav, form } = byName as Record<string, (typeof modules)[number]>;
    expect(moduleMarkup(root, nav as never)).toBe(
      '<div data-module="nav">Fixture text for nav</div>'
    );
    expect(moduleMarkup(root, form as never)).toContain("<form");
    expect(allMarkup(root, [nav, form] as never)).toContain(
      'data-module="form"'
    );
    expect(modules.map((m) => m.name)).toEqual(["bad", "form", "nav"]);
  });

  test("a fixture that never starts its module is reported", () => {
    expect(fixtureProblems(root, modules)).toEqual([
      'src/modules/bad.fixture.html has no element with data-module="bad", so the module would never run',
    ]);
  });
});

describe("pages", () => {
  test("the early page loads the script from <head>, the others from the end of <body>", () => {
    const early = earlyPage("/app.js", "<p>m</p>");
    expect(early.indexOf("/app.js")).toBeLessThan(early.indexOf("<body>"));
    const normal = normalPage("/app.js", "<p>m</p>");
    expect(normal.indexOf("/app.js")).toBeGreaterThan(normal.indexOf("<body>"));
    for (const html of [early, normal]) expect(html).toContain('rel="icon"');
  });

  test("with Taxi on the early script is deferred, as the loader writes it", () => {
    expect(earlyPage("/app.js", "", true)).toContain(
      '<script defer src="/app.js">'
    );
    expect(earlyPage("/app.js", "")).toContain('<script src="/app.js">');
  });

  test("the editor marker is the first child of body", () => {
    const html = editorPage("/app.js", "");
    expect(html).toMatch(/<body><div class="w-editor-publish-node"><\/div>/);
  });

  test("with Taxi on, every fixture page is wrapped, because Taxi's constructor needs [data-taxi]", () => {
    for (const html of [
      normalPage("/app.js", "", true),
      earlyPage("/app.js", "", true),
      editorPage("/app.js", "", true),
      leakPage("/t.js", false, true),
    ]) {
      expect(html).toContain("<div data-taxi><div data-taxi-view>");
    }
    expect(normalPage("/app.js", "")).not.toContain("data-taxi");
    expect(editorPage("/app.js", "", true)).toMatch(
      /<body><div class="w-editor-publish-node"><\/div>/
    );
  });

  test("taxi pages are wrapped the way Taxi expects and link to each other", () => {
    const html = taxiPage("/app.js", "a", "");
    expect(html).toContain("<div data-taxi><div data-taxi-view>");
    expect(html).toContain('href="/__taxi/b.html"');
  });

  test("entries map back to their source file", () => {
    const root = repo({ "src/app.ts": "" });
    expect(entrySource(root, "app.js")).toBe("src/app.ts");
    expect(entrySource(root, "pages/about.js")).toBe("src/pages/about.js");
  });
});

describe("bootProblems", () => {
  const app = (body: string) => ({
    "src/app.ts": `class A { constructor() {\n${body}\n} }`,
  });
  const all = "createCycles(); runPageIn(); runMount();";

  test("an app that makes all three calls has no problems", () => {
    expect(bootProblems(repo(app(all)))).toEqual([]);
  });

  test.each([
    ["createCycles", "runPageIn(); runMount();", "no module would start"],
    [
      "runPageIn",
      "createCycles(); runMount();",
      "onPageIn hooks would never run",
    ],
    [
      "runMount",
      "createCycles(); runPageIn();",
      "onMount hooks would never run",
    ],
  ])("a missing %s is named with what it would break", (name, body, effect) => {
    expect(bootProblems(repo(app(body)))).toEqual([
      `src/app.ts never calls ${name}(), so ${effect}`,
    ]);
  });

  test("a call in a comment doesn't count", () => {
    const problems = bootProblems(
      repo(
        app("createCycles(); runPageIn();\n// runMount();\n/* runMount() */")
      )
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("runMount");
  });

  test("runInitial() counts when src/lib/pages.ts makes the calls", () => {
    const files = {
      ...app("runInitial();"),
      "src/lib/pages.ts": `export function runInitial() { ${all} }`,
    };
    expect(bootProblems(repo(files))).toEqual([]);
    expect(
      bootProblems(
        repo({
          ...files,
          "src/lib/pages.ts":
            "export function runInitial() { createCycles(); }",
        })
      )
    ).toHaveLength(2);
  });

  test("a missing app is reported", () => {
    expect(bootProblems(repo({}))).toEqual(["src/app.ts does not exist"]);
  });
});
