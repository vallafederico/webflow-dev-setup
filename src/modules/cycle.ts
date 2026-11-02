import { Raf } from "@lib/subs";
import {
  onMount,
  onDestroy,
  onPageOut,
  onView,
  onTrack,
  onPageIn,
  onEditor,
} from "@/modules/_";
import gsap from "@lib/gsap";
// import { Raf, Resize } from "@lib/subs";
import State from "@lib/hey";

import { Scroll } from "@lib/scroll";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  // console.log("cycle", element);
  // State.on("something", () => {})
  // ;

  const onSomething = (data: unknown) => {
    console.log("something", data);
  };

  State.on("SOMETHING", onSomething);

  // The editor shows the element as designed, so skip the motion and drop
  // whatever inline state an earlier tween left behind.
  let isEditor = false;
  onEditor((value) => {
    isEditor = value;
    if (!isEditor) return;
    gsap.killTweensOf(element);
    gsap.set(element, { clearProps: "backgroundColor,opacity,visibility" });
  });

  onPageIn(async () => {
    if (isEditor) return;
    // console.log("onPageIn");
    await gsap.to(element, {
      duration: 0.2,
      backgroundColor: "green",
    });
  });

  onPageOut(
    async () => {
      if (isEditor) return;
      // console.log("onPageOut");
      await gsap.to(element, {
        duration: 1,
        backgroundColor: "blue",
      });

      await gsap.to(element, {
        duration: 1,
        autoAlpha: 0,
      });
    },
    {
      element,
    }
  );

  onMount(() => {
    // element.style.backgroundColor = "red";
    // console.log("onMount");
    // observer.start();
  });

  // const observer = onView(element, {
  //   root: null,
  //   rootMargin: "0px",
  //   threshold: 0.1,
  //   autoStart: false,
  //   once: false,
  //   callback: ({ isIn, direction }) => {
  //     console.log("inView", isIn, direction);
  //   },
  // });

  // const track = onTrack(element, {
  //   bounds: [0, 1],
  //   top: "bottom",
  //   bottom: "top",
  //   callback: (value) => {
  //     console.log("^^", value);
  //   },
  // });

  onDestroy(() => {
    State.off("SOMETHING", onSomething);
  });

  // return () => {};
}
