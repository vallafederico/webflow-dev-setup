import { Raf, Resize } from "@lib/subs";
import { onDestroy } from "@/modules/_";
import State from "@lib/hey";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  // console.log("nav", element);

  // setInterval(() => {
  //   console.log("count", count++);
  // }, 1000);

  const onPage = (data: unknown) => {
    console.log("page changed");
  };

  State.on("PAGE", onPage);

  onDestroy(() => {
    State.off("PAGE", onPage);
  });
}
