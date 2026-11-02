# Project Architecture

## Overview

Understanding how the build system works and its components.

## Key Components

### Development Server

- Handles live reload
- Serves bundled files
- Manages WebSocket connections

### Build System

- Bundles JavaScript and CSS
- Processes multiple entry points
- Handles source maps

### API Server

- Serves API routes
- Provides development endpoints
- Manages route documentation

## Commands

Run all of these through pnpm, which calls the project's own Bun. See [Use pnpm, not Bun](./setup.md#use-pnpm-not-bun).

| Command | Runs | What it does |
|---|---|---|
| `pnpm dev` | `bin/dev.ts` | Dev server with live reload, and the loader script on its index page |
| `pnpm api` | `bin/api.ts` | Local API server |
| `pnpm all` | `bin/all.ts` | `pnpm dev` and `pnpm api` together |
| `pnpm build`, `pnpm bundle` | `bin/build.ts` | Production build into `dist/` |
| `pnpm dep` | `bin/deploy.ts` | Vercel: posts the deploy hook. Cloudflare: says to push instead |
| `pnpm connect <host>` | `bin/connect.ts` | Picks Cloudflare or Vercel and writes `project.config.json` |
| `pnpm setup-ssl` | `scripts/setup-ssl.sh` | Local certificates, see [SSL Setup](./ssl.md) |
| `pnpm check` | `bin/check/index.ts` | The fast checks, see [House Rules](./house-rules.md#the-other-checks) |
| `pnpm check:all` | `bin/check/index.ts --all` | The fast checks, then the build, bundle, host and browser checks |
| `pnpm check:runtime` | `bin/check/index.ts --only runtime` | Only the browser run |
| `pnpm check:live` | `bin/check/live.ts` | Compares the deployed files with the commit |
| `pnpm check:mutations` | `bin/check/verify-mutations.ts` | Plants bugs in temp copies and confirms the checks catch them. Slow, and not part of CI |
| `pnpm fix` | `bin/check/fix.ts` | Safe autofixes: formatting and import paths |
| `pnpm new:module <name>` | `bin/new-module.ts` | Writes a module that passes every rule |
| `pnpm sync:skills` | `bin/sync-skills.ts` | Copies `.claude/skills` to `.codex` and `.cursor` |

## Configuration

Build settings are in `bin/config.ts`. Project settings are in `project.config.json`, see [Configuration Guide](./config.md#project-settings).
