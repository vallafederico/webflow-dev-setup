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
5. **Page Transitions (opt-in)**: Taxi.js is off. Links are full page loads, so `onDestroy` and `onPageOut` never run. The steps to enable it are in [`docs/component-lifecycle.md`](docs/component-lifecycle.md#integration-with-taxijs).

## Environment Detection

- **Webflow Editor** (`editor/handled`): a module that calls `Raf.add`, `onView` or GSAP must call `onEditor` from `@/modules/_` to skip or reset the effect in the Designer. It releases its listener on destroy. Don't call `handleEditor` in modules.

## Commands

Run everything through pnpm: `pnpm i`, `pnpm dev`, `pnpm build`, `pnpm check`. Bun is the bundler and runtime those scripts call, at the version the lockfile pins. No global Bun is needed.

To host an Off+Brand project (any project with `team.config.json`), run `pnpm team:create --json`, give the person the `creatorUrl` to confirm with their email code, then run `pnpm check:live --timeout 5m`. No Cloudflare login or token is ever needed. The `offbrand-team-setup` skill has the details.

Never run `bun install`, `bun add` or `bun <script>`. `bun install` replaces packages in `node_modules` and writes a `bun.lock`, and `pnpm i` then reports "Already up to date" without repairing them, so `tsc` fails with errors about `undici-types`. To recover, delete `bun.lock` and `node_modules`, then run `pnpm i --frozen-lockfile`.

## Checks

- `pnpm check` after every change. It has no network and is fast.
- `pnpm check:all` before saying work is done, and report its result. It adds the production build, bundle and host checks, and the browser run.
- `pnpm check:all` replaces `dist/` with a production build, so restart `pnpm dev` or edit a file to get its live reload back.
- `pnpm check:live` after a push, to compare the deployed files with the commit.
- `pnpm fix` applies the safe autofixes (formatting, import paths).
- `./node_modules/.bin/bun run bin/check/index.ts --json` gives machine-readable output. Add `--all` for the `check:all` set. This is the one command that skips pnpm: when a check fails, `pnpm check --json` adds an `ELIFECYCLE` line to stdout, which breaks the JSON.
- Exit codes: `0` passed, `1` findings, `2` a tool failed. A tool failure is never a pass.
- Rules and how to fix them: `docs/house-rules.md`. To make an exception: `// house-ignore <rule>: <reason>` on the line above.

## Skills

Additional domain-specific guidance is available in `.claude/skills/`. Edit skills only there, then run `pnpm sync:skills`.
