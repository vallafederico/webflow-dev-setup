# Configuration Guide

## Overview

Build and server configuration is centralized in `bin/config.ts`.

## Config Structure

```typescript
export const CONFIG = {
  bun: {
    entrypoints: ["src/app.ts", ...pageFiles],  // auto-detected
    outdir: "dist",
    sourcemap: "external",
    target: "browser",
    format: "iife",
    minify: process.env.NODE_ENV === "production",
    plugins: [globEagerPlugin(), glslPlugin()],
  },
  css: {
    entrypoints: ["src/styles/app.css"],
  },
  SERVE_PORT: 6545,
  SERVE_ORIGIN: "https://localhost:6545",  // or http:// if USE_SSL is not set
};
```

### JS Entrypoints

- `src/app.ts` (or `src/app.js`) is auto-detected as the main entry
- Any `.js` / `.ts` files in `src/pages/` are auto-discovered and added as additional entrypoints
- Output format is **IIFE** (compatible with Webflow `<script>` injection)

### CSS Entrypoints

- `src/styles/app.css` — single CSS entrypoint, imports sub-files via `@import`

Built with Bun's experimental CSS bundler. Additional entrypoints can be added to the `css.entrypoints` array in `bin/config.ts`.

### Plugins

- **`globEagerPlugin`**: enables `import.meta.glob('./pattern', { eager: true })` syntax (Vite-like)
- **`glslPlugin`**: imports `.glsl`, `.vert`, `.frag` shader files as strings

### Server

- Dev server runs on port **6545** (configurable via `SERVE_PORT`)
- API server runs on port **6546** (hardcoded in `bin/api.ts`)
- SSL is enabled when `USE_SSL=true` in `.env` (requires certs in `./certs/`)

## Environment Variables

See `.env.example`:

| Variable | Required | Description |
|---|---|---|
| `VERCEL_URL` | Yes | Deployed Vercel URL — used in the loader script for fallback/production URLs |
| `USE_SSL` | No | Set to `"true"` for HTTPS local dev server |
| `VERCEL_DEPLOY_HOOK` | No | Webhook URL for `bun dep` to trigger Vercel deploys |
| `PUBLIC_ASSET_ORIGIN` | No | Override origin for `public/` asset URLs at runtime |
