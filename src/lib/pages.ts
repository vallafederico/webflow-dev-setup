import { App } from "@/app";
import State from "@lib/hey";
import { Core } from "@unseenco/taxi";
import { Transition } from "@lib/page-transitions";
import { Scroll } from "@lib/scroll";
import { Resize } from "@lib/subs";
import {
  createCycles,
  runDestroy,
  runMount,
  runPageOut,
  runPageIn,
} from "@/modules/_";
import { resetWebflow } from "@/webflow/reset-webflow";

const PAGES_CONFIG = {
  links: "a:not([target]):not([href^=\\#]):not([data-taxi-ignore])",
  removeOldContent: true,
  allowInterruption: false,
  bypassCache: false,
};

export interface TransitionParams {
  from?: Element | HTMLElement;
  to?: Element | HTMLElement;
  trigger: HTMLAnchorElement;
  wrapper: HTMLElement | any;
  destination?: string;
}

export function runInitial() {
  createCycles();
  runPageIn();
  runMount();
}

export class _Pages extends Core {
  constructor() {
    super({
      ...PAGES_CONFIG,
      transitions: {
        default: Transition,
      },
    });
  }

  // async init() {}

  async transitionOut({ from, trigger }: TransitionParams) {
    await Promise.allSettled([
      await runPageOut(),
      // ...
    ]);

    runDestroy();
    Scroll.toTop();
  }

  async transitionIn({ to, trigger }: TransitionParams) {
    createCycles();
    Scroll.resize();
    Resize.update();

    // State.PAGE = to;

    await Promise.allSettled([
      await runPageIn(),
      // ...
    ]);

    runMount();
    // resetWebflow();
  }
}

export const Pages = new _Pages();
