/*

mount()
destroy()

pageIn()
pageOut()

view()
track()


*/

import { Observe, ObserveConfig, Track } from "@/modules/_";
import { Resize } from "@lib/subs";
import { handleEditor, releaseEditor } from "@webflow/detect-editor";

/** -- <stores> */
const destroy: Array<() => void> = [];
const mount: Array<() => void> = [];

/** -- <lifecycle> */
export function onMount(fn: () => void) {
  mount.push(fn);
}

export function onDestroy(fn: () => void) {
  destroy.push(fn);
}

export function runDestroy() {
  destroy.forEach((fn) => fn());
  destroy.length = 0;
  //   console.log("destroy -> []", destroy);
}

export function runMount() {
  mount.forEach((fn) => fn());
  mount.length = 0;
  //   console.log("mount -> []", mount);
}

/**
 * Runs `fn` with the current editor state now and whenever it changes, and
 * releases the listener on destroy. Use it instead of calling `handleEditor`
 * directly in a module, which would leave the listener behind.
 */
export function onEditor(fn: (isEditor: boolean) => void) {
  // Register the release first: if `fn` throws on its first call, the listener
  // is already added and must still be released.
  onDestroy(() => releaseEditor(fn));
  handleEditor(fn);
}

/** -- <animation> */
const pageOut: Array<() => Promise<void>> = [];
const pageIn: Array<() => Promise<void>> = [];

export function onPageOut(
  fn: () => Promise<void>,
  { element }: { element?: HTMLElement } = {}
) {
  if (element) {
    pageOut.push(async () => {
      const rect = element.getBoundingClientRect();
      const isCurrentlyVisible = rect.top < Resize.height && rect.bottom > 0;
      return isCurrentlyVisible ? await fn() : Promise.resolve();
    });
  } else {
    pageOut.push(fn);
  }
}

/** Resolves when every hook has settled, with each hook's outcome so a caller can see one that threw. */
export async function runPageOut() {
  const results = await Promise.allSettled(pageOut.map((fn) => fn()));
  pageOut.length = 0;
  //   console.log("page -> []", page);
  return results;
}

export function onPageIn(fn: () => Promise<void>) {
  pageIn.push(fn);
}

export async function runPageIn() {
  const results = await Promise.allSettled(pageIn.map((fn) => fn()));
  pageIn.length = 0;
  return results;
}

export function onView(
  element: HTMLElement,
  { root, rootMargin, threshold, autoStart, once, callback }: ObserveConfig
) {
  const observer = new Observe(element, {
    root,
    rootMargin,
    threshold,
    autoStart,
    once,
    callback,
  });

  onDestroy(() => {
    observer.destroy();
  });

  return observer;
}

export function onTrack(
  element: HTMLElement,
  config: {
    bounds?: [number, number];
    top?: "top" | "center" | "bottom";
    bottom?: "top" | "center" | "bottom";
    callback?: (value: number) => void;
  } = {}
) {
  const track = new Track(element, config);

  onDestroy(() => {
    track.destroy();
  });

  return track;
}
