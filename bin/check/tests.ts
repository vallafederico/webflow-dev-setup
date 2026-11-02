import { exec, excerpt, localBin } from "./tools";
import { type Check, type Finding, ToolFailure, toResult } from "./types";

/** Set for the test run, so a test that starts `pnpm check` is refused. */
export const NESTED_ENV = "AGENT_CHECK_ACTIVE";

export const tests: Check = {
  name: "tests",
  tier: "fast",
  async run({ root }) {
    // "./bin/" is a path prefix. A bare "bin" would match any path containing
    // those letters.
    const result = await exec(
      [
        localBin(root, "bun"),
        "test",
        "./bin/",
        "--path-ignore-patterns",
        "**/fixtures/**",
      ],
      { cwd: root, env: { [NESTED_ENV]: "1" } }
    );
    const output = `${result.stderr}\n${result.stdout}`;

    const findings: Finding[] = [];
    let file = "";
    for (const line of output.split("\n")) {
      const header = /^(\S+\.test\.[tj]sx?):\s*$/.exec(line);
      if (header) file = header[1] as string;
      const failed = /^\(fail\) (.+?)(?: \[[\d.]+ms\])?$/.exec(line);
      if (failed) {
        findings.push({
          rule: "tests/failed",
          severity: "error",
          file: file || "bin",
          line: 1,
          message: `Test failed: ${failed[1]}`,
          fix: `Run bun test ${file ? `./${file}` : "./bin/"} and fix the failing assertion`,
        });
      }
    }

    // bun exits non-zero for failures and for a run that never started, such
    // as a file that doesn't compile. Only the failures are findings.
    const summary = /^\s*(\d+) pass\s*$/m.test(output);
    if (result.code !== 0 && findings.length === 0) {
      if (!summary) {
        throw new ToolFailure(
          `bun test did not run (exit ${result.code}): ${excerpt(output)}`
        );
      }
      findings.push({
        rule: "tests/failed",
        severity: "error",
        file: "bin",
        line: 1,
        message: `bun test exited ${result.code}: ${excerpt(output, 3)}`,
        fix: "Run bun test ./bin/ and fix what it reports",
      });
    }
    return toResult("tests", findings);
  },
};
