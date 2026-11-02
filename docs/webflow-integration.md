# Webflow Integration

This document outlines the Webflow editor detection and integration system, providing automatic handling of Webflow editor mode and seamless integration with the development workflow.

## Overview

The Webflow integration system provides:

- **Editor Detection**: Automatic detection of Webflow editor mode
- **Scroll Management**: Automatic scroll system management in editor vs published mode
- **Conflict Prevention**: Prevents conflicts between custom systems and Webflow editor
- **Development Workflow**: Seamless development experience in both editor and published modes

## Core Components

### Editor Detection

In a module, `onEditor` (from `@/modules/_`) detects Webflow editor state changes and releases its listener on destroy. It wraps `handleEditor` from `@webflow/detect-editor`, which is for library code only:

```typescript
import { onEditor } from "@/modules/_";

// Basic usage
onEditor((isEditor) => {
  if (isEditor) {
    console.log("Webflow editor is active");
    // Disable custom features
  } else {
    console.log("Published site mode");
    // Enable custom features
  }
});
```

### Detection Method

The system detects Webflow editor by checking for the `.w-editor-publish-node` class:

```typescript
const checkEditorState = () => {
  const firstChild = document.body.firstElementChild;
  return (
    firstChild instanceof HTMLElement &&
    firstChild.classList.contains("w-editor-publish-node")
  );
};
```

## Integration with Scroll System

### Automatic Scroll Management

The scroll system automatically integrates with Webflow editor detection:

```typescript
import { onEditor } from "@/modules/_";
import { Scroll } from "@lib/scroll";

// Automatically handle scroll system
onEditor((isEditor) => {
  if (isEditor) {
    // Disable smooth scrolling in editor
    Scroll.destroy();
  } else {
    // Enable smooth scrolling in published site
    Scroll.start();
  }
});
```

### Scroll System Configuration

The scroll system is configured to work seamlessly with Webflow:

```typescript
const SCROLL_CONFIG = {
  infinite: false, // Disable infinite scrolling for Webflow compatibility
  lerp: 0.1, // Smooth scrolling factor
  smoothWheel: true, // Smooth mouse wheel scrolling
  touchMultiplier: 2, // Touch scroll sensitivity
  // autoResize: true,   // Disabled to prevent conflicts with Webflow
};
```

## Development Workflow

### Editor Mode

When Webflow editor is detected:

1. **Scroll System**: Disabled to prevent conflicts
2. **Custom Animations**: Can be conditionally disabled
3. **Performance**: Optimized for editor performance
4. **Debugging**: Enhanced logging for development

### Published Mode

When published site is detected:

1. **Scroll System**: Fully enabled with smooth scrolling
2. **Custom Animations**: All features enabled
3. **Performance**: Optimized for production
4. **User Experience**: Full interactive experience

## Usage Patterns

### Basic Integration

```typescript
import { onEditor } from "@/modules/_";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  let isEditorMode = false;

  // Detect editor mode
  onEditor((isEditor) => {
    isEditorMode = isEditor;

    if (isEditor) {
      // Editor-specific behavior
      element.style.pointerEvents = "none";
      element.classList.add("editor-mode");
    } else {
      // Published site behavior
      element.style.pointerEvents = "auto";
      element.classList.remove("editor-mode");
    }
  });

  // Conditional functionality
  if (!isEditorMode) {
    // Only run custom animations in published mode
    const observer = onView(element, {
      callback: ({ isIn }) => {
        if (isIn) {
          element.classList.add("animated");
        }
      },
    });

    onDestroy(() => observer.destroy());
  }
}
```

### Advanced Integration

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  let isEditorMode = false;
  let scrollUnsubscribe: (() => void) | null = null;
  let observer: any = null;

  // Editor detection with full feature management
  onEditor((isEditor) => {
    isEditorMode = isEditor;

    if (isEditor) {
      // Clean up published mode features
      scrollUnsubscribe?.();
      observer?.destroy();

      // Editor mode setup
      element.classList.add("editor-mode");
      element.style.transform = "none"; // Reset any transforms
    } else {
      // Published mode setup
      element.classList.remove("editor-mode");

      // Enable scroll-based animations
      scrollUnsubscribe = Scroll.add(({ progress }) => {
        element.style.transform = `translateY(${progress * 50}px)`;
      });

      // Enable viewport animations
      observer = onView(element, {
        callback: ({ isIn }) => {
          element.classList.toggle("in-view", isIn);
        },
      });
    }
  });

  // Clean up on destroy
  onDestroy(() => {
    scrollUnsubscribe?.();
    observer?.destroy();
  });
}
```

### Component-Specific Integration

```typescript
export default function (element: HTMLElement, dataset: DOMStringMap) {
  let isEditorMode = false;
  let animations: any[] = [];

  onEditor((isEditor) => {
    isEditorMode = isEditor;

    if (isEditor) {
      // Disable all animations in editor
      animations.forEach((animation) => animation.kill());
      animations = [];

      // Show static state
      element.style.opacity = "1";
      element.style.transform = "none";
    } else {
      // Enable animations in published mode
      setupAnimations();
    }
  });

  function setupAnimations() {
    // Page entrance animation
    onPageIn(async () => {
      const animation = gsap.fromTo(
        element,
        { opacity: 0, y: 50 },
        { opacity: 1, y: 0, duration: 0.6 }
      );
      animations.push(animation);
    });

    // Scroll-based animation
    const scrollAnimation = onTrack(element, {
      bounds: [0, 1],
      callback: (value) => {
        element.style.setProperty("--scroll-progress", value.toString());
      },
    });

    onDestroy(() => {
      scrollAnimation.destroy();
    });
  }
}
```

## Best Practices

### Editor Mode Handling

1. **Disable Heavy Features**: Turn off scroll systems and complex animations
2. **Static Display**: Show elements in their final state
3. **Performance**: Optimize for editor performance
4. **Debugging**: Add helpful logging for development

### Published Mode Handling

1. **Full Features**: Enable all interactive features
2. **Smooth Animations**: Implement smooth page transitions and scroll effects
3. **Performance**: Optimize for production performance
4. **User Experience**: Provide engaging interactive experience

### Development Workflow

1. **Testing**: Test in both editor and published modes
2. **Fallbacks**: Provide graceful fallbacks for all features
3. **Performance**: Monitor performance in both modes
4. **Debugging**: Use appropriate logging for each mode

## Configuration Options

### Editor Detection Configuration

```typescript
interface EditorDetectionConfig {
  selector?: string; // Custom selector for editor detection
  callback?: (isEditor: boolean) => void; // Detection callback
  immediate?: boolean; // Call callback immediately
}
```

### Scroll System Integration

```typescript
// Automatic integration (recommended). src/lib/scroll.ts already does this,
// and it uses handleEditor because it is library code, not a module.
handleEditor((isEditor) => {
  if (isEditor) {
    Scroll.destroy();
  } else {
    Scroll.start();
  }
});

// Manual integration, inside a module
let isEditorMode = false;

onEditor((isEditor) => {
  isEditorMode = isEditor;
});

// Conditional scroll usage
if (!isEditorMode) {
  Scroll.add(callback);
}
```

## Troubleshooting

### Common Issues

1. **Editor Not Detected**: Check for `.w-editor-publish-node` class
2. **Scroll Conflicts**: Ensure scroll system is disabled in editor
3. **Performance Issues**: Disable heavy features in editor mode
4. **Animation Conflicts**: Reset animations when entering editor mode

### Debug Mode

```typescript
// Enable debug logging
onEditor((isEditor) => {
  console.log("Editor mode changed:", isEditor);

  if (isEditor) {
    console.log("Editor mode detected - disabling custom features");
  } else {
    console.log("Published mode detected - enabling custom features");
  }
});
```

### Testing

```typescript
// Test editor detection
const testEditorDetection = () => {
  const isEditor = document.body.firstElementChild?.classList.contains(
    "w-editor-publish-node"
  );
  console.log("Editor detection test:", isEditor);
  return isEditor;
};

// Test feature integration
const testFeatureIntegration = () => {
  const isEditor = testEditorDetection();

  if (isEditor) {
    console.log("Features should be disabled");
  } else {
    console.log("Features should be enabled");
  }
};
```

## API Reference

### onEditor Function (`@/modules/_`)

- `onEditor(callback)` - Calls `callback(isEditor)` now and whenever the editor state changes. Releases the listener in `onDestroy`
- Use it in modules. A module that calls `Raf.add`, `onView` or GSAP must call it (house rule `editor/handled`, see [House Rules](./house-rules.md))

### handleEditor Function (`@webflow/detect-editor`)

What `onEditor` wraps. Use it in library code such as `src/lib/scroll.ts`, not in modules.

- `handleEditor(callback?)` - Set up editor detection and add `callback` as a listener
- `releaseEditor(callback)` - Remove a listener added with `handleEditor`
- Returns: `boolean` - Current editor state

### Integration Points

- **Scroll System**: Automatic integration with `Scroll.destroy()` and `Scroll.start()`
- **Lifecycle Hooks**: Can be used with `onMount` and `onDestroy`
- **Observer System**: Can conditionally enable/disable observers
- **Track System**: Can conditionally enable/disable trackers

## Migration Guide

### From Manual Detection

```typescript
// Old manual detection
const isEditor = document.body.firstElementChild?.classList.contains(
  "w-editor-publish-node"
);

// New automatic detection
onEditor((isEditor) => {
  // Handle editor state changes
});
```

### From Conditional Features

```typescript
// Old conditional approach
if (!isEditor) {
  // Enable features
}

// New reactive approach
onEditor((isEditor) => {
  if (isEditor) {
    // Disable features
  } else {
    // Enable features
  }
});
```

## Performance Considerations

### Editor Mode Performance

1. **Minimal Features**: Disable heavy features in editor
2. **Static Rendering**: Show elements in final state
3. **Memory Management**: Clean up subscriptions and observers
4. **CPU Usage**: Minimize CPU-intensive operations

### Published Mode Performance

1. **Optimized Features**: Enable all features with performance optimization
2. **Smooth Animations**: Use efficient animation techniques
3. **Memory Management**: Proper cleanup of all resources
4. **User Experience**: Prioritize smooth user interactions

## Deployment with .js.txt Files

### Overview

When building your project, the build system automatically generates `.js.txt` copies of all JavaScript files. These `.txt` files can be uploaded to Webflow's asset panel and used as external scripts, providing a seamless deployment workflow.

### How It Works

1. **Build Process**: When you run `bun run build`, the system generates both `.js` and `.js.txt` files
2. **Asset Upload**: Upload the `.js.txt` files to Webflow's asset panel
3. **Script Linking**: Reference these files as external scripts in your Webflow project

### Step-by-Step Deployment

#### 1. Build Your Project

```bash
bun run build
```

This generates files like:

- `dist/app.js` (original)
- `dist/app.js.txt` (copy for Webflow)

#### 2. Upload to Webflow Assets

1. Go to your Webflow project's **Assets** panel
2. Click **Upload** and select your `.js.txt` files
3. Note the generated URL (e.g., `https://assets-global.webflow.com/.../app.js.txt`)

#### 3. Link as External Script

In your Webflow project settings:

1. Go to **Project Settings** → **Custom Code**
2. Add a script tag in the `<head>` section:

```html
<script src="https://assets-global.webflow.com/.../app.js.txt"></script>
```

#### 4. Alternative: Page-Specific Scripts

For page-specific scripts, you can also add them to individual pages:

1. Go to the specific page
2. Click **Page Settings** → **Custom Code**
3. Add the script tag in the `<head>` section

### Benefits

- **Version Control**: Each build creates new `.txt` files with unique URLs
- **Caching**: Webflow's CDN provides fast loading and caching
- **Debugging**: Easy to inspect the source code in browser dev tools
- **No Build Process**: No need to rebuild on Webflow's servers

### File Structure Example

After building, your `dist` folder will contain:
