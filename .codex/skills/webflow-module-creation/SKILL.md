---
name: webflow-module-creation
description: Create and register custom JavaScript modules for Webflow projects. Use when creating new functionality, adding data-module attributes, or structuring component logic.
---

# Webflow Module Creation

This skill guides you through creating and registering custom modules that are automatically mounted based on DOM attributes.

## Core Principles

- **File Location**: All modules must be created in `src/modules/`.
- **Naming**: The filename (e.g., `test.ts`) must exactly match the `data-module` attribute value (e.g., `data-module="test"`). Use kebab-case and a name that says what the module does, not `module` or `index`.
- **Structure**: Every module must have a default export function.

## Module Template

`pnpm new:module <name>` writes a module like this one, which already passes every rule:

```typescript
import { onMount, onDestroy } from "@/modules/_";

/**
 * @param element The DOM element with the data-module attribute
 * @param dataset The data attributes of the element
 */
export default function (element: HTMLElement, dataset: DOMStringMap) {
  // Setup logic here

  onMount(() => {
    // Initialization code
  });

  onDestroy(() => {
    // Cleanup code
  });
}
```

## Step-by-Step Creation

1. **Create the File**: Run `pnpm new:module my-component`, or add a new `.ts` file in `src/modules/` (e.g., `src/modules/my-component.ts`).
2. **Implement the Function**: Export a default function with the signature `(element: HTMLElement, dataset: DOMStringMap) => void`. Fewer parameters are fine.
3. **Register in HTML**: Add the `data-module="my-component"` attribute to the target element in Webflow/HTML.
4. **Access Data**: Use the `dataset` parameter to access `data-` attributes passed from the DOM.
5. **Check**: Run `pnpm check`. A module that uses `Raf.add`, `onView` or GSAP must also call `onEditor` (see the [editor skill](../webflow-editor-integration/SKILL.md)), and everything it subscribes to must be undone in `onDestroy`.

## Best Practices

- Keep modules focused on a single responsibility.
- Use descriptive names that match the component's purpose.
- Ensure the filename is lowercase and uses hyphens if needed (e.g., `image-gallery.ts`).
- The module rules (`module/default-export`, `module/signature`, `module/filename`) are in [House Rules](../../../docs/house-rules.md).
