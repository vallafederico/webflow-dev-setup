import gsap from "@lib/gsap";

export default function (element: HTMLElement) {
  gsap.to(element, { autoAlpha: 1 });
}
