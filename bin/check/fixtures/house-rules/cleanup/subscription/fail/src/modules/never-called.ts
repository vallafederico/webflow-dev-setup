import { onDestroy } from "@/modules/_";
import { Resize as Sizes } from "@lib/subs";

export default function (element: HTMLElement) {
  const stop = Sizes.add(({ width }) => {
    element.dataset.width = String(width);
  });

  onDestroy(() => {
    element.dataset.width = "";
  });
}
