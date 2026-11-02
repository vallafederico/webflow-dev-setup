/**
 * Entry of the test bundle that `pnpm check:runtime` builds into a temp
 * folder. It is never part of the production build: it exposes the module
 * lifecycle and the subscription counts on `window` so the browser run can
 * drive them. Taxi is off in the template, so `onDestroy` never runs in real
 * navigation and this is the only way to exercise it.
 */
import {
  createCycles,
  runDestroy,
  runMount,
  runPageIn,
  runPageOut,
} from "@/modules/_";
import State from "@lib/hey";
import { Scroll } from "@lib/scroll";
import { Raf, Resize } from "@lib/subs";
import { editorListenerCount } from "@webflow/detect-editor";
import type { Counts, FixtureApi } from "./runtime-rules";

// runPageIn and runPageOut settle every hook, so a hook that throws is only
// visible in their results. Say so on the console, where the browser run reads it.
async function report(settled: Promise<PromiseSettledResult<void>[]>) {
  for (const result of await settled) {
    if (result.status === "rejected") {
      console.error(`a page hook rejected: ${String(result.reason)}`);
    }
  }
}

declare global {
  interface Window {
    __wdsCheck: FixtureApi;
  }
}

const root = () => {
  const element = document.getElementById("fixture-root");
  if (!element) throw new Error("fixture page has no #fixture-root");
  return element;
};

window.__wdsCheck = {
  counts: () =>
    ({
      // Set by the leak test's init script, which is not part of any bundle.
      ...(
        window as unknown as { __wdsCounters?: () => object }
      ).__wdsCounters?.(),
      Raf: Raf.count(),
      Resize: Resize.count(),
      Scroll: Scroll.count(),
      State: State.count(),
      editor: editorListenerCount(),
    }) as Counts,
  setFixture: (html) => {
    root().innerHTML = html;
  },
  cycles: () => {
    const called = createCycles().length;
    const uninitialized = Array.from(
      root().querySelectorAll<HTMLElement>("[data-module]")
    )
      .filter((element) => !element._moduleInitialized)
      .map((element) => element.dataset.module ?? "");
    return { called, uninitialized };
  },
  pageIn: () => report(runPageIn()),
  mount: () => runMount(),
  pageOut: () => report(runPageOut()),
  destroy: () => runDestroy(),
};
