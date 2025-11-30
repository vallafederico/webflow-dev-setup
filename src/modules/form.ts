import { onMount } from "@/modules/_";
import { resetWebflow } from "@/webflow/reset-webflow";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  console.log("form", element);

  onMount(() => {
    setTimeout(() => {
      resetWebflow();
    }, 500);
  });
}
