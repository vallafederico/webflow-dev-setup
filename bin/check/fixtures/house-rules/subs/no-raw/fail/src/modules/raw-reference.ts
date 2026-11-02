export default function (element: HTMLElement) {
  const raf = window.requestAnimationFrame;
  raf(() => {
    element.dataset.frame = "1";
  });
  self["requestAnimationFrame"](() => {});
  window.onresize = () => {
    element.dataset.resized = "true";
  };
}
