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
import type { FixtureApi } from "./runtime-rules";

// runPageIn and runPageOut wait on Promise.allSettled, which swallows a hook
// that throws. Say so on the console, where the browser run reads it.
const allSettled = Promise.allSettled.bind(
  Promise
) as typeof Promise.allSettled;
Promise.allSettled = (async (values: Iterable<unknown>) => {
  const results = await allSettled(values);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`a page hook rejected: ${String(result.reason)}`);
    }
  }
  return results;
}) as typeof Promise.allSettled;

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
  counts: () => ({
    Raf: Raf.count(),
    Resize: Resize.count(),
    Scroll: Scroll.count(),
    State: State.count(),
    editor: editorListenerCount(),
  }),
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
  pageIn: () => runPageIn(),
  mount: () => runMount(),
  pageOut: () => runPageOut(),
  destroy: () => runDestroy(),
};
