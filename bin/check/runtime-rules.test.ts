import { describe, expect, test } from "bun:test";
import {
  classifyConsole,
  cleanMessage,
  compareCounts,
  COUNT_ORDER,
  type Counts,
} from "./runtime-rules";

describe("classifyConsole", () => {
  const verdict = (type: string, text: string) =>
    classifyConsole({ type, text });

  test("ordinary logs are ignored", () => {
    expect(verdict("log", "hello").kind).toBe("ignore");
    expect(verdict("info", "x").kind).toBe("ignore");
  });

  test("a network 404 is ignored, any other console.error fails", () => {
    expect(
      verdict(
        "error",
        "Failed to load resource: the server responded with a status of 404 (Not Found)"
      ).kind
    ).toBe("ignore");
    expect(
      verdict(
        "error",
        "Failed to load resource: the server responded with a status of 500 (Server Error)"
      ).kind
    ).toBe("error");
    expect(verdict("error", "boom")).toEqual({
      kind: "error",
      message: "console.error: boom",
    });
  });

  test("createCycles only warns when a module throws, and that is a failure naming the module", () => {
    expect(
      verdict(
        "warning",
        'Failed to call default function for module "nav": Error: boom\n    at x (http://127.0.0.1:5000/app.js:1:2)'
      )
    ).toEqual({
      kind: "error",
      message: 'Failed to call default function for module "nav": Error: boom',
      module: "nav",
    });
    expect(
      verdict("warning", 'Default export is not a function for module "x"')
    ).toMatchObject({ kind: "error", module: "x" });
    expect(verdict("warning", 'module not found: "ghost"')).toMatchObject({
      kind: "error",
      module: "ghost",
    });
  });

  test("other warnings are reported but don't fail", () => {
    expect(verdict("warning", "GSAP target not found")).toEqual({
      kind: "warning",
      message: "console.warn: GSAP target not found",
    });
  });
});

describe("cleanMessage", () => {
  test("keeps the message and drops the stack and the server's port", () => {
    expect(
      cleanMessage(
        "Error at http://127.0.0.1:43210/app.js failed\n    at f (http://127.0.0.1:43210/app.js:1:1)"
      )
    ).toBe("Error at /app.js failed");
  });

  test("keeps a multi-line message that has no stack", () => {
    expect(cleanMessage("line one\nline two")).toBe("line one line two");
  });
});

const counts = (overrides: Partial<Counts> = {}): Counts => ({
  Raf: 0,
  Resize: 0,
  Scroll: 0,
  State: 0,
  editor: 1,
  ...overrides,
});
const cycle = (mounted: Partial<Counts>, destroyed: Partial<Counts> = {}) => ({
  mounted: counts(mounted),
  destroyed: counts(destroyed),
});

describe("compareCounts", () => {
  test("stable counts that return to the baseline are clean", () => {
    const base = counts();
    const same = cycle({ State: 2, editor: 3 });
    expect(compareCounts(base, [same, same, same])).toEqual([]);
  });

  test.each(COUNT_ORDER)(
    "%s left over after destroy names the count",
    (name) => {
      const base = counts();
      const leaky = cycle(
        { [name]: base[name] + 1 },
        { [name]: base[name] + 1 }
      );
      const problems = compareCounts(base, [leaky, leaky, leaky]);
      expect(problems.map((p) => p.count)).toEqual([name]);
      expect(problems[0]?.message).toContain(
        `${name} count is ${base[name] + 1} after destroy`
      );
    }
  );

  test("a count that grows between mounts names the count, even if destroy is clean", () => {
    const problems = compareCounts(counts(), [
      cycle({ Raf: 1 }),
      cycle({ Raf: 2 }),
      cycle({ Raf: 3 }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain(
      "Raf count grew from 1 after the first mount to 2 after mount 2"
    );
  });

  test("reports each leaking count once", () => {
    const leaky = cycle({ Raf: 1, State: 1 }, { Raf: 1, State: 1 });
    expect(
      compareCounts(counts(), [leaky, leaky, leaky]).map((p) => p.count)
    ).toEqual(["Raf", "State"]);
  });
});
