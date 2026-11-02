# Scroll System

This document outlines the enhanced scroll system built on top of Lenis, providing smooth scrolling with advanced subscription capabilities and Webflow editor integration.

## Overview

The scroll system provides:

- Smooth scrolling using Lenis
- Priority-based subscription system for scroll events
- Automatic Webflow editor detection and handling
- Scroll position management during page transitions
- Configurable scroll behavior

## Core Components

### Scroll Instance

The main scroll instance is available at `@lib/scroll`:

```typescript
import { Scroll } from "@lib/scroll";

// Access scroll instance
Scroll.scroll; // Current scroll position
Scroll.limit; // Total scrollable height
Scroll.progress; // Scroll progress (0-1)
Scroll.velocity; // Current scroll velocity
```

### Configuration

The scroll system uses the following configuration:

```typescript
const SCROLL_CONFIG = {
  infinite: false, // Enable infinite scrolling
  lerp: 0.1, // Linear interpolation factor (smoothness)
  smoothWheel: true, // Smooth mouse wheel scrolling
  touchMultiplier: 2, // Touch scroll sensitivity multiplier
  // autoResize: true,   // Auto-resize on window resize
};
```

## Subscription System

### Basic Subscription

Subscribe to scroll events with priority-based ordering:

```typescript
import { Scroll } from "@lib/scroll";

// Subscribe to scroll events
const unsubscribe = Scroll.add((data) => {
  const { scroll, limit, progress, velocity, time } = data;

  // Handle scroll data
  console.log(`Scroll: ${scroll}/${limit} (${(progress * 100).toFixed(1)}%)`);
  console.log(`Velocity: ${velocity.toFixed(2)}`);
});

// Clean up subscription
unsubscribe();
```

### Priority-Based Subscriptions

Use priorities to control execution order (lower numbers = higher priority):

```typescript
// High priority (runs first)
Scroll.add(updateCriticalElements, -1);

// Normal priority (default = 0)
Scroll.add(updateBackgroundElements, 0);

// Low priority (runs last)
Scroll.add(updateNonCriticalElements, 1);
```

### Advanced Usage

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  // Subscribe to scroll for parallax effect
  const scrollUnsubscribe = Scroll.add(({ progress, velocity }) => {
    // Parallax effect
    element.style.transform = `translateY(${progress * 100}px)`;

    // Velocity-based effects
    if (Math.abs(velocity) > 0.5) {
      element.classList.add("scrolling-fast");
    } else {
      element.classList.remove("scrolling-fast");
    }
  });

  // Clean up on destroy
  onDestroy(() => {
    scrollUnsubscribe();
  });
}
```

## Webflow Editor Integration

The scroll system automatically detects and handles Webflow editor mode. This is in `src/lib/scroll.ts`, which uses `handleEditor` because it is library code. Modules use `onEditor` from `@/modules/_` instead:

```typescript
import { handleEditor } from "@webflow/detect-editor";

// Automatically handles editor detection
handleEditor((isEditor) => {
  if (isEditor) {
    // Disable smooth scrolling in editor
    Scroll.destroy();
  } else {
    // Enable smooth scrolling in published site
    Scroll.start();
  }
});
```

### Editor Detection

The system detects Webflow editor by checking for the `.w-editor-publish-node` class:

```typescript
const checkEditorState = () => {
  const firstChild = document.body?.firstElementChild;
  return (
    firstChild instanceof HTMLElement &&
    firstChild.classList.contains("w-editor-publish-node")
  );
};
```

## Scroll Management

### Manual Control

```typescript
// Scroll to top immediately
Scroll.toTop();

// Scroll to specific position
Scroll.scrollTo(1000, {
  immediate: true, // Instant scroll
  // duration: 1,  // Smooth scroll duration
});

// Get scroll data
const scrollData = {
  position: Scroll.scroll,
  limit: Scroll.limit,
  progress: Scroll.progress,
  velocity: Scroll.velocity,
};
```

### Page Transition Integration

The scroll system integrates with page transitions:

```typescript
// In page transition out
async transitionOut() {
  // Reset scroll position for new page
  Scroll.toTop();
}

// In page transition in
async transitionIn() {
  // Update scroll calculations for new content
  Scroll.resize();
}
```

## Performance Considerations

### Subscription Management

- **Limit Subscriptions**: Only subscribe when needed
- **Clean Up**: Always unsubscribe in `onDestroy`
- **Use Priorities**: Use priorities to optimize performance
- **Debounce Heavy Operations**: Avoid heavy computations in scroll callbacks

### Memory Management

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  let isActive = false;

  const scrollUnsubscribe = Scroll.add(({ progress }) => {
    // Only update when element is in view
    if (!isActive) return;

    // Lightweight operations only
    element.style.setProperty("--scroll-progress", progress.toString());
  });

  // Activate only when in view
  const observer = onView(element, {
    callback: ({ isIn }) => {
      isActive = isIn;
    },
  });

  onDestroy(() => {
    scrollUnsubscribe();
  });
}
```

## Integration with Track System

The scroll system works seamlessly with the Track system:

```typescript
import { onTrack } from "@/modules/_";

const track = onTrack(element, {
  bounds: [0, 1],
  top: "bottom",
  bottom: "top",
  callback: (value) => {
    // value is automatically calculated based on scroll position
    element.style.transform = `translateY(${value * 100}px)`;
  },
});
```

## Best Practices

### Subscription Patterns

1. **Component-Based**: Subscribe in component initialization, unsubscribe in cleanup
2. **Priority Management**: Use priorities for critical vs non-critical updates
3. **Conditional Updates**: Only update when necessary (e.g., element in view)
4. **Lightweight Operations**: Keep scroll callbacks fast and efficient

### Webflow Integration

1. **Editor Detection**: In modules, use `onEditor` for Webflow projects
2. **Fallback Handling**: Ensure graceful degradation when scroll is disabled
3. **Testing**: Test both editor and published modes

### Performance Optimization

1. **Throttling**: Use throttling for heavy scroll operations
2. **RAF Integration**: Use GSAP ticker for smooth animations
3. **Memory Cleanup**: Always clean up subscriptions and observers
4. **Efficient Updates**: Use CSS transforms instead of layout-triggering properties

## Troubleshooting

### Common Issues

1. **Scroll Not Working**: Check if Webflow editor is active
2. **Performance Issues**: Reduce number of scroll subscriptions
3. **Memory Leaks**: Ensure all subscriptions are cleaned up
4. **Conflicts**: Check for conflicts with other scroll libraries

### Debug Mode

```typescript
// Enable debug logging
Scroll.add((data) => {
  console.log("Scroll Debug:", data);
}, -999); // Very high priority
```

## API Reference

### Scroll Instance Methods

- `Scroll.add(fn, priority?, id?)` - Subscribe to scroll events
- `Scroll.remove(id)` - Remove specific subscription
- `Scroll.toTop()` - Scroll to top immediately
- `Scroll.scrollTo(target, options?)` - Scroll to specific position
- `Scroll.resize()` - Recalculate scroll bounds
- `Scroll.start()` - Start smooth scrolling
- `Scroll.destroy()` - Destroy scroll instance

### Scroll Data Properties

- `scroll` - Current scroll position
- `limit` - Total scrollable height
- `progress` - Scroll progress (0-1)
- `velocity` - Current scroll velocity
- `time` - Timestamp of scroll event
