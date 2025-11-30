import { Scroll } from "@lib/scroll";
import { Pages } from "@lib/pages";
import { runInitial } from "@lib/pages";

// history.scrollRestoration = "manual";

class _App {
  private scroll = Scroll;
  pages = Pages;

  constructor() {
    console.log("App", performance.now().toFixed(2));

    runInitial();
  }
}

export const App = new _App();
