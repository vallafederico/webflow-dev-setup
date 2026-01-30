---
name: webflow-editor-integration
description: Handle Webflow Designer/Editor mode vs Published site behavior. Use when detecting the editor, disabling custom animations in the designer, or managing features based on the environment.
---

# Webflow Editor Integration

This skill explains how to ensure your custom code doesn't interfere with the Webflow Designer/Editor while providing full functionality on the published site.

## Editor Detection

Import `handleEditor` from `@webflow/detect-editor`:

```typescript
import { handleEditor } from "@webflow/detect-editor";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  let isEditorMode = false;

  handleEditor((isEditor) => {
    isEditorMode = isEditor;

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
      setupPublishedFeatures();
    }
  });
  
  function setupPublishedFeatures() {
    // Initialize animations, observers, etc.
  }
}
```

## Best Practices

- **Disable Interactivity**: Always set `pointerEvents = "none"` in the editor if your component has a fixed position or covers large areas.
- **Reset State**: The editor should show the static, CSS-defined state of your component. Reset any JS-applied styles (`transform`, `opacity`, etc.) when `isEditor` is true.
- **Kill Animations**: If you use GSAP or other animation libraries, ensure they are killed or not started when in editor mode.
- **Conditional Lifecycle**: Use the `isEditorMode` flag inside `onMount`, `onPageIn`, and other hooks to skip logic that isn't needed in the Designer.

## Example: Conditional Viewport Detection

```typescript
handleEditor((isEditor) => {
  if (!isEditor) {
    onView(element, {
      callback: ({ isIn }) => {
        element.classList.toggle("animate-in", isIn);
      }
    });
  }
});
```
