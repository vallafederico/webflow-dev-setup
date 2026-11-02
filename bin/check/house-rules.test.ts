import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  analyzeRoot,
  analyzeSource,
  applyEdits,
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
