import { onMount } from "@/modules/_";

export default function (element: HTMLElement) {
  onMount(() => {
    element.dataset.first = document.body.firstElementChild?.tagName ?? "";
  });
}

// Testing for the body is safe, it is reading through it that throws.
export const ready = !!document.body && document.body?.isConnected;
