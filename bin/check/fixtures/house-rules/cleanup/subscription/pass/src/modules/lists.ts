import { onDestroy, onEditor } from "@/modules/_";
import { Raf, Resize } from "@lib/subs";

export default function (element: HTMLElement) {
  onEditor(() => {});

  const update = () => {
    element.dataset.frame = "1";
  };

  const literal = [Raf.add(update), Raf.add(update)];

  const pushed: Array<() => void> = [];
  pushed.push(Resize.add(update), Resize.add(update));

  const looped: Array<() => void> = [];
  looped.push(Raf.add(update));

  onDestroy(() => {
    literal.forEach((unsubscribe) => unsubscribe());
    pushed.forEach((stop) => stop());
    for (const release of looped) release();
  });
}
