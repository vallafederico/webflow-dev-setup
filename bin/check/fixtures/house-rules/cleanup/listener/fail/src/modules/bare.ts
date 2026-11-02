export default function (element: HTMLElement) {
  const onScroll = () => {
    element.dataset.scrolled = "true";
  };
  // A bare addEventListener is window.addEventListener.
  addEventListener("scroll", onScroll);
}
