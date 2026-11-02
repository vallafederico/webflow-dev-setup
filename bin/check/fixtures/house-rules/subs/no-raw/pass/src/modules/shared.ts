import { onDestroy, onEditor } from "@/modules/_";
import { Raf, Resize } from "@lib/subs";

export default function (element: HTMLElement) {
  const stopFrame = Raf.add(() => {
    element.dataset.frame = "1";
  });
  const stopResize = Resize.add(({ width }) => {
    element.dataset.width = String(width);
  });

  onEditor((isEditor) => {
    element.dataset.editor = String(isEditor);
  });

  onDestroy(() => {
    stopFrame();
    stopResize();
  });
}
