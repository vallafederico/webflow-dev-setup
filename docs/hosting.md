# Hosting

The built files in `dist/` can be hosted on Cloudflare or Vercel. Pick one per project with `pnpm connect`. Pushing to `main` then builds and updates the same CDN link the [loader](./loader.md) uses.

```bash
pnpm connect cloudflare
pnpm connect vercel
```

Webflow still serves the pages. The host only serves what the loader asks for: JS, CSS, `public/` files and the build extras (`.js.txt` copies, `.js.map` source maps, `build-manifest.json`). Source maps are served, so the original source is public. API routes are the only code that runs per request.

| | Cloudflare | Vercel |
|---|---|---|
| Product | Workers Builds with Static Assets | Vercel project |
| Production URL | `https://<name>.<your domain>` | `https://<name>.vercel.app` |
| Branch previews | `<branch>-<name>.<workers.dev subdomain>.workers.dev` | `<name>-git-<branch>-<team>.vercel.app` |
| Preview allowlist | `-<name>.<subdomain>.workers.dev` | `-<team>.vercel.app` |
| API routes | Router generated from `api/*.ts` | Vercel Functions from `api/` |
| CORS headers | `dist/_headers`, written by the build | `vercel.json` |
| `pnpm dep` | Prints "push to main" | Calls `VERCEL_DEPLOY_HOOK` |

## Connecting from the dev page

With no `project.config.json`, the index page of `pnpm dev` (`http://localhost:6545`) shows a **Connect a host** form. Submitting it runs the same code as `pnpm connect`, rebuilds the bundle and shows the project's details, the next steps and the full loader.

- **What it fills in:** the project name from the folder, and `WF_BASE_DOMAIN` if it's set. If Wrangler is logged in, it also fills in your account, your `workers.dev` subdomain and a list of your active domains, through read-only Cloudflare API calls. Wrangler's token stays on the server. Vercel's team suffix is always typed in. If Wrangler isn't logged in, run `pnpm wrangler login` and press **Check again**, or type the values in.
- **What it won't do:** change anything on your Cloudflare account, or replace an existing config. Use the terminal for `--media`, for switching hosts and for changing a connected project.
- **Who can use it:** only the page itself, from this machine. A request from another site or another machine gets a 403, even though the dev server listens on every interface.

## Off+Brand team projects

`team.config.json` names a team whose Cloudflare projects are created for its members, so nobody needs a Cloudflare login or token. For Off+Brand that's the account that owns `itsoffbrand.dev`, and the creator at `https://new.itsoffbrand.dev`. Delete the file and the option goes away.

1. Create the repo in `github.com/itsoffbrand` and push to it, as usual.
2. On the dev page, choose **Off+Brand team**, check the name and press **Create**. The dev server:
   - writes `project.config.json` and `wrangler.jsonc` for `https://<name>.itsoffbrand.dev`
   - commits those two files and pushes `main`
   - looks up the repo's ID with your GitHub login (`gh`, or the credential git already stores)
   - opens the creator
3. The creator asks for a code sent to your `@itsoffbrand.com` email. It checks the name is free and that the repo's pushed config is for this name. Then it creates the Worker, connects the repo and starts the first build.
4. You're sent back to the dev page, which lists the live URL, the branch preview URL and the build log, with the full loader below. The **Status** row turns to **Live** once the first build is done, which takes about a minute.

After that it's the same as any Cloudflare project: push `main` to deploy, push a branch for a preview.

- **From the terminal:** `pnpm connect cloudflare --team --name <name>` writes the same files. Commit and push them, then press **Create on Off+Brand** on the dev page.
- **If the creator refuses:** it says why, for example a name that's taken. Fix it and press **Create on Off+Brand** on the dev page again. The same person can retry a failed attempt, and the retry picks up where it stopped.
- **What it can't do:** change or delete an existing project, or create more than 2 projects per person per hour, or 10 a day for the team.
- **The domain guard:** on a shared domain, a build deploys whatever routes its `wrangler.jsonc` names, so one project could take another's domain. A Workers Builds build fails when `wrangler.jsonc` routes another host on the project's base domain, and `pnpm check:all` reports it.

## `pnpm connect`

Writes the project's settings, then prints the dashboard steps for that host. Every prompt has a flag, so it can run unattended. With no TTY, a value that has no flag, env var or existing setting is an error that names the flag to pass.

| Flag | Applies to | What it sets |
|---|---|---|
| `--name <name>` | both | Project name, a lowercase DNS label (letters, digits, hyphens, up to 63 characters). `www`, `api`, `cdn`, `mail`, `admin`, `ftp` and `app` are refused. In a prompt, the folder name is suggested |
| `--yes`, `-y` | both | Confirm a host change without asking |
| `--help`, `-h` | both | Print the usage |
| `--domain <domain>` | cloudflare | Base domain on your Cloudflare account, like `example.com`. Env: `WF_BASE_DOMAIN` |
| `--subdomain <name>` | cloudflare | Your `workers.dev` subdomain, the `my-team` in `my-team.workers.dev` |
| `--account-id <id>` | cloudflare | The Cloudflare account that owns the domain. Skips the `wrangler whoami` check |
| `--media` | cloudflare | Also create the R2 media bucket, see [Media on R2](#media-on-r2) |
| `--zone-id <id>` | cloudflare | Zone ID of the base domain, only for `--media`. Env: `WF_ZONE_ID` |
| `--suffix <suffix>` | vercel | Team preview suffix, like `-your-team.vercel.app` |

A flag for the other host is an error, for example `--suffix` with `cloudflare`.

```bash
# Unattended
pnpm connect cloudflare --name acme --domain example.com --subdomain my-team --account-id <id>
pnpm connect vercel --name acme --suffix -your-team.vercel.app
```

### Files written

Both hosts get `project.config.json`. Commit it: the loader, the build and the checks all read it.

```json
{
  "host": "cloudflare",
  "name": "acme",
  "deployUrl": "https://acme.example.com",
  "mediaUrl": null,
  "previewHostSuffix": "-acme.my-team.workers.dev"
}
```

Cloudflare also gets `wrangler.jsonc`: the worker name, `account_id`, a `compatibility_date`, `nodejs_compat`, the generated router as `main` (`.generated/worker.ts`), `dist/` as the assets directory with `/api/*` running the Worker first, the custom domain as a route, and preview URLs on. Vercel needs nothing more: `vercel.json` is already in the template.

Neither host's run deletes the other's files, so one project can run on both while you move.

### Re-running

It's safe to run again. Existing values are the defaults, and unattended runs reuse them, so a re-run with the same inputs changes nothing and says so.

- Changing the host asks first (or needs `--yes`), because the URLs in `project.config.json` are replaced.
- An existing `compatibility_date` in `wrangler.jsonc` is kept, unless it's newer than the workerd that Wrangler ships, in which case it's lowered.
- `wrangler.jsonc` is rewritten as plain JSON, so comments in it are lost. Settings you added (`vars`, bindings, other routes, extra `assets` options) are kept.
- If the Wrangler login doesn't list the `account_id` already in `wrangler.jsonc`, it stops rather than switch accounts. Pass `--account-id` to confirm.

## Cloudflare

**The Cloudflare account must own the base domain.** `connect` writes `account_id` into `wrangler.jsonc`, and the deploy creates `<name>.<domain>` on that account. The domain must be active as a zone on the account Wrangler uses. In testing, a deploy under an account that didn't have the domain failed with `The zone "<domain>" does not exist on your account`. With several accounts logged in, `connect` asks which one, or takes `--account-id`.

Before running it, log in once: `pnpm wrangler login` (or set `CLOUDFLARE_API_TOKEN`). `--account-id` is still needed without a Wrangler login.

Then, in the Cloudflare dashboard:

1. Commit and push `project.config.json` and `wrangler.jsonc`.
2. Workers & Pages → create an application and connect the repository (Workers Builds).
3. Set the build command to `pnpm build`. Leave the deploy command as the default.
4. Under Branch control, enable builds for non-production branches, so each branch gets a preview URL.
5. Run `pnpm dev` and paste the loader it prints into the site's custom code in Webflow.

Deploys happen only from git. `pnpm dep` prints a reminder to push to `main`; it never uploads a laptop build.

The build writes `dist/_headers` (the same CORS rules and `.glb`/`.gltf` content types as `vercel.json`) and `.generated/worker.ts`. Both are build output, so they aren't committed. A `public/_headers` would be replaced, with a warning.

A build with no `project.config.json` fails on Workers Builds, because it would otherwise ship bundles with no origin for `public/` files.

`.tool-versions` lists only Node, at a version the build image already has. Workers Builds installs everything in that file, and a pnpm line there, or a Node version the image lacks, failed the build while installing tools. pnpm comes from `packageManager` through Corepack instead.

Confirmed on real Workers Builds pushes (2026-11-11): the default build token creates the custom domain, Workers Builds runs the pnpm version in `packageManager`, it accepts the generated `main`, and a branch push serves that branch's bundle at `<branch>-<name>.<workers.dev subdomain>.workers.dev`.

## Vercel

Connect it, then in Vercel:

1. Commit and push `project.config.json`. `vercel.json` is left as it is.
2. Import the repository as a project named `<name>`, so production is `https://<name>.vercel.app`.
3. Turn off Deployment Protection for preview deployments, or the loader can't fetch them from Webflow. See [Branch Previews](./branch-previews.md#vercel-deployment-protection). This also makes the preview deployments' API routes public.
4. Run `pnpm dev` and paste the loader it prints into the site's custom code in Webflow.

`pnpm dep` calls the deploy hook in `VERCEL_DEPLOY_HOOK`.

On Vercel, `connect` assumes the production URL is `<name>.vercel.app`. If yours is different, edit `deployUrl` in `project.config.json` (any `https` origin with no path is valid).

## Preview allowlist

The loader only accepts `?js=` and `?css=` URLs whose host ends in `previewHostSuffix` (see [Branch Previews](./branch-previews.md)), and the bundle only trusts its own script URL as an origin on those hosts.

- **Cloudflare:** the suffix is `-<name>.<subdomain>.workers.dev`. It also matches any Worker in the same account whose name ends in `-<name>`. Those are all yours, so that's accepted.
- **Vercel:** on Vercel the suffix only proves the hostname ends in your team slug. A Vercel project on another account whose name ends in `-your-team` would also pass. The worst case: someone creates a Vercel project named like `anything-your-team` and gets a person to open a crafted `?js=` link on the `.webflow.io` staging site. That project's script then runs on the staging page, and the tab keeps loading it on every page until `?js=off` or the tab is closed. The published site is not affected. `connect` only accepts a `-<team>.vercel.app` style suffix; a custom domain cannot be used.

`connect` refuses a suffix without a leading `-` or `.`, and a Vercel suffix that isn't one team label plus `.vercel.app`.

## What is served

Static files from `dist/`, built on push: `app.js` and `pages/*.js`, `app.css`, the `.js.txt` copies, the `.js.map` source maps (so the source is public), everything in `public/`, and `build-manifest.json`. Branch previews get their own copy of `public/`.

`.js.txt` files uploaded to Webflow Assets keep working. The bundle only trusts a preview host as its script origin, so from Webflow's CDN it falls back to the deploy URL for `public/` files and `apiPath()`.

On Cloudflare, `OPTIONS` on static assets returns 405, so a preflighted cross-origin asset fetch (one with custom request headers) fails. Plain script, image and `fetch` loads are fine.

### API

Routes are code in `api/`, written the same way on both hosts: a file `api/<name>.ts` that exports one function per HTTP method (`GET`, `POST`, ...), each taking a `Request` and returning a `Response`. It's served at `/api/<name>`.

- A handler that needs `HEAD` exports `HEAD` itself; both hosts return 405 otherwise.
- Handlers set their own CORS headers (see `api/test.ts`, and `OPTIONS` if the browser preflights).
- On Cloudflare, `pnpm build` generates the router from the top-level `api/*.ts` files. Files starting with `_` or `.`, `*.test.ts` and `*.d.ts` aren't routes, and subfolders hold shared helpers. A method the file doesn't export gets 405 with an `Allow` header, an unknown route gets 404, and a thrown error gets 500. With an empty `api/` the router always answers 404.
- `pnpm api` runs the same files locally, on port 6546. If you have no API routes, delete the `api/` folder.

Calling a route from the bundle: `apiPath("test")` from `@/utils/api-path` gives the local server in dev and the deploy URL in production.

## Media on R2

> **Note:** `--media` has not been run against a real Cloudflare account yet. Delete this note once it has.

Heavy files (large video, models, textures) don't belong in `public/`, which is deployed with every branch. Cloudflare projects can keep them in an R2 bucket instead:

```bash
pnpm connect cloudflare --media --zone-id <zone id>   # or set WF_ZONE_ID
```

`--media` runs three Wrangler steps and then writes `mediaUrl` to `project.config.json`:

1. Creates the bucket `<name>-media` (so `--name` can be at most 57 characters).
2. Attaches the domain `<name>-media.<base domain>`, which needs the zone ID of the base domain (Cloudflare dashboard, domain overview, right sidebar).
3. Sets CORS so WebGL and `fetch` can read the files: `GET` and `HEAD` from any origin, with `Range` and `Content-Type` allowed so ranged requests work.

If a step fails, the ones before it have already changed your account. Running the same command again continues from where it stopped.

In code, `mediaUrl()` gives the full URL, the same way `publicAssetUrl()` does for `public/`:

```ts
import { mediaUrl } from "@/utils/public-asset";

const model = mediaUrl("models/hero.glb"); // https://<name>-media.<base domain>/models/hero.glb
```

With no media bucket it falls back to `publicAssetUrl()`.

Upload with Wrangler, from the project folder so it uses the account in `wrangler.jsonc`:

```bash
pnpm wrangler r2 object put <name>-media/models/hero.glb --file ./hero.glb --content-type model/gltf-binary --remote
```

Pass `--remote`. Without it, Wrangler writes to local storage on your machine and the upload never reaches R2. Set `--content-type` yourself: Wrangler only sends the metadata flags you give it. `--cache-control` sets caching. Wrangler 4.155 refuses uploads over 300 MiB, so bigger files need another way to upload.

## Environment

| Variable | Used by | Notes |
|---|---|---|
| `WF_BASE_DOMAIN` | `connect cloudflare` | Default for `--domain` |
| `WF_ZONE_ID` | `connect cloudflare --media` | Default for `--zone-id` |
| `CLOUDFLARE_API_TOKEN` | Wrangler | Alternative to `pnpm wrangler login` |
| `VERCEL_DEPLOY_HOOK` | `pnpm dep` on Vercel | Optional |
| `PUBLIC_ASSET_ORIGIN` | build | Overrides the origin baked into the bundle for `public/` files |
| `USE_SSL` | dev server | `true` for HTTPS, see [SSL Setup](./ssl.md) |
| `WF_DEV_PORT` | dev server | Port for `pnpm dev`, default 6545 |

The rest of the settings live in `project.config.json`, not in env vars. There's one automatic exception: a project that has no `project.config.json` and builds on Vercel falls back to the `VERCEL_URL` that Vercel sets itself. Don't set it by hand. On Workers Builds, with no config, the build fails.

The project runs on pnpm, pinned by `packageManager` in `package.json`. Both hosts build with `pnpm build`: Workers Builds through the build command above, Vercel through `vercel.json`. Bun is the bundler and dev runtime that the pnpm scripts call, at the version in the lockfile, so don't use `bun` commands directly ([why](./setup.md#use-pnpm-not-bun)). Use Node 22.13 or newer.

## Moving an existing project

Existing sites keep working on Vercel. Moving to Cloudflare is something you do per project, on a branch:

1. Bring the template changes into the project, then on that branch run `pnpm connect <host>` and commit `project.config.json` with them. Do this before merging to `main`, so the first production build already has its config. A Vercel build with no config still works through the `VERCEL_URL` fallback, but a Workers Builds build fails.
2. To move to Cloudflare, run `pnpm connect cloudflare` and answer yes to the host change. Set up the Workers Builds project as above and check the Cloudflare URL serves `app.js` before changing any site.
3. Every site's loader must then be re-pasted from `pnpm dev` and republished, because the loader has the deploy URL baked in. A site that stays on Vercel can keep its old loader until you choose to update it.
4. Vercel can keep running alongside. Both hosts build the same commit, and the origin baked into a bundle comes from `deployUrl` in `project.config.json`, so once it points at Cloudflare, `public/` file URLs in a bundle loaded from Vercel point at Cloudflare too. Switch off Vercel when no site loads from it.

## Checks

`pnpm check:live` compares what a host serves with the current commit, on either host. See [House Rules](./house-rules.md) and the checks section of `CLAUDE.md` for the rest of the commands.
