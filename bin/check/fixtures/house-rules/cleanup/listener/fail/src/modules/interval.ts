export default function (element: HTMLElement) {
  let count = 0;
  setInterval(() => {
    element.dataset.count = String(count++);
  }, 1000);
}
