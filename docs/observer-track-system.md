# Observer & Track System

This document outlines the enhanced observer and track systems, providing advanced viewport detection and scroll tracking capabilities with efficient memory management.

> Examples omit `onEditor`; `editor/handled` requires it for modules using `Raf.add`, `onView` or GSAP. See [House Rules](./house-rules.md).

## Overview

The system provides:

- **Observer System**: Advanced Intersection Observer with grouping and management
- **Track System**: Scroll-based tracking with precise bounds calculation
- **Memory Management**: Efficient observer grouping and automatic cleanup
- **Direction Detection**: Enhanced scroll direction detection for animations
- **Performance Optimization**: Optimized observer management and subscription handling

## Observer System

### Core Components

#### ObserverManager

A singleton that manages all Intersection Observers efficiently:

```typescript
import { ObserverManager } from "@/modules/_/observe";

// Get singleton instance
const manager = ObserverManager.getInstance();
```

#### Observe Class

The main observer class for viewport detection:

```typescript
import { Observe } from "@/modules/_/observe";

const observer = new Observe(element, {
  root: null, // Root element (null = viewport)
  rootMargin: "0px", // Margin around root
  threshold: 0, // Visibility threshold
  autoStart: false, // Start automatically
  once: false, // Trigger only once
  callback: (data) => {
    // Custom callback
    console.log("Observer event:", data);
  },
});
```

### Configuration Options

```typescript
interface ObserveConfig {
  root?: HTMLElement | null; // Root element for intersection
  rootMargin?: string; // Margin around root (CSS-like)
  threshold?: number; // Visibility threshold (0-1)
  autoStart?: boolean; // Start observer automatically
  once?: boolean; // Trigger only once
  callback?: (data: ObserveEventData) => void; // Custom callback
}

interface ObserveEventData {
  entry: IntersectionObserverEntry; // Native intersection entry
  direction: number; // Scroll direction (-1 = up, 1 = down)
  isIn: boolean; // Whether element is in view
}
```

### Basic Usage

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  const observer = new Observe(element, {
    threshold: 0.1, // Trigger when 10% visible
    rootMargin: "50px", // 50px margin around viewport
    autoStart: true, // Start immediately
    callback: ({ isIn, direction }) => {
      if (isIn) {
        element.classList.add("in-view");
        console.log("Element entered viewport");
      } else {
        element.classList.remove("in-view");
        console.log("Element left viewport");
      }
    },
  });

  // Manual control
  observer.start();
  observer.stop();
  observer.destroy();

  // Auto-cleanup with lifecycle hooks
  onDestroy(() => {
    observer.destroy();
  });
}
```

### Advanced Observer Patterns

#### Direction-Based Animations

```typescript
const observer = new Observe(element, {
  threshold: 0.1,
  callback: ({ isIn, direction }) => {
    if (isIn) {
      // Animate in based on direction
      if (direction > 0) {
        // Scrolling down - animate from bottom
        gsap.fromTo(
          element,
          { y: 50, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6 }
        );
      } else {
        // Scrolling up - animate from top
        gsap.fromTo(
          element,
          { y: -50, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.6 }
        );
      }
    }
  },
});
```

#### Staggered Animations

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  const children = Array.from(element.children) as HTMLElement[];

  children.forEach((child, index) => {
    const childObserver = new Observe(child, {
      threshold: 0.1,
      callback: ({ isIn }) => {
        if (isIn) {
          gsap.to(child, {
            opacity: 1,
            y: 0,
            duration: 0.5,
            delay: index * 0.1, // Stagger effect
            ease: "power2.out",
          });
        }
      },
    });

    onDestroy(() => childObserver.destroy());
  });
}
```

## Track System

### Overview

The Track system extends the Observer system to provide scroll-based tracking with precise bounds calculation:

```typescript
import { Track } from "@/modules/_/track";

const track = new Track(element, {
  bounds: [0, 1], // Output range
  top: "bottom", // When to start tracking
  bottom: "top", // When to stop tracking
  callback: (value) => {
    // Progress callback
    console.log("Track progress:", value);
  },
});
```

### Configuration Options

```typescript
interface TrackConfig {
  bounds: [number, number]; // Output range [min, max]. Output is clamped to 0-1, so use [0, 1] and scale in the callback
  top: "top" | "center" | "bottom"; // Start trigger point
  bottom: "top" | "center" | "bottom"; // End trigger point
  callback?: (value: number) => void; // Progress callback
}
```

### Trigger Points

`top` and `bottom` each take a position in the viewport:

- **`top`** is where the element's top edge must be for tracking to start (value 0).
- **`bottom`** is where the element's bottom edge must be for tracking to end (value 1).
- Each can be `"top"`, `"center"` or `"bottom"` of the viewport. The default, `top: "bottom"` and `bottom: "top"`, tracks from the element entering at the bottom to it leaving at the top.

### Basic Usage

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  const track = new Track(element, {
    bounds: [0, 1], // Output 0-1
    top: "bottom", // Start when the element's top reaches the viewport bottom
    bottom: "top", // End when the element's bottom reaches the viewport top
    callback: (value) => {
      // value goes from 0 to 1 as element scrolls through viewport
      element.style.setProperty("--scroll-progress", value.toString());
    },
  });

  // Auto-cleanup
  onDestroy(() => {
    track.destroy();
  });
}
```

### Advanced Track Patterns

#### Parallax Effects

```typescript
const track = new Track(element, {
  bounds: [0, 1], // Output is clamped to 0-1, so scale it in the callback
  top: "bottom",
  bottom: "top",
  callback: (value) => {
    // Parallax effect
    element.style.transform = `translateY(${value * 200}px)`;
  },
});
```

#### Rotation Effects

```typescript
const track = new Track(element, {
  bounds: [0, 1], // Output is clamped to 0-1, so scale it in the callback
  top: "center",
  bottom: "center",
  callback: (value) => {
    element.style.transform = `rotate(${value * 360}deg)`;
  },
});
```

#### Scale Effects

```typescript
const track = new Track(element, {
  bounds: [0.5, 1], // Scale from 50% to 100%
  top: "bottom",
  bottom: "top",
  callback: (value) => {
    element.style.transform = `scale(${value})`;
  },
});
```

#### Complex Animations

```typescript
const track = new Track(element, {
  bounds: [0, 1],
  top: "bottom",
  bottom: "top",
  callback: (value) => {
    // Multiple properties
    element.style.transform = `
      translateY(${value * 100}px)
      rotate(${value * 180}deg)
      scale(${0.5 + value * 0.5})
    `;

    // Opacity
    element.style.opacity = value.toString();

    // CSS custom properties
    element.style.setProperty("--progress", value.toString());
  },
});
```

### Bounds Calculation

The track system automatically calculates bounds based on:

1. **Element Position**: Current element position in viewport
2. **Trigger Points**: Start and end trigger points
3. **Viewport Size**: Current viewport dimensions
4. **Scroll Position**: Current scroll position

```typescript
// Manual bounds calculation (for reference)
function computeBounds(el: HTMLElement, config: TrackConfig) {
  const bounds = clientRect(el);
  const { top: topPos, bottom: bottomPos, wh } = bounds;
  const centerOffset = wh / 2;

  bounds.top =
    topPos -
    (config.top === "center" ? centerOffset : config.top === "bottom" ? wh : 0);

  bounds.bottom =
    bottomPos -
    (config.bottom === "center"
      ? centerOffset
      : config.bottom === "bottom"
      ? wh
      : 0);

  return bounds;
}
```

## Lifecycle Integration

### Using with Lifecycle Hooks

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  let observer: Observe;
  let track: Track;

  onMount(() => {
    // Initialize observers
    observer = new Observe(element, {
      threshold: 0.1,
      callback: ({ isIn }) => {
        element.classList.toggle("in-view", isIn);
      },
    });

    track = new Track(element, {
      bounds: [0, 1],
      callback: (value) => {
        element.style.setProperty("--progress", value.toString());
      },
    });
  });

  onDestroy(() => {
    // Clean up observers
    observer?.destroy();
    track?.destroy();
  });
}
```

### Using Convenience Functions

```typescript
import { onView, onTrack } from "@/modules/_";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  // Auto-cleanup observers
  const observer = onView(element, {
    threshold: 0.1,
    autoStart: true,
    callback: ({ isIn }) => {
      element.classList.toggle("in-view", isIn);
    },
  });

  const track = onTrack(element, {
    bounds: [0, 1],
    callback: (value) => {
      element.style.setProperty("--progress", value.toString());
    },
  });

  // No manual cleanup needed - handled automatically
}
```

## Performance Optimization

### Observer Grouping

The ObserverManager automatically groups observers with the same configuration:

```typescript
// These observers share the same IntersectionObserver instance
const observer1 = new Observe(element1, { threshold: 0.1 });
const observer2 = new Observe(element2, { threshold: 0.1 });
const observer3 = new Observe(element3, { threshold: 0.1 });

// This observer uses a separate instance (different config)
const observer4 = new Observe(element4, { threshold: 0.5 });
```

### Memory Management

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  const observers: Observe[] = [];

  // Create multiple observers
  element.querySelectorAll(".animate").forEach((child) => {
    const observer = new Observe(child as HTMLElement, {
      threshold: 0.1,
      callback: ({ isIn }) => {
        if (isIn) {
          child.classList.add("animated");
        }
      },
    });
    observers.push(observer);
  });

  // Clean up all observers
  onDestroy(() => {
    observers.forEach((observer) => observer.destroy());
  });
}
```

### Conditional Tracking

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  let track: Track | null = null;
  let isActive = false;

  // Only track when element is in view
  const observer = new Observe(element, {
    threshold: 0.1,
    callback: ({ isIn }) => {
      if (isIn && !isActive) {
        // Start tracking
        track = new Track(element, {
          bounds: [0, 1],
          callback: (value) => {
            element.style.setProperty("--progress", value.toString());
          },
        });
        isActive = true;
      } else if (!isIn && isActive) {
        // Stop tracking
        track?.destroy();
        track = null;
        isActive = false;
      }
    },
  });

  onDestroy(() => {
    observer.destroy();
    track?.destroy();
  });
}
```

## Best Practices

### Observer Usage

1. **Threshold Selection**: Use appropriate thresholds for your use case
2. **Root Margin**: Use rootMargin for early triggering
3. **Direction Detection**: Use direction for scroll-based animations
4. **Auto Cleanup**: Always clean up observers in `onDestroy`

### Track Usage

1. **Bounds Planning**: Plan your bounds carefully for smooth animations
2. **Trigger Points**: Choose appropriate trigger points for your effect
3. **Performance**: Keep track callbacks lightweight
4. **Responsive**: Consider viewport changes in your calculations

### Memory Management

1. **Observer Grouping**: Let the system group observers automatically
2. **Cleanup**: Always destroy observers and tracks
3. **Conditional Creation**: Only create observers when needed
4. **Lifecycle Integration**: Use lifecycle hooks for automatic cleanup

## API Reference

### Observe Class

- `new Observe(element, config)` - Create new observer
- `observer.start()` - Start observing
- `observer.stop()` - Stop observing
- `observer.destroy()` - Destroy observer and cleanup

### Track Class

- `new Track(element, config)` - Create new track
- `track.value` - Current track value
- `track.bounds` - Current bounds
- `track.destroy()` - Destroy track and cleanup

### ObserverManager

- `ObserverManager.getInstance()` - Get singleton instance
- `manager.addElement(element, config, callbacks)` - Add element to observer
- `manager.removeElement(element)` - Remove element from observer

### Convenience Functions

- `onView(element, config)` - Create auto-cleanup observer. Like `Observe`, it only starts with `autoStart: true` or a call to `observer.start()`
- `onTrack(element, config)` - Create auto-cleanup track
