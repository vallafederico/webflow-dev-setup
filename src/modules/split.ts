import gsap, { SplitText } from "@lib/gsap";
import { onEditor, onView } from "@/modules/_";

function setVisuallyHidden(element: HTMLElement) {
  element.setAttribute("aria-hidden", "true");
  element.style.position = "absolute";
  element.style.left = "-9999px";
  element.style.top = "-9999px";
  element.style.width = "1px";
}

const splitText = (element: HTMLElement) => {
  const content = element.textContent;
  element.textContent = "";

  const span = document.createElement("span");
  span.textContent = content;
  element.appendChild(span);
  setVisuallyHidden(span);

  const anotherSpan = document.createElement("span");
  anotherSpan.setAttribute("data-css", "overflow-clip");
  anotherSpan.textContent = content;
  anotherSpan.setAttribute("aria-hidden", "true");
  element.appendChild(anotherSpan);

  const splitText = new SplitText(anotherSpan, {
    type: "chars",
  });

  return splitText;
};

export default function Split(element: HTMLElement) {
  const split = splitText(element);

  const observer = onView(element, {
    autoStart: false,
    callback: ({ isIn }) => {
      // console.log("inView", isIn);

      if (isIn) {
        gsap.to(split.chars, {
          yPercent: 0,
          stagger: 0.02,
        });
      } else {
        gsap.killTweensOf(split.chars);
        gsap.set(split.chars, {
          yPercent: 100,
        });
      }
    },
  });

  // No motion in the editor: stop observing, kill the tweens and clear the
  // offset the out-of-view state sets on the chars. The text stays split.
  onEditor((isEditor) => {
    if (isEditor) {
      observer.stop();
      gsap.killTweensOf(split.chars);
      gsap.set(split.chars, { clearProps: "transform" });
    } else {
      observer.start();
    }
  });
}
