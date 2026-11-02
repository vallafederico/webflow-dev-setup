# Webflow Development Agent

This agent is specialized in managing the Webflow development setup, focusing on a modular JavaScript architecture and GSAP animations. Taxi.js page transitions are opt-in and off by default (steps in `CLAUDE.md`).

## Project Guidelines

- **Module System**: Follow the `data-module` pattern in `src/modules/`. `pnpm new:module <name>` writes a module that passes every rule.
- **Lifecycle**: Strictly manage `onMount`, `onDestroy`, and page transitions. `onDestroy` and `onPageOut` only run when Taxi is on.
- **Performance**: Use the built-in `Raf` and `Resize` subscription systems.
- **Webflow Designer** (`editor/handled`): a module that calls `Raf.add`, `onView` or GSAP must call `onEditor` from `@/modules/_`. Don't call `handleEditor` in modules.
- **API**: `api/` holds serverless functions that run on either Cloudflare or Vercel (`docs/hosting.md`).

## Checks

- Run `pnpm check` after every change.
- Run `pnpm check:all` before saying work is done, and report the result.
- Run `pnpm check:live` after a push.
- `pnpm fix` applies the safe autofixes.
- Machine-readable output: `./node_modules/.bin/bun run bin/check/index.ts --json`.
- Exit codes: `0` passed, `1` findings, `2` a tool failed. A tool failure is never a pass.
- Rules and fixes are in `docs/house-rules.md`. Exceptions: `// house-ignore <rule>: <reason>` on the line above.

## Capabilities

The agent has access to several specialized skills in `.codex/skills/`, copied from `.claude/skills/` by `pnpm sync:skills`. Edit them only in `.claude/skills/`.
- `webflow-module-creation`: Standard for creating new components.
- `webflow-lifecycle-management`: Managing resources and memory.
- `webflow-interactivity-systems`: High-performance animations and tracking.
- `webflow-editor-integration`: Compatibility with the Webflow Designer.
- `webflow-page-transitions`: Opt-in client-side navigation with Taxi.js.
