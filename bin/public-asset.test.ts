import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Tests for src/utils/public-asset.ts and api-path.ts. They read build-time
// defines and `document.currentScript` while the module evaluates, so each case
// sets those up and imports a fresh copy.
const g = globalThis as any;
let n = 0;

afterEach(() => {
  delete g.document;
  delete g.__PUBLIC_ASSET_ORIGIN__;
  delete g.__MEDIA_ORIGIN__;
  delete g.__API_DEV_ORIGIN__;
});

function setup(opts: {
  src?: string | null;
  asset?: string;
  media?: string;
  api?: string;
}) {
  if (opts.src !== undefined) {
    g.document = { currentScript: opts.src === null ? null : { src: opts.src } };
  }
  g.__PUBLIC_ASSET_ORIGIN__ = opts.asset ?? "";
  g.__MEDIA_ORIGIN__ = opts.media ?? "";
  g.__API_DEV_ORIGIN__ = opts.api ?? "";
}

const loadAsset = () => import(`../src/utils/public-asset.ts?case=${n++}`);

describe("public-asset", () => {
  test("uses the origin the script was loaded from", async () => {
    setup({ src: "https://preview-acme.team.workers.dev/app.js", asset: "https://acme.example.com" });
    const m = await loadAsset();
    expect(m.PUBLIC_ASSET_ORIGIN).toBe("https://preview-acme.team.workers.dev");
    expect(m.publicAssetUrl("img/a.png")).toBe("https://preview-acme.team.workers.dev/img/a.png");
  });

  test("falls back to the build-time origin for an inline script", async () => {
    setup({ src: "", asset: "https://acme.example.com" });
    expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe("https://acme.example.com");
  });

  test("falls back when there is no current script", async () => {
    setup({ src: null, asset: "https://acme.example.com" });
    expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe("https://acme.example.com");
  });

  test("falls back outside a browser", async () => {
    setup({ asset: "https://acme.example.com" });
    expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe("https://acme.example.com");
  });

  test("falls back for an opaque origin", async () => {
    setup({ src: "data:text/javascript,1", asset: "https://acme.example.com" });
    expect((await loadAsset()).PUBLIC_ASSET_ORIGIN).toBe("https://acme.example.com");
  });

  test("gives a root-relative path when there is no origin at all", async () => {
    setup({});
    expect((await loadAsset()).publicAssetUrl("a.png")).toBe("/a.png");
  });

  test("mediaUrl uses the media origin", async () => {
    setup({ asset: "https://acme.example.com", media: "https://media.example.com/" });
    expect((await loadAsset()).mediaUrl("/big/model.glb")).toBe("https://media.example.com/big/model.glb");
  });

  test("mediaUrl falls back to publicAssetUrl without a media origin", async () => {
    setup({ asset: "https://acme.example.com" });
    expect((await loadAsset()).mediaUrl("model.glb")).toBe("https://acme.example.com/model.glb");
  });
});

describe("apiPath", () => {
  // Bundled with real defines, like the build, so nothing is shared between cases.
  async function run(defines: Record<string, string>, src?: string) {
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
      new Function("globalThis", "document", `${code}`)(
        scope,
        src === undefined ? undefined : { currentScript: { src } }
      );
      return { out: scope.out as string[], code };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const base = {
    __PUBLIC_ASSET_ORIGIN__: "https://acme.example.com",
    __MEDIA_ORIGIN__: "",
    __API_DEV_ORIGIN__: "",
  };

  test("uses the dev API origin when it is set", async () => {
    const { out } = await run({ ...base, __API_DEV_ORIGIN__: "https://localhost:6546" });
    expect(out).toEqual(["https://localhost:6546/api/test", "https://localhost:6546/api/"]);
  });

  test("uses the asset origin in production, with no localhost in the bundle", async () => {
    const { out, code } = await run(base);
    expect(out).toEqual(["https://acme.example.com/api/test", "https://acme.example.com/api/"]);
    expect(code).not.toContain("localhost");
  });

  test("follows a preview script's origin", async () => {
    const { out } = await run(base, "https://preview.example.com/app.js");
    expect(out[0]).toBe("https://preview.example.com/api/test");
  });

  test("does not read process.env", async () => {
    const { code } = await run(base);
    expect(code).not.toContain("process.env");
  });
});
