---
name: webflow-interactivity-systems
description: Use observer, scroll tracking, and subscription services for advanced interactivity. Use when implementing scroll animations, viewport detection, or frame-based updates.
---

# Webflow Interactivity Systems

This skill guides you through the specialized systems for viewport detection, scroll progress tracking, and global event subscriptions.

## Viewport & Scroll Tracking

Import from `@/modules/_`:

### `onView` (Viewport Detection)
Triggers a callback when an element enters or leaves the viewport.
```typescript
onView(element, {
  threshold: 0.1,
  callback: ({ isIn, direction }) => {
    element.classList.toggle("is-visible", isIn);
  }
});
```

### `onTrack` (Scroll Progress)
Maps scroll progress through an element to a range of values.
```typescript
onTrack(element, {
  bounds: [0, 100], // Map progress to 0-100
  top: "bottom",    // Start when bottom of element hits viewport top
  bottom: "top",    // End when top of element hits viewport bottom
  callback: (value) => {
    element.style.setProperty("--progress", value.toString());
  }
});
```

## Global Subscriptions

Import from `@lib/subs`:

### `Raf` (Animation Frame)
For smooth, frame-based updates. Returns an unsubscribe function.
```typescript
const unsubscribe = Raf.add(({ deltaTime, time }) => {
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
- **Cleanup**: Always call the returned unsubscribe function in `onDestroy`.

## Trigger Point Guide for `onTrack`
- `top: "bottom"`, `bottom: "top"`: Full visibility duration.
- `top: "center"`, `bottom: "center"`: While element passes through screen center.
- `top: "top"`, `bottom: "bottom"`: While element is fully contained in viewport.
