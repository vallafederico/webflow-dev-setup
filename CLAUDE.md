# Webflow Development Setup

This project is a custom development environment for Webflow, using a modular JavaScript system and GSAP for animations. Taxi.js page transitions are available but off by default.

## Project Structure

- `src/modules/`: Custom modules that auto-mount based on `data-module` attributes.
- `src/lib/`: Core libraries (GSAP, Scroll, Pages, Transitions).
- `src/utils/`: Utility functions (Math, Tick, public asset and API URLs).
- `api/`: Serverless functions, on either host (Cloudflare or Vercel). See `docs/hosting.md`.

## Core Systems

1. **Module System**: Modules are functions exported from `src/modules/`. They receive `(element, dataset)`. `pnpm new:module <name>` writes one that passes every rule.
2. **Lifecycle Hooks**: Use `onMount`, `onDestroy`, `onPageIn`, `onPageOut` and `onEditor` from `@/modules/_`.
3. **Interactivity**: Use `onView` for viewport detection and `onTrack` for scroll progress.
4. **Subscriptions**: Use `Raf` for animation frames and `Resize` for window resizing from `@lib/subs`.
5. **Page Transitions (opt-in)**: Taxi.js is off. Links are full page loads, so `onDestroy` and `onPageOut` never run. To enable it:
   - In `src/lib/pages.ts`, uncomment `export const Pages = new _Pages();`.
   - In `src/app.ts`, uncomment `import { Pages } from "@lib/pages";` and `pages = Pages;`.
   - In the Webflow markup, wrap the page in an element with `data-taxi` and put `data-taxi-view` on the content inside it that changes per page. Links with `data-taxi-ignore` are skipped.
   - Set `"taxi": true` in `checks.config.json`, so the browser check also follows a real link.

## Environment Detection

- **Webflow Editor** (`editor/handled`): a module that calls `Raf.add`, `onView` or GSAP must call `onEditor` from `@/modules/_` to skip or reset the effect in the Designer. It releases its listener on destroy. Don't call `handleEditor` in modules.

## Checks

- `pnpm check` after every change. It has no network and is fast.
- `pnpm check:all` before saying work is done, and report its result. It adds the production build, bundle and host checks, and the browser run.
- `pnpm check:live` after a push, to compare the deployed files with the commit.
- `pnpm fix` applies the safe autofixes (formatting, import paths).
- `./node_modules/.bin/bun run bin/check/index.ts --json` gives machine-readable output. Add `--all` for the `check:all` set.
- Exit codes: `0` passed, `1` findings, `2` a tool failed. A tool failure is never a pass.
- Rules and how to fix them: `docs/house-rules.md`. To make an exception: `// house-ignore <rule>: <reason>` on the line above.

## Skills

Additional domain-specific guidance is available in `.claude/skills/`. Edit skills only there, then run `pnpm sync:skills`.
