import { onDestroy } from "@/modules/_";

export default function (element: HTMLElement) {
  const handler = () => {};
  element.addEventListener("click", handler);

  onDestroy(() => {
    // Same handler, but a different event, so the click listener stays.
    element.removeEventListener("mouseenter", handler);
  });
}
