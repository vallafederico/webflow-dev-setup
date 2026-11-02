import path from "node:path";
import { checks as registry } from "./registry";
import { NESTED_ENV } from "./tests";
import {
  type Check,
  type CheckContext,
  type CheckResult,
  type Finding,
  ToolFailure,
} from "./types";

export interface RunOutcome {
  /** One entry per check, in registry order. */
  results: CheckResult[];
  /** Checks whose tool broke, by name, with the reason. */
  failures: Map<string, string>;
}

const TOOL_FAILURE_RULE = "tool/failure";

function scrub(text: string, root: string): string {
  return text.split(`${root}${path.sep}`).join("").split(root).join(".");
}

function byLocation(a: Finding, b: Finding): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

/**
 * Runs the checks and returns them in registry order. They run concurrently,
 * unless `sequential` is set for checks that depend on each other's output.
 */
export async function runChecks(
  checks: Check[],
  ctx: CheckContext,
  { sequential = false }: { sequential?: boolean } = {}
): Promise<RunOutcome> {
  const failures = new Map<string, string>();
  const runOne = async (check: Check): Promise<CheckResult> => {
    try {
      const result = await check.run(ctx);
      return {
        name: check.name,
        ok: result.ok,
        findings: result.findings
          .map((finding) => ({
            rule: finding.rule,
            severity: finding.severity,
            file: finding.file,
            line: finding.line,
            message: scrub(finding.message, ctx.root),
            fix: scrub(finding.fix, ctx.root),
          }))
          .sort(byLocation),
      };
    } catch (error) {
      // A crash is a tool failure too, so it can't read as a pass.
      const failure =
        error instanceof ToolFailure
          ? error
          : new ToolFailure(
              `${check.name} crashed: ${(error as Error)?.message ?? String(error)}`
            );
      const message = scrub(failure.message, ctx.root);
      failures.set(check.name, message);
      return {
        name: check.name,
        ok: false,
        findings: [
          {
            rule: TOOL_FAILURE_RULE,
            severity: "error",
            file: failure.file,
            line: 1,
            message,
            fix: failure.fix,
          },
        ],
      };
    }
  };
  const results: CheckResult[] = [];
  if (sequential) {
    for (const check of checks) results.push(await runOne(check));
  } else {
    results.push(...(await Promise.all(checks.map(runOne))));
  }
  return { results, failures };
}

export function exitCodeFor(outcome: RunOutcome): 0 | 1 | 2 {
  if (outcome.failures.size > 0) return 2;
  return outcome.results.every((result) => result.ok) ? 0 : 1;
}

export function toJson(outcome: RunOutcome): string {
  return `${JSON.stringify(
    {
      ok: exitCodeFor(outcome) === 0,
      checks: outcome.results.map(({ name, ok, findings }) => ({
        name,
        ok,
        findings,
      })),
    },
    null,
    2
  )}\n`;
}

const HUMAN_LIMIT = 25;

export function toHuman(outcome: RunOutcome): string {
  const lines: string[] = [];
  let errors = 0;
  let warnings = 0;
  for (const result of outcome.results) {
    const errorCount = result.findings.filter(
      (f) => f.severity === "error"
    ).length;
    const warningCount = result.findings.length - errorCount;
    errors += errorCount;
    warnings += warningCount;

    const broke = outcome.failures.has(result.name);
    const mark = broke ? "TOOL FAILED" : result.ok ? "ok" : "FAIL";
    const counts = [
      errorCount ? `${errorCount} error${errorCount === 1 ? "" : "s"}` : "",
      warningCount
        ? `${warningCount} warning${warningCount === 1 ? "" : "s"}`
        : "",
    ].filter(Boolean);
    lines.push(
      `${mark.padEnd(5)} ${result.name}${counts.length ? ` (${counts.join(", ")})` : ""}`
    );

    // Errors first, so a long list of warnings can't hide them.
    const shown = [...result.findings].sort(
      (a, b) => Number(b.severity === "error") - Number(a.severity === "error")
    );
    for (const finding of shown.slice(0, HUMAN_LIMIT)) {
      const where = finding.file ? `${finding.file}:${finding.line}` : "-";
      const tag = finding.severity === "warning" ? "warning " : "";
      lines.push(`  ${tag}${finding.rule}  ${where}`);
      lines.push(`    ${finding.message}`);
      lines.push(`    fix: ${finding.fix}`);
    }
    if (shown.length > HUMAN_LIMIT) {
      lines.push(
        `  ... ${shown.length - HUMAN_LIMIT} more, run pnpm check --json for all`
      );
    }
  }

  const code = exitCodeFor(outcome);
  lines.push("");
  lines.push(
    code === 2
      ? `A tool failed (${[...outcome.failures.keys()].join(", ")}). This is not a pass.`
      : code === 1
        ? `Failed: ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`
        : `Passed${warnings ? ` with ${warnings} warning${warnings === 1 ? "" : "s"}` : ""}`
  );
  return `${lines.join("\n")}\n`;
}

const USAGE = "Usage: pnpm check [--all] [--only <check>] [--json]";

export async function main(argv: string[]): Promise<number> {
  let all = false;
  let json = false;
  let only: string | undefined;
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--all") all = true;
    else if (arg === "--json") json = true;
    else if (arg === "--only") {
      only = argv[++i];
      if (!only) {
        process.stderr.write(`--only needs a check name. ${USAGE}\n`);
        return 2;
      }
    } else unknown.push(arg);
  }
  if (unknown.length > 0) {
    process.stderr.write(`Unknown option ${unknown.join(" ")}. ${USAGE}\n`);
    return 2;
  }
  if (process.env[NESTED_ENV]) {
    process.stderr.write(
      "pnpm check was started from inside the check's own test run, which would recurse. Don't run it from a test.\n"
    );
    return 2;
  }
  const root = path.resolve(import.meta.dir, "..", "..");

  // One check on its own, such as `pnpm check:runtime`. Same output and exit codes.
  if (only) {
    const check = registry.find((candidate) => candidate.name === only);
    if (!check) {
      process.stderr.write(
        `No check named ${only}. They are: ${registry.map((c) => c.name).join(", ")}\n`
      );
      return 2;
    }
    const outcome = await runChecks([check], { root, all: true });
    process.stdout.write(json ? toJson(outcome) : toHuman(outcome));
    return exitCodeFor(outcome);
  }

  // Without any tier "all" check, --all would run only the fast ones and
  // still read as the full pass agents rely on before finishing.
  if (all && !registry.some((check) => check.tier === "all")) {
    process.stderr.write(
      "pnpm check:all has no tier-all checks registered (build, bundle, host, runtime), so it can't give the full result. Not a pass.\n"
    );
    return 2;
  }
  const selected = registry.filter((check) => all || check.tier === "fast");
  // The fast checks are independent. The rest build and read dist/, so they
  // run after them, one at a time and in registry order.
  const fast = await runChecks(
    selected.filter((check) => check.tier === "fast"),
    { root, all }
  );
  const slow = await runChecks(
    selected.filter((check) => check.tier === "all"),
    { root, all },
    { sequential: true }
  );
  const outcome: RunOutcome = {
    results: [...fast.results, ...slow.results],
    failures: new Map([...fast.failures, ...slow.failures]),
  };
  process.stdout.write(json ? toJson(outcome) : toHuman(outcome));
  return exitCodeFor(outcome);
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
