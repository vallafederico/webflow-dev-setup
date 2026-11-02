const modules = import.meta.glob("../*.{ts,js}", { eager: true });
// console.log("modules -> []", modules);

// Extend HTMLElement interface to include our custom property
declare global {
  // Provided at build time by bin/plugins/glob.ts
  interface ImportMeta {
    glob(pattern: string, options: { eager: true }): Record<string, unknown>;
  }

  interface HTMLElement {
    _moduleInitialized?: boolean;
  }
}

export function createCycles(dataAttribute = "module") {
  return Array.from(document.querySelectorAll(`[data-${dataAttribute}]`))
    .map((element) => {
      const htmlElement = element as HTMLElement;
      const attributeValue = htmlElement.dataset[dataAttribute];

      // Check if THIS SPECIFIC ELEMENT is already initialized
      if (htmlElement._moduleInitialized) {
        return null; // Skip this specific element
      }

      const modulePath = modules[`./../${attributeValue}.ts`]
        ? `./../${attributeValue}.ts`
        : `./../${attributeValue}.js`;

      if (modules[modulePath]) {
        // Expecting a default export function
        const moduleFn = (
          modules[modulePath] as {
            default: (el: HTMLElement, dataset: DOMStringMap) => any;
          }
        ).default;
        if (typeof moduleFn === "function") {
          try {
            // Mark THIS SPECIFIC ELEMENT as initialized
            htmlElement._moduleInitialized = true;

            return moduleFn(htmlElement, htmlElement.dataset);
          } catch (error) {
            // Remove the flag if initialization fails
            delete htmlElement._moduleInitialized;
            console.warn(
              `Failed to call default function for ${dataAttribute} "${attributeValue}":`,
              error
            );
            return null;
          }
        } else {
          console.warn(
            `Default export is not a function for ${dataAttribute} "${attributeValue}"`
          );
          return null;
        }
      } else {
        console.warn(`${dataAttribute} not found: "${attributeValue}"`);
        return null;
      }
    })
    .filter((item) => item !== null);
}

// Optional: Helper function to manually clear initialization for testing
export function clearModuleInitialization(element: HTMLElement) {
  delete element._moduleInitialized;
}
