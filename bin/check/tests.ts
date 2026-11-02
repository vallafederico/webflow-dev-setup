import { exec, excerpt, localBin } from "./tools";
import { type Check, type Finding, ToolFailure, toResult } from "./types";

/** Set for the test run, so a test that starts `pnpm check` is refused. */
export const NESTED_ENV = "AGENT_CHECK_ACTIVE";

/** Folders that may hold tests. "./x/" is a path prefix, not a substring. */
const TEST_PATHS = ["./bin/", "./src/", "./api/"];

/** Pulls a count out of bun's summary, such as " 12 pass". */
function count(output: string, label: string): number | null {
  const match = new RegExp(`^\\s*(\\d+) ${label}\\s*$`, "m").exec(output);
  return match ? Number(match[1]) : null;
}

export const tests: Check = {
  name: "tests",
  tier: "fast",
  async run({ root }) {
    const result = await exec(
      [
        localBin(root, "bun"),
        "test",
        ...TEST_PATHS,
        "--path-ignore-patterns",
        "**/fixtures/**",
      ],
      { cwd: root, env: { [NESTED_ENV]: "1" } }
    );
    const output = `${result.stderr}\n${result.stdout}`;

    // Only bun's closing line proves the run reached its end. A test that
    // calls process.exit(0) leaves no such line, however it exits.
    if (!/^Ran \d+ tests? across \d+ files?/m.test(output)) {
      throw new ToolFailure(
        `bun test did not finish (exit ${result.code}), so its result can't be trusted: ${excerpt(output)}`,
        {
          fix: "Remove process.exit and anything else that stops the test run early, then run ./node_modules/.bin/bun test ./bin/ ./src/ ./api/",
        }
      );
    }
    const passed = count(output, "pass") ?? 0;
    const failed = count(output, "fail") ?? 0;
    if (passed === 0 && failed === 0) {
      throw new ToolFailure(
        "bun test ran but no test passed. Tests that are skipped, todo or missing prove nothing",
        { fix: "Add a test that runs and passes, and unskip the others" }
      );
    }

    const findings: Finding[] = [];
    let file = "";
    for (const line of output.split("\n")) {
      const header = /^(\S+\.test\.[tj]sx?):\s*$/.exec(line);
      if (header) file = header[1] as string;
      const failure = /^\(fail\) (.+?)(?: \[[\d.]+ms\])?$/.exec(line);
      if (failure) {
        findings.push({
          rule: "tests/failed",
          severity: "error",
          file: file || "bin",
          line: 1,
          message: `Test failed: ${failure[1]}`,
          fix: `Run ./node_modules/.bin/bun test ${file ? `./${file}` : "./bin/"} and fix the failing assertion`,
        });
      }
    }

    // Failures bun counted but didn't name, and errors thrown between tests.
    if (findings.length === 0 && (failed > 0 || result.code !== 0)) {
      findings.push({
        rule: "tests/failed",
        severity: "error",
        file: "bin",
        line: 1,
        message: `bun test exited ${result.code} with ${failed} failing: ${excerpt(output, 3)}`,
        fix: "Run ./node_modules/.bin/bun test ./bin/ ./src/ ./api/ and fix what it reports",
      });
    }
    return toResult("tests", findings);
  },
};
