export type Severity = "error" | "warning";

/** One problem, in the shape agents read from `--json`. */
export interface Finding {
  rule: string;
  severity: Severity;
  /** Repo-relative path with forward slashes. */
  file: string;
  /** 1-based. Use 1 when the tool can't say. */
  line: number;
  message: string;
  /** A concrete instruction for fixing it, never "see docs". */
  fix: string;
}

export interface CheckResult {
  name: string;
  /** True when there is no error finding. Warnings don't fail a check. */
  ok: boolean;
  findings: Finding[];
}

export interface CheckContext {
  /** Absolute path of the repo being checked. */
  root: string;
  /** True for `--all`, which includes tier "all" checks. */
  all: boolean;
}

export interface Check {
  name: string;
  tier: "fast" | "all";
  run(ctx: CheckContext): Promise<CheckResult>;
}

/**
 * Thrown when the tool itself broke: a crash, an invalid config or a missing
 * binary. It is not a finding about the code, so it exits 2 instead of 1.
 */
export class ToolFailure extends Error {
  readonly file: string;
  readonly fix: string;

  constructor(message: string, options: { file?: string; fix?: string } = {}) {
    super(message);
    this.name = "ToolFailure";
    this.file = options.file ?? "";
    this.fix =
      options.fix ?? "Fix the tool or its config, then run pnpm check again";
  }
}

export function toResult(name: string, findings: Finding[]): CheckResult {
  return {
    name,
    ok: !findings.some((finding) => finding.severity === "error"),
    findings,
  };
}
