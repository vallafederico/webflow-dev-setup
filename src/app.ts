import { Scroll } from "@lib/scroll";
import { runInitial } from "@lib/pages";
import { tick } from "@/utils/tick";
// import { Pages } from "@lib/pages";

// history.scrollRestoration = "manual";

class _App {
  private scroll = Scroll;
  // pages = Pages;

  constructor() {
    console.log("App", performance.now().toFixed(2));

    runInitial();

    requestAnimationFrame(() => {
      setTimeout(() => tick.showWebVitals(), 1500);
    });
  }
}

export const App = new _App();
