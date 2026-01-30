---
name: webflow-lifecycle-management
description: Manage module lifecycles, cleanup, and page transitions. Use when handling component initialization, destruction, or animating page entrances and exits.
---

# Webflow Lifecycle Management

Core lifecycle patterns for memory safety and smooth transitions.

## Lifecycle Hooks
- `onMount`: Component startup.
- `onDestroy`: **Mandatory cleanup**.
- `onPageIn`: Entrance animations.
- `onPageOut`: Exit animations.

## Example
```typescript
import { onMount, onDestroy, onPageIn, onPageOut } from "@/modules/_";

export default function(element: HTMLElement) {
  onPageIn(async () => { /* transition in */ });
  onPageOut(async () => { /* transition out */ }, { element });
  onDestroy(() => { /* cleanup everything */ });
}
```
