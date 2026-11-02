import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runBiomeReport } from "./biome";
import { analyzeRoot, applyEdits, type Edit } from "./house-rules";
import { biomeScope } from "./scope";
import { ToolFailure } from "./types";

/**
 * Applies the fixes that can't change behaviour: import paths, Biome's safe
 * lint fixes and formatting. Files outside Biome's scope are never touched.
 */
export async function fix(root: string) {
  const inScope = biomeScope(root);

  // Import paths first, because the formatter runs last and settles the layout.
  const byFile = new Map<string, Edit[]>();
  for (const edit of analyzeRoot(root).edits) {
    if (!inScope(edit.file)) continue;
    byFile.set(edit.file, [...(byFile.get(edit.file) ?? []), edit]);
  }
  for (const [file, edits] of byFile) {
    const full = path.join(root, file);
    writeFileSync(full, applyEdits(readFileSync(full, "utf8"), edits));
  }
  const importEdits = [...byFile.values()].reduce(
    (sum, edits) => sum + edits.length,
    0
  );

  // `--write` applies safe fixes only. Unsafe ones need a person.
  const lint = await runBiomeReport(root, ["lint", "--write"]);
  const format = await runBiomeReport(root, ["format", "--write"]);

  return {
    importEdits,
    importFiles: byFile.size,
    lintChanged: lint.summary?.changed ?? 0,
    formatChanged: format.summary?.changed ?? 0,
  };
}

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..", "..");
  try {
    const result = await fix(root);
    console.log(
      `Fixed ${result.importEdits} import path(s) in ${result.importFiles} file(s)`
    );
    console.log(`Biome safe fixes changed ${result.lintChanged} file(s)`);
    console.log(`Biome formatting changed ${result.formatChanged} file(s)`);
    console.log("Run pnpm check to see what is left");
  } catch (error) {
    const message =
      error instanceof ToolFailure ? error.message : String(error);
    console.error(`pnpm fix could not finish: ${message}`);
    process.exit(2);
  }
}
