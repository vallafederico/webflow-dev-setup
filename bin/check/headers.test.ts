import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HEADERS_FILE } from "../build";
import {
  diffRules,
  parseHeadersFile,
  vercelRules,
  vercelSourceToPattern,
} from "./headers";

const vercel = JSON.parse(
  readFileSync(path.resolve(import.meta.dir, "..", "..", "vercel.json"), "utf8")
);

describe("vercelSourceToPattern", () => {
  test.each([
    ["/(.*)", "/*"],
    ["/(.*\\.glb)", "/*.glb"],
    ["/(.*\\.gltf)", "/*.gltf"],
    ["/fonts/(.*)", null],
    ["/(a|b)", null],
  ])("%s", (source, expected) => {
    expect(vercelSourceToPattern(source)).toBe(expected);
  });
});

describe("the real rules", () => {
  test("the build's _headers matches vercel.json today", () => {
    const expected = vercelRules(vercel.headers);
    expect(expected.unsupported).toEqual([]);
    expect(diffRules(expected.rules, parseHeadersFile(HEADERS_FILE))).toEqual(
      []
    );
  });
});

describe("diffRules", () => {
  const rules = (text: string) => parseHeadersFile(text);
  const base = rules("/*\n  A: 1\n  B: 2\n");

  test("equal rules have no difference, whatever the case or order", () => {
    expect(diffRules(base, rules("# c\n/*\n  b: 2\n  a: 1\n"))).toEqual([]);
  });

  test("names a changed value, a missing header and an extra header", () => {
    expect(diffRules(base, rules("/*\n  A: 9\n  C: 3\n"))).toEqual([
      '/*: a is "9", vercel.json has "1"',
      "/*: missing header b: 2",
      "/*: extra header c: 3",
    ]);
  });

  test("names a missing and an extra pattern", () => {
    expect(diffRules(base, rules("/*.glb\n  A: 1\n"))).toEqual([
      "/* is missing",
      "/*.glb has rules that vercel.json does not have",
    ]);
  });
});
