import { format, lint } from "./biome";
import { build } from "./build";
import { bundle } from "./bundle";
import { host } from "./host";
import { houseRules } from "./house-rules";
import { runtime } from "./runtime";
import { skills } from "./skills";
import { tests } from "./tests";
import type { Check } from "./types";
import { types } from "./tsc";

/**
 * Every check, in the order it is reported. The tier "all" checks run one
 * after another, in this order, after the fast ones: `build` first, because
 * `bundle` and `host` read the dist/ it writes.
 */
export const checks: Check[] = [
  format,
  lint,
  types,
  houseRules,
  skills,
  tests,
  build,
  bundle,
  host,
  runtime,
];
