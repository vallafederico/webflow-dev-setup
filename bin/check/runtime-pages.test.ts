import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  allMarkup,
  earlyPage,
  editorPage,
  entrySource,
  fixtureProblems,
  listModules,
  moduleMarkup,
  normalPage,
  requireModules,
  taxiPage,
} from "./runtime-pages";
import { taxiWiringProblems } from "./runtime";
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

  test("the editor marker is the first child of body", () => {
    const html = editorPage("/app.js", "");
    expect(html).toMatch(/<body><div class="w-editor-publish-node"><\/div>/);
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

describe("taxiWiringProblems", () => {
  const wired = {
    "src/app.ts":
      'import { Pages } from "@lib/pages";\nclass A { pages = Pages; }',
    "src/lib/pages.ts": "export const Pages = new _Pages();",
  };

  test("a wired project has no problems", () => {
    expect(taxiWiringProblems(repo(wired))).toEqual([]);
  });

  test("the template, with Taxi commented out, lists what's missing", () => {
    const problems = taxiWiringProblems(
      repo({
        "src/app.ts":
          '// import { Pages } from "@lib/pages";\n  // pages = Pages;',
        "src/lib/pages.ts": "// export const Pages = new _Pages();",
      })
    );
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("src/lib/pages.ts");
    expect(problems[1]).toContain("pages = Pages");
  });
});
