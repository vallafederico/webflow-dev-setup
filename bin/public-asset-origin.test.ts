import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBunDefine, getPublicAssetOriginForBuild } from "./public-asset-origin";

const ENV_KEYS = [
  "NODE_ENV",
  "PUBLIC_ASSET_ORIGIN",
  "VERCEL",
  "VERCEL_URL",
  "WORKERS_CI",
  "USE_SSL",
];

const config = {
  host: "cloudflare",
  name: "acme",
  deployUrl: "https://acme.itsoffbrand.dev",
  mediaUrl: "https://acme-media.itsoffbrand.dev",
  previewHostSuffix: "-acme.team.workers.dev",
};

let dir: string;
let cwd: string;
let saved: Record<string, string | undefined>;
let warn: ReturnType<typeof spyOn>;

beforeEach(() => {
  cwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), "origin-"));
  process.chdir(dir);
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.NODE_ENV = "production";
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const writeConfig = (value: object = config) =>
  writeFileSync(join(dir, "project.config.json"), JSON.stringify(value));

describe("getPublicAssetOriginForBuild", () => {
  test("uses deployUrl from the config in production", () => {
    writeConfig();
    expect(getPublicAssetOriginForBuild()).toBe("https://acme.itsoffbrand.dev");
  });

  test("PUBLIC_ASSET_ORIGIN wins over the config", () => {
    writeConfig();
    process.env.PUBLIC_ASSET_ORIGIN = "https://preview.example.com/";
    expect(getPublicAssetOriginForBuild()).toBe("https://preview.example.com");
  });

  test("ignores an invalid override and uses the config", () => {
    writeConfig();
    process.env.PUBLIC_ASSET_ORIGIN = "not a url";
    expect(getPublicAssetOriginForBuild()).toBe("https://acme.itsoffbrand.dev");
    expect(warn).toHaveBeenCalled();
  });

  test("config wins over Vercel's automatic URL", () => {
    writeConfig();
    process.env.VERCEL = "1";
    process.env.VERCEL_URL = "x.vercel.app";
    expect(getPublicAssetOriginForBuild()).toBe("https://acme.itsoffbrand.dev");
  });

  test("no config on Vercel uses VERCEL_URL", () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_URL = "x.vercel.app";
    expect(getPublicAssetOriginForBuild()).toBe("https://x.vercel.app");
  });

  test("VERCEL_URL alone is ignored outside Vercel", () => {
    process.env.VERCEL_URL = "x.vercel.app";
    expect(getPublicAssetOriginForBuild()).toBe("");
    expect(warn).toHaveBeenCalled();
  });

  test("no config on Workers Builds fails the build", () => {
    process.env.WORKERS_CI = "1";
    expect(() => getPublicAssetOriginForBuild()).toThrow("pnpm connect");
  });

  test("no config elsewhere warns and returns an empty origin", () => {
    expect(getPublicAssetOriginForBuild()).toBe("");
    expect(warn).toHaveBeenCalled();
  });

  test("an invalid config throws", () => {
    writeConfig({ ...config, host: "netlify" });
    expect(() => getPublicAssetOriginForBuild()).toThrow("invalid");
  });

  test("dev uses the local dev server", () => {
    process.env.NODE_ENV = "development";
    writeConfig();
    expect(getPublicAssetOriginForBuild()).toBe("http://localhost:6545");
  });
});

describe("getBunDefine", () => {
  test("production defines the media origin and no dev API origin", () => {
    writeConfig();
    expect(getBunDefine()).toEqual({
      __PUBLIC_ASSET_ORIGIN__: '"https://acme.itsoffbrand.dev"',
      __MEDIA_ORIGIN__: '"https://acme-media.itsoffbrand.dev"',
      __API_DEV_ORIGIN__: '""',
    });
  });

  test("media origin is empty without a config or mediaUrl", () => {
    expect(getBunDefine().__MEDIA_ORIGIN__).toBe('""');
    writeConfig({ ...config, mediaUrl: null });
    expect(getBunDefine().__MEDIA_ORIGIN__).toBe('""');
  });

  test("dev defines the API origin to match USE_SSL", () => {
    process.env.NODE_ENV = "development";
    expect(getBunDefine().__API_DEV_ORIGIN__).toBe('"http://localhost:6546"');
    process.env.USE_SSL = "true";
    expect(getBunDefine().__API_DEV_ORIGIN__).toBe('"https://localhost:6546"');
  });
});
