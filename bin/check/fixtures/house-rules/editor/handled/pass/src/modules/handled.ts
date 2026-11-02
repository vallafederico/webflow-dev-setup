import { onEditor, onView } from "@/modules/_";
import gsap from "@lib/gsap";

export default function (element: HTMLElement) {
  let editing = false;
  onEditor((isEditor) => {
    editing = isEditor;
  });

  onView(element, {
    callback: ({ isIn }) => {
      if (!editing && isIn) gsap.to(element, { autoAlpha: 1 });
    },
  });
}
