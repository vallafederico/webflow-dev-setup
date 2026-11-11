import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NAME } from "./project-config";

export const TEAM_CONFIG_FILE = "team.config.json";

/**
 * A team whose Cloudflare projects are created by its creator Worker, so no one
 * needs a Cloudflare login. Committed in the template. Delete the file to hide
 * the team option.
 */
export interface TeamConfig {
  name: string;
  creatorUrl: string;
  githubOrg: string;
  cloudflare: { accountId: string; domain: string; subdomain: string };
}

export function readTeamConfig(cwd = process.cwd()): TeamConfig | null {
  const path = resolve(cwd, TEAM_CONFIG_FILE);
  if (!existsSync(path)) return null;
  let value: any;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const ok =
    typeof value?.name === "string" &&
    typeof value.creatorUrl === "string" &&
    /^https:\/\/[a-z0-9.-]+$/.test(value.creatorUrl) &&
    typeof value.githubOrg === "string" &&
    /^[A-Za-z0-9-]+$/.test(value.githubOrg) &&
    /^\w+$/.test(value.cloudflare?.accountId ?? "") &&
    /^[a-z0-9.-]+\.[a-z]+$/.test(value.cloudflare?.domain ?? "") &&
    NAME.test(value.cloudflare?.subdomain ?? "");
  return ok ? (value as TeamConfig) : null;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Git = (args: string[], input?: string) => Promise<GitResult>;

const GIT_TIMEOUT_MS = 60_000;

/** Runs git with no prompts, so a missing credential fails instead of hanging the dev server. */
export function createGit(cwd: string, bin = "git"): Git {
  return (args, input) =>
    new Promise((done) => {
      const child = spawn(bin, args, {
        cwd,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GH_PROMPT_DISABLED: "1",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill(), GIT_TIMEOUT_MS);
      child.stdout.on("data", (c) => (stdout += c));
      child.stderr.on("data", (c) => (stderr += c));
      child.on("error", (e) => {
        clearTimeout(timer);
        done({ code: 127, stdout, stderr: String(e) });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done({ code: code ?? 1, stdout, stderr });
      });
      child.stdin.end(input ?? "");
    });
}

/** `owner/repo` from a GitHub remote URL in HTTPS or SSH form. */
export function parseGithubRemote(
  url: string
): { owner: string; repo: string } | null {
  const match = url
    .trim()
    .match(
      /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/
    );
  return match ? { owner: match[1], repo: match[2] } : null;
}

/**
 * The repo's numeric ID, looked up on this machine with the person's own
 * GitHub access: `gh` if it's logged in, otherwise the credential git already
 * stores for github.com. The creator checks the ID again through Cloudflare.
 */
export async function lookUpRepoId(
  owner: string,
  repo: string,
  deps: { gh: Git; git: Git; fetch: typeof fetch }
): Promise<string | null> {
  const viaGh = await deps.gh(["api", `repos/${owner}/${repo}`, "--jq", ".id"]);
  if (viaGh.code === 0 && /^\d+$/.test(viaGh.stdout.trim()))
    return viaGh.stdout.trim();

  const credential = await deps.git(
    ["credential", "fill"],
    "protocol=https\nhost=github.com\n\n"
  );
  const password = credential.stdout.match(/^password=(.+)$/m)?.[1];
  if (credential.code !== 0 || !password) return null;
  try {
    const response = await deps.fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          Authorization: `Bearer ${password}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "webflow-dev-setup",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!response.ok) return null;
    const id = ((await response.json()) as { id?: unknown }).id;
    return typeof id === "number" ? String(id) : null;
  } catch {
    return null;
  }
}

export function creatorLink(
  team: TeamConfig,
  params: Record<string, string>
): string {
  const url = new URL("/new", team.creatorUrl);
  for (const [key, value] of Object.entries(params))
    url.searchParams.set(key, value);
  return url.toString();
}

/** The `origin` remote's GitHub owner and repo, read synchronously for page rendering and the CLI. */
export function originRepo(
  cwd: string
): { owner: string; repo: string } | null {
  try {
    const result = spawnSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    return result.status === 0 ? parseGithubRemote(result.stdout) : null;
  } catch {
    return null;
  }
}
