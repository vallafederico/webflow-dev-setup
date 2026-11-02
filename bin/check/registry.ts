import { format, lint } from "./biome";
import { houseRules } from "./house-rules";
import { skills } from "./skills";
import { tests } from "./tests";
import type { Check } from "./types";
import { types } from "./tsc";

/**
 * Every check, in the order it is reported. Add tier "all" checks (bundle,
 * host, runtime) to the end of this array.
 */
export const checks: Check[] = [format, lint, types, houseRules, skills, tests];
