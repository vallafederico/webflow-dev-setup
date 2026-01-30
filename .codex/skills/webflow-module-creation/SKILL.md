---
name: webflow-module-creation
description: Create and register custom JavaScript modules for Webflow projects. Use when creating new functionality, adding data-module attributes, or structuring component logic.
---

# Webflow Module Creation

Standard for creating modules in the Webflow development setup.

## Workflow

1. Create a file in `src/modules/` (e.g., `my-feature.ts`).
2. Export a default function:
   ```typescript
   import { onMount, onDestroy } from "@/modules/_";

   export default function(element: HTMLElement, dataset: DOMStringMap) {
     onMount(() => { /* init */ });
     onDestroy(() => { /* cleanup */ });
   }
   ```
3. Add `data-module="my-feature"` to the element in Webflow.
