import { exec, excerpt, localBin, relativeTo } from "./tools";
import { type Check, type Finding, ToolFailure, toResult } from "./types";

// "src/a.ts(12,5): error TS2322: Type 'x' is not assignable to type 'y'."
const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;

export const types: Check = {
  name: "types",
  tier: "fast",
  async run({ root }) {
    const result = await exec(
      [localBin(root, "tsc"), "--noEmit", "-p", ".", "--pretty", "false"],
      { cwd: root }
    );

    const findings: Finding[] = [];
    let last: Finding | undefined;
    for (const line of result.stdout.split("\n")) {
      const match = DIAGNOSTIC.exec(line);
      if (match) {
        const [, file, row, , code, message] = match;
        last = {
          rule: `tsc/${code}`,
          severity: "error",
          file: relativeTo(root, file as string),
          line: Number(row),
          message: message as string,
          fix: `Change the code so it type checks, then run ./node_modules/.bin/tsc --noEmit -p . (${code})`,
        };
        findings.push(last);
      } else if (last && /^\s+\S/.test(line)) {
        // Continuation lines belong to the previous message.
        last.message += ` ${line.trim()}`;
      } else {
        last = undefined;
      }
    }

    // A broken tsconfig is reported against the file like any other error,
    // but nothing was type checked, so it is the tool that failed.
    const config = findings.find((finding) =>
      /(^|\/)tsconfig[^/]*\.json$/.test(finding.file)
    );
    if (config) {
      throw new ToolFailure(`${config.file}:${config.line} ${config.message}`, {
        file: config.file,
        fix: "Fix the syntax or options in tsconfig.json",
      });
    }

    // A non-zero exit with nothing parsed, such as TS5083 for an unreadable
    // tsconfig.json, means tsc didn't check the code.
    if (result.code !== 0 && findings.length === 0) {
      throw new ToolFailure(
        `tsc failed without type errors (exit ${result.code}): ${excerpt(result.stdout || result.stderr)}`,
        { file: "tsconfig.json" }
      );
    }
    return toResult("types", findings);
  },
};
