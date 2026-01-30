import { Scroll } from "@lib/scroll";
import { Pages } from "@lib/pages";
import { runInitial } from "@lib/pages";
import { tick } from "@/utils/tick";

// history.scrollRestoration = "manual";

class _App {
  private scroll = Scroll;
  pages = Pages;

  constructor() {
    console.log("App", performance.now().toFixed(2));

    runInitial();

    // Print web metrics to console after app init (gives LCP/CLS etc time to settle)
    requestAnimationFrame(() => {
      setTimeout(() => tick.showWebVitals(), 1500);
    });
  }
}

export const App = new _App();
