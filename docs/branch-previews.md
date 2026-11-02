# Branch Previews on `.webflow.io`

Share a branch deployment with a client on the Webflow staging domain without touching production code.

Developers see branch changes through localhost. Clients can't, so the loader accepts query parameters that point JS and/or CSS at a preview deployment instead. Both hosts build a preview for each branch: see [Hosting](./hosting.md).

## Usage

Push the branch, wait for its preview deployment, then share a staging link with the preview URL. On Vercel it looks like `your-project-git-feature-your-team.vercel.app`, on Cloudflare like `feature-your-project.your-subdomain.workers.dev` (not yet confirmed on a real push, see [Hosting](./hosting.md#cloudflare)):

```
https://your-site.webflow.io/?js=https://your-project-git-feature-your-team.vercel.app
https://your-site.webflow.io/about?js=https://your-project-git-feature-your-team.vercel.app&css=https://your-project-git-feature-your-team.vercel.app
```

| Parameter | Effect |
|---|---|
| `?js=<preview url>` | Load the JS entry for this page from the preview |
| `?css=<preview url>` | Load the CSS files from the preview |
| `?js=none` / `?css=none` | Don't load our JS / CSS at all, to check whether an issue comes from the bundle or from Webflow and third-party scripts |
| `?js=off` / `?css=off` | Clear that preview and go back to normal loading |

- JS and CSS switch independently. Whatever isn't passed loads from the production deployment (`deployUrl` in `project.config.json`).
- Page routing still applies: `/about` loads `pages/about.js` from the preview.
- Localhost is skipped while any preview is active, so developers and clients see the same thing.
- The value can be a full URL, a bare host (`your-project-git-feature-your-team.vercel.app`), or quoted (`?js="…"`). Only the origin is used.
- The console logs `[loader] preview { js, css }` with the origins in use.

## Persistence

The preview is stored in `sessionStorage`, per browser tab. A client can open the link, click around, and reload without losing it. A new tab opened without the parameters loads normally, and so does the tab after `?js=off` / `?css=off`.

## Where it applies

Only on `*.webflow.io`. Production domains ignore the parameters entirely, so a preview link can never change what live visitors get.

## Security

Anyone can craft a staging link with these parameters, so the loader only accepts `https` URLs whose host ends in the allowed suffix. Anything else is ignored with a console warning and the page loads normally. A loader generated with no suffix accepts none.

The suffix is `previewHostSuffix` in `project.config.json`, written by `pnpm connect`:

| Host | Suffix | What it admits |
|---|---|---|
| Cloudflare | `-<name>.<subdomain>.workers.dev` | This project's previews, and any Worker in the same account whose name ends in `-<name>`. Those are all yours (not yet confirmed on a real push, see [Hosting](./hosting.md#cloudflare)) |
| Vercel | `-<team>.vercel.app` | Any host ending in your team slug, which isn't exclusive to the project or the team |

On Vercel the suffix only proves the hostname ends in your team slug, so a project on another account with a matching name would also pass. What that allows, and how far it reaches, is in [Hosting](./hosting.md#preview-allowlist).

The suffix is baked into the loader when the dev server generates it. Regenerate and re-paste the loader after changing it. `pnpm connect` refuses a suffix without a leading `-` or `.`, so `yourteam.vercel.app` can't also match `evil-notyourteam.vercel.app`.

## Vercel Deployment Protection

This applies to Vercel only. Vercel protects preview deployments by default (Vercel Authentication). A `<script>` tag can't sign in, so a client would get a login response instead of JS and nothing would run. For client previews, disable Deployment Protection for previews in the Vercel project settings, or scope it so these assets stay public.

## How it's implemented

The logic lives in the generated loader (`bin/generateResponse.ts`, `generateLoaderScript`). The dev server index at `http://localhost:6545` prints the full loader, including this gate, ready to paste into Webflow's head custom code.
