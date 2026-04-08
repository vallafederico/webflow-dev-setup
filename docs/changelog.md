# Changelog

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
