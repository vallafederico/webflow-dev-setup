/**
 * Counts what the lifecycle can leave behind but the shared libraries don't
 * count: intervals, listeners on the page's global targets, and live
 * observers. Playwright runs it as an init script in the leak test's page
 * only, before any bundle code, so nothing is added to the production bundle.
 *
 * It must stay self-contained: it is serialised and run in the page.
 */
export function installCounters() {
  const w = window as any;
  const timers = new Set<unknown>();
  const setInterval = w.setInterval.bind(w);
  const clearInterval = w.clearInterval.bind(w);
  const clearTimeout = w.clearTimeout.bind(w);
  w.setInterval = (...args: unknown[]) => {
    const id = setInterval(...args);
    timers.add(id);
    return id;
  };
  // Timeouts and intervals share one id space, so either call clears either.
  w.clearInterval = w.clearTimeout = (id: unknown) => {
    timers.delete(id);
    return clearInterval(id) ?? clearTimeout(id);
  };

  const listeners = new Set<string>();
  const ids = new WeakMap<object, number>();
  let nextId = 0;
  const label = (t: unknown) =>
    t === w
      ? "window"
      : t === document
        ? "document"
        : t === document.documentElement
          ? "html"
          : t === document.body && t
            ? "body"
            : "";
  const key = (t: unknown, type: string, fn: object, opts: any) => {
    if (!ids.has(fn)) ids.set(fn, nextId++);
    return `${label(t)}|${type}|${ids.get(fn)}|${typeof opts === "boolean" ? opts : !!opts?.capture}`;
  };
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (
    this: any,
    type: string,
    fn: any,
    opts?: any
  ) {
    if (fn && label(this) && !opts?.once) {
      const k = key(this, type, fn, opts);
      listeners.add(k);
      opts?.signal?.addEventListener("abort", () => listeners.delete(k));
    }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (
    this: any,
    type: string,
    fn: any,
    opts?: any
  ) {
    if (fn && label(this)) listeners.delete(key(this, type, fn, opts));
    return remove.call(this, type, fn, opts);
  };

  const observers = new Set<object>();
  for (const name of [
    "IntersectionObserver",
    "ResizeObserver",
    "MutationObserver",
  ]) {
    const Native = w[name];
    w[name] = class extends Native {
      observe(...args: unknown[]) {
        observers.add(this);
        return super.observe(...args);
      }
      disconnect() {
        observers.delete(this);
        return super.disconnect();
      }
    };
  }

  w.__wdsCounters = () => ({
    timers: timers.size,
    listeners: listeners.size,
    observers: observers.size,
  });
}
