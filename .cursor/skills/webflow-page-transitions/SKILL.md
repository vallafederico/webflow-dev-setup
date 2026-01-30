---
name: webflow-page-transitions
description: Manage and implement client-side page transitions using Taxi.js. Use when creating transition animations, handling cross-page state, or debugging navigation.
---

# Webflow Page Transitions

This skill covers how to work with the Taxi.js transition system and how it triggers module lifecycles.

## How it Works
1. **Trigger**: User clicks a valid link.
2. **Leave**: Taxi calls `onLeave` -> `transitionOut` -> `onPageOut` hooks run -> modules destroyed.
3. **Load**: New content is fetched and swapped.
4. **Enter**: Taxi calls `onEnter` -> `transitionIn` -> modules initialized -> `onPageIn` hooks run -> `onMount` hooks run.

## Implementing Transitions in Modules

Use the `onPageIn` and `onPageOut` hooks inside your modules to create seamless transitions.

```typescript
import { onPageIn, onPageOut } from "@/modules/_";
import gsap from "@lib/gsap";

export default function(element: HTMLElement) {
  // Entrance animation
  onPageIn(async () => {
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
Transitions are managed in `src/lib/pages.ts`. You can ignore specific links by adding `data-taxi-ignore` to the HTML element in Webflow.

## Troubleshooting Transitions
- **Animations not waiting**: Ensure your lifecycle hooks return a `Promise` (use `async` and `await`).
- **Module not mounting on new page**: Check if `data-module` is present in the new page's HTML and that the filename matches exactly.
- **Scroll issues**: The system automatically scrolls to top in `transitionOut`.
- **Memory leaks**: Ensure `onDestroy` handles cleanup; it is automatically triggered by the transition system.
