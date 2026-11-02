import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { exec, excerpt, localBin } from "./tools";
import { type Check, type Finding, ToolFailure, toResult } from "./types";

/** What the build check saw per repo, so the checks after it know whether dist/ can be trusted. */
const outcomes = new Map<string, "ok" | "failed">();

export const MANIFEST_FILE = path.join("dist", "build-manifest.json");

/**
 * Called first by every check that reads dist/. A failed build leaves no
 * output worth reading, and reading an older dist/ would pass code that no
 * longer builds, so it is a tool failure and not a pass.
 */
export function requireBuild(root: string): void {
  if (outcomes.get(root) === "failed") {
    throw new ToolFailure(
      "the production build failed, so there is no dist/ to check",
      {
        fix: "Fix the build error the build check reports, then run pnpm check:all again",
      }
    );
  }
  // Run on its own, nothing here proves dist/ is current. It must at least exist.
  if (!outcomes.has(root) && !existsSync(path.join(root, MANIFEST_FILE))) {
    throw new ToolFailure(
      `${MANIFEST_FILE} is missing, so there is no build to check`,
      {
        fix: "Run pnpm build, or run pnpm check:all, which builds first",
      }
    );
  }
}

/** The first `src/...` or `api/...` path named in a tool's output, to point the finding at. */
function blameFile(output: string): string {
  const match = /\b((?:src|api|bin)\/[\w./@-]+\.(?:ts|js|css))/.exec(output);
  return match ? (match[1] as string) : "bin/build.ts";
}

export const build: Check = {
  name: "build",
  tier: "all",
  async run({ root }) {
    outcomes.delete(root);
    // Stale output would let a build that no longer produces a file keep
    // passing on the copy from an earlier build.
    await rm(path.join(root, "dist"), { recursive: true, force: true });
    await rm(path.join(root, ".generated"), { recursive: true, force: true });

    const result = await exec([localBin(root, "bun"), "run", "bin/build.ts"], {
      cwd: root,
      env: { NODE_ENV: "production" },
    });
    const output = `${result.stderr}\n${result.stdout}`;

    const findings: Finding[] = [];
    const fail = (message: string, fix: string, file = "bin/build.ts") => {
      findings.push({
        rule: "build/failed",
        severity: "error",
        file,
        line: 1,
        message,
        fix,
      });
    };

    if (result.code !== 0) {
      fail(
        `pnpm build exited ${result.code}: ${excerpt(output, 3)}`,
        "Run pnpm build and fix the error it prints",
        blameFile(output)
      );
    } else {
      let entries = 0;
      try {
        const manifest = JSON.parse(
          readFileSync(path.join(root, MANIFEST_FILE), "utf8")
        );
        for (const file of manifest.javascript?.files ?? []) {
          if (!String(file.path).endsWith(".js")) continue;
          entries += 1;
          if (!existsSync(path.join(root, "dist", file.path))) {
            fail(
              `build-manifest.json lists dist/${file.path}, which was not written`,
              "Run pnpm build and check that every entry in src/ is built"
            );
          }
        }
      } catch {
        fail(
          `pnpm build exited 0 but wrote no readable ${MANIFEST_FILE}`,
          "Run pnpm build and read its output"
        );
      }
      if (entries === 0 && findings.length === 0) {
        fail(
          "pnpm build exited 0 but built no JavaScript entry",
          "Make sure src/app.ts exists, then run pnpm build"
        );
      }
    }

    outcomes.set(root, findings.length === 0 ? "ok" : "failed");
    return toResult("build", findings);
  },
};
