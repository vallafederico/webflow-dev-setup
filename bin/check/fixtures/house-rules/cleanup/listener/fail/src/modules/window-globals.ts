export default function (element: HTMLElement) {
  self.setInterval(() => {
    element.dataset.tick = "1";
  }, 1000);
  new window.IntersectionObserver(() => {});
  new globalThis["ResizeObserver"](() => {});
}
