import { onDestroy } from "@/modules/_";

export default function (element) {
  const onClick = () => {};
  element.addEventListener("click", onClick);
  onDestroy(() => element.removeEventListener("click", onClick));
}
