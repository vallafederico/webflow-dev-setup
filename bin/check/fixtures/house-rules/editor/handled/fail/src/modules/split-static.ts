import { SplitText } from "@lib/gsap";

export default function (element: HTMLElement) {
  SplitText.create(element, { type: "chars" });
}
