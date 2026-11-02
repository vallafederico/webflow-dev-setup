---
name: webflow-interactivity-systems
description: Use observer, scroll tracking, and subscription services for advanced interactivity. Use when implementing scroll animations, viewport detection, or frame-based updates.
---

# Webflow Interactivity Systems

This skill guides you through the specialized systems for viewport detection, scroll progress tracking, and global event subscriptions.

A module that uses `onView`, `Raf.add` or GSAP must also call `onEditor`, so it doesn't run in the Webflow Designer. See [Webflow Editor Integration](../webflow-editor-integration/SKILL.md) and [House Rules](../../../docs/house-rules.md).

## Viewport & Scroll Tracking

Import from `@/modules/_`:

### `onView` (Viewport Detection)
Triggers a callback when an element enters or leaves the viewport. It doesn't start by itself: pass `autoStart: true`, or call `observer.start()` (for example from `onMount`). It is destroyed in `onDestroy` for you.
```typescript
onView(element, {
  threshold: 0.1,
  autoStart: true,
  callback: ({ isIn, direction }) => {
    element.classList.toggle("is-visible", isIn);
  },
});
```

### `onTrack` (Scroll Progress)
Maps scroll progress through an element to a value from 0 to 1. The output is clamped to 0-1, so keep `bounds` at `[0, 1]` and scale in the callback.
```typescript
onTrack(element, {
  bounds: [0, 1], // Map progress to 0-1
  top: "bottom", // Start when the element's top reaches the viewport bottom
  bottom: "top", // End when the element's bottom reaches the viewport top
  callback: (value) => {
    element.style.setProperty("--progress", (value * 100).toString()); // 0-100
  },
});
```

## Global Subscriptions

Import from `@lib/subs`:

### `Raf` (Animation Frame)
For smooth, frame-based updates. Returns an unsubscribe function.
```typescript
const unsubscribe = Raf.add(({ time, deltaTime }) => {
  // time: seconds since the ticker started. deltaTime: seconds since the last frame
  element.style.transform = `rotate(${time * 50}deg)`;
});
onDestroy(unsubscribe);
```

### `Resize` (Window Resize)
For responsive logic. Returns an unsubscribe function.
```typescript
const unsubscribe = Resize.add(({ width, height }) => {
  element.classList.toggle("is-mobile", width < 768);
});
onDestroy(unsubscribe);
```

## Priority & Performance

- **Priorities**: `add(callback, priority)` where lower numbers run first.
  - `-1`: High priority (critical layout)
  - `0`: Normal priority (default)
  - `1`: Low priority (background effects)
- **Efficiency**: Use `onView` to enable/disable expensive `Raf` or `onTrack` callbacks when the element is not visible.
- **Cleanup**: Always call the returned unsubscribe function in `onDestroy` (house rule `cleanup/subscription`).

## Trigger Point Guide for `onTrack`
- `top: "bottom"`, `bottom: "top"`: Full visibility duration.
- `top: "center"`, `bottom: "center"`: While element passes through screen center.
- `top: "top"`, `bottom: "bottom"`: While element is fully contained in viewport.
