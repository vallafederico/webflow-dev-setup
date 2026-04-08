import { Scroll } from "@lib/scroll";
import { runInitial } from "@lib/pages";
import { tick } from "@/utils/tick";
import { publicAssetUrl, PUBLIC_ASSET_ORIGIN } from "@/utils/public-asset";
import { createCycles, runMount, runPageIn } from "./modules/_";
// import { Pages } from "@lib/pages";

export { PUBLIC_ASSET_ORIGIN, publicAssetUrl };

/** Paths under `public/` to warm-load at startup (absolute URL via {@link publicAssetUrl}). */
// const PUBLIC_ASSET_PATHS = ["bd.002_Bake6_CyclesBake_COMBINED.png"] as const;

// function loadPublicAssets() {
//   for (const path of PUBLIC_ASSET_PATHS) {
//     const url = publicAssetUrl(path);
//     console.log("url", url);
//   }
// }

// history.scrollRestoration = "manual";

class _App {
  private scroll = Scroll;
  // pages = Pages;

  constructor() {
    console.log("App local", performance.now().toFixed(2));

    createCycles();
    runPageIn();
    runMount();

    // requestAnimationFrame(() => {
    //   setTimeout(() => tick.showWebVitals(), 1500);
    // });
  }
}

export const App = new _App();
