# SSL Setup

The dev server can serve over HTTPS, so the staging site (`https://*.webflow.io`) can load local files. Browsers block plain `http://localhost` scripts on HTTPS pages.

## Create the certificates

```bash
bun run setup-ssl
```

This runs `scripts/setup-ssl.sh`, which uses the `mkcert` npm package to:

1. Create a local certificate authority at `certs/ca.crt` / `certs/ca.key`
2. Add that authority to the system trust store (macOS keychain, asks for your password)
3. Issue `certs/localhost.pem` / `certs/localhost-key.pem` for `localhost`, `127.0.0.1` and `::1`

`certs/` is gitignored. Each developer creates their own.

## Run over HTTPS

```bash
USE_SSL=true bun dev
```

Or set `USE_SSL=true` in `.env`. The server runs at `https://localhost:6545`, and the generated loader uses that address for local files. Without the certificates, the dev server exits with instructions.

## iOS Simulator

The Simulator has its own trust store. With it booted, add the repo's authority:

```bash
xcrun simctl keychain booted add-root-cert certs/ca.crt
```

Then open the staging site with `?local=1`. See [Loader Script](./loader.md#local-code-in-the-ios-simulator).

Physical phones can't use the local server: `localhost` on a phone is the phone itself. Use a [branch preview](./branch-previews.md) instead.

## Troubleshooting

- **Chrome still warns about the certificate:** in `chrome://settings/security` → Manage certificates → Authorities, import `certs/ca.crt` and trust it for websites.
- **Regenerating:** delete `certs/` and run `bun run setup-ssl` again. Re-run the Simulator command after regenerating, since the authority changes.
