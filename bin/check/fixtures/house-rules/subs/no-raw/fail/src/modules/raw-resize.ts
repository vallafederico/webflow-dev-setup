import { onDestroy } from "@/modules/_";

export default function (element: HTMLElement) {
  const onResize = () => {
    element.dataset.width = String(window.innerWidth);
  };
  window.addEventListener("resize", onResize);

  onDestroy(() => {
    window.removeEventListener("resize", onResize);
  });
}
