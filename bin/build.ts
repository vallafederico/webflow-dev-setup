import { CONFIG } from "./config";

// console.log(process.env.NODE_ENV);

async function build() {
  console.log("📦 Building production bundle...");
  try {
    await Bun.build({
      entrypoints: CONFIG.ENTRY_POINTS,
      outdir: CONFIG.BUILD_DIRECTORY,
      minify: CONFIG.MINIFY,
      sourcemap: CONFIG.SOURCEMAP,
      experimentalCss: CONFIG.EXPERIMENTAL_CSS,
      target: "browser",
      format: "iife",
    });
    console.log("✅ Build complete!");
  } catch (error) {
    console.error("❌ Build failed:", error);
    process.exit(1);
  }
}

build();
