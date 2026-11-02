import path from "node:path";
import { exitCodeFor, runChecks, toHuman, toJson } from "./index";
import type { Check } from "./types";

/** Runs one check on its own and prints it like `pnpm check` does. */
export async function main(check: Check, argv: string[]): Promise<number> {
  const unknown = argv.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    process.stderr.write(
      `Unknown option ${unknown.join(" ")}. Usage: [--json]\n`
    );
    return 2;
  }
  const root = path.resolve(import.meta.dir, "..", "..");
  const outcome = await runChecks([check], { root, all: true });
  process.stdout.write(
    argv.includes("--json") ? toJson(outcome) : toHuman(outcome)
  );
  return exitCodeFor(outcome);
}
