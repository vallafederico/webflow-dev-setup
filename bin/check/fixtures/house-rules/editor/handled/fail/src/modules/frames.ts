import { onDestroy } from "@/modules/_";
import { Raf } from "@lib/subs";

export default function (element: HTMLElement) {
  const stop = Raf.add(() => {
    element.dataset.frame = "1";
  });
  onDestroy(stop);
}
