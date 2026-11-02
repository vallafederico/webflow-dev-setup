import { findDrift } from "../sync-skills";
import { type Check, type Finding, toResult } from "./types";

const MESSAGES = {
  missing: "is missing, so agents using this folder don't get the skill",
  different:
    "differs from the .claude/skills source, so agents get stale advice",
  extra: "has no source in .claude/skills",
} as const;

export const skills: Check = {
  name: "skills",
  tier: "fast",
  async run({ root }) {
    const findings: Finding[] = findDrift(root).map((item) => ({
      rule: `skills/${item.kind === "different" ? "drift" : item.kind}`,
      severity: item.kind === "extra" ? "warning" : "error",
      file: item.file,
      line: 1,
      message: `${item.file} ${MESSAGES[item.kind]}`,
      fix:
        item.kind === "extra"
          ? `Move it into ${item.source} if it should stay, or delete it`
          : "Edit only .claude/skills, then run pnpm sync:skills",
    }));
    return toResult("skills", findings);
  },
};
