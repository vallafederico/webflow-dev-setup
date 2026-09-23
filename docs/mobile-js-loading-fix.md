# Mobile JS Loading / Safari Privacy Fix

Branch: `fix/js-not-loading-on-mobile`

On mobile (especially Safari), the site could appear stuck with no JS — or Safari would prompt to “Reduce Privacy Protections” — because of how the loader and early bundle init interacted with third-party scripts and a missing `<body>`.

## Symptoms

- Custom JS never runs on phones / tablets viewing `.webflow.io` or production
- Safari Advanced Tracking / Private Browsing warning about the Vercel script URL
- Preloader / cover stuck forever after a cached reload
- About / info routes load a stub page script and never boot `App`

## Root causes & fixes

### 1. Loader (`bin/generateResponse.ts`)

**Problems**

- On `.webflow.io`, the loader always tried `https://localhost:6545` first. On a phone that address is the phone itself, with no dev server or trusted certificate, so every load made a failing request to a local address before falling back to the deploy. This is the most likely trigger for Safari's privacy prompt: a public page probing local addresses. Not yet confirmed on a physical iPhone.
- `crossOrigin="anonymous"` was set on classic (non-module) scripts, turning them into CORS requests. That wasn't breaking loading: `vercel.json` sends `Access-Control-Allow-Origin: *`, so the CORS check passes. It's just unnecessary for classic scripts.

**Fixes**

- Skip localhost on coarse-pointer devices (phones/tablets); load straight from deploy
- Drop `crossOrigin` from the injected script / preload tags
- Still allow desktop `.webflow.io` local-first with deploy fallback; use `?local=0` to force deploy

### 2. Editor detection (`src/webflow/detect-editor.ts`)

**Problems**

- `app.js` is injected from `<head>`, so on a cached reload it can run before `<body>` exists. Reading `document.body` threw during bundle init and killed the whole app.
- Many modules called `handleEditor()`, each creating its own `MutationObserver` on `document.body` with no disconnect.

**Fixes**

- Optional-chain `document.body` when checking editor state
- Defer observing until `document.body` exists (`DOMContentLoaded` if needed)
- One shared observer + listener set; `releaseEditor()` to drop listeners

### 3. Scroll (`src/lib/scroll.ts`)

Uses `handleEditor` at module init. With the body-safe shared observer above, scroll no longer crashes when the bundle evaluates before `<body>` is ready.

### 4. Page entries (`src/pages/`)

**Problem**

- About / info (and similar) page entry files were stubs (`console.log` only). The loader routes those slugs to the page file **instead of** `app.js`, so `App` never started on those URLs.

**Fix**

- Page entries import / boot `App` (e.g. `import "../app"`), optionally adding page-specific logic on top.

## After deploy

1. Rebuild / redeploy so the new loader script is generated
2. Paste the updated **Loader Script** from the dev server index into Webflow site `<head>` custom code
3. Publish the Webflow site
4. On a phone: confirm JS runs without a Safari privacy prompt; on desktop `.webflow.io`, local-first still works unless `?local=0`
