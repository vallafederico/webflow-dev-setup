import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Routes in wrangler.jsonc on the project's own base domain that aren't the
 * project's own host. On a shared domain, a build deploys whatever routes its
 * repo names, so one project's config could take another project's live
 * domain, and Cloudflare reports the build as a success. Routes on other
 * domains are left alone, since those are the owner's own zones.
 */
export function foreignRoutes(routes: unknown, deployUrl: string): string[] {
  const own = new URL(deployUrl).hostname.toLowerCase();
  const zone = own.split(".").slice(1).join(".");
  if (!zone.includes(".")) return [];
  const list = Array.isArray(routes) ? routes : routes ? [routes] : [];
  const foreign: string[] = [];
  for (const route of list) {
    const pattern =
      typeof route === "string"
        ? route
        : typeof route === "object" && route !== null
          ? (route as { pattern?: unknown }).pattern
          : undefined;
    if (typeof pattern !== "string") continue;
    const host = pattern
      .replace(/^[a-z]+:\/\//i, "")
      .split("/")[0]
      .toLowerCase();
    if (host === own) continue;
    if (host === zone || host.endsWith(`.${zone}`)) foreign.push(pattern);
  }
  return foreign;
}

/** The foreign routes in `wrangler.jsonc`, or `[]` when it's missing or unreadable (other checks report that). */
export function foreignRoutesInWrangler(
  deployUrl: string,
  cwd = process.cwd()
): string[] {
  const path = resolve(cwd, "wrangler.jsonc");
  if (!existsSync(path)) return [];
  try {
    const wrangler = Bun.JSONC.parse(readFileSync(path, "utf8")) as {
      routes?: unknown;
      route?: unknown;
    };
    return foreignRoutes(
      [
        ...(Array.isArray(wrangler.routes) ? wrangler.routes : []),
        ...(wrangler.route ? [wrangler.route] : []),
      ],
      deployUrl
    );
  } catch {
    return [];
  }
}
