export default function (element: HTMLElement) {
  const tick = () => {
    element.dataset.frame = "1";
    requestAnimationFrame(tick);
  };
  tick();
}
