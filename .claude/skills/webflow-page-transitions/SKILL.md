---
name: webflow-page-transitions
description: Manage and implement client-side page transitions using Taxi.js. Use when creating transition animations, handling cross-page state, or debugging navigation.
---

# Webflow Page Transitions

This skill covers how to work with the Taxi.js transition system and how it triggers module lifecycles.

## Taxi is opt-in

Taxi is off in the template: it is commented out in `src/app.ts` and `src/lib/pages.ts`. Links are full page loads, so `onDestroy` and `onPageOut` never run. `onPageIn` and `onMount` run once per load.

To enable it:

1. In `src/lib/pages.ts`, uncomment `export const Pages = new _Pages();`.
2. In `src/app.ts`, uncomment `import { Pages } from "@lib/pages";` and `pages = Pages;`.
3. In the Webflow markup, wrap the page in an element with `data-taxi`, and put `data-taxi-view` on the content inside it that changes per page. Taxi reads both from every page it fetches, and throws without `data-taxi-view`.
4. Set `"taxi": true` in `checks.config.json`, so the browser check also follows a real link between pages.

## How it Works (once enabled)
1. **Trigger**: User clicks a valid link.
2. **Leave**: Taxi calls `onLeave` -> `transitionOut` -> `onPageOut` hooks run -> modules destroyed (`onDestroy`).
3. **Load**: New content is fetched and swapped.
4. **Enter**: Taxi calls `onEnter` -> `transitionIn` -> modules initialized -> `onPageIn` hooks run -> `onMount` hooks run.

## Implementing Transitions in Modules

Use the `onPageIn` and `onPageOut` hooks inside your modules to create seamless transitions. They are safe to write before Taxi is on: `onPageIn` runs on load, and `onPageOut` waits until it is enabled.

```typescript
import { onEditor, onPageIn, onPageOut } from "@/modules/_";
import gsap from "@lib/gsap";

export default function(element: HTMLElement) {
  let inEditor = false;
  onEditor((isEditor) => {
    inEditor = isEditor;
  });

  // Entrance animation
  onPageIn(async () => {
    if (inEditor) return;
    await gsap.from(element, { 
      opacity: 0, 
      y: 30, 
      duration: 1, 
      ease: "power3.out" 
    });
  });

  // Exit animation
  onPageOut(async () => {
    await gsap.to(element, { 
      opacity: 0, 
      duration: 0.5 
    });
  }, { element }); // { element } ensures it only runs if visible
}
```

## Global Configuration
Transitions are managed in `src/lib/pages.ts` and `src/lib/page-transitions.ts`. You can ignore specific links by adding `data-taxi-ignore` to the link in Webflow.

## Troubleshooting Transitions
- **Nothing happens on navigation**: Taxi is off until the steps above are done.
- **Animations not waiting**: Ensure your lifecycle hooks return a `Promise` (use `async` and `await`).
- **Module not mounting on new page**: Check if `data-module` is present in the new page's HTML and that the filename matches exactly.
- **Scroll issues**: The system automatically scrolls to top in `transitionOut`.
- **Memory leaks**: Ensure `onDestroy` handles cleanup; it is triggered by the transition system once Taxi is on (see [House Rules](../../../docs/house-rules.md)).
