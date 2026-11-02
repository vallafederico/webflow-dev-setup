/** What the browser run decides from what it saw, kept apart from the browser so it can be unit tested. */

export type Verdict =
  | { kind: "ignore" }
  | { kind: "error"; message: string; module?: string }
  | { kind: "warning"; message: string };

export interface ConsoleLine {
  /** Playwright's console type: "log", "error", "warning", ... */
  type: string;
  text: string;
}

/** The message up to its stack trace, with the local server's origin removed so ports never reach a finding. */
export function cleanMessage(text: string): string {
  const lines = text.split("\n");
  const stack = lines.findIndex((line, i) => i > 0 && /^\s+at /.test(line));
  return (stack === -1 ? lines : lines.slice(0, stack))
    .join(" ")
    .replaceAll(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/g, "")
    .trim();
}

const NETWORK_404 =
  /^Failed to load resource: the server responded with a status of 404\b/;

/** `createCycles` catches a module's error and only warns, so these warnings are failures. */
const MODULE_FAILURE =
  /(?:Failed to call default function for|Default export is not a function for) module "([^"]+)"|^module not found: "([^"]+)"/;

export function classifyConsole(line: ConsoleLine): Verdict {
  const message = cleanMessage(line.text);
  if (line.type === "error") {
    return NETWORK_404.test(message)
      ? { kind: "ignore" }
      : { kind: "error", message: `console.error: ${message}` };
  }
  if (line.type === "warning") {
    const failure = MODULE_FAILURE.exec(message);
    if (failure)
      return { kind: "error", message, module: failure[1] ?? failure[2] };
    return { kind: "warning", message: `console.warn: ${message}` };
  }
  return { kind: "ignore" };
}

export const COUNT_ORDER = [
  "Raf",
  "Resize",
  "Scroll",
  "State",
  "editor",
] as const;
export type CountName = (typeof COUNT_ORDER)[number];
export type Counts = Record<CountName, number>;

export interface CycleCounts {
  mounted: Counts;
  destroyed: Counts;
}

const FIXES: Record<CountName, string> = {
  Raf: "keep the function Raf.add returns and call it in onDestroy",
  Resize: "keep the function Resize.add returns and call it in onDestroy",
  Scroll: "keep the function Scroll.add returns and call it in onDestroy",
  State: "call State.off with the same handler in onDestroy",
  editor:
    "use onEditor() from @/modules/_ instead of handleEditor, which releases its listener on destroy",
};

export function leakFix(name: CountName): string {
  return FIXES[name];
}

export interface CountProblem {
  count: CountName;
  message: string;
}

/**
 * Compares the counts of a full lifecycle, repeated. After destroy every
 * count must be back where it was before the first mount, and a later mount
 * must register exactly what the first one did.
 */
export function compareCounts(
  baseline: Counts,
  cycles: CycleCounts[]
): CountProblem[] {
  const problems: CountProblem[] = [];
  const first = cycles[0];
  for (const name of COUNT_ORDER) {
    let reported = false;
    cycles.forEach((cycle, index) => {
      if (reported) return;
      if (cycle.destroyed[name] !== baseline[name]) {
        reported = true;
        problems.push({
          count: name,
          message: `${name} count is ${cycle.destroyed[name]} after destroy in cycle ${index + 1}, but ${baseline[name]} before the first mount, so something subscribed on mount was never undone`,
        });
      } else if (
        first &&
        index > 0 &&
        cycle.mounted[name] !== first.mounted[name]
      ) {
        reported = true;
        problems.push({
          count: name,
          message: `${name} count grew from ${first.mounted[name]} after the first mount to ${cycle.mounted[name]} after mount ${index + 1}`,
        });
      }
    });
  }
  return problems;
}

/** What the test bundle (bin/check/fixture-entry.ts) puts on `window.__wdsCheck`. */
export interface FixtureApi {
  counts(): Counts;
  /** Replaces the fixture root's markup with fresh elements. */
  setFixture(html: string): void;
  /** Runs createCycles and reports which `data-module` elements did not initialise. */
  cycles(): { called: number; uninitialized: string[] };
  pageIn(): Promise<void>;
  mount(): void;
  pageOut(): Promise<void>;
  destroy(): void;
}
