import { onDestroy, onEditor } from "@/modules/_";
import { Scroll } from "@lib/scroll";
import { Raf, Resize as Sizes } from "@lib/subs";

export default function (element: HTMLElement) {
  onEditor(() => {});

  const stopFrame = Raf.add(() => {
    element.dataset.frame = "1";
  });
  const stopSizes = Sizes.add(({ width }) => {
    element.dataset.width = String(width);
  });
  const stopScroll = Scroll.add(() => {});

  // A helper that onDestroy calls counts as cleanup.
  const cleanup = () => {
    stopSizes();
    stopScroll?.();
  };

  onDestroy(stopFrame);
  onDestroy(() => cleanup());
}
