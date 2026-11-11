# Plan: create Cloudflare projects for the team from the dev page

Status: ready to implement once "Setup for the account owners" is done. Nothing here is built yet.

Setup progress, checked 2026-11-11:

- Step 1 is done. `itsoffbrand.dev` is active on the account `ob-ops` (ID `5397e49e27a3bdf3feb44682527cc6e6`), whose `workers.dev` subdomain is `ob-ops`. The account has no Workers yet.
- Step 3 is done. An org owner installed the GitHub app on `itsoffbrand` with access to all repositories. Still to confirm: which Cloudflare user connected it.
- Step 2 is deferred. For now steps 4 and 5 are done as `federico@itsoffbrand.com`, not an ops user. Moving them to an ops user is in Known limits.
- Step 5 is done for the hand tests: a user token `deploy-setup` (federico@itsoffbrand.com), with Workers Builds Configuration Edit, Workers Scripts Edit and Account Settings Read on `ob-ops`, plus DNS Read on `itsoffbrand.dev`. It expires on 2026-12-11. It lives in the gitignored `.wrangler/home/cloudflare.env` on Federico's machine. The creator Worker gets its own token when it's deployed. The Builds API accepts it, and the account has no build tokens yet.
- Step 4 is done. Importing the test repo `itsoffbrand/creator-test` (private, repo ID `1453966759`) created the Worker `creator-test` and the default build token `creator-test build token`, UUID `d3161106-e8aa-4c3b-8f60-ddb87522a671`. Cloudflare already had the `itsoffbrand` GitHub connection, so no owner step was needed. After `.tool-versions` was fixed, the push of `afca6ea` built and deployed `https://creator-test.itsoffbrand.dev`, and the build token created the custom domain. That covers "Prove first" step 4 for production.
- Steps 6 and 7 are open. The account's only members are two Super Administrators, `ross@` and `federico@itsoffbrand.com`.
- The Builds API refuses wrangler's OAuth login (`GET /builds/tokens` returns an authentication error), so the "Prove first" calls need the step 5 API token.

## Goal

Someone at Off+Brand starts a project, presses one button on the `pnpm dev` page, confirms an email code, and gets a working deploy link and loader. They need no Cloudflare login, no token and no dashboard steps.

```text
degit, git init, push to itsoffbrand/<repo>
pnpm dev -> Connect a host -> Off+Brand team
  -> new.itsoffbrand.dev: email code, check name and repo, Create
  -> back on the dev page: config written, full loader shown
commit and push -> first build -> https://<name>.itsoffbrand.dev/app.js
```

## Decisions

| Topic | Decision |
|---|---|
| Sharing a token | No. [Creating a Worker needs Workers Admin across the account](https://developers.cloudflare.com/workers/authorization/workers/), so a shared token could also overwrite or delete every site on it |
| Who holds the credentials | A small "creator" Worker. Its code has no edit or delete route, which is what makes it create-only |
| Where it runs | Private repo `itsoffbrand/project-creator`, deployed at `new.itsoffbrand.dev` on the Cloudflare account that owns `itsoffbrand.dev`. It doesn't go in the template, which is public and is copied into every project |
| Login | Cloudflare Access with one-time email codes, only for emails ending in `@itsoffbrand.com`. We write no auth code |
| Allowed repos | `itsoffbrand/*` only |
| Limits | 2 projects per hour per email, and 10 per day for everyone, counted in D1. [The rate limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) only has 10 or 60 second windows, per location, so it can't do this |
| What the person gets back | Name, domain, subdomain and account ID. None are secret, and no token leaves the Worker |
| First build | Not started by the Worker. The build needs `project.config.json` and `wrangler.jsonc` in the repo, so the person's next push starts it |
| Creating the GitHub repo | Not in this version. The repo must already exist and be pushed |
| Other teams | They run their own copy on their own account. This one only serves Off+Brand |

## Setup for the account owners

No code is needed for this. Don't send any token through chat, email or a ticket: each one goes straight into `wrangler secret put` in step 7.

**Who:** someone who is an admin on the Cloudflare account that owns `itsoffbrand.dev`, and an owner of the [`itsoffbrand`](https://github.com/itsoffbrand) GitHub org. These can be two people.

1. **Confirm the account.** In Cloudflare, confirm `itsoffbrand.dev` is an active domain on the account, and note the account ID and the `workers.dev` subdomain.
2. **Create a dedicated ops user.** Add a user such as `ops@itsoffbrand.com` to the account. [The Builds API only accepts user tokens](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/), so the token stops working if the person who made it leaves. Do steps 3 to 5 logged in as this user. (Deferred for now: see Known limits.)
3. **Install the GitHub app** (needs a GitHub org owner or the GitHub Apps Manager role). In Workers & Pages, open any Worker, or create one by importing a repo, then go to **Settings > Builds > Connect**. Choose GitHub and authorize the app for **`itsoffbrand`**, not a personal account.
   - Done with **All repositories**, so every new repo in the org works with the Create button without being added by hand. The trade-off is that the app can read all of the org's repos (180 now).
4. **Create a build token.** In that Worker, go to **Settings > Builds > API token** and let Cloudflare create the default one. It's needed because [only the default token includes Workers Routes edit for all zones](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), which is what creates each project's domain. There's no documented API for creating one.
5. **Create the Cloudflare API token** at `dash.cloudflare.com/profile/api-tokens`, as a user token, with:
   - Workers Builds Configuration: Edit
   - Workers Scripts: the level that can create Workers (Workers Admin)
   - Zone DNS: Read, for `itsoffbrand.dev`
6. **Create a GitHub read token.** A fine-grained token owned by the `itsoffbrand` org, with Metadata: Read on all repositories. The creator needs it to look up the IDs of private repos. It can't read code. The org may need to approve it.
7. **Turn on Access.** In Zero Trust, add **One-time PIN** as a login method, because [it's no longer on by default](https://developers.cloudflare.com/cloudflare-one/changelog/access/). When the creator is deployed, add an Access application for `new.itsoffbrand.dev` with one Allow rule: **Emails ending in `@itsoffbrand.com`**. [One-time PIN with no email rule lets anyone in](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/). Check the Zero Trust free plan's seat limit against the team size, which we haven't confirmed.

**Send back to the developer:** the account ID, the `workers.dev` subdomain, the build token's UUID (`GET /accounts/<id>/builds/tokens` lists it without the secret), the test repo's name, and whether steps 1 to 7 are done. None of these are secrets. The two tokens go in as secrets by the person holding them:

```bash
pnpm wrangler secret put CLOUDFLARE_API_TOKEN
pnpm wrangler secret put GITHUB_TOKEN
```

## Prove first

Test these by hand with `curl` on the test repo before writing the Worker, because they can change the design. The test repo gets a copy of the template from `feat/cloudflare-hosting`. These also cover the real-account checks the hosting plan is still waiting on (Part 1, done checks 8 and 9).

Results from 2026-11-11 on `itsoffbrand/creator-test-2` (private, repo ID `1454001533`), all with the `deploy-setup` user token:

1. **Passed.** `PUT /accounts/<id>/workers/scripts/creator-test-2` with a one-module placeholder returns the tag in `result.tag`, so no second call is needed.
2. **Passed.** `POST /accounts/<id>/builds/workers` with the body below, unchanged, connected the private org repo. It returned `success: true` and created the production trigger for `main`. The repo was already pushed with its config, and nothing ran until the next push.
3. Skipped: the app has access to all repositories, so there's no unlisted repo to test with.
4. **Passed.** The next push to `main` built and deployed in under a minute, and the build token created `creator-test-2.itsoffbrand.dev`. The deployed `build-manifest.json` has that push's commit.
5. **Passed.** Pushing the branch `preview-test` created a preview, which built with `npx wrangler preview` and served that branch's commit at `https://preview-test-creator-test-2.ob-ops.workers.dev`. Its builds are listed under `GET /builds/workers/<tag>/previews/<preview id>/builds`, not under the Worker's own builds.
6. Inside the Worker, [`ctx.access.getIdentity()`](https://developers.cloudflare.com/changelog/post/2026-08-14-workers-access/) returns the verified email. If it doesn't, validate the [`Cf-Access-Jwt-Assertion` header](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) against the application's AUD tag. Still open: needs setup step 7.
7. A name that already has a DNS record makes the build fail, which tells us whether the DNS check below is needed. Still open: it needs a DNS record created on the zone, and `deploy-setup` only has DNS Read.
8. **Failed, and it changes the design.** A Worker's custom domain can be taken by another project's build. `itsoffbrand/creator-clash-test` was connected as Worker `clash-test`, with its `wrangler.jsonc` route set to `creator-test.itsoffbrand.dev`, a domain the Worker `creator-test` already had. Its build succeeded and moved the domain to `clash-test`. Wrangler only warned that the Worker was last updated through the API. Rebuilding `creator-test` took the domain back. The default build token can edit Workers routes on every zone, so the creator's name check only protects a project when it's created. Anyone who can push to any connected repo can later point its route at another project's `*.itsoffbrand.dev`. See "Domain takeover after creation" below.

Also found: `POST /builds/workers` returns `12002: Invalid request body` without `previews_enabled` and `previews_base_config`, so send both. `POST /builds/triggers/<trigger uuid>/builds` with `{"branch": "main"}` starts a build, for a repo that was pushed before it was connected.

```json
{
  "script_tag": "<worker tag>",
  "git_repository": {
    "provider_type": "github",
    "provider_account_id": "88026844",
    "provider_account_name": "itsoffbrand",
    "repo_id": "<repo id>",
    "repo_name": "<repo>",
    "branch": "main"
  },
  "production_settings": {
    "build_command": "pnpm build",
    "deploy_command": "npx wrangler deploy",
    "build_token_uuid": "<build token uuid>"
  },
  "previews_enabled": true,
  "previews_base_config": {
    "build_command": "pnpm build",
    "deploy_command": "npx wrangler preview",
    "build_token_uuid": "<build token uuid>"
  }
}
```

## Work

### 1. The creator Worker (`itsoffbrand/project-creator`)

`wrangler.jsonc`: a custom domain at `new.itsoffbrand.dev`, `workers_dev: false` and `preview_urls: false` so nothing bypasses the login, a D1 binding, and vars `ACCOUNT_ID`, `BASE_DOMAIN`, `WORKERS_SUBDOMAIN`, `BUILD_TOKEN_UUID`, `GITHUB_ORG`.

`GET /new?name=&repo=&state=&return=` shows a form with the name and repo filled in, and the deploy link they will get.

`POST /new` runs these in order and stops at the first failure with a message the person can act on:

1. Read the email from Access. Refuse if it's missing or doesn't end in `@itsoffbrand.com`, even though Access already checked. Refuse a POST from another origin.
2. Check the limits.
3. Check the input:
   - The name uses the same rules as `pnpm connect`, plus `new` as a reserved name.
   - The repo is `github.com/itsoffbrand/<repo>`, in HTTPS or SSH form.
   - The return address is `http://localhost:<port>` or `https://localhost:<port>`, and nothing else.
4. **Refuse an existing name.** The name must be free in D1, as a Worker on the account, and as a DNS record on the zone. This is what stops someone replacing a client's live site.
5. Insert the D1 row with `status = creating`. The name column is unique, so two people can't claim one name.
6. Look up the repo ID from GitHub. A 404 means it doesn't exist or isn't in the org.
7. Upload the placeholder Worker and get its tag.
8. Connect the repo with the body above. If it fails, show Cloudflare's error. The app has access to every repo in the org, so this should only fail if that access changes.
9. Set `status = created` and redirect to the return address with `state`, `name`, `domain`, `subdomain` and `accountId`. Also show the equivalent `pnpm connect cloudflare ...` command, for when the dev server isn't running.

If a step fails, set `status = failed` and record the step. Only the same person, with the same name and repo, can retry, and the retry continues from where it stopped. A failed placeholder is removed by hand, since the Worker has no delete code.

D1 table `projects`: `name` (unique), `repo`, `email`, `status`, `failed_step`, `created_at`. It's also the log of who created what. Only attempts that reach step 5 count towards the limits.

### 2. The template (`feat/cloudflare-hosting`)

- `team.config.json`, committed: `{ "name": "Off+Brand", "creatorUrl": "https://new.itsoffbrand.dev" }`. The form only shows the team option when this file exists. Anyone else using the public template sees the option, gets stopped at the login, and can delete the file.
- `bin/connect-panel.ts`, a third choice in the form, using the file's name:
  - It fills the repo from `git remote get-url origin`. With no remote, it shows the commands to create and push one, and disables the button.
  - `POST /_connect/team` makes a random `state`, keeps it in memory for 15 minutes, and returns the creator URL to open.
  - `GET /_connect/created` needs that `state`, once. Without this check, any website could send the browser there and overwrite the config. It then calls `connect` with the returned values, rebuilds and shows the project panel.
- `bin/connect.ts`: a `managedBuild` option in `ConnectDeps` that drops the dashboard steps from the next steps, leaving "commit and push" and "paste the loader".
- Docs: `docs/hosting.md` and the README.

## Done checks

**Local:**

1. Creator tests with fake Cloudflare and GitHub APIs cover:
   - each refusal in steps 1 to 4, including an existing Worker, an existing DNS record and a third create within the hour
   - a retry after failure at each of steps 6 to 8
   - no response or log contains a token
2. Template tests: `/_connect/created` without the right `state`, or with a used one, writes nothing. The team option is hidden without `team.config.json`. `pnpm check:all` exits 0.

**On the real account, using the test repo:**

3. From a real `pnpm dev` page, a real `@itsoffbrand.com` email goes all the way through, with no Cloudflare login on that machine. After the push, `https://<name>.itsoffbrand.dev/app.js` serves that commit and `pnpm check:live` passes.
4. A branch push gets a preview, and `?js=<preview>` works on a staging site.
5. A non-`@itsoffbrand.com` email gets no code. `new.itsoffbrand.dev` can't be reached any other way, and the Worker's `workers.dev` URL doesn't exist.
6. Trying an existing project's name is refused, and that project is unchanged.
7. A third project within an hour from the same email is refused.

## Stop conditions

Stop and report, rather than work around it, if:

- the Builds API can't connect a private org repo with a user token
- a build can't create the custom domain with the default build token
- the only way to keep this working is to give people a Cloudflare token

Don't touch live Webflow sites, existing client repos or existing Workers on the account. Use only the test repo until done check 3 passes.

## Domain takeover after creation

Open decision, from "Prove first" step 8. A build deploys whatever route its repo's `wrangler.jsonc` names, and the build token may edit any route on the zone. So a typo, a copied repo or a bad actor can move a live project's domain to another Worker, and the build reports success. Options:

- **Accept it.** Everyone with push access is on the team. Mistakes show up as a site serving the wrong bundle, and the log shows which build did it.
- **Check in the build.** `pnpm build` fails when `wrangler.jsonc` routes name anything other than `<name>.itsoffbrand.dev` for the Worker's own name. This catches mistakes, not someone who edits the check out.
- **Take routes away from the build.** The creator attaches the domain itself through the Workers domains API, the projects' `wrangler.jsonc` has no `routes`, and the build token can't edit routes. That needs a custom build token, and whether Builds accepts one is untested.

## Known limits

- The token belongs to one user. [Account-owned tokens aren't supported yet](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/). When they are, move to one.
  - Tested on 2026-11-11 with an Account API Token on `ob-ops` that had Workers CI (Legacy) Edit, the closest permission offered, since the account token form has no "Workers Builds Configuration". The token verified as active, and it could list Workers and read the zone, but `GET /builds/tokens` and `GET /builds/repos/connections` both returned `12006: Invalid token`. So Builds still needs a user token.
- For now the build token and API token belong to `federico@itsoffbrand.com`. Before other people rely on the creator, add the ops user from setup step 2, redo steps 4 and 5 as that user, and replace the creator's `CLOUDFLARE_API_TOKEN` secret and `BUILD_TOKEN_UUID` var. Until then, both stop working if that user leaves or loses access.
- Anyone with an `@itsoffbrand.com` email and a repo in the org can create projects. That's the point, and the limits and log are the protection.
- Nothing cleans up old projects. Deleting one stays a manual job for an account admin.
