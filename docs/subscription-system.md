# Subscription System

This document outlines the centralized subscription system providing efficient event management for requestAnimationFrame and window resize events with priority-based ordering.

## Overview

The subscription system provides:

- **Raf Service**: RequestAnimationFrame with GSAP ticker integration
- **Resize Service**: Debounced window resize events
- **Priority System**: Priority-based subscription ordering
- **Memory Management**: Automatic cleanup and resource management
- **Performance Optimization**: Efficient event handling and debouncing

## Core Services

### Raf Service

The Raf service provides a centralized requestAnimationFrame loop using GSAP's optimized ticker:

```typescript
import { Raf } from "@lib/subs";

// Subscribe to animation frame updates
const unsubscribe = Raf.add(({ deltaTime, time }) => {
  // deltaTime: seconds since the ticker started
  // time: the last frame's length in milliseconds, times 0.01
  // (the names are swapped, see "Raf Data" below)

  // Update animations
  element.style.transform = `translateX(${Math.sin(deltaTime) * 50}px)`;
});

// Clean up subscription
unsubscribe();
```

### Resize Service

The Resize service provides debounced window resize events:

```typescript
import { Resize } from "@lib/subs";

// Subscribe to resize events
const unsubscribe = Resize.add(({ width, height }) => {
  // Handle resize
  console.log(`Window resized to: ${width}x${height}`);

  // Update responsive behavior
  if (width < 768) {
    element.classList.add("mobile");
  } else {
    element.classList.remove("mobile");
  }
});

// Clean up subscription
unsubscribe();
```

## Configuration

### Raf Configuration

The Raf service uses GSAP's ticker for optimal performance:

```typescript
class _Raf extends Subscribable {
  constructor() {
    super();
    gsap.ticker.add(this.update.bind(this));
  }

  update(deltaTime: number, time: number) {
    this.notify({ deltaTime, time: time * 0.01 });
  }
}
```

### Resize Configuration

The Resize service includes debouncing and dimension tracking:

```typescript
class _Resize extends Subscribable {
  width = window.innerWidth;
  height = window.innerHeight;
  private timeoutId: number | null = null;
  private readonly debounceDelay = 100; // 100ms debounce

  constructor() {
    super();
    window.addEventListener("resize", this.update.bind(this));
  }
}
```

## Priority System

Both Raf and Resize services support priority-based subscription ordering:

### Priority Levels

- **High Priority** (negative numbers): Execute first
- **Normal Priority** (0): Default priority
- **Low Priority** (positive numbers): Execute last

### Usage Examples

```typescript
// High priority - critical animations
Raf.add(updateCriticalAnimation, -1);

// Normal priority - standard animations
Raf.add(updateStandardAnimation, 0);

// Low priority - background effects
Raf.add(updateBackgroundEffect, 1);

// Resize priorities
Resize.add(updateCriticalLayout, -1);
Resize.add(updateStandardLayout, 0);
Resize.add(updateBackgroundLayout, 1);
```

## Advanced Usage Patterns

### Component Integration

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  // Raf subscription for smooth animations
  const rafUnsubscribe = Raf.add(({ deltaTime, time }) => {
    // Smooth rotation
    element.style.transform = `rotate(${time * 50}deg)`;

    // Frame-rate independent animation
    const currentOpacity = parseFloat(element.style.opacity) || 0;
    element.style.opacity = Math.min(
      1,
      currentOpacity + deltaTime * 2
    ).toString();
  });

  // Resize subscription for responsive behavior
  const resizeUnsubscribe = Resize.add(({ width, height }) => {
    // Responsive font sizing
    element.style.fontSize = width < 768 ? "14px" : "18px";

    // Responsive positioning
    if (width < 1024) {
      element.style.left = "10px";
    } else {
      element.style.left = "50px";
    }
  });

  // Clean up subscriptions
  onDestroy(() => {
    rafUnsubscribe();
    resizeUnsubscribe();
  });
}
```

### Performance Optimization

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  let isActive = false;
  let lastUpdate = 0;
  const updateInterval = 16; // ~60fps

  // Conditional Raf subscription
  const rafUnsubscribe = Raf.add(({ time }) => {
    // Only update when active and at appropriate intervals
    if (!isActive || time - lastUpdate < updateInterval) return;

    lastUpdate = time;

    // Perform expensive calculations
    const newPosition = calculateComplexPosition(time);
    element.style.transform = `translate(${newPosition.x}px, ${newPosition.y}px)`;
  });

  // Activate only when in view
  const observer = onView(element, {
    callback: ({ isIn }) => {
      isActive = isIn;
    },
  });

  onDestroy(() => {
    rafUnsubscribe();
  });
}
```

### Multiple Subscriptions

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  const subscriptions: (() => void)[] = [];

  // Multiple Raf subscriptions with different priorities
  subscriptions.push(
    Raf.add(updatePosition, -1), // High priority
    Raf.add(updateRotation, 0), // Normal priority
    Raf.add(updateOpacity, 1) // Low priority
  );

  // Multiple Resize subscriptions
  subscriptions.push(
    Resize.add(updateLayout, -1), // Critical layout updates
    Resize.add(updateAnimations, 0), // Animation adjustments
    Resize.add(updateBackground, 1) // Background effects
  );

  // Clean up all subscriptions
  onDestroy(() => {
    subscriptions.forEach((unsubscribe) => unsubscribe());
  });
}
```

## Data Structures

### Raf Data

```typescript
interface RafData {
  deltaTime: number; // Seconds elapsed since the GSAP ticker started
  time: number; // Last frame's length in milliseconds, times 0.01
}
```

The names are swapped relative to what they sound like. GSAP's ticker calls its listeners with `(secondsElapsed, millisecondsSinceLastFrame)`, and `_Raf.update(deltaTime, time)` in `src/lib/subs.ts` names them in that order. Check that file before relying on either value, in case it has been changed.

### Resize Data

```typescript
interface ResizeData {
  width: number; // Current window width
  height: number; // Current window height
}
```

## Best Practices

### Raf Usage

1. **Frame Rate Independence**: Use `deltaTime` for frame-rate independent animations
2. **Performance**: Keep Raf callbacks lightweight and efficient
3. **Conditional Updates**: Only update when necessary
4. **Cleanup**: Always unsubscribe to prevent memory leaks

### Resize Usage

1. **Debouncing**: The service automatically debounces, but avoid heavy operations
2. **Responsive Design**: Use resize events for responsive behavior
3. **Layout Updates**: Prioritize critical layout updates
4. **Performance**: Limit DOM queries and heavy calculations

### General Guidelines

1. **Priority Management**: Use priorities to ensure critical updates run first
2. **Memory Management**: Always clean up subscriptions in `onDestroy`
3. **Error Handling**: Handle errors gracefully in subscription callbacks
4. **Testing**: Test performance with multiple subscriptions

## Performance Considerations

### Raf Performance

```typescript
// Good - Lightweight operations
Raf.add(({ time }) => {
  element.style.transform = `translateX(${time * 10}px)`;
});

// Bad - Heavy operations every frame
Raf.add(({ time }) => {
  // Expensive DOM queries
  const allElements = document.querySelectorAll(".heavy");
  allElements.forEach((el) => {
    // Complex calculations
    const rect = el.getBoundingClientRect();
    const distance = calculateDistance(rect, time);
    el.style.transform = `translate(${distance.x}px, ${distance.y}px)`;
  });
});
```

### Resize Performance

```typescript
// Good - Efficient responsive updates
Resize.add(({ width }) => {
  element.classList.toggle("mobile", width < 768);
  element.style.fontSize = width < 768 ? "14px" : "18px";
});

// Bad - Heavy operations on every resize
Resize.add(({ width, height }) => {
  // Expensive recalculations
  const allElements = document.querySelectorAll(".recalculate");
  allElements.forEach((el) => {
    const newLayout = calculateComplexLayout(el, width, height);
    applyComplexLayout(el, newLayout);
  });
});
```

## Troubleshooting

### Common Issues

1. **Memory Leaks**: Ensure all subscriptions are cleaned up
2. **Performance Issues**: Reduce number of subscriptions or optimize callbacks
3. **Priority Conflicts**: Use appropriate priorities for different update types
4. **Debounce Issues**: Resize is automatically debounced, but check for conflicts

### Debug Mode

```typescript
// Debug Raf subscriptions
Raf.add((data) => {
  console.log("Raf Debug:", data);
}, -999); // Very high priority

// Debug Resize subscriptions
Resize.add((data) => {
  console.log("Resize Debug:", data);
}, -999); // Very high priority
```

## API Reference

### Raf Service

- `Raf.add(fn, priority?, id?)` - Subscribe to animation frame updates
- `Raf.remove(id)` - Remove specific subscription
- `Raf.notify(data)` - Manually trigger notifications (internal use)

### Resize Service

- `Resize.add(fn, priority?, id?)` - Subscribe to resize events
- `Resize.remove(id)` - Remove specific subscription
- `Resize.width` - Current window width
- `Resize.height` - Current window height
- `Resize.notify(data)` - Manually trigger notifications (internal use)

### Base Subscribable Class

- `add(fn, priority?, id?)` - Add subscriber with priority
- `remove(id)` - Remove subscriber by ID
- `notify(data)` - Notify all subscribers with data

### Return Values

All `add` methods return an unsubscribe function:

```typescript
const unsubscribe = Raf.add(callback);
// ... later ...
unsubscribe(); // Clean up subscription
```

## Integration Examples

### With Lifecycle Hooks

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  let rafUnsubscribe: (() => void) | null = null;
  let resizeUnsubscribe: (() => void) | null = null;

  onMount(() => {
    // Start subscriptions when component mounts
    rafUnsubscribe = Raf.add(updateAnimation);
    resizeUnsubscribe = Resize.add(updateResponsive);
  });

  onDestroy(() => {
    // Clean up subscriptions when component destroys
    rafUnsubscribe?.();
    resizeUnsubscribe?.();
  });
}
```

### With Observer System

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  let isActive = false;

  // Only animate when in view
  const observer = onView(element, {
    callback: ({ isIn }) => {
      isActive = isIn;
    },
  });

  // Conditional animation
  const rafUnsubscribe = Raf.add(({ time }) => {
    if (!isActive) return;

    element.style.transform = `translateY(${Math.sin(time) * 10}px)`;
  });

  onDestroy(() => {
    rafUnsubscribe();
  });
}
```
