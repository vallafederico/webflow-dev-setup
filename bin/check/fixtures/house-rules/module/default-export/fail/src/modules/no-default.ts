import { onMount } from "@/modules/_";

// Named export only, so createCycles can't find the module function.
export function setup(element: HTMLElement) {
  onMount(() => {
    element.dataset.ready = "true";
  });
}
