import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { createRunner, projectLinks } from "./connect";
import { readProjectConfig } from "./project-config";
import { createGit, readTeamConfig, TEAM_CONFIG_FILE } from "./team";
import { prepareTeamProject } from "./team-setup";

const USAGE = `Usage: pnpm team:create [--no-open] [--json]

Sets this project up on the team's Cloudflare account, with no Cloudflare login:
creates the GitHub repo in the team's org if there isn't one (needs gh), writes
and pushes the config, and opens the creator. Sign in there with your work email
and press Create. Then run pnpm check:live to wait for the first deploy.

  --no-open   Print the creator link instead of opening it
  --json      Print one JSON object, for scripts and agents`;

function openInBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer"
        : "xdg-open";
  spawn(command, [url], { stdio: "ignore", detached: true }).unref();
}

export async function main(
  argv: string[],
  cwd = process.cwd()
): Promise<number> {
  let flags: { "no-open"?: boolean; json?: boolean; help?: boolean };
  try {
    flags = parseArgs({
      args: argv,
      options: {
        "no-open": { type: "boolean" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    }).values;
  } catch (error) {
    console.error(
      `${error instanceof Error ? error.message : error}\n\n${USAGE}`
    );
    return 1;
  }
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const team = readTeamConfig(cwd);
  if (!team) {
    const message = `There's no valid ${TEAM_CONFIG_FILE}, so this project has no team to set up with. Use pnpm connect instead.`;
    if (flags.json) console.log(JSON.stringify({ ok: false, message }));
    else console.error(message);
    return 1;
  }

  const result = await prepareTeamProject({
    cwd,
    team,
    git: createGit(cwd),
    gh: createGit(cwd, "gh"),
    run: createRunner(cwd),
    fetch,
  });

  if (!result.ok) {
    if (flags.json)
      console.log(
        JSON.stringify({ ok: false, message: result.message, log: result.log })
      );
    else console.error([...result.log, result.message].join("\n"));
    return 1;
  }

  const url = result.link();
  const config = readProjectConfig(cwd);
  const links = config ? projectLinks(config, team.cloudflare.accountId) : [];
  if (flags.json) {
    console.log(
      JSON.stringify({
        ok: true,
        name: result.name,
        repo: result.repo,
        repoId: result.repoId,
        creatorUrl: url,
        deployUrl: config?.deployUrl,
        links,
        next: [
          "A person opens creatorUrl, signs in with their work email and presses Create. An agent can't do this step.",
          "Then run: pnpm check:live --timeout 5m",
        ],
      })
    );
  } else {
    for (const line of result.log) console.log(line);
    console.log(
      `\nPushed ${result.repo}. Last step, in the browser:\n  ${url}\n`
    );
    console.log(
      `Sign in with your ${team.name} email and press Create. The first build starts straight away.\n`
    );
    for (const link of links)
      console.log(`  ${link.label.padEnd(16)} ${link.url}`);
    console.log(
      "\nThen run pnpm check:live to wait for the deploy, and pnpm dev for the loader."
    );
  }
  if (!flags["no-open"] && !flags.json) openInBrowser(url);
  return 0;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
