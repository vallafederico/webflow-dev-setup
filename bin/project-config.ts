import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const PROJECT_CONFIG_FILE = "project.config.json";

export type ProjectHost = "cloudflare" | "vercel";

/** Written by `pnpm connect`, committed, and read by the loader, build and checks. */
export interface ProjectConfig {
  host: ProjectHost;
  name: string;
  deployUrl: string;
  mediaUrl: string | null;
  previewHostSuffix: string;
}

const HOSTS: readonly ProjectHost[] = ["cloudflare", "vercel"];
export const SUFFIX = /^[-.][a-z0-9.-]+$/;
export const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function isHttpsOrigin(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}

/** Returns every problem with a parsed config, so callers can report them all at once. */
export function validateProjectConfig(value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["must be a JSON object"];
  }
  const config = value as Record<string, unknown>;
  const errors: string[] = [];

  if (!HOSTS.includes(config.host as ProjectHost)) {
    errors.push(`host must be one of: ${HOSTS.join(", ")}`);
  }
  if (typeof config.name !== "string" || !NAME.test(config.name)) {
    errors.push("name must be a lowercase DNS label");
  }
  if (!isHttpsOrigin(config.deployUrl)) {
    errors.push(
      "deployUrl must be an https origin with no path or trailing slash"
    );
  }
  if (config.mediaUrl !== null && !isHttpsOrigin(config.mediaUrl)) {
    errors.push(
      "mediaUrl must be null or an https origin with no path or trailing slash"
    );
  }
  if (
    typeof config.previewHostSuffix !== "string" ||
    !SUFFIX.test(config.previewHostSuffix)
  ) {
    errors.push(`previewHostSuffix must match ${SUFFIX}`);
  }
  return errors;
}

/** Returns `null` when the project isn't connected. Throws when the file is invalid. */
export function readProjectConfig(cwd = process.cwd()): ProjectConfig | null {
  const path = resolve(cwd, PROJECT_CONFIG_FILE);
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${PROJECT_CONFIG_FILE} is not valid JSON: ${error}`);
  }

  const errors = validateProjectConfig(parsed);
  if (errors.length > 0) {
    throw new Error(`${PROJECT_CONFIG_FILE} is invalid: ${errors.join("; ")}`);
  }
  return parsed as ProjectConfig;
}
