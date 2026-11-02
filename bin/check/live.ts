import path from "node:path";
import { readProjectConfig } from "../project-config";
import { exitCodeFor, runChecks, toHuman, toJson } from "./index";
import { exec } from "./tools";
import { type Check, type Finding, ToolFailure, toResult } from "./types";

export const MAIN_BRANCH = "main";
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_INTERVAL_MS = 5_000;
const MANIFEST = "build-manifest.json";
/** A manifest with no commit is stale or never records one; it does not need the full wait. */
const NULL_COMMIT_WAIT_MS = 60_000;
const FILE_TIMEOUT_MS = 15_000;
const MANIFEST_TIMEOUT_MS = 15_000;

export interface LiveDeps {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Runs `git <args>` in the repo being checked. */
  git(args: string[]): Promise<{ code: number; stdout: string }>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Progress while waiting, so a silent run isn't mistaken for a hung one. */
  log(message: string): void;
}

export interface LiveOptions {
  url?: string;
  timeoutMs: number;
  intervalMs: number;
}

const USAGE =
  "Usage: pnpm check:live [--url <deployment url>] [--timeout <seconds, or 90s / 5m>] [--json]";

/** `300`, `90s`, `5m` or `1500ms`. */
export function parseDuration(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(text);
  if (!match) return null;
  const unit = { ms: 1, s: 1000, m: 60_000 }[
    (match[2] ?? "s") as "ms" | "s" | "m"
  ];
  return Math.round(Number(match[1]) * unit);
}

export function parseArgs(
  argv: string[]
): { options: LiveOptions; json: boolean } | { error: string } {
  const options: LiveOptions = {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
  };
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const [flag, inline] = arg.startsWith("--")
      ? arg.split(/=(.*)/s, 2)
      : [arg, undefined];
    const value = () => inline ?? argv[++i];
    if (flag === "--json") json = true;
    else if (flag === "--url") {
      const url = value();
      if (!url) return { error: `--url needs a value. ${USAGE}` };
      options.url = url;
    } else if (flag === "--timeout") {
      const parsed = parseDuration(value() ?? "");
      if (parsed === null)
        return {
          error: `--timeout must be a number of seconds, such as 300, 90s or 5m. ${USAGE}`,
        };
      options.timeoutMs = parsed;
    } else return { error: `Unknown option ${arg}. ${USAGE}` };
  }
  return { options, json };
}

const JS = /^(?:text|application)\/(?:x-)?(?:java|ecma)script\b/i;
const CSS = /^text\/css\b/i;

interface Manifest {
  commit?: string | null;
  javascript?: { files?: { path: unknown }[] };
  css?: { files?: { path: unknown }[] };
}

export function makeLive(options: LiveOptions, deps: LiveDeps): Check {
  return {
    name: "live",
    tier: "all",
    async run({ root }) {
      // -- Preconditions: no deployment can match these, so waiting would be pointless
      const git = async (...args: string[]) => {
        const result = await deps.git(args);
        return { ...result, stdout: result.stdout.trim() };
      };
      const status = await git("status", "--porcelain");
      if (status.code !== 0) {
        throw new ToolFailure(
          "git status failed, so the working tree can't be checked",
          {
            fix: "Run pnpm check:live inside the git repository",
          }
        );
      }
      if (status.stdout) {
        throw new ToolFailure(
          "the working tree has uncommitted changes, so no deployment can contain them",
          {
            fix: "Commit and push your changes, then run pnpm check:live again",
          }
        );
      }
      const head = await git("rev-parse", "HEAD");
      if (head.code !== 0 || !head.stdout) {
        throw new ToolFailure("there is no commit to compare with", {
          fix: "Commit and push your work, then run pnpm check:live again",
        });
      }
      // A detached HEAD has no upstream, so a remote branch containing it is the proof.
      const symbolic = await git("symbolic-ref", "-q", "HEAD");
      const detached = symbolic.code !== 0 || !symbolic.stdout;
      if (detached) {
        const remotes = await git("branch", "-r", "--contains", "HEAD");
        if (remotes.code !== 0 || !remotes.stdout) {
          throw new ToolFailure(
            "HEAD is detached and no remote branch contains it, so it has not been pushed",
            {
              fix: "Push the commit to a branch, then run pnpm check:live again",
            }
          );
        }
      } else {
        const upstream = await git("rev-parse", "@{u}");
        if (upstream.code !== 0 || !upstream.stdout) {
          throw new ToolFailure(
            "the current branch has no upstream, so HEAD has not been pushed",
            {
              fix: "Run git push -u origin HEAD, wait for the deploy to start, then run pnpm check:live again",
            }
          );
        }
        if (upstream.stdout !== head.stdout) {
          throw new ToolFailure(
            `HEAD (${head.stdout}) is not what the upstream branch has (${upstream.stdout}), so no deployment matches it`,
            {
              fix: "Push or pull until HEAD equals its upstream, then run pnpm check:live again",
            }
          );
        }
      }

      // -- Which deployment
      const branch = detached
        ? ""
        : symbolic.stdout.replace(/^refs\/heads\//, "");
      let url = options.url;
      if (!url) {
        if (branch !== MAIN_BRANCH) {
          throw new ToolFailure(
            `branch ${branch || "(detached)"} needs the deployment's address: deployUrl only follows ${MAIN_BRANCH}`,
            {
              fix: "Run pnpm check:live --url <the preview URL for this branch>",
            }
          );
        }
        let config: ReturnType<typeof readProjectConfig>;
        try {
          config = readProjectConfig(root);
        } catch (error) {
          throw new ToolFailure((error as Error).message, {
            file: "project.config.json",
            fix: "Fix project.config.json, or pass --url <deployment url>",
          });
        }
        if (!config) {
          throw new ToolFailure(
            "project.config.json does not exist and no --url was given, so there is no deployment to check",
            {
              fix: "Run pnpm connect cloudflare or pnpm connect vercel, or pass --url <deployment url>",
            }
          );
        }
        url = config.deployUrl;
      }
      let origin: string;
      try {
        const parsed = new URL(url);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error("not http(s)");
        origin = parsed.origin;
        // The manifest and files are found at the root, so a path would point at the wrong place.
        if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
          throw new ToolFailure(
            `--url ${url} has a path, query or fragment, but the files are looked up at the root of the origin`,
            { fix: `Pass only the origin: --url ${parsed.origin}` }
          );
        }
      } catch (error) {
        if (error instanceof ToolFailure) throw error;
        throw new ToolFailure(`--url ${url} is not a valid http(s) address`, {
          fix: "Pass the full address, such as https://my-branch-acme.team.workers.dev",
        });
      }

      // -- Wait for the deployment to serve this commit
      const findings: Finding[] = [];
      const add = (rule: string, file: string, message: string, fix: string) =>
        findings.push({ rule, severity: "error", file, line: 1, message, fix });

      const noCache = { "cache-control": "no-cache", pragma: "no-cache" };
      // A server that accepts the connection and never answers must not outlast --timeout.
      const request = (target: string, timeoutMs: number) =>
        deps.fetch(target, {
          cache: "no-store",
          headers: noCache,
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });

      const start = deps.now();
      const deadline = start + options.timeoutMs;
      let seen:
        | { kind: "commit"; commit: string | null }
        | { kind: "error"; reason: string }
        | null = null;
      let manifest: Manifest | null = null;
      let nullSince: number | null = null;
      for (;;) {
        try {
          const response = await request(
            `${origin}/${MANIFEST}`,
            Math.max(1000, Math.min(MANIFEST_TIMEOUT_MS, deadline - deps.now()))
          );
          const type = response.headers.get("content-type") ?? "";
          if (
            response.status === 401 ||
            response.status === 403 ||
            (response.ok && /text\/html/i.test(type))
          ) {
            // Retrying won't change it: the deployment is behind a login.
            await response.body?.cancel();
            add(
              "live/protected",
              MANIFEST,
              `${origin}/${MANIFEST} ${response.ok ? "returned an HTML page" : `returned ${response.status}`} instead of the manifest, so the deployment looks protected`,
              "Vercel Deployment Protection (or Cloudflare Access) may be on. Turn it off for this deployment, then run pnpm check:live again"
            );
            return toResult("live", findings);
          }
          if (!response.ok) {
            seen = {
              kind: "error",
              reason: `${MANIFEST} returned ${response.status}`,
            };
          } else {
            const body = (await response.json()) as Manifest;
            seen = {
              kind: "commit",
              commit:
                typeof body.commit === "string" && body.commit
                  ? body.commit
                  : null,
            };
            if (seen.commit === head.stdout) {
              manifest = body;
              break;
            }
          }
        } catch (error) {
          seen = {
            kind: "error",
            reason: `could not read ${MANIFEST}: ${(error as Error).message}`,
          };
        }
        if (seen.kind === "commit" && seen.commit === null) {
          nullSince ??= deps.now();
          if (deps.now() - nullSince >= NULL_COMMIT_WAIT_MS) break;
        } else {
          nullSince = null;
        }
        const left = deadline - deps.now();
        if (left <= 0) break;
        deps.log(
          `waiting for ${origin} to serve ${head.stdout.slice(0, 7)} (${
            seen.kind === "commit"
              ? `it serves ${seen.commit ? seen.commit.slice(0, 7) : "no commit"}`
              : seen.reason
          }), ${Math.ceil(left / 1000)}s left`
        );
        await deps.sleep(Math.min(options.intervalMs, left));
      }

      if (!manifest) {
        const waited = `${Math.round(options.timeoutMs / 1000)}s`;
        if (seen?.kind === "commit" && seen.commit === null) {
          add(
            "live/no-commit",
            MANIFEST,
            `${origin}/${MANIFEST} still has no commit (null) after ${Math.round(NULL_COMMIT_WAIT_MS / 1000)}s, so it can't be matched to HEAD ${head.stdout}`,
            "The build didn't see WORKERS_CI_COMMIT_SHA or VERCEL_GIT_COMMIT_SHA. Deploy through Workers Builds or Vercel from git, not a local upload"
          );
        } else if (seen?.kind === "commit") {
          add(
            "live/stale",
            MANIFEST,
            `${origin} still serves commit ${seen.commit} after ${waited}, but HEAD is ${head.stdout}`,
            "Check the deployment's build log. If it failed, fix the build and push again"
          );
        } else {
          add(
            "live/unreachable",
            MANIFEST,
            `${origin}/${MANIFEST} could not be read within ${waited} (${seen?.reason ?? "no response"}); HEAD is ${head.stdout}`,
            "Check the address, and that the deployment finished"
          );
        }
        return toResult("live", findings);
      }

      // -- The files the manifest lists
      const entries = [
        ...(manifest.javascript?.files ?? []).map((f) => ({
          file: f.path,
          kind: "js" as const,
        })),
        ...(manifest.css?.files ?? []).map((f) => ({
          file: f.path,
          kind: "css" as const,
        })),
      ].filter((e) => !(typeof e.file === "string" && e.file.endsWith(".map")));
      if (entries.length === 0) {
        add(
          "live/no-files",
          MANIFEST,
          `${MANIFEST} lists no JS or CSS file`,
          "Rebuild and deploy: the build wrote an empty manifest"
        );
      }
      for (const entry of entries) {
        const file = entry.file;
        if (
          typeof file !== "string" ||
          path.isAbsolute(file) ||
          /^[a-z]:/i.test(file) ||
          file.split("/").includes("..")
        ) {
          add(
            "live/manifest-path",
            MANIFEST,
            `${MANIFEST} lists ${JSON.stringify(file)}, which is not a path relative to dist/`,
            "Rebuild with the current bin/manifest.ts, which writes relative paths"
          );
          continue;
        }
        const target = `${origin}/${file.split("/").map(encodeURIComponent).join("/")}`;
        let response: Response;
        try {
          response = await request(target, FILE_TIMEOUT_MS);
        } catch (error) {
          add(
            "live/file-status",
            file,
            `/${file} could not be fetched: ${(error as Error).message}`,
            "Check that the deployment is up"
          );
          continue;
        }
        await response.body?.cancel();
        if (response.status !== 200) {
          add(
            "live/file-status",
            file,
            `/${file} returned ${response.status}, not 200`,
            "Check that the build output was deployed in full"
          );
          continue;
        }
        const type = response.headers.get("content-type") ?? "";
        if (!(entry.kind === "js" ? JS : CSS).test(type)) {
          add(
            "live/content-type",
            file,
            `/${file} has content-type ${type ? `"${type}"` : "(none)"}, expected ${entry.kind === "js" ? "text/javascript" : "text/css"}`,
            "Check the host's headers rules for this file type"
          );
        }
        const cors = response.headers.get("access-control-allow-origin");
        if (cors !== "*") {
          add(
            "live/cors",
            file,
            `/${file} has Access-Control-Allow-Origin ${cors === null ? "missing" : `"${cors}"`}, expected "*", so Webflow pages can't load it`,
            "Check dist/_headers (Cloudflare) or vercel.json headers (Vercel)"
          );
        }
      }
      return toResult("live", findings);
    },
  };
}

export async function main(
  argv: string[],
  overrides: { deps?: Partial<LiveDeps>; root?: string } = {}
): Promise<number> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) {
    process.stderr.write(`${parsed.error}\n`);
    return 2;
  }
  const root = overrides.root ?? path.resolve(import.meta.dir, "..", "..");
  const deps: LiveDeps = {
    fetch: (url, init) => fetch(url, init),
    git: async (args) => {
      const result = await exec(["git", ...args], { cwd: root });
      return { code: result.code, stdout: result.stdout };
    },
    sleep: (ms) => Bun.sleep(ms),
    now: () => Date.now(),
    log: (message) => process.stderr.write(`${message}\n`),
    ...overrides.deps,
  };
  const outcome = await runChecks([makeLive(parsed.options, deps)], {
    root,
    all: true,
  });
  process.stdout.write(parsed.json ? toJson(outcome) : toHuman(outcome));
  return exitCodeFor(outcome);
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
