export default function (element: HTMLElement) {
  element.addEventListener("click", () => {
    element.dataset.clicked = "true";
  });
}
