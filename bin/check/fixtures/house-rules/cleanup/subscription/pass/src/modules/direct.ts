import { onDestroy } from "@/modules/_";
import { Resize } from "@lib/subs";

export default function (element: HTMLElement) {
  onDestroy(
    Resize.add(({ width }) => {
      element.dataset.width = String(width);
    })
  );
}
