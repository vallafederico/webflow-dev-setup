// Only the State imported from lib/hey is checked, not any object with .on.
const emitter = { on: (_name: string, _fn: () => void) => {} };

export default function (element: HTMLElement) {
  emitter.on("PAGE", () => {
    element.dataset.page = "1";
  });
}
