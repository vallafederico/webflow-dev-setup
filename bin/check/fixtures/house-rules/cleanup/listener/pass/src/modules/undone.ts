import { onDestroy } from "@/modules/_";

export default function (element: HTMLElement) {
  const onClick = () => {
    element.dataset.clicked = "true";
  };
  element.addEventListener("click", onClick);

  // A bare call is on window, and so is self.
  const onLoad = () => {};
  addEventListener("load", onLoad);
  const onScroll = () => {};
  window.addEventListener("scroll", onScroll);

  let count = 0;
  const interval = window.setInterval(() => {
    element.dataset.count = String(count++);
  }, 1000);

  const observer = new IntersectionObserver(() => {});
  observer.observe(element);

  // Entries kept in a list are all released by the loop in onDestroy.
  const observers: MutationObserver[] = [];
  observers.push(new MutationObserver(() => {}));

  onDestroy(() => {
    element.removeEventListener("click", onClick);
    removeEventListener("load", onLoad);
    self.removeEventListener("scroll", onScroll);
    clearInterval(interval);
    observer.disconnect();
    observers.forEach((entry) => entry.disconnect());
  });
}
