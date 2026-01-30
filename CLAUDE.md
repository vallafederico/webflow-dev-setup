# Webflow Development Setup

This project is a custom development environment for Webflow, using a modular JavaScript system, GSAP for animations, and Taxi.js for page transitions.

## Project Structure

- `src/modules/`: Custom modules that auto-mount based on `data-module` attributes.
- `src/lib/`: Core libraries (GSAP, Scroll, Pages, Transitions).
- `src/utils/`: Utility functions (Math, Tick, URL validation).
- `api/`: Serverless functions (Vercel).

## Core Systems

1. **Module System**: Modules are functions exported from `src/modules/`. They receive `(element, dataset)`.
2. **Lifecycle Hooks**: Use `onMount`, `onDestroy`, `onPageIn`, and `onPageOut` from `@/modules/_`.
3. **Interactivity**: Use `onView` for viewport detection and `onTrack` for scroll progress.
4. **Subscriptions**: Use `Raf` for animation frames and `Resize` for window resizing from `@lib/subs`.
5. **Page Transitions**: Managed by Taxi.js in `src/lib/pages.ts` and `src/lib/page-transitions.ts`.

## Environment Detection

- **Webflow Editor**: Use `handleEditor` from `@webflow/detect-editor` to disable JS features in the Designer.

## Skills

Additional domain-specific guidance is available in `.claude/skills/`.
