import { exec, excerpt, localBin, relativeTo } from "./tools";
import { type Check, type Finding, ToolFailure, toResult } from "./types";

interface BiomeDiagnostic {
  severity: "fatal" | "error" | "warning" | "information" | "info";
  message: string;
  category: string | null;
  location?: {
    path?: string;
    start?: { line: number; column: number };
  };
}

interface BiomeReport {
  diagnostics: BiomeDiagnostic[];
  summary?: { changed?: number };
}

/**
 * Runs `biome <command>` through its JSON reporter. A report that can't be
 * parsed means Biome never got as far as checking code, which is a tool
 * failure, such as an invalid biome.json.
 */
export async function runBiomeReport(
  root: string,
  args: string[]
): Promise<BiomeReport> {
  const bin = localBin(root, "biome");
  const result = await exec(
    [bin, ...args, "--reporter=json", "--max-diagnostics=none", "--colors=off"],
    { cwd: root }
  );

  let report: BiomeReport;
  try {
    report = JSON.parse(result.stdout) as BiomeReport;
  } catch {
    throw new ToolFailure(
      `biome ${args[0]} produced no report (exit ${result.code}): ${excerpt(result.stderr || result.stdout)}`,
      { file: "biome.json", fix: "Fix biome.json so that biome can run" }
    );
  }
  if (!Array.isArray(report.diagnostics)) {
    throw new ToolFailure(`biome ${args[0]} returned an unexpected report`);
  }

  // Biome failed (exit 2+, or 1 with nothing to show for it) without pointing
  // at any file: it didn't check the code.
  const located = report.diagnostics.some(
    (diagnostic) =>
      diagnostic.location?.path &&
      (diagnostic.severity === "error" || diagnostic.severity === "fatal")
  );
  if (result.code !== 0 && !located) {
    throw new ToolFailure(
      `biome ${args[0]} exited ${result.code} but reported no error in any file: ${excerpt(result.stderr || result.stdout)}`,
      { file: "biome.json" }
    );
  }

  // Anything that isn't about the code itself, such as a configuration or
  // internal error, means the tool is broken.
  for (const diagnostic of report.diagnostics) {
    const category = diagnostic.category ?? "";
    const isError =
      diagnostic.severity === "fatal" || diagnostic.severity === "error";
    if (isError && !isCodeCategory(category)) {
      throw new ToolFailure(
        `biome ${args[0]} failed: ${category || "unknown"}: ${diagnostic.message}`,
        { file: "biome.json" }
      );
    }
  }
  return report;
}

export async function runBiome(
  root: string,
  args: string[]
): Promise<BiomeDiagnostic[]> {
  return (await runBiomeReport(root, args)).diagnostics;
}

function isCodeCategory(category: string): boolean {
  return (
    category === "format" ||
    category === "parse" ||
    category.startsWith("lint/") ||
    category.startsWith("assist/") ||
    category.startsWith("suppressions/") ||
    category.startsWith("parse/")
  );
}

function biomeRuleUrl(category: string): string {
  const name = category.split("/").pop() ?? category;
  const kebab = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return `https://biomejs.dev/linter/rules/${kebab}`;
}

const LINT_FIXES: Record<string, string> = {
  "lint/correctness/noUnusedImports": "Delete the unused import, or use it",
  "lint/correctness/noUnusedVariables":
    "Delete the unused variable, or rename it with a leading _ if it must stay",
  "lint/correctness/noUnusedPrivateClassMembers":
    "Delete the unused private member, or use it",
  "lint/style/useConst": "Change let to const, which pnpm fix does",
};

function lintFix(category: string): string {
  return (
    LINT_FIXES[category] ??
    `Edit this line to satisfy ${category}, then check ${biomeRuleUrl(category)} for the preferred form`
  );
}

export const format: Check = {
  name: "format",
  tier: "fast",
  async run({ root }) {
    const diagnostics = await runBiome(root, ["format"]);
    const findings: Finding[] = [];
    for (const diagnostic of diagnostics) {
      const file = diagnostic.location?.path;
      // Syntax errors are reported by the lint check, so they show up once.
      if (diagnostic.category !== "format" || !file) continue;
      findings.push({
        rule: "format",
        severity: "error",
        file: relativeTo(root, file),
        line: 1,
        message: "File is not formatted the way Biome prints it",
        fix: "Run pnpm fix",
      });
    }
    return toResult("format", findings);
  },
};

export const lint: Check = {
  name: "lint",
  tier: "fast",
  async run({ root }) {
    const diagnostics = await runBiome(root, ["lint"]);
    const findings: Finding[] = [];
    for (const diagnostic of diagnostics) {
      const category = diagnostic.category ?? "";
      const file = diagnostic.location?.path;
      if (category === "format" || !file) continue;
      // Info is style advice, not a finding.
      if (
        diagnostic.severity !== "error" &&
        diagnostic.severity !== "fatal" &&
        diagnostic.severity !== "warning"
      ) {
        continue;
      }
      const isParse = category === "parse" || category.startsWith("parse/");
      findings.push({
        rule: isParse ? "parse" : category,
        severity: diagnostic.severity === "warning" ? "warning" : "error",
        file: relativeTo(root, file),
        line: diagnostic.location?.start?.line || 1,
        message: diagnostic.message,
        fix: isParse ? "Fix the syntax error at this line" : lintFix(category),
      });
    }
    return toResult("lint", findings);
  },
};
