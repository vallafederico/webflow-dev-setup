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
  options?: { env?: Record<string, string> }
) => Promise<RunResult>;

/** A failed step, named so the user knows what to retry or clean up. */
export class StepError extends Error {
  constructor(
    readonly step: string,
    detail: string
  ) {
    super(`${step} failed: ${detail}`);
  }
}

/** R2 returns code 10004 and this wording when you already own the bucket. */
const BUCKET_EXISTS = /already exists|\[code: 10004\]/i;
const ALREADY = /already/i;

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

export interface MediaOptions {
  run: Runner;
  accountId: string;
  bucket: string;
  mediaHost: string;
  zoneId: string;
  /** True when this exact media URL was already written by an earlier run. */
  alreadyConnected: boolean;
  log: (message: string) => void;
}

/** Creates the bucket, attaches its domain, sets CORS. Throws a `StepError` on the first failure. */
export async function setupMedia(options: MediaOptions): Promise<void> {
  const { run, accountId, bucket, mediaHost, zoneId, log } = options;
  const env = { CLOUDFLARE_ACCOUNT_ID: accountId };

  const created = await run(["r2", "bucket", "create", bucket], { env });
  if (created.code !== 0) {
    if (!BUCKET_EXISTS.test(created.stderr + created.stdout)) {
      throw new StepError("Creating the R2 bucket", detail(created));
    }
    log(`R2 bucket ${bucket} already exists, continuing.`);
  } else {
    log(`Created R2 bucket ${bucket}.`);
  }

  // --force skips the confirmation prompt, which would otherwise hang or cancel without a TTY.
  const attached = await run(
    ["r2", "bucket", "domain", "add", bucket, "--domain", mediaHost, "--zone-id", zoneId, "--force"],
    { env }
  );
  if (attached.code !== 0) {
    // Only trust "already" when an earlier run of ours recorded this exact domain.
    if (!(options.alreadyConnected && ALREADY.test(attached.stderr + attached.stdout))) {
      throw new StepError("Attaching the custom domain to the R2 bucket", detail(attached));
    }
    log(`${mediaHost} is already attached, continuing.`);
  } else {
    log(`Attached ${mediaHost} to ${bucket}.`);
  }

  const dir = mkdtempSync(join(tmpdir(), "connect-cors-"));
  try {
    const file = join(dir, "cors.json");
    writeFileSync(file, `${JSON.stringify(CORS_RULES, null, 2)}\n`);
    const cors = await run(["r2", "bucket", "cors", "set", bucket, "--file", file, "--force"], {
      env,
    });
    if (cors.code !== 0) throw new StepError("Setting CORS on the R2 bucket", detail(cors));
    log(`Set CORS on ${bucket} (GET and HEAD from any origin).`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
