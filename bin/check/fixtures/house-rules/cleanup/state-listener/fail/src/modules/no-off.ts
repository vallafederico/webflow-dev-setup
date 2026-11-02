import { onDestroy } from "@/modules/_";
import State from "@lib/hey";

export default function (element: HTMLElement) {
  const onPage = (data: unknown) => {
    element.dataset.page = String(data);
  };
  State.on("PAGE", onPage);

  onDestroy(() => {
    element.dataset.page = "";
  });
}
