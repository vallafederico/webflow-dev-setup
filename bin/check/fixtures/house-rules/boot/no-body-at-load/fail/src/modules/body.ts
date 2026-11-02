const first = document.body.firstElementChild;

export default function (element: HTMLElement) {
  element.dataset.first = first?.tagName ?? "";
}
