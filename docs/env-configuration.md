# .Env Configuration

Environment variables go in `.env` (gitignored). `.env.example` lists the ones the project reads:

| Variable | Required | Description |
|---|---|---|
| `USE_SSL` | No | `true` serves the dev and API servers over HTTPS. Needs certificates, see [SSL Setup](./ssl.md) |
| `VERCEL_DEPLOY_HOOK` | No | Webhook that `pnpm dep` calls to trigger a Vercel deploy. Vercel only |
| `PUBLIC_ASSET_ORIGIN` | No | Overrides the origin baked into the bundle for `public/` file URLs at build time |

The deploy URL, preview suffix and host are not environment variables. They are in `project.config.json`, written by `pnpm connect` and committed: see [Configuration Guide](./config.md#project-settings) and [Hosting](./hosting.md).

The one automatic exception: a production build on Vercel with no `project.config.json` uses the `VERCEL_URL` that Vercel sets itself. Don't set it by hand.

`pnpm connect` also reads `WF_BASE_DOMAIN` and `WF_ZONE_ID` as defaults for its flags, and Wrangler reads `CLOUDFLARE_API_TOKEN`. See [Hosting](./hosting.md#environment).
