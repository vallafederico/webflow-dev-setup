// Imports that are never called don't count, and neither do Scroll and onTrack.
import { onTrack } from "@/modules/_";
import gsap from "@lib/gsap";
import { Scroll } from "@lib/scroll";
import { Raf } from "@lib/subs";

export default function (element: HTMLElement) {
  const unused = [gsap, Raf];
  const track = onTrack(element, { callback: () => {} });
  Scroll.scrollTo(0);
  return unused.length + (track ? 1 : 0);
}
