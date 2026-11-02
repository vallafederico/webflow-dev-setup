---
name: webflow-lifecycle-management
description: Manage module lifecycles, cleanup, and page transitions. Use when handling component initialization, destruction, or animating page entrances and exits.
---

# Webflow Lifecycle Management

This skill covers the usage of lifecycle hooks to ensure proper resource management and smooth page transitions.

## Lifecycle Hooks

Import these from `@/modules/_`:

- `onMount(fn)`: Runs once when the module is initialized and added to the DOM.
- `onDestroy(fn)`: Runs when the module is removed from the DOM. **CRITICAL** for preventing memory leaks.
- `onPageIn(fn)`: Runs during the page entrance transition. Usually used for animations. It also runs once on the first page load.
- `onPageOut(fn, options)`: Runs during the page exit transition.
- `onEditor(fn)`: Calls `fn(isEditor)` now and whenever the Webflow editor state changes, and releases its listener in `onDestroy`. Required by house rule `editor/handled` for modules that use `Raf.add`, `onView` or GSAP. See the [editor skill](../webflow-editor-integration/SKILL.md).

**`onDestroy` and `onPageOut` only run when Taxi page transitions are on.** They are off in the template, so links are full page loads and the page is simply replaced. Write the cleanup anyway: `pnpm check` requires it, and it is what makes enabling Taxi safe. See the [page transitions skill](../webflow-page-transitions/SKILL.md).

## Example Pattern

```typescript
import { onMount, onDestroy, onEditor, onPageIn, onPageOut } from "@/modules/_";
import gsap from "@lib/gsap";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  let inEditor = false;
  onEditor((isEditor) => {
    inEditor = isEditor;
  });

  onMount(() => {
    // Initialize: add event listeners, start observers
  });

  onPageIn(async () => {
    if (inEditor) return;
    // Animate in
    await gsap.from(element, { opacity: 0, y: 20, duration: 0.8 });
  });

  onPageOut(
    async () => {
      // Animate out
      await gsap.to(element, { opacity: 0, duration: 0.4 });
    },
    { element }
  ); // Pass { element } to only animate if visible

  onDestroy(() => {
    // Cleanup: remove listeners, destroy GSAP instances, stop observers
  });
}
```

## Critical Cleanup Checklist

Always perform these actions in `onDestroy`:
- [ ] Remove event listeners (`element.removeEventListener`). `{ once: true }` doesn't exempt a listener: if it never fires, it is still attached.
- [ ] Unsubscribe from `Raf`, `Resize`, or `Scroll` services.
- [ ] Remove `State.on` listeners with `State.off` and the same named handler.
- [ ] Destroy `Observe` or `Track` instances (`onView` and `onTrack` do this for you).
- [ ] Kill active GSAP animations if necessary.
- [ ] Clear `setTimeout` or `setInterval`, and disconnect observers.

`pnpm check` enforces most of this. See [House Rules](../../../docs/house-rules.md).

## Page Transitions
- `onPageIn` and `onPageOut` should be `async` functions to wait for animations to complete.
- Use the `{ element }` option in `onPageOut` to optimize performance by only running the exit animation if the element is currently in the viewport.
