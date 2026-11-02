import { globEagerPlugin } from "./plugins/glob";
import { glslPlugin } from "./plugins/glsl";
import { getPageFiles } from "./pages";
import { existsSync } from "fs";
import { resolve } from "path";

const cssEntrypoints = ["src/styles/app.css"];

const appFile = existsSync(resolve("src/app.ts"))
  ? "src/app.ts"
  : existsSync(resolve("src/app.js"))
    ? "src/app.js"
    : null;

const pages = getPageFiles().map((page) => {
  return `src/pages/${page}`;
});

// WF_DEV_PORT lets the tests run while `bun dev` holds the default port.
const SERVE_PORT = Number(process.env.WF_DEV_PORT) || 6545;

export const CONFIG = {
  bun: {
    entrypoints: [...(appFile ? [appFile] : []), ...pages],
    outdir: "dist",
    sourcemap: "external",
    target: "browser",
    format: "iife",
    minify: process.env.NODE_ENV === "production",
    plugins: [globEagerPlugin(), glslPlugin()],
  },
  css: {
    entrypoints: cssEntrypoints,
  },
  // Server Info for websocket
  SERVE_PORT,
  SERVE_ORIGIN:
    process.env.USE_SSL === "true"
      ? `https://localhost:${SERVE_PORT}`
      : `http://localhost:${SERVE_PORT}`,
};
