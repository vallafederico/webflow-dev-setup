import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

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
    .filter((entry) => statSync(path.join(dir, entry)).isFile())
    .map((entry) => entry.split(path.sep).join("/"))
    .sort();
}

/** Compares every file under the source skills with each copy. */
export function findDrift(repo = root): Drift[] {
  const drift: Drift[] = [];
  const sourceDir = path.join(repo, SOURCE);
  const sourceFiles = listFiles(sourceDir);

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
  for (const target of TARGETS) {
    for (const file of listFiles(sourceDir)) {
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
  if (process.argv.includes("--check")) {
    const drift = findDrift();
    if (drift.length === 0) {
      console.log("Skills match .claude/skills");
    } else {
      for (const item of drift) {
        console.log(`${item.kind.padEnd(9)} ${item.file}`);
      }
      console.log("\nRun pnpm sync:skills to copy .claude/skills over them");
      process.exit(1);
    }
  } else {
    const written = syncSkills();
    for (const file of written) console.log(`wrote ${file}`);
    console.log(
      written.length === 0
        ? "Skills already match .claude/skills"
        : `Synced ${written.length} file(s) from ${SOURCE}`
    );
  }
}
