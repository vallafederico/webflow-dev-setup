---
name: webflow-editor-integration
description: Handle Webflow Designer/Editor mode vs Published site behavior. Use when detecting the editor, disabling custom animations in the designer, or managing features based on the environment.
---

# Webflow Editor Integration

Ensures custom code behaves correctly in the Webflow Designer.

## Pattern
```typescript
import { handleEditor } from "@webflow/detect-editor";

export default function(element: HTMLElement) {
  handleEditor((isEditor) => {
    if (isEditor) {
      // Disable JS interactivity, reset styles
      element.style.pointerEvents = "none";
    } else {
      // Enable full functionality
    }
  });
}
```
