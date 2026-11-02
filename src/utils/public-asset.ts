declare const __PUBLIC_ASSET_ORIGIN__: string;
declare const __MEDIA_ORIGIN__: string;
declare const __PREVIEW_HOST_SUFFIX__: string;

/**
 * Origin of the running script, but only when it came from one of this project's preview hosts.
 * Any other source is ignored: a `.js.txt` uploaded to Webflow's CDN runs from assets-global.webflow.com,
 * and page HTML can replace `document.currentScript` with `<img name="currentScript">`.
 */
function scriptOrigin(): string {
  if (typeof document === "undefined" || !__PREVIEW_HOST_SUFFIX__) return "";
  // Only set while the script first runs, so read it now and not inside a function.
  const el = document.currentScript;
  if (!(el instanceof HTMLScriptElement) || !el.src) return "";
  try {
    const { origin, protocol, hostname } = new URL(el.src);
    return protocol === "https:" && hostname.endsWith(__PREVIEW_HOST_SUFFIX__)
      ? origin
      : "";
  } catch {
    return "";
  }
}

const SCRIPT_ORIGIN = scriptOrigin();

/**
 * Absolute origin where `public/` files are hosted. Taken from where this script was loaded
 * from when that is a preview host, so `?js=<preview url>` on staging also points files at the
 * preview. Otherwise the origin injected at bundle time: `PUBLIC_ASSET_ORIGIN` or `deployUrl`.
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
