import { onDestroy } from "@/modules/_";

export default function (element: HTMLElement) {
  const onClick = () => {
    element.dataset.clicked = "true";
  };
  element.addEventListener("click", onClick);

  // Removes itself after the first call.
  window.addEventListener("load", () => {}, { once: true });

  let count = 0;
  const interval = setInterval(() => {
    element.dataset.count = String(count++);
  }, 1000);

  const observer = new IntersectionObserver(() => {});
  observer.observe(element);

  const controller = new AbortController();
  element.addEventListener("focus", () => {}, { signal: controller.signal });

  onDestroy(() => {
    element.removeEventListener("click", onClick);
    clearInterval(interval);
    observer.disconnect();
    controller.abort();
  });
}
