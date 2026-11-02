export default function (element: HTMLElement) {
  // { once: true } does not remove it if the event never fires.
  element.addEventListener("click", () => {}, { once: true });
}
