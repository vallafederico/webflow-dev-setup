export default function (
  element: HTMLElement,
  dataset: DOMStringMap,
  extra: string
) {
  element.dataset.ready = dataset.ready + extra;
}
