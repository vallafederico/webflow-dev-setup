import { onDestroy } from "@/modules/_";
import Events from "@lib/hey";

export default function (element: HTMLElement) {
  const onPage = (data: unknown) => {
    element.dataset.page = String(data);
  };
  Events.on("PAGE", onPage);

  // Once removes itself, so an inline function is fine.
  Events.once("READY", () => {
    element.dataset.ready = "true";
  });

  onDestroy(() => {
    Events.off("PAGE", onPage);
  });
}
