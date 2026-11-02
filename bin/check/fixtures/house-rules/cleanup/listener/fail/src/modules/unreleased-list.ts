export default function (element: HTMLElement) {
  const observers: MutationObserver[] = [];
  observers.push(new MutationObserver(() => {}));
  observers.forEach((entry) => entry.observe(element));
}
