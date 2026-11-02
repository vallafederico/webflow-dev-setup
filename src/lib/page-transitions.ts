import { App } from "@/app";
import { Transition as BaseTransition } from "@unseenco/taxi";

/* -- Baseline Transition */
export class Transition extends BaseTransition {
  async onLeave({
    from,
    trigger,
    done,
  }: {
    from: Element | HTMLElement;
    trigger: string | false | HTMLElement;
    done: Function;
  }) {
    await App.pages?.transitionOut({ from, trigger });
    done();
  }

  async onEnter({
    to,
    trigger,
    done,
  }: {
    to: Element | HTMLElement;
    trigger: string | false | HTMLElement;
    done: Function;
  }) {
    await App.pages?.transitionIn({ to, trigger });
    done();
  }
}

/* -- ... Transition */
