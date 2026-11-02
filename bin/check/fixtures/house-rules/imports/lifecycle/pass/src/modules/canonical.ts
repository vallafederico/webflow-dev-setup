import { onMount } from "@/modules/_";

export default function (element: HTMLElement) {
  onMount(() => {
    element.dataset.ready = "true";
  });
}
