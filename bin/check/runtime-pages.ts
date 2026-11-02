import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ToolFailure } from "./types";

export interface ModuleFile {
  /** The `data-module` value. */
  name: string;
  /** Repo-relative path, such as src/modules/nav.ts. */
  file: string;
}

/**
 * What `src/modules/_/create.ts` would find: `src/modules/*.{ts,js}`. Test
 * files and type declarations are bundled by the glob but are not modules.
 */
export function listModules(root: string): ModuleFile[] {
  const dir = path.join(root, "src", "modules");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(ts|js)$/.test(entry.name) &&
        !/\.(d|test|spec)\.(ts|js)$/.test(entry.name) &&
        !entry.name.startsWith(".")
    )
    .map((entry) => ({
      name: entry.name.replace(/\.(ts|js)$/, ""),
      file: `src/modules/${entry.name}`,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The markup that exercises one module: its `.fixture.html` if it has one, else a single element. */
export function moduleMarkup(root: string, module: ModuleFile): string {
  const override = path.join(
    root,
    "src",
    "modules",
    `${module.name}.fixture.html`
  );
  if (existsSync(override)) return readFileSync(override, "utf8");
  return `<div data-module="${escapeHtml(module.name)}">Fixture text for ${escapeHtml(module.name)}</div>`;
}

/** Fixture files that never start their module, which would let it skip every check. */
export function fixtureProblems(root: string, modules: ModuleFile[]): string[] {
  const problems: string[] = [];
  for (const module of modules) {
    const markup = moduleMarkup(root, module);
    const pattern = new RegExp(
      `data-module\\s*=\\s*["']?${module.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\\s>]`
    );
    if (!pattern.test(markup)) {
      problems.push(
        `src/modules/${module.name}.fixture.html has no element with data-module="${module.name}", so the module would never run`
      );
    }
  }
  return problems;
}

export function allMarkup(root: string, modules: ModuleFile[]): string {
  return modules.map((module) => moduleMarkup(root, module)).join("\n");
}

const HEAD = `<meta charset="utf-8"><title>fixture</title><link rel="icon" href="/favicon.ico">`;
const page = (head: string, body: string) =>
  `<!doctype html><html lang="en"><head>${HEAD}${head}</head><body>${body}</body></html>`;

const EDITOR_NODE = '<div class="w-editor-publish-node"></div>';

/**
 * The fixture root, wrapped the way Taxi needs when the project has turned it
 * on: its constructor reads `[data-taxi]` and throws on a page without one.
 */
const root = (markup: string, taxi: boolean) =>
  taxi
    ? `<div data-taxi><div data-taxi-view><main id="fixture-root">${markup}</main></div></div>`
    : `<main id="fixture-root">${markup}</main>`;

/** The production bundle at the end of <body>, as Webflow's footer code loads it. */
export function normalPage(script: string, markup: string, taxi = false) {
  return page("", `${root(markup, taxi)}<script src="${script}"></script>`);
}

/**
 * The bundle from a synchronous <script> in <head>, which runs before <body>
 * exists. With Taxi on it is `defer`, as the loader writes it for production:
 * Taxi's constructor needs the page's [data-taxi] element, which a script that
 * runs before the body is parsed can never find.
 */
export function earlyPage(script: string, markup: string, taxi = false) {
  return page(
    `<script${taxi ? " defer" : ""} src="${script}"></script>`,
    root(markup, taxi)
  );
}

/** Webflow's editor marks the page with this node as the first child of <body>. */
export function editorPage(script: string, markup: string, taxi = false) {
  return page(
    "",
    `${EDITOR_NODE}${root(markup, taxi)}<script src="${script}"></script>`
  );
}

/** An empty fixture root, so nothing mounts until the test drives the lifecycle. */
export function leakPage(testScript: string, editor = false, taxi = false) {
  return page(
    "",
    `${editor ? EDITOR_NODE : ""}${root("", taxi)}<script src="${testScript}"></script>`
  );
}

/** Two pages wrapped the way Taxi expects, each linking to the other. */
export function taxiPage(
  script: string,
  which: "a" | "b",
  markup: string
): string {
  const other = which === "a" ? "b" : "a";
  const content = `<h1 id="taxi-title">Taxi page ${which}</h1><a id="taxi-link" href="/__taxi/${other}.html">Go to ${other}</a>${markup}`;
  return page("", `${root(content, true)}<script src="${script}"></script>`);
}

/** Source file behind a built entry, to point findings at. */
export function entrySource(root: string, entry: string): string {
  if (entry === "app.js") {
    for (const candidate of ["src/app.ts", "src/app.js"]) {
      if (existsSync(path.join(root, candidate))) return candidate;
    }
    return "src";
  }
  const page = /^pages\/(.+)\.js$/.exec(entry);
  return page ? `src/pages/${page[1]}.js` : "src";
}

export function requireModules(modules: ModuleFile[]): void {
  if (modules.length === 0) {
    throw new ToolFailure(
      "no module found in src/modules/*.{ts,js}, so the browser run would test nothing",
      {
        fix: "Add a module with pnpm new:module <name>, or fix the path src/modules/",
      }
    );
  }
}

/** A 1x1 transparent PNG, served as the favicon so a missing one never reads as an error. */
export const FAVICON = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);
