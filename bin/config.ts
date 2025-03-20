export const CONFIG = {
  bun: {
    entrypoints: ["src/app.js", "src/styles/index.css"],
    outdir: "dist",
    experimentalCss: true,
    sourcemap: "inline",
    target: "browser",
    format: "iife",
    minify: process.env.NODE_ENV === "production",
  },
  // Build configuration

  // Server Info for websocket
  SERVE_PORT: 6545,
  SERVE_ORIGIN: `http://localhost:6545`,
};
