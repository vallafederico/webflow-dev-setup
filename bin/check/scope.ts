import { readFileSync } from "node:fs";
import path from "node:path";
import { toPosix } from "./tools";

/**
 * Decides whether Biome would look at a file, from `files.includes` in
 * biome.json. Only used so `pnpm fix` can't edit a file Biome ignores.
 */
export function biomeScope(root: string): (file: string) => boolean {
  let includes: string[] = ["**"];
  try {
    const config = JSON.parse(
      readFileSync(path.join(root, "biome.json"), "utf8")
    ) as { files?: { includes?: string[] } };
    includes = config.files?.includes ?? includes;
  } catch {
    // An unreadable config is reported by the Biome steps, not here.
  }

  const positive = includes
    .filter((pattern) => !pattern.startsWith("!"))
    .map((pattern) => new Bun.Glob(pattern));
  const negative = includes
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => new Bun.Glob(pattern.slice(1)));

  return (file) => {
    const posix = toPosix(file);
    const parts = posix.split("/");
    // An excluded folder excludes everything below it.
    const ancestors = parts.map((_, index) =>
      parts.slice(0, index + 1).join("/")
    );
    return (
      positive.some((glob) => glob.match(posix)) &&
      !negative.some((glob) => ancestors.some((part) => glob.match(part)))
    );
  };
}
