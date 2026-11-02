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

## Project Settings

Host settings live in `project.config.json`, committed and written by `pnpm connect` (see [Hosting](./hosting.md)):

| Field | Description |
|---|---|
| `host` | `cloudflare` or `vercel` |
| `name` | Project name, a lowercase DNS label |
| `deployUrl` | Production origin, used by the loader and baked into the bundle for `public/` URLs |
| `mediaUrl` | R2 media origin, or `null` |
| `previewHostSuffix` | Hosts ending in this are accepted as branch previews (`?js=`, `?css=`) |

An unconnected project has no file. `bun dev` still works, and its index page shows a "run `pnpm connect`" notice instead of the loader. A production build with no file warns, fails on Workers Builds, and on Vercel falls back to the `VERCEL_URL` that Vercel sets itself. An invalid file fails a production build.

## Environment Variables

See `.env.example`:

| Variable | Required | Description |
|---|---|---|
| `USE_SSL` | No | Set to `"true"` for HTTPS local dev server |
| `VERCEL_DEPLOY_HOOK` | No | Webhook URL for `pnpm dep` to trigger Vercel deploys. Vercel only |
| `PUBLIC_ASSET_ORIGIN` | No | Override the origin baked into the bundle for `public/` asset URLs at build time |

`pnpm connect` also reads `WF_BASE_DOMAIN` and `WF_ZONE_ID`, and Wrangler reads `CLOUDFLARE_API_TOKEN`. See [Hosting](./hosting.md#environment).
