declare const __PUBLIC_ASSET_ORIGIN__: string;
declare const __MEDIA_ORIGIN__: string;

/** Origin of the script running this bundle. Empty for an inline script, such as a pasted `.js.txt`. */
function scriptOrigin(): string {
  if (typeof document === "undefined") return "";
  // Only set while the script first runs, so read it now and not inside a function.
  const src = (document.currentScript as HTMLScriptElement | null)?.src;
  if (!src) return "";
  try {
    const { origin } = new URL(src);
    return origin === "null" ? "" : origin;
  } catch {
    return "";
  }
}

const SCRIPT_ORIGIN = scriptOrigin();

/**
 * Absolute origin where `public/` files are hosted. Taken from where this script was loaded
 * from, so `?js=<preview url>` on staging also points files at the preview. Falls back to the
 * origin injected at bundle time when the script has no `src`.
 * Use {@link publicAssetUrl} for file paths.
 */
export const PUBLIC_ASSET_ORIGIN = SCRIPT_ORIGIN || __PUBLIC_ASSET_ORIGIN__;

function joinUrl(origin: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = origin.replace(/\/$/, "");
  if (!base) return p;
  return `${base}${p}`;
}

/**
 * Resolve a root-relative path (e.g. `images/logo.png` or `/images/logo.png`) to a full URL.
 * Use this when the bundle runs on Webflow: relative URLs would hit the Webflow origin, where these files are not.
 */
export function publicAssetUrl(path: string): string {
  return joinUrl(PUBLIC_ASSET_ORIGIN, path);
}

/**
 * Like {@link publicAssetUrl} for heavy files that live in the project's media bucket.
 * Falls back to `public/` when the project has no media origin.
 */
export function mediaUrl(path: string): string {
  if (!__MEDIA_ORIGIN__) return publicAssetUrl(path);
  return joinUrl(__MEDIA_ORIGIN__, path);
}
