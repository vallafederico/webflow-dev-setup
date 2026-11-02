import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { ToolFailure } from "./check/types";

/** `.claude/skills` is the only place skills are edited. */
export const SOURCE = ".claude/skills";
export const TARGETS = [".codex/skills", ".cursor/skills"];

export interface Drift {
  /** Repo-relative path of the copy that is wrong. */
  file: string;
  /** The source file it should match. */
  source: string;
  kind: "missing" | "different" | "extra";
}

const root = path.resolve(import.meta.dir, "..");

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter(
      (entry) =>
        statSync(path.join(dir, entry)).isFile() &&
        path.basename(entry) !== ".DS_Store"
    )
    .map((entry) => entry.split(path.sep).join("/"))
    .sort();
}

/** Every source skill file. Nothing to copy means the source is broken. */
function sourceFilesOf(repo: string): string[] {
  const files = listFiles(path.join(repo, SOURCE));
  if (files.length === 0) {
    throw new ToolFailure(
      `${SOURCE} has no skill files, so there is nothing to compare the copies with`,
      { fix: `Restore ${SOURCE}, which is the source of every skill` }
    );
  }
  return files;
}

/** Compares every file under the source skills with each copy. */
export function findDrift(repo = root): Drift[] {
  const drift: Drift[] = [];
  const sourceDir = path.join(repo, SOURCE);
  const sourceFiles = sourceFilesOf(repo);

  for (const target of TARGETS) {
    const targetDir = path.join(repo, target);
    for (const file of sourceFiles) {
      const source = `${SOURCE}/${file}`;
      const copy = path.join(targetDir, file);
      if (!existsSync(copy)) {
        drift.push({ file: `${target}/${file}`, source, kind: "missing" });
      } else if (
        !readFileSync(copy).equals(readFileSync(path.join(sourceDir, file)))
      ) {
        drift.push({ file: `${target}/${file}`, source, kind: "different" });
      }
    }
    // A skill that only exists in a copy is stale. It is reported, never
    // deleted, so nothing is lost by running the sync.
    const known = new Set(sourceFiles);
    for (const file of listFiles(targetDir)) {
      if (!known.has(file)) {
        drift.push({
          file: `${target}/${file}`,
          source: `${SOURCE}/${file}`,
          kind: "extra",
        });
      }
    }
  }
  return drift;
}

/** Copies the source skills over each target. Returns the files written. */
export function syncSkills(repo = root): string[] {
  const written: string[] = [];
  const sourceDir = path.join(repo, SOURCE);
  const sourceFiles = sourceFilesOf(repo);
  for (const target of TARGETS) {
    for (const file of sourceFiles) {
      const from = path.join(sourceDir, file);
      const to = path.join(repo, target, file);
      if (existsSync(to) && readFileSync(to).equals(readFileSync(from))) {
        continue;
      }
      mkdirSync(path.dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(from));
      written.push(`${target}/${file}`);
    }
  }
  return written;
}

if (import.meta.main) {
  try {
    const written = syncSkills();
    for (const file of written) console.log(`wrote ${file}`);
    console.log(
      written.length === 0
        ? "Skills already match .claude/skills"
        : `Synced ${written.length} file(s) from ${SOURCE}`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
