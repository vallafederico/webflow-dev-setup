import gsap from "@lib/gsap";

type SubscriberFn = (data: any) => void;

class Subscribable {
  #subscribers: { fn: SubscriberFn; priority: number; id: symbol }[] = [];

  add(fn: SubscriberFn, priority = 0, id = Symbol()) {
    const index = this.#subscribers.findIndex((sub) => sub.priority > priority);
    if (index === -1) {
      this.#subscribers.push({ fn, priority, id });
    } else {
      this.#subscribers.splice(index, 0, { fn, priority, id });
    }
    return () => this.remove(id);
  }

  remove(id: symbol) {
    this.#subscribers = this.#subscribers.filter((f) => f.id !== id);
  }

  notify(data: any) {
    if (this.#subscribers.length < 1) return;
    this.#subscribers.forEach((f) => f.fn(data));
  }

  /** Live subscriber count, for leak checks. */
  count() {
    return this.#subscribers.length;
  }
}

/** What `Raf.add` callbacks receive. */
export interface RafData {
  /** Seconds since the GSAP ticker started. */
  time: number;
  /** Seconds since the last frame. */
  deltaTime: number;
}

/** Raf */
class _Raf extends Subscribable {
  constructor() {
    super();
    gsap.ticker.add(this.update.bind(this));
  }

  // GSAP's ticker calls its listeners with (seconds since it started, milliseconds since the last tick).
  update(time: number, deltaTime: number) {
    this.notify({ time, deltaTime: deltaTime / 1000 } satisfies RafData);
  }
}

/** Resize */
class _Resize extends Subscribable {
  width = window.innerWidth;
  height = window.innerHeight;
  private timeoutId: number | null = null;
  private readonly debounceDelay = 100;

  constructor() {
    super();
    window.addEventListener("resize", this.update.bind(this));
  }

  update() {
    if (this.timeoutId) {
      window.clearTimeout(this.timeoutId);
    }

    this.timeoutId = window.setTimeout(() => {
      const newWidth = window.innerWidth;
      const newHeight = window.innerHeight;

      if (newWidth !== this.width || newHeight !== this.height) {
        this.width = newWidth;
        this.height = newHeight;
        this.notify({ width: this.width, height: this.height });
      }

      this.timeoutId = null;
    }, this.debounceDelay);
  }
}

export const Raf = new _Raf();
export const Resize = new _Resize();
