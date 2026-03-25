declare const __PUBLIC_ASSET_ORIGIN__: string;

/**
 * Absolute origin where `public/` files are hosted (Vercel in production, local dev server in dev).
 * Injected at bundle time; use {@link publicAssetUrl} for file paths.
 */
export const PUBLIC_ASSET_ORIGIN = __PUBLIC_ASSET_ORIGIN__;

/**
 * Resolve a root-relative path (e.g. `images/logo.png` or `/images/logo.png`) to a full URL.
 * Use this when the bundle runs on Webflow: relative URLs would hit the Webflow origin, where these files are not.
 */
export function publicAssetUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = PUBLIC_ASSET_ORIGIN.replace(/\/$/, "");
  if (!base) return p;
  return `${base}${p}`;
}
