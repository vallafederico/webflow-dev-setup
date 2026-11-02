# Changelog

## [Unreleased] - 2026-11-02

### Added

- **Cloudflare hosting alongside Vercel**: `pnpm connect cloudflare` or `pnpm connect vercel` picks the host and writes `project.config.json` (and `wrangler.jsonc` on Cloudflare). On Cloudflare, pushing to `main` builds with Workers Builds, serves `dist/` as static assets, and runs `api/*.ts` through a generated router (not yet confirmed on a real Workers Builds push, see Hosting). Optional R2 media with `pnpm connect cloudflare --media` and `mediaUrl()` (`--media` untested). See [Hosting](./hosting.md).
- **Checks agents and CI can run**: `pnpm check`, `pnpm check:all`, `pnpm check:live` and `pnpm fix`, with house rules for modules, `pnpm new:module <name>`, and a GitHub Actions workflow that runs `pnpm check:all` on pull requests. See [House Rules](./house-rules.md).
- **`onEditor`** in `@/modules/_`: calls a function with the Webflow editor state and releases its listener on destroy. Modules that use `Raf.add`, `onView` or GSAP must call it (`editor/handled`).

### Changed

- **Deploy URL and preview suffix come from `project.config.json`**, not the `VERCEL_URL` and `PREVIEW_HOST_SUFFIX` env vars. A loader with no suffix accepts no `?js=` preview, where it used to default to `.vercel.app`. Re-paste the loader after moving a site to another host. A build on Vercel with no config still uses the `VERCEL_URL` Vercel sets itself.
- **The dev index connects the project**: with no host it shows a **Connect a host** form, filled in from your Cloudflare login where it can, and a local-only loader so you can start in Webflow straight away. Once connected it shows the project's details, the next steps and the full loader. Paste that over the local one.
- **pnpm runs everything**. `pnpm i` replaces `bun install`, and `vercel.json` now builds with `pnpm build`, so Vercel uses the Bun version in the lockfile. Bun stays the bundler and dev runtime. Don't run `bun install`: see [Use pnpm, not Bun](./setup.md#use-pnpm-not-bun).
- **`.claude/skills` is the only place skills are edited**. `pnpm sync:skills` copies them to `.codex` and `.cursor`, and `pnpm check` fails on drift.
- **Raf timing**: Raf now passes `time` and `deltaTime` in seconds; previously the two were swapped and `time` was mis-scaled.
- **Docs say Taxi is opt-in**, with the steps to enable it. It was already off in the template.

---

## [Unreleased] - 2026-10-06

### Fixed

- **Bundle running before `<body>` on phones**: The loader now writes the deploy-path `<script defer>` with `document.write` while the page is parsing, so `defer` is honoured. Appended scripts ignore `defer`, so a cached bundle could run in `<head>`; any code touching `document.body` at startup then crashed the whole bundle and Safari on iOS offered to "reduce advanced privacy protections". Applies to production domains, phones and branch previews; the desktop localhost path is unchanged. See [Loader Script](./loader.md#why-the-loader-looks-the-way-it-does).

---

## [Unreleased] - 2026-09-23

### Added

- **Branch previews on `.webflow.io`**: `?js=<vercel preview url>` and `&css=<vercel preview url>` load JS / CSS from a Vercel branch deployment, remembered per tab, cleared with `?js=off` / `?css=off`. Only `https` hosts ending in `PREVIEW_HOST_SUFFIX` (default `.vercel.app`) are accepted; production domains ignore them. `?js=none` / `?css=none` skip loading the bundle on staging for debugging. See [Branch Previews](./branch-previews.md).
- **`?local=1` on `.webflow.io`**: tries the local dev server even on touch devices (iOS Simulator), remembered per tab, cleared with `?local=0`.

### Fixed

- **Mobile JS / Safari privacy**: Loader no longer forces `crossOrigin` on classic scripts; skips localhost on phones. See [Mobile JS Loading Fix](./mobile-js-loading-fix.md).
- **Editor detection**: Body-safe init + one shared `MutationObserver` (`handleEditor` / `releaseEditor`).
- **Page entries**: `about` / `info` / `home` boot `App` instead of stub logs.

---

## [Unreleased] - 2025-04-08

### Changed

- **Unified Loader Script**: Replaced per-file `onerror` handlers with a single self-contained `<script>` block
  - Production (non `.webflow.io`): loads JS + CSS directly from Vercel — fastest path
  - Dev (`.webflow.io`): preloads deployed assets, tries local dev server first, falls back on error
  - Dev server index page now shows a click-to-copy loader script with pre-filled URLs

- **Page-Specific JS Routing**: The loader auto-routes by URL path to page-specific scripts
  - Files in `src/pages/` are built as separate entrypoints
  - Loader matches first path segment (e.g. `/home` → `home.js`)
  - Falls back to `app.js` when no page matches
  - Dev server index shows role badges: `(fallback)` for app.js, `(/slug)` for page scripts

- **CSS Fully Managed by Loader**: `app.css` is injected by the loader script
  - No more separate `<link>` tags in Webflow's custom code
  - No more custom CSS written inside Webflow Designer
  - Same local-first-with-fallback strategy as JS
  - Single CSS entrypoint (`app.css`) — removed `out.css` as a default

### Removed

- Per-file inline `onerror` fallback attributes
- Dual-script CSS approach (separate Designer vs Production stylesheets)
- `out.css` as a default CSS entrypoint (no longer needed since CSS isn't written in Webflow)
- `.error-handler-box` UI in dev server index (replaced by `.loader-box`)

---

## [Unreleased] - 2024-12-19

### Added

- **Enhanced Scroll System**: Integrated Lenis for smooth scrolling with subscription capabilities

  - Smooth scrolling with configurable lerp and touch multiplier
  - Priority-based subscription system for scroll events
  - Automatic scroll position management during page transitions
  - `Scroll.toTop()` method for resetting scroll position

- **Webflow Editor Detection**: Automatic detection and handling of Webflow editor mode

  - `handleEditor()` function detects Webflow editor state changes
  - Automatically disables smooth scrolling in editor mode
  - Prevents conflicts between custom scroll system and Webflow editor

- **Advanced Observer System**: Improved Intersection Observer with grouping and management

  - `ObserverManager` singleton for efficient observer management
  - Observer grouping by configuration to reduce memory usage
  - Enhanced direction detection for scroll-based animations
  - Automatic cleanup and memory management

- **Track System**: Advanced scroll tracking with precise bounds calculation

  - `Track` class extends `Observe` for scroll-based animations
  - Configurable bounds and trigger points (top, center, bottom)
  - Automatic bounds recalculation on resize
  - Scroll progress tracking with 0-1 value range

- **Subscription System**: Centralized event management with priority support

  - `Raf` class for requestAnimationFrame with GSAP ticker integration
  - `Resize` class for debounced window resize events
  - Priority-based subscription ordering
  - Automatic cleanup and memory management

- **Enhanced Page Transitions**: Improved Taxi.js integration with lifecycle hooks
  - `Transition` class for coordinating page transitions
  - Automatic scroll position management
  - Lifecycle hook integration for smooth animations
  - Error handling with Promise.allSettled

### Improved

- **Module System**: Enhanced component lifecycle management

  - Better initialization tracking to prevent duplicate initialization
  - Improved error handling for module loading
  - Enhanced cleanup and memory management
  - More robust element tracking

- **Lifecycle Hooks**: More flexible and powerful lifecycle management
  - Enhanced `onPageOut` with visibility-based execution
  - Improved error handling for parallel execution
  - Better integration with scroll and resize systems
  - More intuitive API design

### Technical Improvements

- **Performance**: Optimized observer management and subscription handling
- **Memory Management**: Better cleanup and resource management
- **Error Handling**: Improved error handling throughout the system
- **TypeScript**: Enhanced type safety and better type definitions
- **Code Organization**: Better separation of concerns and modularity

### Breaking Changes

- None

### Migration Guide

- No migration required for existing code
- New features are additive and backward compatible
