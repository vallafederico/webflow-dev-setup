import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ToolFailure } from "./types";

export const CHECKS_CONFIG_FILE = "checks.config.json";

export interface ChecksConfig {
  /** True once the project has enabled Taxi, which turns on the navigation step. */
  taxi: boolean;
  /** How long a page hook may run before the leak test calls it hung. */
  hookTimeoutMs: number;
  /** Gzip bytes per built entry. Keys are dist-relative paths or globs. */
  budgets: Record<string, number>;
}

const KEYS = ["taxi", "hookTimeoutMs", "budgets"];
const DEFAULT_HOOK_TIMEOUT_MS = 10_000;

/**
 * Reads checks.config.json. A typo here would silently switch a check off, so
 * an unknown key or a wrong type is a tool failure, not a default.
 */
export function readChecksConfig(root: string): ChecksConfig {
  const file = path.join(root, CHECKS_CONFIG_FILE);
  const fail = (message: string): never => {
    throw new ToolFailure(`${CHECKS_CONFIG_FILE} ${message}`, {
      file: CHECKS_CONFIG_FILE,
      fix: `Fix ${CHECKS_CONFIG_FILE}: keys are ${KEYS.join(", ")}`,
    });
  };
  if (!existsSync(file)) return fail("is missing");

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return fail(`is not valid JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return fail("must be a JSON object");
  }
  const config = parsed as Record<string, unknown>;

  const unknown = Object.keys(config).filter((key) => !KEYS.includes(key));
  if (unknown.length > 0)
    return fail(`has unknown keys: ${unknown.join(", ")}`);

  const taxi = config.taxi ?? false;
  if (typeof taxi !== "boolean") return fail("taxi must be true or false");

  const hookTimeoutMs = config.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
  if (
    typeof hookTimeoutMs !== "number" ||
    !Number.isInteger(hookTimeoutMs) ||
    hookTimeoutMs < 100
  ) {
    return fail("hookTimeoutMs must be a whole number of milliseconds");
  }

  const budgets = config.budgets;
  if (
    typeof budgets !== "object" ||
    budgets === null ||
    Array.isArray(budgets)
  ) {
    return fail("budgets must be an object of gzip byte budgets");
  }
  for (const [key, value] of Object.entries(budgets)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return fail(`budgets["${key}"] must be a positive number of bytes`);
    }
  }
  return { taxi, hookTimeoutMs, budgets: budgets as Record<string, number> };
}
