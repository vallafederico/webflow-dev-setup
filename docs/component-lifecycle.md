# Component Lifecycle & Page Transitions

This document outlines the component lifecycle system and how it integrates with page transitions using the Taxi.js library.

> Examples omit `onEditor`; `editor/handled` requires it for modules using `Raf.add`, `onView` or GSAP. See [House Rules](./house-rules.md).

> **Taxi is opt-in and off by default.** Without it, links are full page loads: `onPageIn` and `onMount` run once per load, and `onDestroy` and `onPageOut` never run. The steps to enable it are in [Integration with Taxi.js](#integration-with-taxijs).

## Overview

The system provides a declarative way to manage component lifecycles during page transitions, ensuring smooth animations and proper cleanup. Components are automatically discovered and managed based on data attributes.

## Component Discovery

Components are automatically discovered using the `createCycles()` function, which:

- Scans the DOM for elements with `data-module` attributes
- Dynamically imports corresponding module files from `src/modules/`
- Instantiates each component with the element and its dataset
- Returns an array of initialized components

```typescript
// Example component element
<div data-module="cycle">...</div>;

// Corresponding module file: src/modules/cycle.ts
export default function (element: HTMLElement, dataset: DOMStringMap) {
  // Component logic here
}
```

---

## Pure Lifecycle Hooks

### `onMount(fn: () => void)`

- **Trigger**: Called when the page enters and components are initialized
- **Purpose**: Set up component state, initialize variables, prepare component for use
- **Execution**: Synchronous, runs after `createCycles()`, and after `runPageIn()` has started on a normal load, and after it has finished once Taxi is on
- **Use Case**: Perfect for one-time setup that doesn't involve animations

```typescript
onMount(() => {
  // Initialize component state
  element.dataset.initialized = "true";

  // Set up initial styles
  element.style.opacity = "0";

  // Start observers or timers
  observer.start();
});
```

### `onDestroy(fn: () => void)`

- **Trigger**: Called when the page is about to transition out. Only runs when Taxi is enabled
- **Purpose**: Clean up observers, cancel animations, remove event listeners, reset state
- **Execution**: Synchronous, runs during `runDestroy()`
- **Use Case**: Essential for preventing memory leaks and cleaning up resources

```typescript
onDestroy(() => {
  // Stop observers
  observer.destroy();

  // Cancel any ongoing animations
  gsap.killTweensOf(element);

  // Remove event listeners
  element.removeEventListener("click", handleClick);

  // Reset component state
  element.dataset.initialized = "false";
});
```

### `onEditor(fn: (isEditor: boolean) => void)`

- **Trigger**: Called straight away with the current editor state, and again whenever it changes
- **Purpose**: Skip or reset effects inside the Webflow Designer
- **Cleanup**: Releases its listener in `onDestroy`, so you don't have to
- **Rule**: A module that calls `Raf.add`, `onView` or GSAP must call it (`editor/handled`, see [House Rules](./house-rules.md)). Don't call `handleEditor` directly in a module

```typescript
onEditor((isEditor) => {
  if (isEditor) gsap.set(element, { clearProps: "all" });
});
```

---

## Page Transition Hooks

### `onPageIn(fn: () => Promise<void>)`

- **Trigger**: Called when the page enters (before mount). Also runs once on the first page load
- **Purpose**: Animate components into view, trigger entrance animations
- **Execution**: Asynchronous, runs after `createCycles()` and before `runMount()`
- **Note**: All `onPageIn` callbacks run in parallel using `Promise.allSettled()`

```typescript
onPageIn(async () => {
  await gsap.to(element, {
    duration: 0.5,
    opacity: 1,
    y: 0,
    ease: "power2.out",
  });
});
```

### `onPageOut(fn: () => Promise<void>, options?: { element?: HTMLElement })`

- **Trigger**: Called when the page is about to transition out. Only runs when Taxi is enabled
- **Purpose**: Animate components out of view, prepare for transition
- **Execution**: Asynchronous, runs before `runDestroy()`
- **Options**:
  - `element`: If provided, the callback only runs if the element is currently visible in the viewport
- **Note**: All `onPageOut` callbacks run in parallel using `Promise.allSettled()`

```typescript
// Animate out only if element is visible
onPageOut(
  async () => {
    await gsap.to(element, {
      duration: 0.3,
      opacity: 0,
      y: -20,
      ease: "power2.in",
    });
  },
  { element } // Only animate if element is in viewport
);

// Always animate out (regardless of visibility)
onPageOut(async () => {
  await gsap.to(element, {
    duration: 0.2,
    scale: 0.8,
    opacity: 0,
  });
});
```

---

## Animation Utilities

### `onView(element, config)`

- **Purpose**: Set up Intersection Observer for viewport detection
- **Auto-cleanup**: Automatically destroyed when component is destroyed
- **Returns**: Observer instance for manual control
- **Use Case**: Trigger animations when elements enter/leave the viewport

```typescript
const observer = onView(element, {
  root: null, // Use viewport as root
  rootMargin: "0px", // No margin
  threshold: 0.1, // Trigger when 10% visible
  autoStart: false, // Don't start automatically
  once: false, // Trigger multiple times
  callback: ({ isIn }) => {
    if (isIn) {
      // Element entered viewport
      gsap.to(element, { opacity: 1, duration: 0.5 });
    } else {
      // Element left viewport
      gsap.to(element, { opacity: 0.5, duration: 0.3 });
    }
  },
});

// Start the observer when component mounts
onMount(() => {
  observer.start();
});
```

### `onTrack(element, config)`

- **Purpose**: Set up scroll tracking for scroll-based animations
- **Auto-cleanup**: Automatically destroyed when component is destroyed
- **Returns**: Track instance for manual control
- **Use Case**: Create parallax effects, scroll-triggered animations

```typescript
const track = onTrack(element, {
  bounds: [0, 1], // Track from 0% to 100% of viewport
  top: "center", // Start when the element's top reaches the viewport center
  bottom: "center", // End when the element's bottom reaches the viewport center
  callback: (value) => {
    // value goes from 0 to 1 as element scrolls through viewport
    gsap.set(element, {
      y: value * 100, // Move element down as it scrolls
      rotation: value * 360, // Rotate element as it scrolls
    });
  },
});
```

---

## Subscription System (Raf & Resize)

The system provides two global subscription services for handling requestAnimationFrame and resize events efficiently.

### `Raf` - Request Animation Frame

- **Purpose**: Provides a centralized requestAnimationFrame loop using GSAP's ticker
- **Data**: Provides `{ deltaTime, time }` on each frame
- **Performance**: Uses GSAP's optimized ticker for better performance
- **Use Case**: Smooth animations, physics simulations, continuous updates

```typescript
import { Raf } from "@lib/subs";

// Subscribe to animation frame updates
const unsubscribe = Raf.add(({ deltaTime, time }) => {
  // deltaTime: time since last frame in seconds
  // time: total time since start in seconds

  // Update element position based on time
  element.style.transform = `translateX(${Math.sin(time) * 50}px)`;

  // Or use deltaTime for frame-rate independent animations
  element.style.opacity = Math.min(1, element.style.opacity + deltaTime);
});

// Clean up subscription
onDestroy(() => {
  unsubscribe();
});
```

### `Resize` - Window Resize Events

- **Purpose**: Provides debounced resize events with current dimensions
- **Data**: Provides `{ width, height }` when window size changes
- **Debouncing**: Automatically debounced (100ms delay) to prevent excessive updates
- **Use Case**: Responsive layouts, recalculating positions, updating animations

```typescript
import { Resize } from "@lib/subs";

// Subscribe to resize events
const unsubscribe = Resize.add(({ width, height }) => {
  // Update component based on new dimensions
  if (width < 768) {
    element.classList.add("mobile");
    element.classList.remove("desktop");
  } else {
    element.classList.add("desktop");
    element.classList.remove("mobile");
  }

  // Recalculate positions or animations
  updateLayout();
});

// Clean up subscription
onDestroy(() => {
  unsubscribe();
});
```

### Advanced Subscription Usage

#### Priority System

Both `Raf` and `Resize` support priority-based subscription ordering:

```typescript
// Higher priority (negative numbers = higher priority)
Raf.add(updateCriticalAnimation, -1);

// Normal priority (default = 0)
Raf.add(updateBackgroundAnimation, 0);

// Lower priority (positive numbers = lower priority)
Raf.add(updateNonCriticalAnimation, 1);
```

#### Multiple Subscriptions

You can have multiple subscriptions in the same component:

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  // Subscribe to animation frame for smooth movement
  const rafUnsubscribe = Raf.add(({ time }) => {
    element.style.transform = `rotate(${time * 50}deg)`;
  });

  // Subscribe to resize for responsive behavior
  const resizeUnsubscribe = Resize.add(({ width }) => {
    element.style.fontSize = width < 768 ? "14px" : "18px";
  });

  // Clean up both subscriptions
  onDestroy(() => {
    rafUnsubscribe();
    resizeUnsubscribe();
  });
}
```

#### Performance Considerations

- **Raf**: Use sparingly - each subscription runs every frame
- **Resize**: Automatically debounced, but still limit heavy operations
- **Cleanup**: Always unsubscribe in `onDestroy` to prevent memory leaks
- **Priority**: Use priorities to ensure critical updates run first

---

## Page Transition Flow

The page transition system follows this sequence:

### Page Exit (transitionOut)

1. **`runPageOut()`** - Execute all `onPageOut` callbacks in parallel
2. **`runDestroy()`** - Execute all `onDestroy` callbacks and clean up observers
3. **`Scroll.toTop()`** - Reset scroll position

### Page Enter (transitionIn)

1. **`createCycles()`** - Discover and initialize new components
2. **`Scroll.resize()`** - Update scroll calculations
3. **`runPageIn()`** - Execute all `onPageIn` callbacks in parallel
4. **`runMount()`** - Execute all `onMount` callbacks

---

## Complete Component Example

```typescript
// src/modules/example.ts
import {
  onMount,
  onDestroy,
  onPageOut,
  onPageIn,
  onView,
  onTrack,
} from "@/modules/_";
import { Raf, Resize } from "@lib/subs";
import gsap from "@lib/gsap";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  // Set up viewport observer
  const observer = onView(element, {
    threshold: 0.1,
    autoStart: false,
    callback: ({ isIn }) => {
      if (isIn) {
        element.classList.add("in-view");
      } else {
        element.classList.remove("in-view");
      }
    },
  });

  // Set up scroll tracking
  const track = onTrack(element, {
    bounds: [0, 1],
    callback: (value) => {
      element.style.setProperty("--scroll-progress", value.toString());
    },
  });

  // Subscribe to animation frame for smooth effects
  const rafUnsubscribe = Raf.add(({ time }) => {
    if (element.classList.contains("in-view")) {
      element.style.transform = `translateY(${Math.sin(time) * 5}px)`;
    }
  });

  // Subscribe to resize for responsive behavior
  const resizeUnsubscribe = Resize.add(({ width }) => {
    element.style.fontSize = width < 768 ? "14px" : "18px";
  });

  // Component initialization
  onMount(() => {
    console.log("Component mounted");
    observer.start();
    element.style.opacity = "0";
  });

  // Page entrance animation
  onPageIn(async () => {
    await gsap.to(element, {
      duration: 0.5,
      opacity: 1,
      y: 0,
      ease: "power2.out",
    });
  });

  // Page exit animation (only if visible)
  onPageOut(
    async () => {
      await gsap.to(element, {
        duration: 0.3,
        opacity: 0,
        y: -20,
        ease: "power2.in",
      });
    },
    { element }
  );

  // Cleanup
  onDestroy(() => {
    console.log("Component destroyed");
    element.classList.remove("in-view");
    rafUnsubscribe();
    resizeUnsubscribe();
  });
}
```

---

## Key Benefits

1. **Declarative**: Components declare their lifecycle needs using hooks
2. **Automatic Cleanup**: Observers and trackers are automatically cleaned up
3. **Performance**: Only visible elements animate during page transitions
4. **Parallel Execution**: Page transitions use `Promise.allSettled()` for efficiency
5. **Error Handling**: Failed callbacks don't block other components
6. **Flexible**: Components can be as simple or complex as needed
7. **Centralized Subscriptions**: Efficient handling of global events

## Best Practices

### Lifecycle Hooks

- Use `onMount` for setup that needs to happen once per page
- Use `onDestroy` for cleanup to prevent memory leaks
- Keep setup and cleanup logic simple and focused

### Page Transitions

- Use `onPageIn/onPageOut` for entrance/exit animations
- Use the `element` option in `onPageOut` to only animate visible elements
- Keep animations short to maintain smooth page transitions
- Handle errors gracefully as callbacks run in parallel

### Animation Utilities

- Use `onView` for viewport-triggered animations
- Use `onTrack` for scroll-based effects
- Remember that observers are automatically cleaned up
- Start observers in `onMount` if `autoStart: false`

### Subscription System

- **Raf**: Use for smooth, continuous animations or effects
- **Resize**: Use for responsive behavior and layout updates
- **Cleanup**: Always unsubscribe in `onDestroy`
- **Performance**: Limit heavy operations in Raf callbacks
- **Priority**: Use priorities to control execution order

## Integration with Taxi.js

Taxi.js is not active in the template: it is commented out in `src/app.ts` and `src/lib/pages.ts`. To enable it:

1. In `src/lib/pages.ts`, uncomment `export const Pages = new _Pages();`.
2. In `src/app.ts`, uncomment `import { Pages } from "@lib/pages";`, delete `import type { _Pages }`, the `// Set by...` comment and `pages?: _Pages;`, and uncomment `pages = Pages;`. Left in, the old type import and field fail `pnpm check`.
3. In the Webflow markup, wrap the page in an element with `data-taxi` and put `data-taxi-view` on the content inside it that changes per page. Add `data-taxi-ignore` to links Taxi should leave alone.
4. In `checks.config.json`, set `"taxi": true`, so the browser check also follows a real link. Raise the `app.js` and `pages/*.js` budgets to `70000` as well: Taxi adds about 3.4 kB gzip, which goes over the defaults.

Once enabled, the system works with Taxi.js for page transitions:

- **Transition Class**: Handles the coordination between Taxi.js and the lifecycle system
- **Automatic Discovery**: Components are automatically found and initialized on each page
- **Smooth Transitions**: Lifecycle hooks ensure proper timing of animations and cleanup

```js
Example Component Lifecycle

start() // starts the component, including obseerrver and such
animateIn() // animates the component in /triggered by the observer or manually
stop() // stops the component, including observer and such
animateOut() // animates the component out /triggered by the observer or manually
destroy() // destroys the component, including observer and such

page transition

pageOut() {
    stop()
    animateOut() (if in view)
    destroy()
}

pageIn() {
    start()
    animateIn()
}
```
