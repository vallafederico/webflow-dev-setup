import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateLoaderScript, generateResponse } from "./generateResponse";

const DEP = "https://acme.itsoffbrand.dev";
const LOC = "http://localhost:6545";
const SUFFIX = "-acme.team.workers.dev";
const PREVIEW = `https://feat-x${SUFFIX}`;

interface El {
  tag: string;
  src?: string;
  href?: string;
  rel?: string;
  as?: string;
  defer?: boolean;
  onerror?: () => void;
}

interface LoaderOptions {
  search?: string;
  host?: string;
  pathname?: string;
  /** `document.readyState` when the loader runs. */
  readyState?: string;
  /** `document.currentScript`: truthy while the parser is running the loader's own tag. */
  currentScript?: object | null;
  /** `(pointer: coarse)`: a phone or tablet, which can't reach the developer's localhost. */
  coarse?: boolean;
  /** Shared between runs to model one tab's sessionStorage across reloads. */
  store?: Map<string, string>;
}

/** Runs the generated loader against fakes and returns what it did to the page. */
function runLoader(loader: string, opts: LoaderOptions = {}) {
  const {
    search = "",
    host = "site.webflow.io",
    pathname = "/",
    readyState = "complete",
    currentScript = null,
    coarse = true,
    store = new Map<string, string>(),
  } = opts;
  const code = loader.replace(/^<script>/, "").replace(/<\/script>$/, "");
  const appended: El[] = [];
  const written: string[] = [];
  const document = {
    head: { appendChild: (el: El) => appended.push(el) },
    readyState,
    currentScript,
    createElement: (tag: string): El => ({ tag }),
    write: (html: string) => void written.push(html),
  };
  const location = { hostname: host, search, pathname };
  const sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const matchMedia = () => ({ matches: coarse });
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const info = spyOn(console, "info").mockImplementation(() => {});
  try {
    new Function("document", "location", "sessionStorage", "matchMedia", code)(
      document,
      location,
      sessionStorage,
      matchMedia
    );
    return {
      appended,
      written,
      store,
      warnings: warn.mock.calls,
      get scripts() {
        return appended.filter((e) => e.tag === "script");
      },
      get links() {
        return appended.filter((e) => e.tag === "link");
      },
      /** Runs after the loader, so a failure handler's own appends show up in `appended`. */
      fail: (el: El) => el.onerror?.(),
    };
  } finally {
    warn.mockRestore();
    info.mockRestore();
  }
}

const loaderFor = (suffix: string, pageJs: string[] = []) =>
  generateLoaderScript("app.js", pageJs, ["app.css"], DEP, LOC, suffix);
const srcs = (els: El[]) => els.map((e) => e.src);
const hrefs = (els: El[]) => els.map((e) => e.href);

describe("loader preview allowlist", () => {
  test("with no suffix, ?js=https://anything is refused and warned about", () => {
    const { scripts, warnings } = runLoader(loaderFor(""), {
      search: "?js=https://anything",
    });
    expect(srcs(scripts)).toEqual([`${DEP}/app.js`]);
    expect(warnings.length).toBe(1);
    expect(String(warnings[0][0])).toContain("[loader] ignoring js preview");
  });

  test("with no suffix, even a *.vercel.app or *.workers.dev URL is refused", () => {
    for (const url of [
      "https://x.vercel.app",
      "https://x-acme.team.workers.dev",
      "https://",
    ]) {
      const { scripts } = runLoader(loaderFor(""), { search: `?js=${url}` });
      expect(srcs(scripts)).toEqual([`${DEP}/app.js`]);
    }
  });

  test("with a suffix, a matching preview is used", () => {
    const { scripts, warnings } = runLoader(loaderFor(SUFFIX), {
      search: `?js=${PREVIEW}`,
    });
    expect(srcs(scripts)).toEqual([`${PREVIEW}/app.js`]);
    expect(warnings.length).toBe(0);
  });

  test("a preview given without a scheme is treated as https", () => {
    const { scripts } = runLoader(loaderFor(SUFFIX), {
      search: `?js=feat-x${SUFFIX}`,
    });
    expect(srcs(scripts)).toEqual([`${PREVIEW}/app.js`]);
  });

  test("with a suffix, other hosts and plain http are refused", () => {
    for (const url of [
      "https://anything",
      "https://evil.example.com",
      `http://feat-x${SUFFIX}`,
    ]) {
      const { scripts, warnings } = runLoader(loaderFor(SUFFIX), {
        search: `?js=${url}`,
      });
      expect(srcs(scripts)).toEqual([`${DEP}/app.js`]);
      expect(warnings.length).toBe(1);
    }
  });

  test("previews are ignored off .webflow.io", () => {
    const { scripts } = runLoader(loaderFor(SUFFIX), {
      host: "www.example.com",
      search: `?js=${PREVIEW}`,
    });
    expect(srcs(scripts)).toEqual([`${DEP}/app.js`]);
  });
});

describe("loader preview state", () => {
  test("a preview is remembered for the tab, and ?js=off clears it", () => {
    const store = new Map<string, string>();
    const loader = loaderFor(SUFFIX);

    runLoader(loader, { search: `?js=${PREVIEW}`, store });
    expect(store.get("wf-preview-js")).toBe(PREVIEW);

    const reload = runLoader(loader, { store });
    expect(srcs(reload.scripts)).toEqual([`${PREVIEW}/app.js`]);

    const off = runLoader(loader, { search: "?js=off", store });
    expect(srcs(off.scripts)).toEqual([`${DEP}/app.js`]);
    expect(store.has("wf-preview-js")).toBe(false);

    const after = runLoader(loader, { store });
    expect(srcs(after.scripts)).toEqual([`${DEP}/app.js`]);
  });

  test("?css=off clears only the css preview", () => {
    const store = new Map<string, string>();
    const loader = loaderFor(SUFFIX);
    runLoader(loader, { search: `?js=${PREVIEW}&css=${PREVIEW}`, store });
    expect(store.has("wf-preview-css")).toBe(true);

    const run = runLoader(loader, { search: "?css=off", store });
    expect(store.has("wf-preview-css")).toBe(false);
    expect(store.get("wf-preview-js")).toBe(PREVIEW);
    expect(hrefs(run.links)).toEqual([`${DEP}/app.css`]);
    expect(srcs(run.scripts)).toEqual([`${PREVIEW}/app.js`]);
  });

  test("?js=none loads no script but still loads css, and is remembered", () => {
    const store = new Map<string, string>();
    const loader = loaderFor(SUFFIX);

    const run = runLoader(loader, { search: "?js=none", store });
    expect(run.scripts).toEqual([]);
    expect(run.written).toEqual([]);
    expect(hrefs(run.links)).toEqual([`${DEP}/app.css`]);
    expect(store.get("wf-preview-js")).toBe("none");

    const reload = runLoader(loader, { store });
    expect(reload.scripts).toEqual([]);

    const off = runLoader(loader, { search: "?js=off", store });
    expect(srcs(off.scripts)).toEqual([`${DEP}/app.js`]);
  });

  test("?css=none loads no css but still loads the script", () => {
    const run = runLoader(loaderFor(SUFFIX), { search: "?css=none" });
    expect(run.links).toEqual([]);
    expect(srcs(run.scripts)).toEqual([`${DEP}/app.js`]);
  });

  test("none is accepted even with no suffix, since it loads nothing", () => {
    const run = runLoader(loaderFor(""), { search: "?js=none&css=none" });
    expect(run.appended).toEqual([]);
    expect(run.warnings.length).toBe(0);
  });

  test("a preview skips localhost even on a desktop", () => {
    const run = runLoader(loaderFor(SUFFIX), {
      search: `?js=${PREVIEW}`,
      coarse: false,
    });
    expect(srcs(run.scripts)).toEqual([`${PREVIEW}/app.js`]);
    expect(run.links.some((l) => l.rel === "preload")).toBe(false);
  });
});

describe("loader script insertion", () => {
  test("while the parser runs the loader, it writes a deferred tag", () => {
    const run = runLoader(loaderFor(SUFFIX), {
      readyState: "loading",
      currentScript: {},
    });
    expect(run.written).toEqual([
      `<script defer src="${DEP}/app.js"></script>`,
    ]);
    expect(run.scripts).toEqual([]);
  });

  test("the written tag uses the preview src when there is one", () => {
    const run = runLoader(loaderFor(SUFFIX), {
      readyState: "loading",
      currentScript: {},
      search: `?js=${PREVIEW}`,
    });
    expect(run.written).toEqual([
      `<script defer src="${PREVIEW}/app.js"></script>`,
    ]);
  });

  test("after parsing it appends a script with defer and never writes", () => {
    for (const opts of [
      { readyState: "complete", currentScript: {} },
      { readyState: "interactive", currentScript: {} },
      { readyState: "loading", currentScript: null }, // run from a callback, not the parser
      { readyState: "complete", currentScript: null },
    ]) {
      const run = runLoader(loaderFor(SUFFIX), opts);
      expect(run.written).toEqual([]);
      expect(run.scripts).toEqual([
        { tag: "script", src: `${DEP}/app.js`, defer: true },
      ]);
    }
  });

  test("stylesheets are links appended to <head>", () => {
    const run = runLoader(loaderFor(SUFFIX));
    expect(run.links).toEqual([
      { tag: "link", rel: "stylesheet", href: `${DEP}/app.css` },
    ]);
  });

  test("a page script is chosen by the first path segment, else app.js", () => {
    const loader = loaderFor(SUFFIX, ["pages/about.js"]);
    expect(
      srcs(runLoader(loader, { pathname: "/about/team" }).scripts)
    ).toEqual([`${DEP}/pages/about.js`]);
    expect(srcs(runLoader(loader, { pathname: "/" }).scripts)).toEqual([
      `${DEP}/app.js`,
    ]);
  });
});

describe("loader localhost", () => {
  const desktop = { coarse: false };

  test("on a desktop it tries localhost first and preloads the deployed files", () => {
    const run = runLoader(loaderFor(SUFFIX), desktop);
    expect(srcs(run.scripts)).toEqual([`${LOC}/app.js`]);
    const preloads = run.links.filter((l) => l.rel === "preload");
    expect(preloads).toEqual([
      { tag: "link", rel: "preload", as: "script", href: `${DEP}/app.js` },
      { tag: "link", rel: "preload", as: "style", href: `${DEP}/app.css` },
    ]);
    expect(hrefs(run.links.filter((l) => l.rel === "stylesheet"))).toEqual([
      `${LOC}/app.css`,
    ]);
  });

  test("when localhost fails to load, each file falls back to the deployment", () => {
    const run = runLoader(loaderFor(SUFFIX), desktop);
    const localScript = run.scripts[0];
    const localCss = run.links.find((l) => l.rel === "stylesheet")!;
    expect(typeof localScript.onerror).toBe("function");
    expect(typeof localCss.onerror).toBe("function");

    run.fail(localScript);
    expect(srcs(run.scripts)).toEqual([`${LOC}/app.js`, `${DEP}/app.js`]);
    expect(run.scripts[1].defer).toBe(true);

    run.fail(localCss);
    expect(hrefs(run.links.filter((l) => l.rel === "stylesheet"))).toEqual([
      `${LOC}/app.css`,
      `${DEP}/app.css`,
    ]);
  });

  test("a touch device skips localhost unless ?local=1, which is remembered", () => {
    const loader = loaderFor(SUFFIX);
    const store = new Map<string, string>();
    expect(srcs(runLoader(loader, { coarse: true, store }).scripts)).toEqual([
      `${DEP}/app.js`,
    ]);

    const forced = runLoader(loader, {
      coarse: true,
      search: "?local=1",
      store,
    });
    expect(srcs(forced.scripts)).toEqual([`${LOC}/app.js`]);
    expect(store.get("wf-local")).toBe("1");

    expect(srcs(runLoader(loader, { coarse: true, store }).scripts)).toEqual([
      `${LOC}/app.js`,
    ]);
  });

  test("?local=0 goes straight to the deployment and forgets ?local=1", () => {
    const loader = loaderFor(SUFFIX);
    const store = new Map([["wf-local", "1"]]);
    const run = runLoader(loader, { coarse: false, search: "?local=0", store });
    expect(srcs(run.scripts)).toEqual([`${DEP}/app.js`]);
    expect(store.has("wf-local")).toBe(false);
  });

  test("outside .webflow.io it loads the deployment", () => {
    const run = runLoader(loaderFor(SUFFIX), {
      coarse: false,
      host: "www.example.com",
    });
    expect(srcs(run.scripts)).toEqual([`${DEP}/app.js`]);
  });
});

describe("loader before pnpm connect", () => {
  const loader = generateLoaderScript("app.js", [], ["app.css"], "", LOC, "");
  const urls = (run: ReturnType<typeof runLoader>) =>
    run.appended.map((el) => el.src ?? el.href);

  test("on a desktop it loads only from localhost, with nothing to preload", () => {
    const run = runLoader(loader, { coarse: false });
    expect(urls(run)).toEqual([`${LOC}/app.css`, `${LOC}/app.js`]);
    expect(run.warnings).toHaveLength(0);
  });

  test("when localhost is down it requests nothing from the site and warns", () => {
    const run = runLoader(loader, { coarse: false });
    const before = run.appended.length;
    for (const el of [...run.appended]) run.fail(el);
    expect(run.appended).toHaveLength(before);
  });

  test("a phone or a published domain loads nothing and warns", () => {
    for (const opts of [
      { coarse: true },
      { coarse: false, host: "www.acme.com" },
    ]) {
      const run = runLoader(loader, opts);
      expect(run.appended).toHaveLength(0);
      expect(run.written).toHaveLength(0);
      expect(run.warnings).toHaveLength(1);
    }
  });
});

describe("dev index", () => {
  let dir: string;
  let cwd: string;
  beforeEach(() => {
    cwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), "index-"));
    process.chdir(dir);
  });
  afterEach(() => {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  });

  const outputs = [{ path: "/x/dist/app.js" }, { path: "/x/dist/app.css" }];
  const index = async () => await generateResponse("/", outputs).text();
  const writeConfig = (value: object) =>
    writeFileSync(join(dir, "project.config.json"), JSON.stringify(value));

  test("with a config, the loader holds deployUrl and the suffix and no .vercel.app default", async () => {
    writeConfig({
      host: "cloudflare",
      name: "acme",
      deployUrl: DEP,
      mediaUrl: null,
      previewHostSuffix: SUFFIX,
    });
    const html = await index();
    expect(html).toContain(`var DEP = &quot;${DEP}&quot;;`);
    expect(html).toContain(`var PREVIEW_HOST = &quot;${SUFFIX}&quot;;`);
    expect(html).toContain("!PREVIEW_HOST || !u");
    expect(html).not.toContain(".vercel.app");
    expect(html).not.toContain("Vercel");
    expect(html).not.toContain("pnpm connect");
    expect(html).not.toContain("Connect a host");
    expect(html).toContain("<dt>Deploy URL</dt>");
  });

  test("without a config there is a connect form and a local-only loader", async () => {
    const html = await index();
    expect(html).toContain("Connect a host");
    expect(html).toContain("Loader Script (local only)");
    expect(html).toContain("click to copy");
    expect(html).toContain("var DEP = &quot;&quot;;");
    expect(html).not.toContain("VERCEL_URL");
  });

  test("an invalid config shows its error instead of crashing", async () => {
    writeConfig({ host: "netlify" });
    const html = await index();
    expect(html).not.toContain("Loader Script");
    expect(html).toContain("project.config.json is invalid");
    expect(html).not.toContain("Connect a host");
  });
});
