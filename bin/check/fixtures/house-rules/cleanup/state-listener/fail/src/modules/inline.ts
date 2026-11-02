import Events from "@lib/hey";

export default function (element: HTMLElement) {
  Events.on("PAGE", (data) => {
    element.dataset.page = String(data);
  });
}
