/**
 * Builds what the browser run loads, in a subprocess with NODE_ENV=production
 * so the defines and minification match `pnpm build`:
 *
 *   bun run bin/check/runtime-build.ts <production dir> <test dir>
 *
 * Both go to the temp folders given, never to dist/.
 */
import path from "node:path";
import type { BuildConfig } from "bun";
import { CONFIG } from "../config";
import { getBunDefine } from "../public-asset-origin";

const [productionDir, testDir] = process.argv.slice(2);
if (!(productionDir && testDir)) {
  console.error("usage: runtime-build.ts <production dir> <test dir>");
  process.exit(2);
}

const define = getBunDefine();
const common = {
  ...(CONFIG.bun as BuildConfig),
  define,
  sourcemap: "none",
} satisfies BuildConfig;

const production = await Bun.build({
  ...common,
  outdir: productionDir,
  minify: true,
});

const test = await Bun.build({
  ...common,
  entrypoints: [path.resolve(import.meta.dir, "fixture-entry.ts")],
  outdir: testDir,
  minify: false,
});

for (const result of [production, test]) {
  if (!result.success) {
    for (const log of result.logs) console.error(String(log));
    process.exit(1);
  }
}
console.log(
  JSON.stringify({
    production: production.outputs
      .map((o) => path.relative(productionDir, o.path))
      .sort(),
    test: test.outputs.map((o) => path.relative(testDir, o.path)).sort(),
  })
);
