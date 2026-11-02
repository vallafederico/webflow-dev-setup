import { existsSync } from "node:fs";
import path from "node:path";
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

export async function exec(
  command: string[],
  options: { cwd: string; env?: Record<string, string> }
): Promise<ExecResult> {
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
      `could not start ${path.basename(command[0] ?? "")}: ${(error as Error).message}`
    );
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
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
