import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Tests for src/utils/public-asset.ts and api-path.ts. They read build-time
// defines and `document.currentScript` while the module evaluates, so each case
// sets those up and imports a fresh copy.
const g = globalThis as any;
let n = 0;

const DEPLOY = "https://acme.itsoffbrand.dev";
const OVERRIDE = "https://override.example.com";
const SUFFIX = "-acme.team.workers.dev";
const PREVIEW = `https://feat-x${SUFFIX}`;
const WEBFLOW_CDN =
  "https://assets-global.webflow.com/abc123/def456_app.js.txt";

/** Stands in for the browser's class, so `instanceof` behaves as it does there. */
class FakeScriptElement {
  constructor(public src: string) {}
}

afterEach(() => {
  delete g.document;
  delete g.HTMLScriptElement;
  delete g.__PUBLIC_ASSET_ORIGIN__;
  delete g.__MEDIA_ORIGIN__;
  delete g.__PREVIEW_HOST_SUFFIX__;
});

type Current = string | null | object;

/** `current` is a script src, or an object standing in for something that isn't a script element. */
function setup(opts: {
  current?: Current;
  asset?: string;
  media?: string;
  suffix?: string;
  browser?: boolean;
}) {
  if (opts.browser !== false) {
    g.HTMLScriptElement = FakeScriptElement;
    const current =
      typeof opts.current === "string"
        ? new FakeScriptElement(opts.current)
        : (opts.current ?? null);
    g.document = { currentScript: current };
  }
  g.__PUBLIC_ASSET_ORIGIN__ = opts.asset ?? "";
  g.__MEDIA_ORIGIN__ = opts.media ?? "";
  g.__PREVIEW_HOST_SUFFIX__ = opts.suffix ?? "";
}

const loadAsset = () => import(`../src/utils/public-asset.ts?case=${n++}`);

// Each case runs with the deploy URL baked in, and again with a PUBLIC_ASSET_ORIGIN
// override baked in instead: the override only changes what the build injects.
describe.each([
  ["deploy URL", DEPLOY],
  ["PUBLIC_ASSET_ORIGIN override", OVERRIDE],
])("public-asset with %s", (_label, baked) => {
  test("a script on the deploy host gives the baked-in origin", async () => {
    setup({ current: `${DEPLOY}/app.js`, asset: baked, suffix: SUFFIX });
    expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe(baked);
  });

  test("a script on a preview host gives the preview origin", async () => {
    setup({ current: `${PREVIEW}/app.js`, asset: baked, suffix: SUFFIX });
    const m = await loadAsset();
    expect(m.PUBLIC_ASSET_ORIGIN).toBe(PREVIEW);
    expect(m.publicAssetUrl("img/a.png")).toBe(`${PREVIEW}/img/a.png`);
  });

  test("a .js.txt on Webflow's CDN gives the baked-in origin", async () => {
    setup({ current: WEBFLOW_CDN, asset: baked, suffix: SUFFIX });
    const m = await loadAsset();
    expect(m.PUBLIC_ASSET_ORIGIN).toBe(baked);
    expect(m.mediaUrl("m.glb")).toBe(`${baked}/m.glb`);
  });

  test("an overridden document.currentScript gives the baked-in origin", async () => {
    // <img name="currentScript"> replaces the property with an element that isn't a script.
    for (const current of [
      { src: `${PREVIEW}/app.js` },
      { src: "https://evil.example.com/app.js" },
      Object.assign(Object.create(null), { src: `${PREVIEW}/app.js` }),
    ]) {
      setup({ current, asset: baked, suffix: SUFFIX });
      expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe(baked);
    }
  });
});

describe("public-asset script origin", () => {
  test("an inline script or no current script gives the baked-in origin", async () => {
    setup({ current: "", asset: DEPLOY, suffix: SUFFIX });
    expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe(DEPLOY);
    setup({ current: null, asset: DEPLOY, suffix: SUFFIX });
    expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe(DEPLOY);
  });

  test("outside a browser it gives the baked-in origin", async () => {
    setup({ browser: false, asset: DEPLOY, suffix: SUFFIX });
    expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe(DEPLOY);
  });

  test("with no preview suffix the script origin is never used", async () => {
    setup({ current: `${PREVIEW}/app.js`, asset: DEPLOY, suffix: "" });
    expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe(DEPLOY);
  });

  test("only https preview hosts are accepted", async () => {
    for (const src of [
      `http://feat-x${SUFFIX}/app.js`,
      `https://feat-x${SUFFIX}.evil.example.com/app.js`,
      `https://acme.team.workers.dev/app.js`, // no leading "-", so not this project
      "https://evil.example.com/app.js",
      "data:text/javascript,1",
      "blob:https://site.webflow.io/1234",
      "not a url",
    ]) {
      setup({ current: src, asset: DEPLOY, suffix: SUFFIX });
      expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe(DEPLOY);
    }
  });

  test("keeps the port of a preview origin", async () => {
    setup({ current: `${PREVIEW}:8443/app.js`, asset: DEPLOY, suffix: SUFFIX });
    expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe(`${PREVIEW}:8443`);
  });

  test("gives a root-relative path when there is no origin at all", async () => {
    setup({});
    expect((await loadAsset()).publicAssetUrl("a.png")).toBe("/a.png");
  });
});

describe("mediaUrl", () => {
  test("uses the media origin", async () => {
    setup({ asset: DEPLOY, media: "https://media.example.com/" });
    expect((await loadAsset()).mediaUrl("/big/model.glb")).toBe(
      "https://media.example.com/big/model.glb"
    );
  });

  test("falls back to publicAssetUrl without a media origin", async () => {
    setup({ asset: DEPLOY });
    expect((await loadAsset()).mediaUrl("model.glb")).toBe(
      `${DEPLOY}/model.glb`
    );
  });

  test("a media file follows the preview script origin only through the fallback", async () => {
    setup({ current: `${PREVIEW}/app.js`, asset: DEPLOY, suffix: SUFFIX });
    expect((await loadAsset()).mediaUrl("model.glb")).toBe(
      `${PREVIEW}/model.glb`
    );
    setup({
      current: `${PREVIEW}/app.js`,
      asset: DEPLOY,
      suffix: SUFFIX,
      media: "https://media.example.com",
    });
    expect((await loadAsset()).mediaUrl("model.glb")).toBe(
      "https://media.example.com/model.glb"
    );
  });
});

describe("apiPath", () => {
  // Bundled with real defines, like the build, so nothing is shared between cases.
  async function run(defines: Record<string, string>, current?: Current) {
    const dir = mkdtempSync(join(tmpdir(), "api-path-"));
    try {
      const entry = join(dir, "entry.ts");
      writeFileSync(
        entry,
        `import { apiPath } from ${JSON.stringify(resolve("src/utils/api-path.ts"))};
(globalThis as any).out = [apiPath("test"), apiPath()];`
      );
      const result = await Bun.build({
        entrypoints: [entry],
        target: "browser",
        format: "iife",
        define: Object.fromEntries(
          Object.entries(defines).map(([k, v]) => [k, JSON.stringify(v)])
        ),
      });
      const code = await result.outputs[0].text();
      const scope: any = {};
      new Function("globalThis", "document", "HTMLScriptElement", code)(
        scope,
        current === undefined
          ? undefined
          : {
              currentScript:
                typeof current === "string"
                  ? new FakeScriptElement(current)
                  : current,
            },
        FakeScriptElement
      );
      return { out: scope.out as string[], code };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const base = {
    __PUBLIC_ASSET_ORIGIN__: DEPLOY,
    __MEDIA_ORIGIN__: "",
    __PREVIEW_HOST_SUFFIX__: SUFFIX,
    __API_DEV_ORIGIN__: "",
  };

  test("uses the dev API origin when it is set", async () => {
    const { out } = await run({
      ...base,
      __API_DEV_ORIGIN__: "https://localhost:6546",
    });
    expect(out).toEqual([
      "https://localhost:6546/api/test",
      "https://localhost:6546/api/",
    ]);
  });

  test("uses the asset origin in production, with no localhost in the bundle", async () => {
    const { out, code } = await run(base);
    expect(out).toEqual([`${DEPLOY}/api/test`, `${DEPLOY}/api/`]);
    expect(code).not.toContain("localhost");
  });

  test("follows a preview script's origin", async () => {
    const { out } = await run(base, `${PREVIEW}/app.js`);
    expect(out[0]).toBe(`${PREVIEW}/api/test`);
  });

  test("ignores a script on Webflow's CDN and an overridden currentScript", async () => {
    expect((await run(base, WEBFLOW_CDN)).out[0]).toBe(`${DEPLOY}/api/test`);
    expect((await run(base, { src: `${PREVIEW}/app.js` })).out[0]).toBe(
      `${DEPLOY}/api/test`
    );
  });

  test("does not read process.env", async () => {
    const { code } = await run(base);
    expect(code).not.toContain("process.env");
  });
});
