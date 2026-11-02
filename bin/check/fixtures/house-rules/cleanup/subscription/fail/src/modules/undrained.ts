import { onDestroy, onEditor } from "@/modules/_";
import { Raf } from "@lib/subs";

export default function (element: HTMLElement) {
  onEditor(() => {});

  const subscriptions: Array<() => void> = [];
  subscriptions.push(Raf.add(() => {}));

  onDestroy(() => {
    // Looks like cleanup, but never calls the entries.
    subscriptions.forEach((entry) => entry.toString());
    element.dataset.done = "true";
  });
}
