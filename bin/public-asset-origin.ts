import { CONFIG } from "./config";
import { readProjectConfig, type ProjectConfig } from "./project-config";
import { getValidatedUrlSafe } from "./url-validator";

/** `bin/api.ts` listens here. */
const API_DEV_PORT = 6546;

const isProduction = () => process.env.NODE_ENV === "production";

/** Allows `http://` for localhost (unlike validateUrl, which forces https). */
function normalizeAssetOriginOverride(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const normalized = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
    const u = new URL(normalized);
    if (!u.hostname) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Origin where `public/` files are served. Injected into the browser bundle at build time.
 * - Dev: local dev server (`CONFIG.SERVE_ORIGIN`)
 * - Production: `deployUrl` from `project.config.json` (script on Webflow must load assets from your deployment)
 * - Override: `PUBLIC_ASSET_ORIGIN` (e.g. preview URL)
 *
 * With no config, a Vercel build uses the `VERCEL_URL` Vercel sets itself, so a
 * project that never ran `pnpm connect` keeps working there. A Workers Builds
 * build has no equivalent, so it fails instead of shipping an empty origin.
 */
export function getPublicAssetOriginForBuild(): string {
  const override = process.env.PUBLIC_ASSET_ORIGIN;
  if (override) {
    const v = normalizeAssetOriginOverride(override);
    if (v) return v;
    console.warn("⚠️  Invalid PUBLIC_ASSET_ORIGIN, ignoring");
  }
  if (isProduction()) {
    const config = readProjectConfig();
    if (config) return config.deployUrl;

    if (process.env.VERCEL) {
      const vercel = getValidatedUrlSafe("VERCEL_URL");
      if (vercel) return vercel;
    }
    if (process.env.WORKERS_CI) {
      throw new Error(
        "project.config.json is missing. Run `pnpm connect cloudflare` and commit it, so asset URLs resolve when the script runs on Webflow."
      );
    }
    console.warn(
      "⚠️  project.config.json is missing. Run `pnpm connect` so production builds know where assets are served when the script runs on Webflow."
    );
    return "";
  }
  return CONFIG.SERVE_ORIGIN;
}

/** Where `bin/api.ts` is reachable in dev. Empty in production, so no localhost URL ships. */
export function getApiDevOrigin(): string {
  if (isProduction()) return "";
  const protocol = process.env.USE_SSL === "true" ? "https" : "http";
  return `${protocol}://localhost:${API_DEV_PORT}`;
}

/**
 * In dev an invalid config is logged and treated as missing, so the server still starts and
 * the dev index can show the error. A production build must fail on it.
 */
function readConfigForDefine(): ProjectConfig | null {
  try {
    return readProjectConfig();
  } catch (error) {
    if (isProduction()) throw error;
    console.error(`❌ ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

export function getBunDefine(): Record<string, string> {
  const config = readConfigForDefine();
  return {
    __PUBLIC_ASSET_ORIGIN__: JSON.stringify(getPublicAssetOriginForBuild()),
    __MEDIA_ORIGIN__: JSON.stringify(config?.mediaUrl ?? ""),
    // Script origins are only trusted on these hosts. Empty means never.
    __PREVIEW_HOST_SUFFIX__: JSON.stringify(config?.previewHostSuffix ?? ""),
    __API_DEV_ORIGIN__: JSON.stringify(getApiDevOrigin()),
  };
}
