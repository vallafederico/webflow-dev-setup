import { onMount } from "./_";

export default function (element: HTMLElement) {
  onMount(() => {
    element.dataset.ready = "true";
  });
}
