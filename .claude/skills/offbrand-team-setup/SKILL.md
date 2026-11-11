---
name: offbrand-team-setup
description: Set up an Off+Brand project's hosting on the team's Cloudflare account, with no Cloudflare login or token. Use when the user wants to deploy, host, connect, publish or "set up" a new project, get its deploy link or loader, or asks why a team project isn't live yet. Only for projects with a team.config.json.
---

# Off+Brand team setup

Off+Brand projects are hosted on the team's Cloudflare account at `https://<name>.itsoffbrand.dev`. A creator Worker at `https://new.itsoffbrand.dev` makes each project, so nobody needs a Cloudflare login. The project is always named after its GitHub repo in `itsoffbrand`.

Check `team.config.json` exists first. Without it, use `pnpm connect` instead (see `docs/hosting.md`).

## Steps

1. **Check the project builds:** `pnpm check`. Fix what it reports before going further.
2. **Run the setup:** `pnpm team:create --json`. It:
   - creates `itsoffbrand/<folder name>` with `gh` and pushes, if there's no repo yet
   - writes `project.config.json` and `wrangler.jsonc`, commits only those two files, and pushes `main`
   - looks up the repo's ID and returns the creator link as `creatorUrl`
3. **Hand the link to the person.** Opening `creatorUrl` means signing in with an `@itsoffbrand.com` email code and pressing **Create**. You can't do this step: the code goes to their inbox. Give them the link and wait for them to say it's done.
4. **Wait for the deploy:** `pnpm check:live --timeout 5m`. It passes once `https://<name>.itsoffbrand.dev` serves this commit. The first build takes about a minute.
5. **Get the loader:** the `pnpm dev` index page shows it. Tell the person to paste it into the site's custom code in Webflow.

The `pnpm dev` page does steps 2 to 4 with one button: **Off+Brand team**, then **Create**. Suggest it to people who'd rather click.

## Reading the JSON

- `ok: true`: `creatorUrl`, `deployUrl` and `links` (live bundle, build manifest, branch preview pattern, build log) are set. Report the links.
- `ok: false`: `message` says what to fix. Common ones:

| Message says | Do this |
|---|---|
| `gh auth login` | Ask the person to run `gh auth login`. Don't work around it |
| isn't in github.com/itsoffbrand | The repo is somewhere else. Ask whether to move it to the org. Don't change `origin` yourself |
| You're on "<branch>" | `git switch main`, then run it again |
| can't be a project name | The repo or folder name needs lowercase letters, digits and hyphens. Ask before renaming |
| already connected to | It's on another host. Only switch with the person's say-so: `pnpm connect cloudflare --team --yes` |
| couldn't push | Usually main is behind. `git pull --rebase`, then run it again |

If the creator page refuses, it says why. A taken name means renaming the repo. The same person can retry a failed attempt, and it picks up where it stopped.

## After setup

- Push `main` to deploy. Push a branch for a preview at `https://<branch>-<name>.ob-ops.workers.dev`.
- `pnpm check:live` after each push confirms what's live.

## Don't

- Run `wrangler login`, create Cloudflare tokens, or ask the person for one. The team flow never needs them.
- Edit `routes` in `wrangler.jsonc`. A build that routes another `*.itsoffbrand.dev` host fails on purpose, because it would take another project's domain.
- Commit anything else as part of setup. `team:create` commits only the two config files, plus the first commit of a brand-new repo.
