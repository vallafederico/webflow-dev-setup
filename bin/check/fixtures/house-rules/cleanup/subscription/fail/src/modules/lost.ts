import { onEditor } from "@/modules/_";
import { Raf } from "@lib/subs";

export default function (element: HTMLElement) {
  onEditor(() => {});

  Raf.add(() => {
    element.dataset.frame = "1";
  });
}
