import { CONFIG } from "./config";
import { getValidatedUrlSafe } from "../src/utils/url-validator";

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
 * - Production: `VERCEL_URL` (script on Webflow must load assets from your deployment)
 * - Override: `PUBLIC_ASSET_ORIGIN` (e.g. preview URL)
 */
export function getPublicAssetOriginForBuild(): string {
  const override = process.env.PUBLIC_ASSET_ORIGIN;
  if (override) {
    const v = normalizeAssetOriginOverride(override);
    if (v) return v;
    console.warn("⚠️  Invalid PUBLIC_ASSET_ORIGIN, ignoring");
  }
  if (process.env.NODE_ENV === "production") {
    const vercel = getValidatedUrlSafe("VERCEL_URL");
    if (!vercel) {
      console.warn(
        "⚠️  VERCEL_URL is not set or invalid. Production builds need it so asset URLs resolve when the script runs on Webflow."
      );
    }
    return vercel ?? "";
  }
  return CONFIG.SERVE_ORIGIN;
}

export function getBunDefine(): Record<string, string> {
  return {
    __PUBLIC_ASSET_ORIGIN__: JSON.stringify(getPublicAssetOriginForBuild()),
  };
}
