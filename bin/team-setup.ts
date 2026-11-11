import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { connect, type Io, type Runner, suggestName } from "./connect";
import { PROJECT_CONFIG_FILE, readProjectConfig } from "./project-config";
import {
  creatorLink,
  type Git,
  lookUpRepoId,
  parseGithubRemote,
  type TeamConfig,
} from "./team";

export interface SetupDeps {
  cwd: string;
  team: TeamConfig;
  git: Git;
  gh: Git;
  run: Runner;
  fetch: typeof fetch;
  /** Rebuilds the bundle after the config is written, on the dev server. */
  onConnected?: () => Promise<unknown>;
}

export type SetupResult =
  | {
      ok: true;
      name: string;
      repo: string;
      repoId: string;
      link: (extra?: Record<string, string>) => string;
      log: string[];
    }
  | { ok: false; status: number; message: string; log: string[] };

/**
 * Everything before the creator, in one place for the dev page's button and
 * `pnpm team:create`:
 *
 * 1. With no git repo yet: `git init`, and a first commit of everything git doesn't ignore.
 * 2. With no `origin`: create `<org>/<folder name>` as a private repo with `gh` and push.
 * 3. Write the config for the repo's name, commit those two files and push `main`.
 * 4. Look up the repo's ID with the person's GitHub login.
 *
 * The creator checks the repo again, so nothing here has to be trusted.
 */
export async function prepareTeamProject(
  deps: SetupDeps
): Promise<SetupResult> {
  const { cwd, team, git, gh } = deps;
  const log: string[] = [];
  const fail = (status: number, message: string): SetupResult => ({
    ok: false,
    status,
    message,
    log,
  });
  const say = (line: string) => log.push(line);
  const folderName = suggestName(basename(cwd));

  if (!existsSync(resolve(cwd, ".git"))) {
    const init = await git(["init", "-b", "main"]);
    if (init.code !== 0) return fail(500, `git init failed:\n${init.stderr}`);
  }
  if ((await git(["rev-parse", "--verify", "HEAD"])).code !== 0) {
    await git(["add", "-A"]);
    const first = await git([
      "commit",
      "-m",
      "Start from the Webflow dev setup template",
    ]);
    if (first.code !== 0)
      return fail(
        422,
        `Created a git repo, but couldn't make the first commit:\n${first.stderr || first.stdout}\nSet git's user.name and user.email, then try again.`
      );
    say("Created a git repo and committed the template.");
  }

  let remote = parseGithubRemote(
    (await git(["remote", "get-url", "origin"])).stdout
  );
  if (!remote) {
    const existing = (await git(["remote", "get-url", "origin"])).code === 0;
    if (existing)
      return fail(
        422,
        `This folder's origin isn't a GitHub repo. Point it at github.com/${team.githubOrg}/<repo>, then try again.`
      );
    if (!folderName)
      return fail(
        422,
        `The folder name "${basename(cwd)}" can't be a project name. Rename the folder to lowercase letters, digits and hyphens.`
      );
    const branch = (
      await git(["rev-parse", "--abbrev-ref", "HEAD"])
    ).stdout.trim();
    if (branch !== "main")
      return fail(
        422,
        `You're on "${branch}". Switch to main, then try again.`
      );
    const created = await gh([
      "repo",
      "create",
      `${team.githubOrg}/${folderName}`,
      "--private",
      "--source",
      ".",
      "--push",
    ]);
    if (created.code !== 0)
      return fail(
        422,
        `Couldn't create github.com/${team.githubOrg}/${folderName}:\n${(created.stderr || created.stdout).trim()}\n\nIf gh isn't installed or logged in, run gh auth login, or create the repo yourself and push to it.`
      );
    say(
      `Created the private repo github.com/${team.githubOrg}/${folderName} and pushed to it.`
    );
    remote = { owner: team.githubOrg, repo: folderName };
  }

  if (remote.owner.toLowerCase() !== team.githubOrg.toLowerCase())
    return fail(
      422,
      `This folder's origin is github.com/${remote.owner}/${remote.repo}, which isn't in github.com/${team.githubOrg}. Team projects live in the org: move the repo there, or point origin at a repo in it.`
    );

  const name = suggestName(remote.repo);
  if (!name)
    return fail(
      422,
      `"${remote.repo}" can't be a project name. Rename the repo to lowercase letters, digits and hyphens.`
    );

  const branch = (
    await git(["rev-parse", "--abbrev-ref", "HEAD"])
  ).stdout.trim();
  if (branch !== "main")
    return fail(
      422,
      `You're on "${branch}". The first build runs from main, so switch to main and try again.`
    );

  let existing = null;
  try {
    existing = readProjectConfig(cwd);
  } catch (error) {
    return fail(422, String(error instanceof Error ? error.message : error));
  }
  if (
    existing &&
    !(
      existing.host === "cloudflare" &&
      new URL(existing.deployUrl).hostname ===
        `${existing.name}.${team.cloudflare.domain}`
    )
  )
    return fail(
      409,
      `This project is already connected to ${existing.deployUrl}. To move it to ${team.name}, run pnpm connect cloudflare --team --yes in a terminal.`
    );

  const io: Io = {
    interactive: false,
    ask: async () => "",
    log: say,
    error: say,
  };
  const code = await connect(["cloudflare", "--team", `--name=${name}`], {
    cwd,
    io,
    run: deps.run,
    origin: () => remote,
  });
  if (code !== 0) return fail(422, log.join("\n"));
  await deps
    .onConnected?.()
    .catch((error) =>
      say(`\nThe rebuild failed, so edit a file to retry it: ${error}`)
    );

  const files = [PROJECT_CONFIG_FILE, "wrangler.jsonc"];
  await git(["add", "--", ...files]);
  if ((await git(["diff", "--cached", "--quiet", "--", ...files])).code === 1) {
    const commit = await git([
      "commit",
      "-m",
      `Connect to ${team.name} hosting as ${name}`,
      "--",
      ...files,
    ]);
    if (commit.code !== 0)
      return fail(
        422,
        `The config is written, but git couldn't commit it:\n${commit.stderr || commit.stdout}`
      );
  }
  const push = await git(["push", "-u", "origin", "HEAD:main"]);
  if (push.code !== 0)
    return fail(
      422,
      `The config is committed, but git couldn't push it:\n${push.stderr || push.stdout}\nPush main yourself, then try again.`
    );

  const repoId = await lookUpRepoId(remote.owner, remote.repo, {
    gh,
    git,
    fetch: deps.fetch,
  });
  if (!repoId)
    return fail(
      422,
      "Pushed, but couldn't look up the repo's ID with your GitHub login. Run gh auth login, then try again."
    );

  const repo = `${remote.owner}/${remote.repo}`;
  return {
    ok: true,
    name,
    repo,
    repoId,
    log,
    link: (extra = {}) => creatorLink(team, { name, repo, repoId, ...extra }),
  };
}
