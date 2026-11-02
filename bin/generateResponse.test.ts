import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateLoaderScript, generateResponse } from "./generateResponse";

const DEP = "https://acme.itsoffbrand.dev";
const SUFFIX = "-acme.team.workers.dev";

/** Runs the generated loader against fakes and returns what it appended to <head>. */
function runLoader(
  loader: string,
  { search, host = "site.webflow.io" }: { search: string; host?: string }
) {
  const code = loader.replace(/^<script>/, "").replace(/<\/script>$/, "");
  const appended: any[] = [];
  const store = new Map<string, string>();
  const head = { appendChild: (el: any) => appended.push(el) };
  const document = {
    head,
    readyState: "complete",
    currentScript: null,
    createElement: (tag: string) => ({ tag }),
    write() {
      throw new Error("document.write after parsing would wipe the page");
    },
  };
  const location = { hostname: host, search, pathname: "/" };
  const sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const matchMedia = () => ({ matches: true }); // touch device: skip localhost
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const info = spyOn(console, "info").mockImplementation(() => {});
  try {
    new Function(
      "document",
      "location",
      "sessionStorage",
      "matchMedia",
      code
    )(document, location, sessionStorage, matchMedia);
    return { scripts: appended.filter((e) => e.tag === "script"), warnings: warn.mock.calls };
  } finally {
    warn.mockRestore();
    info.mockRestore();
  }
}

const loaderFor = (suffix: string) =>
  generateLoaderScript("app.js", [], ["app.css"], DEP, "http://localhost:6545", suffix);

describe("loader preview allowlist", () => {
  test("with no suffix, ?js=https://anything is refused and warned about", () => {
    const { scripts, warnings } = runLoader(loaderFor(""), { search: "?js=https://anything" });
    expect(scripts.map((s) => s.src)).toEqual([`${DEP}/app.js`]);
    expect(warnings.length).toBe(1);
    expect(String(warnings[0][0])).toContain("[loader] ignoring js preview");
  });

  test("with no suffix, even a *.vercel.app or *.workers.dev URL is refused", () => {
    for (const url of ["https://x.vercel.app", "https://x-acme.team.workers.dev", "https://"]) {
      const { scripts } = runLoader(loaderFor(""), { search: `?js=${url}` });
      expect(scripts.map((s) => s.src)).toEqual([`${DEP}/app.js`]);
    }
  });

  test("with a suffix, a matching preview is used", () => {
    const { scripts, warnings } = runLoader(loaderFor(SUFFIX), {
      search: `?js=https://feat-x${SUFFIX}`,
    });
    expect(scripts.map((s) => s.src)).toEqual([`https://feat-x${SUFFIX}/app.js`]);
    expect(warnings.length).toBe(0);
  });

  test("with a suffix, other hosts and plain http are refused", () => {
    for (const url of ["https://anything", "https://evil.example.com", `http://feat-x${SUFFIX}`]) {
      const { scripts, warnings } = runLoader(loaderFor(SUFFIX), { search: `?js=${url}` });
      expect(scripts.map((s) => s.src)).toEqual([`${DEP}/app.js`]);
      expect(warnings.length).toBe(1);
    }
  });

  test("previews are ignored off .webflow.io", () => {
    const { scripts } = runLoader(loaderFor(SUFFIX), {
      host: "www.example.com",
      search: `?js=https://feat-x${SUFFIX}`,
    });
    expect(scripts.map((s) => s.src)).toEqual([`${DEP}/app.js`]);
  });

  test("keeps the document.write path for parser-inserted defer", () => {
    const loader = loaderFor(SUFFIX);
    expect(loader).toContain("d.readyState===\"loading\" && d.currentScript");
    expect(loader).toContain("<\\/script>");
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
  });

  test("without a config there is no loader and a connect notice", async () => {
    const html = await index();
    expect(html).not.toContain("Loader Script");
    expect(html).not.toContain("PREVIEW_HOST");
    expect(html).toContain("pnpm connect");
    expect(html).not.toContain("VERCEL_URL");
  });

  test("an invalid config shows its error instead of crashing", async () => {
    writeConfig({ host: "netlify" });
    const html = await index();
    expect(html).not.toContain("Loader Script");
    expect(html).toContain("project.config.json is invalid");
  });
});
