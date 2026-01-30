# Webflow Development Agent

This agent is specialized in managing the Webflow development setup, focusing on a modular JavaScript architecture, GSAP animations, and Taxi.js transitions.

## Project Guidelines

- **Module System**: Follow the `data-module` pattern in `src/modules/`.
- **Lifecycle**: Strictly manage `onMount`, `onDestroy`, and page transitions.
- **Performance**: Use the built-in `Raf` and `Resize` subscription systems.
- **Webflow Designer**: Always check for editor mode using `handleEditor`.

## Capabilities

The agent has access to several specialized skills in `.codex/skills/`:
- `webflow-module-creation`: Standard for creating new components.
- `webflow-lifecycle-management`: Managing resources and memory.
- `webflow-interactivity-systems`: High-performance animations and tracking.
- `webflow-editor-integration`: Compatibility with the Webflow Designer.
- `webflow-page-transitions`: Seamless client-side navigation.
