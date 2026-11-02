import {
  constants,
  cpSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { onTerminate } from "./cleanup";
import { exec, excerpt, localBin } from "./tools";

/**
 * Wrangler runs in a temp copy of the project, because it writes `.wrangler/`
 * next to its config and the test files below must never reach the repo.
 * `api/` and `node_modules` are linked, since wrangler only reads them.
 */
export function makeSandbox(root: string): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(path.join(tmpdir(), "wrangler-check-"));
  const copy = (name: string) => {
    const from = path.join(root, name);
    if (existsSync(from)) {
      cpSync(from, path.join(dir, name), {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
      });
    }
  };
  for (const name of ["wrangler.jsonc", "dist", ".generated"]) copy(name);
  for (const name of ["api", "node_modules", "package.json"]) {
    const from = path.join(root, name);
    if (existsSync(from)) symlinkSync(from, path.join(dir, name));
  }
  const remove = () => rmSync(dir, { recursive: true, force: true });
  const forget = onTerminate(remove);
  return {
    dir,
    cleanup: () => {
      forget();
      remove();
    },
  };
}

/** No account tokens, so a check can never reach a real account, and no telemetry. */
export function wranglerEnv(sandbox: string): Record<string, string> {
  const env: Record<string, string> = {
    WRANGLER_SEND_METRICS: "false",
    WRANGLER_LOG_PATH: path.join(sandbox, ".wrangler-logs"),
    CI: "1",
    NO_COLOR: "1",
  };
  for (const key of Object.keys(process.env)) {
    if (/^CLOUDFLARE_/.test(key)) env[key] = "";
  }
  return env;
}

/** Wrangler's complaint, without the sandbox's temp path. */
export function wranglerComplaint(output: string, sandbox: string): string {
  const errors = output
    .split("\n")
    .filter((line) => /ERROR|✘|Error:/.test(line))
    .join("\n");
  return excerpt(errors || output, 4)
    .split(fsRealPath(sandbox))
    .join(".")
    .split(sandbox)
    .join(".");
}

function fsRealPath(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}

/** `wrangler deploy --dry-run` in a sandbox: bundles the Worker and reads the assets, and uploads nothing. */
export async function dryRun(root: string, sandbox: string) {
  const result = await exec(
    [
      localBin(root, "wrangler"),
      "deploy",
      "--dry-run",
      "--outdir",
      path.join(sandbox, ".dry-run"),
    ],
    { cwd: sandbox, env: wranglerEnv(sandbox) }
  );
  return {
    ok: result.code === 0,
    message: wranglerComplaint(`${result.stderr}\n${result.stdout}`, sandbox),
  };
}

/** Writes the files local serving needs on top of the build, into the sandbox's dist only. */
export function addServingFixtures(sandbox: string) {
  writeFileSync(path.join(sandbox, "dist", "check-model.glb"), "glTF");
  writeFileSync(path.join(sandbox, "dist", "check-model.gltf"), "{}");
}
