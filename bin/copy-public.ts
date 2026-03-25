import { cp, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Merge `public/` into `dist/` root so files are served at `/…` (not `/public/…`). */
export async function copyPublicToDist(): Promise<void> {
  if (!existsSync("public")) return;

  console.log("\n📁 Copying public assets to dist root...");
  const entries = await readdir("public", { withFileTypes: true });
  const distRoot = join(process.cwd(), "dist");
  for (const entry of entries) {
    await cp(join("public", entry.name), join(distRoot, entry.name), {
      recursive: true,
    });
  }
  console.log("✅ Public assets copied successfully!");
}
