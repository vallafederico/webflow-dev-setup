# Multiple Entry Points & Page Routing

## Overview

By default, the loader script loads `app.js` on every page. If you need page-specific JavaScript, add files to `src/pages/` — the loader will automatically route by URL path.

## How It Works

1. Any `.js` or `.ts` file in `src/pages/` is built as a separate entrypoint alongside `app.js`.
2. The loader script generates a **pages map** from the filenames.
3. At runtime, the loader extracts the first path segment from `location.pathname` and matches it to a page file.
4. If a match is found, that page's JS loads **instead of** `app.js`. If not, `app.js` loads as the fallback.

### Example

Given these page files:

```
src/pages/
  ├── home.js
  └── about.js
```

The loader generates:

```javascript
var pages = {"home":"home.js","about":"about.js"};
var slug = location.pathname.replace(/^\/|\/$/g,"").split("/")[0];
var js = pages[slug] || "app.js";
```

| URL | Loads |
|---|---|
| `mysite.webflow.io/` | `app.js` (no slug → fallback) |
| `mysite.webflow.io/home` | `home.js` |
| `mysite.webflow.io/about` | `about.js` |
| `mysite.webflow.io/about/team` | `about.js` (first segment matches) |
| `mysite.webflow.io/contact` | `app.js` (no match → fallback) |

## Creating a Page Script

Add a file to `src/pages/` with the page slug as the filename:

```javascript
// src/pages/home.js
import "../app";
```

Typically, page scripts import `app.ts` to get the base functionality, then add page-specific logic on top. Or they can be fully standalone.

## Dev Server Index

When you run `bun dev`, the index page at `http://localhost:6545` shows all JS files with badges:

- **(fallback)** — `app.js`, loaded when no page matches
- **(/home)** — `home.js`, loaded on `/home`

The generated loader script at the top of the page already includes the pages map with your actual URLs.

## Adding / Removing Pages

The build system auto-discovers pages on every rebuild. During `bun dev`, adding or deleting a file in `src/pages/` triggers a re-scan and rebuild — no config changes needed.

## CSS

CSS entrypoints are separate from page routing. `app.css` loads on every page regardless of which JS file is selected. Additional CSS entrypoints can be added in `bin/config.ts` if needed.
