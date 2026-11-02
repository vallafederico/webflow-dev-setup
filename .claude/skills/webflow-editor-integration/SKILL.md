---
name: webflow-editor-integration
description: Handle Webflow Designer/Editor mode vs Published site behavior. Use when detecting the editor, disabling custom animations in the designer, or managing features based on the environment.
---

# Webflow Editor Integration

This skill explains how to ensure your custom code doesn't interfere with the Webflow Designer/Editor while providing full functionality on the published site.

## Editor Detection

Import `onEditor` from `@/modules/_`. It calls your function now and again whenever the editor state changes, and releases its listener in `onDestroy`:

```typescript
import { onEditor } from "@/modules/_";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  onEditor((isEditor) => {
    if (isEditor) {
      // Logic for Webflow Designer (Editor)
      element.classList.add("is-editor");
      element.style.pointerEvents = "none"; // Avoid blocking clicks in Designer
      // Reset any transforms or opacity applied by custom JS
      element.style.transform = "none";
      element.style.opacity = "1";
    } else {
      // Logic for Published Site
      element.classList.remove("is-editor");
      element.style.pointerEvents = "auto";
    }
  });
}
```

Don't call `handleEditor` from `@webflow/detect-editor` in a module: it has no release, so the listener outlives the page. `onEditor` wraps it. `handleEditor` is for library code such as `src/lib/scroll.ts`.

## House rule: `editor/handled`

A module that calls `Raf.add`, `onView`, `new SplitText` or an animating GSAP method (`gsap.to`, `gsap.timeline`, ...) must also call `onEditor`, or `pnpm check` fails. `Scroll` and `onTrack` are exempt, because `src/lib/scroll.ts` already stops Lenis in the editor. The rule only checks that `onEditor` is called, so make the callback do the work. See [House Rules](../../../docs/house-rules.md).

## Best Practices

- **Disable Interactivity**: Always set `pointerEvents = "none"` in the editor if your component has a fixed position or covers large areas.
- **Reset State**: The editor should show the static, CSS-defined state of your component. Reset any JS-applied styles (`transform`, `opacity`, etc.) when `isEditor` is true.
- **Kill Animations**: If you use GSAP or other animation libraries, ensure they are killed or not started when in editor mode.
- **Conditional Lifecycle**: Keep the flag from `onEditor` in a variable and check it inside `onMount`, `onPageIn`, and other hooks to skip logic that isn't needed in the Designer. `onEditor` runs its callback straight away, so the flag is set before the hooks run.

## Example: Conditional Viewport Detection

`onView` doesn't start observing until you call `start()` (or pass `autoStart: true`), so the editor callback can switch it on and off:

```typescript
const observer = onView(element, {
  callback: ({ isIn }) => {
    element.classList.toggle("animate-in", isIn);
  },
});

onEditor((isEditor) => {
  if (isEditor) {
    observer.stop();
    element.classList.remove("animate-in");
  } else {
    observer.start();
  }
});
```
