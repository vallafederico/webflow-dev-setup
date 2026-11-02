import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readChecksConfig } from "./checks-config";
import { ToolFailure } from "./types";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function repo(config?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "checks-config-"));
  dirs.push(root);
  if (config !== undefined) {
    writeFileSync(path.join(root, "checks.config.json"), config);
  }
  return root;
}

describe("readChecksConfig", () => {
  test("reads the repo's own file", () => {
    const config = readChecksConfig(path.resolve(import.meta.dir, "..", ".."));
    expect(config.taxi).toBe(false);
    expect(config.budgets["app.js"]).toBeGreaterThan(0);
  });

  test("fills in defaults", () => {
    const config = readChecksConfig(repo('{"budgets":{"app.js":1}}'));
    expect(config).toEqual({
      taxi: false,
      hookTimeoutMs: 10000,
      budgets: { "app.js": 1 },
    });
  });

  test.each([
    ["a missing file", undefined],
    ["invalid JSON", "{"],
    ["an array", "[]"],
    [
      "a typo in a key, which would switch a check off",
      '{"Taxi":true,"budgets":{}}',
    ],
    ["a string for taxi", '{"taxi":"yes","budgets":{}}'],
    ["a tiny hook timeout", '{"hookTimeoutMs":5,"budgets":{}}'],
    ["no budgets", "{}"],
    ["a budget that is not a number", '{"budgets":{"app.js":"big"}}'],
    ["a zero budget", '{"budgets":{"app.js":0}}'],
  ])("%s is a tool failure, not a default", (_name, text) => {
    expect(() => readChecksConfig(repo(text))).toThrow(ToolFailure);
  });
});
