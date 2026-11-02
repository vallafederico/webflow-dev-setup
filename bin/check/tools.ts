import { existsSync } from "node:fs";
import path from "node:path";
import { onTerminate } from "./cleanup";
import { ToolFailure } from "./types";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Path to a binary the repo installed, so no network or global tool is used. */
export function localBin(root: string, name: string): string {
  const file = path.join(root, "node_modules", ".bin", name);
  if (!existsSync(file)) {
    throw new ToolFailure(
      `${name} is not installed (expected ${path.join("node_modules", ".bin", name)})`,
      { fix: "Run pnpm i --frozen-lockfile" }
    );
  }
  return file;
}

/** Longest a tool may run before the check gives up on it. */
export const DEFAULT_TIMEOUT_MS = 180_000;

/** `CHECK_TOOL_TIMEOUT_MS` shortens it, for proving that a stuck tool ends the run. */
export function toolTimeoutMs(fallback = DEFAULT_TIMEOUT_MS): number {
  const override = Number(process.env.CHECK_TOOL_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : fallback;
}

export async function exec(
  command: string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    /** Killed after this long, which is a tool failure. Defaults to 180s. */
    timeoutMs?: number;
  }
): Promise<ExecResult> {
  const name = path.basename(command[0] ?? "");
  const timeoutMs = options.timeoutMs ?? toolTimeoutMs();
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(command, {
      cwd: options.cwd,
      env: { ...process.env, NO_COLOR: "1", ...options.env },
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    throw new ToolFailure(
      `could not start ${name}: ${(error as Error).message}`
    );
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      proc.kill();
      // A process that ignores SIGTERM must not outlive the check.
      setTimeout(() => proc.kill(9), 2000).unref();
      reject(
        new ToolFailure(
          `${name} did not finish within ${Math.round(timeoutMs / 1000)}s and was stopped, so its result can't be trusted`,
          {
            fix: `Run ${command.join(" ")} yourself to see what it is waiting for`,
          }
        )
      );
    }, timeoutMs);
  });
  const forget = onTerminate(() => {
    proc.kill();
  });

  const finished = Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ]);
  finished.catch(() => {});
  try {
    // Not waiting on the pipes after expiry: a grandchild can hold them open.
    const [stdout, stderr, code] = await Promise.race([finished, expired]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    forget();
  }
}

/**
 * The first meaningful lines of tool output on one line, for a failure message.
 * Drops blank lines and the rulers and frames some tools draw.
 */
export function excerpt(text: string, lines = 4): string {
  const cleaned = text
    .split("\n")
    .map((line) => line.replace(/^[\s>│|]+/, "").trim())
    .filter((line) => line && !/^[━─\s^]+$/.test(line) && !/━{3,}/.test(line));
  // Biome marks its actual complaint with a cross, so show only those.
  const complaints = cleaned.filter((line) => line.startsWith("×"));
  return (complaints.length > 0 ? complaints : cleaned)
    .slice(0, lines)
    .join(" | ");
}

export function toPosix(file: string): string {
  return file.split(path.sep).join("/");
}

/** Make a path from tool output repo-relative. */
export function relativeTo(root: string, file: string): string {
  const absolute = path.isAbsolute(file) ? file : path.join(root, file);
  return toPosix(path.relative(root, absolute));
}
