---
name: webflow-interactivity-systems
description: Use observer, scroll tracking, and subscription services for advanced interactivity. Use when implementing scroll animations, viewport detection, or frame-based updates.
---

# Webflow Interactivity Systems

Advanced interaction patterns using the project's custom services.

## Services
- `onView`: Viewport detection (Intersection Observer).
- `onTrack`: Scroll progress mapping.
- `Raf`: Animation frame subscription.
- `Resize`: Window resize subscription.

## Usage
```typescript
import { onView, onTrack } from "@/modules/_";
import { Raf } from "@lib/subs";

onView(element, { callback: ({ isIn }) => { ... } });
onTrack(element, { bounds: [0, 1], callback: (p) => { ... } });
const unsub = Raf.add(({ time }) => { ... });
```
