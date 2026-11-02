import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `wrangler <args>`. Injected so tests never touch an account. */
export type Runner = (
  args: string[],
  options?: { env?: Record<string, string>; cwd?: string }
) => Promise<RunResult>;

/** A failed step, named so the user knows what to retry or clean up. */
export class StepError extends Error {
  constructor(step: string, detail: string) {
    super(`${step} failed: ${detail}`);
  }
}

// UNCONFIRMED: the 10004 code and this wording are from memory of the R2 API, not seen in a real
// response. If the real text differs, a re-run fails at bucket creation with Cloudflare's message.
const BUCKET_EXISTS = /already exists|\[code: 10004\]/i;

export const CORS_RULES = {
  rules: [
    {
      allowed: {
        origins: ["*"],
        methods: ["GET", "HEAD"],
        // Range is not a simple header, so ranged GETs (video, large glTF) preflight.
        headers: ["Range", "Content-Type"],
      },
      exposeHeaders: ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
      maxAgeSeconds: 86400,
    },
  ],
};

function detail(result: RunResult): string {
  return (result.stderr || result.stdout).trim() || `exit code ${result.code}`;
}

/** True when `host` appears in `output` as a whole token, not inside a longer hostname. */
function listsHost(output: string, host: string): boolean {
  const escaped = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9.-])${escaped}($|[^a-z0-9.-])`, "i").test(output);
}

export interface MediaOptions {
  run: Runner;
  accountId: string;
  bucket: string;
  mediaHost: string;
  zoneId: string;
  log: (message: string) => void;
}

/**
 * Creates the bucket, attaches its domain, sets CORS. Throws a `StepError` on the first failure.
 *
 * Runs from an empty temp directory: Wrangler prefers `account_id` from the project's
 * wrangler.jsonc over `CLOUDFLARE_ACCOUNT_ID`, which would act on the wrong account.
 */
export async function setupMedia(options: MediaOptions): Promise<void> {
  const { run, accountId, bucket, mediaHost, zoneId, log } = options;
  const dir = mkdtempSync(join(tmpdir(), "connect-media-"));
  const wrangler = (args: string[]) => run(args, { env: { CLOUDFLARE_ACCOUNT_ID: accountId }, cwd: dir });

  try {
    const created = await wrangler(["r2", "bucket", "create", bucket]);
    if (created.code !== 0) {
      if (!BUCKET_EXISTS.test(created.stderr + created.stdout)) {
        throw new StepError("Creating the R2 bucket", detail(created));
      }
      log(`R2 bucket ${bucket} already exists, continuing.`);
    } else {
      log(`Created R2 bucket ${bucket}.`);
    }

    // A retry after a later failure finds the domain already here. Asking first, rather than
    // forgiving an "already" error, means a domain held by a different bucket still fails.
    const listed = await wrangler(["r2", "bucket", "domain", "list", bucket]);
    if (listed.code !== 0) throw new StepError("Listing the R2 bucket's custom domains", detail(listed));
    if (listsHost(listed.stdout, mediaHost)) {
      log(`${mediaHost} is already attached to ${bucket}, continuing.`);
    } else {
      // --force skips the confirmation prompt, which would otherwise hang or cancel without a TTY.
      const attached = await wrangler([
        "r2", "bucket", "domain", "add", bucket, "--domain", mediaHost, "--zone-id", zoneId, "--force",
      ]);
      if (attached.code !== 0) {
        throw new StepError("Attaching the custom domain to the R2 bucket", detail(attached));
      }
      log(`Attached ${mediaHost} to ${bucket}.`);
    }

    const file = join(dir, "cors.json");
    writeFileSync(file, `${JSON.stringify(CORS_RULES, null, 2)}\n`);
    const cors = await wrangler(["r2", "bucket", "cors", "set", bucket, "--file", file, "--force"]);
    if (cors.code !== 0) throw new StepError("Setting CORS on the R2 bucket", detail(cors));
    log(`Set CORS on ${bucket} (GET and HEAD from any origin).`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
