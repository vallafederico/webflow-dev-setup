import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  analyzeRoot,
  analyzeSource,
  applyEdits,
  LIMITS,
  moduleNameProblem,
  RULES,
} from "./house-rules";

const FIXTURES = path.join(import.meta.dir, "fixtures", "house-rules");
const ONLY_THIS_RULE_EXEMPT = new Set<string>();

function fixture(rule: string, kind: "fail" | "pass") {
  const dir = path.join(FIXTURES, rule, kind);
  expect(existsSync(dir)).toBe(true);
  return analyzeRoot(dir);
}

describe("one failing and one passing fixture per rule", () => {
  for (const rule of RULES) {
    test(`${rule}: the failing fixture is flagged`, () => {
      const { findings } = fixture(rule, "fail");
      const flagged = findings.filter((finding) => finding.rule === rule);
      expect(flagged.length).toBeGreaterThan(0);
      for (const finding of flagged) {
        expect(finding.fix.length).toBeGreaterThan(10);
        expect(finding.message.length).toBeGreaterThan(10);
        expect(finding.file.startsWith("src/")).toBe(true);
        expect(finding.line).toBeGreaterThan(0);
      }
      // A fixture proves one rule, so no other rule may fire on it.
      if (!ONLY_THIS_RULE_EXEMPT.has(rule)) {
        expect(findings.filter((finding) => finding.rule !== rule)).toEqual([]);
      }
    });

    test(`${rule}: the passing fixture has no findings at all`, () => {
      expect(fixture(rule, "pass").findings).toEqual([]);
    });
  }

  test("every rule has a fixture folder and nothing else does", () => {
    const rules = [...RULES].sort();
    const folders: string[] = [];
    for (const group of readdirSync(FIXTURES)) {
      for (const name of readdirSync(path.join(FIXTURES, group))) {
        folders.push(`${group}/${name}`);
      }
    }
    expect(folders.sort()).toEqual(rules);
  });
});

describe("severity", () => {
  test("only boot/no-body-at-load and debug/console are warnings", () => {
    for (const rule of RULES) {
      const { findings } = fixture(rule, "fail");
      for (const finding of findings.filter((f) => f.rule === rule)) {
        const warns =
          rule === "boot/no-body-at-load" || rule === "debug/console";
        expect(finding.severity).toBe(warns ? "warning" : "error");
      }
    }
  });
});

describe("scope", () => {
  const run = (file: string, text: string) =>
    analyzeSource(file, text).findings.map((finding) => finding.rule);

  test("module rules skip src/modules/_ and nested folders", () => {
    const text = "export const x = document.body.id; console.log(x);\n";
    expect(run("src/modules/_/helper.ts", text)).toEqual([]);
    expect(run("src/modules/deep/thing.ts", text)).toEqual([]);
    expect(run("src/utils/thing.ts", text)).toEqual([]);
  });

  test("imports and process.env cover all of src, but not other folders", () => {
    const text = 'import gsap from "gsap";\nexport const a = process.env.A;\n';
    expect(run("src/utils/a.ts", text).sort()).toEqual([
      "browser/no-process-env",
      "imports/gsap",
    ]);
    expect(run("bin/a.ts", text)).toEqual([]);
  });

  test("subs/no-raw covers pages as well as modules", () => {
    const text = "requestAnimationFrame(() => {});\n";
    expect(run("src/pages/home.js", text)).toEqual(["subs/no-raw"]);
    expect(run("src/utils/a.ts", text)).toEqual([]);
  });
});

describe("imports", () => {
  test("autofix rewrites the specifier and leaves the rest alone", () => {
    const source = [
      'import { Raf } from "@/lib/subs"; // keep',
      'import { onMount } from "./_";',
      "",
    ].join("\n");
    const { edits } = analyzeSource("src/modules/a.ts", source);
    expect(edits).toHaveLength(2);
    expect(applyEdits(source, edits)).toBe(
      [
        'import { Raf } from "@lib/subs"; // keep',
        'import { onMount } from "@/modules/_";',
        "",
      ].join("\n")
    );
  });

  test("a fixed file has no findings, so fixing twice changes nothing", () => {
    const source = 'import { Raf } from "../lib/subs";\nRaf.add(() => {});\n';
    const first = applyEdits(
      source,
      analyzeSource("src/utils/a.ts", source).edits
    );
    expect(analyzeSource("src/utils/a.ts", first).findings).toEqual([]);
    expect(analyzeSource("src/utils/a.ts", first).edits).toEqual([]);
  });

  test("an ignored import is neither reported nor rewritten", () => {
    const source =
      '// house-ignore imports/subs: the build script resolves this path\nimport { Raf } from "@/lib/subs";\n';
    const result = analyzeSource("src/utils/a.ts", source);
    expect(result.findings).toEqual([]);
    expect(result.edits).toEqual([]);
  });
});

describe("house-ignore", () => {
  const module = (body: string) =>
    `export default function (element: HTMLElement) {\n${body}\n}\n`;

  test("silences only the rule it names, on the next line", () => {
    const text = module(
      [
        "  // house-ignore debug/console: logged on purpose",
        "  console.log(1);",
        "  console.log(2);",
      ].join("\n")
    );
    const findings = analyzeSource("src/modules/a.ts", text).findings;
    expect(findings.map((f) => [f.rule, f.line])).toEqual([
      ["debug/console", 4],
    ]);
  });

  test("a different rule name does not silence anything", () => {
    const text = module(
      "  // house-ignore cleanup/listener: wrong rule\n  console.log(1);"
    );
    expect(
      analyzeSource("src/modules/a.ts", text).findings.map((f) => f.rule)
    ).toEqual(["debug/console"]);
  });

  test("without a reason it silences nothing and is reported itself", () => {
    const text = module("  // house-ignore debug/console:\n  console.log(1);");
    expect(
      analyzeSource("src/modules/a.ts", text)
        .findings.map((f) => f.rule)
        .sort()
    ).toEqual(["debug/console", "house-ignore/reason"]);
  });

  test("a whole-file finding is ignored from the line above the first statement", () => {
    const text =
      "// house-ignore module/default-export: this file only registers a plugin\nexport const x = 1;\n";
    expect(analyzeSource("src/modules/a.ts", text).findings).toEqual([]);
  });
});

describe("cleanup rules follow the code, not names", () => {
  const body = (text: string) =>
    [
      'import { onDestroy } from "@/modules/_";',
      'import Bus from "@lib/hey";',
      'import { Raf } from "@lib/subs";',
      "export default function (element: HTMLElement) {",
      text,
      "}",
      "",
    ].join("\n");
  // editor/handled has its own tests, so only the cleanup rules show here.
  const rules = (text: string) =>
    analyzeSource("src/modules/a.ts", body(text))
      .findings.map((f) => f.rule)
      .filter((rule) => rule.startsWith("cleanup/"));

  test("State is found through its import, whatever it is called", () => {
    expect(rules('  Bus.on("A", () => {});')).toEqual([
      "cleanup/state-listener",
    ]);
  });

  test("a local object called State is not the State store", () => {
    const text = [
      "const State = { on(_a: string, _b: () => void) {} };",
      'State.on("A", () => {});',
    ].join("\n");
    expect(
      analyzeSource(
        "src/modules/a.ts",
        `export default function () {\n${text}\n}\n`
      ).findings
    ).toEqual([]);
  });

  test("off must pass the same handler as on", () => {
    const wrong = [
      "  const a = () => {};",
      "  const b = () => {};",
      '  Bus.on("A", a);',
      '  onDestroy(() => { Bus.off("A", b); });',
    ].join("\n");
    expect(rules(wrong)).toEqual(["cleanup/state-listener"]);
    const right = wrong.replace('Bus.off("A", b)', 'Bus.off("A", a)');
    expect(rules(right)).toEqual([]);
  });

  test("off outside onDestroy does not count", () => {
    const text = [
      "  const a = () => {};",
      '  Bus.on("A", a);',
      '  Bus.off("A", a);',
    ].join("\n");
    expect(rules(text)).toEqual(["cleanup/state-listener"]);
  });

  test("a cleanup function that onDestroy receives by name counts", () => {
    const text = [
      "  const a = () => {};",
      '  Bus.on("A", a);',
      '  function stop() { Bus.off("A", a); }',
      "  onDestroy(stop);",
    ].join("\n");
    expect(rules(text)).toEqual([]);
  });

  test("the unsubscribe function must be called, not just kept", () => {
    expect(rules("  const stop = Raf.add(() => {});")).toEqual([
      "cleanup/subscription",
    ]);
    expect(
      rules(
        "  const stop = Raf.add(() => {});\n  onDestroy(() => { stop(); });"
      )
    ).toEqual([]);
  });

  test("listeners on different targets are told apart", () => {
    const text = [
      "  const f = () => {};",
      '  element.addEventListener("click", f);',
      '  onDestroy(() => { window.removeEventListener("click", f); });',
    ].join("\n");
    expect(rules(text)).toEqual(["cleanup/listener"]);
  });
});

describe("boot/no-body-at-load", () => {
  const warn = (text: string) =>
    analyzeSource("src/modules/a.ts", `${text}\nexport default () => {};\n`)
      .findings.filter((f) => f.rule === "boot/no-body-at-load")
      .map((f) => f.line);

  test("flags reads at the top level and in top-level callbacks' arguments", () => {
    expect(warn("const a = document.body.classList;")).toEqual([1]);
    expect(warn("observer.observe(document.body, {});")).toEqual([1]);
  });

  test("ignores code that runs later and plain checks", () => {
    expect(warn("function f() { return document.body.id; }")).toEqual([]);
    expect(warn("const f = () => document.body.id;")).toEqual([]);
    expect(warn("if (document.body) { /* wait */ }")).toEqual([]);
    expect(warn("const a = document.body?.id;")).toEqual([]);
  });
});

describe("module names", () => {
  test("accepts kebab-case and refuses the rest", () => {
    expect(moduleNameProblem("carousel-slider")).toBeNull();
    expect(moduleNameProblem("nav")).toBeNull();
    expect(moduleNameProblem("test")).toBeNull();
    expect(moduleNameProblem("CarouselSlider")).toContain("kebab-case");
    expect(moduleNameProblem("carousel_slider")).toContain("kebab-case");
    expect(moduleNameProblem("2up")).toContain("kebab-case");
    expect(moduleNameProblem("module")).toContain("generic");
  });
});

describe("every file in a failing fixture is flagged, every one in a passing fixture is clean", () => {
  const files = (dir: string): string[] =>
    (readdirSync(dir, { recursive: true }) as string[])
      .filter((entry) => statSync(path.join(dir, entry)).isFile())
      .map((entry) => entry.split(path.sep).join("/"));

  for (const rule of RULES) {
    test(`${rule}: no failing file slips through unflagged`, () => {
      const dir = path.join(FIXTURES, rule, "fail");
      const flagged = new Set(analyzeRoot(dir).findings.map((f) => f.file));
      for (const file of files(dir)) expect(flagged.has(file)).toBe(true);
    });
  }
});

/** One variant per case, so a miss names the variant. */
describe("syntax variants", () => {
  const rulesOf = (file: string, source: string, prefix = "") =>
    analyzeSource(file, source)
      .findings.map((f) => f.rule)
      .filter((rule) => rule.startsWith(prefix));
  const mod = (
    body: string,
    header = 'import { onDestroy, onEditor } from "@/modules/_";\nimport State from "@lib/hey";\nimport { Raf } from "@lib/subs";\nimport gsap, { SplitText } from "@lib/gsap";'
  ) =>
    `${header}\nexport default function (element: HTMLElement) {\n${body}\n}\n`;

  const failing: Array<[string, string, string, string]> = [
    // [name, file, source, rule]
    [
      "browser: process['env'].X",
      "src/a.ts",
      "export const a = process['env'].X;",
      "browser/no-process-env",
    ],
    [
      "browser: process['env']['X']",
      "src/a.ts",
      "export const a = process['env']['X'];",
      "browser/no-process-env",
    ],
    [
      "browser: (process as any).env.X",
      "src/a.ts",
      "export const a = (process as any).env.X;",
      "browser/no-process-env",
    ],
    [
      "browser: globalThis.process.env.X",
      "src/a.ts",
      "export const a = globalThis.process.env.X;",
      "browser/no-process-env",
    ],
    [
      "browser: window['process'].env.X",
      "src/a.ts",
      "export const a = window['process'].env.X;",
      "browser/no-process-env",
    ],
    [
      "browser: const { env } = process",
      "src/a.ts",
      "const { env } = process;\nexport { env };",
      "browser/no-process-env",
    ],
    [
      "browser: const p = process",
      "src/a.ts",
      "const p = process;\nexport { p };",
      "browser/no-process-env",
    ],
    [
      "browser: const env = process.env",
      "src/a.ts",
      "export const env = process.env;",
      "browser/no-process-env",
    ],
    [
      "browser: process.env[name]",
      "src/a.ts",
      "export const f = (n: string) => process.env[n];",
      "browser/no-process-env",
    ],
    [
      "raw: requestAnimationFrame",
      "src/modules/a.ts",
      mod("  requestAnimationFrame(() => {});"),
      "subs/no-raw",
    ],
    [
      "raw: self.requestAnimationFrame",
      "src/modules/a.ts",
      mod("  self.requestAnimationFrame(() => {});"),
      "subs/no-raw",
    ],
    [
      "raw: window['requestAnimationFrame']",
      "src/modules/a.ts",
      mod("  window['requestAnimationFrame'](() => {});"),
      "subs/no-raw",
    ],
    [
      "raw: const raf = window.requestAnimationFrame",
      "src/modules/a.ts",
      mod("  const raf = window.requestAnimationFrame;\n  raf(() => {});"),
      "subs/no-raw",
    ],
    [
      "raw: const { requestAnimationFrame } = window",
      "src/modules/a.ts",
      mod(
        "  const { requestAnimationFrame } = window;\n  requestAnimationFrame(() => {});"
      ),
      "subs/no-raw",
    ],
    [
      "raw: window.onresize =",
      "src/modules/a.ts",
      mod("  window.onresize = () => {};"),
      "subs/no-raw",
    ],
    [
      "raw: addEventListener('resize')",
      "src/pages/a.js",
      "addEventListener('resize', () => {});",
      "subs/no-raw",
    ],
    [
      "listener: bare addEventListener",
      "src/modules/a.ts",
      mod("  const f = () => {};\n  addEventListener('x', f);"),
      "cleanup/listener",
    ],
    [
      "listener: removed under another event",
      "src/modules/a.ts",
      mod(
        "  const f = () => {};\n  element.addEventListener('click', f);\n  onDestroy(() => element.removeEventListener('mouseenter', f));"
      ),
      "cleanup/listener",
    ],
    [
      "listener: removed from another target",
      "src/modules/a.ts",
      mod(
        "  const f = () => {};\n  element.addEventListener('click', f);\n  onDestroy(() => document.removeEventListener('click', f));"
      ),
      "cleanup/listener",
    ],
    [
      "listener: bare add, removed from element",
      "src/modules/a.ts",
      mod(
        "  const f = () => {};\n  addEventListener('click', f);\n  onDestroy(() => element.removeEventListener('click', f));"
      ),
      "cleanup/listener",
    ],
    [
      "listener: { once: true } is not an exemption",
      "src/modules/a.ts",
      mod("  element.addEventListener('click', () => {}, { once: true });"),
      "cleanup/listener",
    ],
    [
      "listener: signal is not an exemption",
      "src/modules/a.ts",
      mod(
        "  const c = new AbortController();\n  const f = () => {};\n  element.addEventListener('click', f, { signal: c.signal });"
      ),
      "cleanup/listener",
    ],
    [
      "listener: self.setInterval",
      "src/modules/a.ts",
      mod("  self.setInterval(() => {}, 1);"),
      "cleanup/listener",
    ],
    [
      "listener: new window.IntersectionObserver",
      "src/modules/a.ts",
      mod("  new window.IntersectionObserver(() => {});"),
      "cleanup/listener",
    ],
    [
      "state: off with another event",
      "src/modules/a.ts",
      mod(
        "  const f = () => {};\n  State.on('A', f);\n  onDestroy(() => State.off('B', f));"
      ),
      "cleanup/state-listener",
    ],
    [
      "state: off with another handler",
      "src/modules/a.ts",
      mod(
        "  const f = () => {};\n  const g = () => {};\n  State.on('A', f);\n  onDestroy(() => State.off('A', g));"
      ),
      "cleanup/state-listener",
    ],
    [
      "subscription: array literal never drained",
      "src/modules/a.ts",
      mod(
        "  onEditor(() => {});\n  const all = [Raf.add(() => {})];\n  onDestroy(() => { all.length = 0; });"
      ),
      "cleanup/subscription",
    ],
    [
      "subscription: push, drained by another list",
      "src/modules/a.ts",
      mod(
        "  onEditor(() => {});\n  const a: Array<() => void> = [];\n  const b: Array<() => void> = [];\n  a.push(Raf.add(() => {}));\n  onDestroy(() => b.forEach((s) => s()));"
      ),
      "cleanup/subscription",
    ],
    [
      "editor: SplitText.create",
      "src/modules/a.ts",
      mod("  SplitText.create(element);"),
      "editor/handled",
    ],
    [
      "editor: ScrollTrigger-free gsap.timeline chain",
      "src/modules/a.ts",
      mod("  gsap.timeline().to(element, {});"),
      "editor/handled",
    ],
    [
      "gsap: export * from gsap",
      "src/a.ts",
      "export * from 'gsap';",
      "imports/gsap",
    ],
    [
      "gsap: import()",
      "src/a.ts",
      "export const l = () => import('gsap');",
      "imports/gsap",
    ],
    [
      "gsap: require()",
      "src/a.ts",
      "export const l = require('gsap/ScrollTrigger');",
      "imports/gsap",
    ],
    [
      "subs: export from",
      "src/a.ts",
      "export { Raf } from '@/lib/subs';",
      "imports/subs",
    ],
    [
      "lifecycle: export from",
      "src/utils/a.ts",
      "export { onMount } from '../modules/_';",
      "imports/lifecycle",
    ],
    [
      "js module without default export",
      "src/modules/a.js",
      "export const a = 1;",
      "module/default-export",
    ],
    [
      "js module with three parameters",
      "src/modules/a.js",
      "export default function (a, b, c) {}",
      "module/signature",
    ],
    [
      "js module with a bad name",
      "src/modules/Bad_Name.js",
      "export default function () {}",
      "module/filename",
    ],
    [
      "js module leaking a listener",
      "src/modules/a.js",
      "export default function (e) { e.addEventListener('x', () => {}); }",
      "cleanup/listener",
    ],
  ];
  for (const [name, file, source, rule] of failing) {
    test(`flags ${name}`, () => {
      expect(rulesOf(file, source)).toContain(rule);
    });
  }

  const passing: Array<[string, string, string]> = [
    [
      "process.env.NODE_ENV through a cast",
      "src/a.ts",
      "export const a = (process as any).env.NODE_ENV;",
    ],
    [
      "import type from gsap",
      "src/a.ts",
      "import type { gsap } from 'gsap';\nexport type G = typeof gsap;",
    ],
    ["export type from gsap", "src/a.ts", "export type { Tween } from 'gsap';"],
    [
      "a gsap import inside src/lib/gsap.ts",
      "src/lib/gsap.ts",
      "import gsap from 'gsap';\nexport default gsap;\nexport const l = () => import('gsap');",
    ],
    [
      "bare add and bare remove",
      "src/modules/a.ts",
      mod(
        "  const f = () => {};\n  addEventListener('x', f);\n  onDestroy(() => removeEventListener('x', f));"
      ),
    ],
    [
      "add on self, remove on window",
      "src/modules/a.ts",
      mod(
        "  const f = () => {};\n  self.addEventListener('x', f);\n  onDestroy(() => window.removeEventListener('x', f));"
      ),
    ],
    [
      "a state on and off with the same event and handler",
      "src/modules/a.ts",
      mod(
        "  const f = () => {};\n  State.on('A', f);\n  onDestroy(() => State.off('A', f));"
      ),
    ],
    [
      "subscriptions pushed and released with any loop variable",
      "src/modules/a.ts",
      mod(
        "  onEditor(() => {});\n  const subs: Array<() => void> = [];\n  subs.push(Raf.add(() => {}), Raf.add(() => {}));\n  onDestroy(() => {\n    subs.forEach((unsubscribe) => unsubscribe());\n  });"
      ),
    ],
    [
      "a list literal released with forEach",
      "src/modules/a.ts",
      mod(
        "  onEditor(() => {});\n  const subs = [Raf.add(() => {}), Raf.add(() => {})];\n  onDestroy(() => subs.forEach((u) => u()));"
      ),
    ],
    [
      "a list released with for...of",
      "src/modules/a.ts",
      mod(
        "  onEditor(() => {});\n  const subs = [Raf.add(() => {})];\n  onDestroy(() => {\n    for (const s of subs) s();\n  });"
      ),
    ],
    [
      "observers released with forEach",
      "src/modules/a.ts",
      mod(
        "  const observers: MutationObserver[] = [];\n  observers.push(new MutationObserver(() => {}));\n  onDestroy(() => observers.forEach((o) => o.disconnect()));"
      ),
    ],
    [
      "a reassigned subscription released by name",
      "src/modules/a.ts",
      mod(
        "  onEditor(() => {});\n  let s = Raf.add(() => {});\n  s = Raf.add(() => {});\n  onDestroy(s);"
      ),
    ],
    [
      "intervals released with forEach(clearInterval)",
      "src/modules/a.ts",
      mod(
        "  const ids: number[] = [];\n  ids.push(window.setInterval(() => {}, 1));\n  onDestroy(() => ids.forEach(clearInterval));"
      ),
    ],
    [
      "a js module that cleans up",
      "src/modules/a.js",
      "import { onDestroy } from '@/modules/_';\nexport default function (e) { const f = () => {}; e.addEventListener('x', f); onDestroy(() => e.removeEventListener('x', f)); }",
    ],
  ];
  for (const [name, file, source] of passing) {
    test(`accepts ${name}`, () => {
      expect(rulesOf(file, source)).toEqual([]);
    });
  }
});

describe("limits", () => {
  test("are listed for the docs", () => {
    expect(LIMITS.length).toBeGreaterThan(5);
    for (const limit of LIMITS) expect(limit.endsWith(".")).toBe(true);
  });
});
