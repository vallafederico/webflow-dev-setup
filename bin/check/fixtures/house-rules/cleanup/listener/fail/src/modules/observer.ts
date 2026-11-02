export default function (element: HTMLElement) {
  const observer = new MutationObserver(() => {
    element.dataset.changed = "true";
  });
  observer.observe(element, { childList: true });
}
