# Loader Script Refactoring Guide

Changes made to `bin/generateResponse.ts` to replace the old per-file `onerror` handler pattern with a unified loader script.

---

## What changed

### Before

The dev server index page showed individual `<script>` and `<link>` tags for each file, each with its own inline `onerror` fallback:

```html
<script defer src="https://localhost:6545/app.js" onerror="(function(){const script=document.createElement('script');script.src='https://deployed.vercel.app/app.js';script.defer='true';document.head.appendChild(script);})()"></script>
<link rel="stylesheet" href="https://localhost:6545/out.css" onerror="(function(){const link=document.createElement('link');link.rel='stylesheet';link.href='https://deployed.vercel.app/out.css';document.head.appendChild(link);})()">
```

### After

A single self-contained `<script>` block that handles all JS and CSS loading with:

1. **Production vs dev detection** — checks `location.hostname.endsWith(".webflow.io")`
2. **Production path** — loads everything directly from deployed URL (fastest)
3. **Dev path** — preloads deployed assets as fallback, tries local dev server first, falls back on `onerror`
4. **Page-specific JS routing** — if `src/pages/` has page scripts, the loader matches the URL path to pick the right JS file instead of always loading `app.js`

---

## How to replicate

### 1. Add `escapeHtml` helper

At the top of `generateResponse.ts`, add:

```typescript
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

### 2. Replace the loader script generator

Add a `generateLoaderScript` function that takes separated JS (app vs pages) and CSS file lists:

```typescript
function generateLoaderScript(
  appJs: string | null,
  pageJs: string[],
  cssFiles: string[],
  deployUrl: string,
  localUrl: string
): string {
  const cssArray = cssFiles.map((f) => `"${f}"`).join(", ");
  const hasPages = pageJs.length > 0;

  const pagesMap = hasPages
    ? `{${pageJs
        .map((f) => {
          const slug = f.replace(/^pages\//, "").replace(/\.js$/, "");
          return `"${slug}":"${f}"`;
        })
        .join(",")}}`
    : null;

  const fallback = appJs ? `"${appJs}"` : "null";

  return `<script>
(function(d,h,host){
  var isWF = host.endsWith(".webflow.io");
  var DEP = "${deployUrl}";
  var LOC = "${localUrl}";

  function loadScript(src,cors){
    var s=d.createElement("script");
    s.src=src; s.defer=1;
    if(cors) s.crossOrigin="anonymous";
    h.appendChild(s);
    return s;
  }

  function loadCSS(href){
    var l=d.createElement("link");
    l.rel="stylesheet"; l.href=href;
    h.appendChild(l);
    return l;
  }

  var css = [${cssArray}];
${
  hasPages
    ? `
  var pages = ${pagesMap};
  var slug = location.pathname.replace(/^\\/|\\/$/g,"").split("/")[0];
  var js = pages[slug] || ${fallback};`
    : `
  var js = ${fallback};`
}

  if(!isWF){
    css.forEach(function(f){ loadCSS(DEP+"/"+f); });
    if(js) loadScript(DEP+"/"+js, true);
    return;
  }

  if(js){
    var p=d.createElement("link");
    p.rel="preload"; p.as="script"; p.href=DEP+"/"+js; p.crossOrigin="anonymous";
    h.appendChild(p);
  }
  css.forEach(function(f){
    var p=d.createElement("link");
    p.rel="preload"; p.as="style"; p.href=DEP+"/"+f;
    h.appendChild(p);
  });

  css.forEach(function(f){
    var l=loadCSS(LOC+"/"+f);
    l.onerror=function(){ loadCSS(DEP+"/"+f); };
  });
  if(js){
    var s=loadScript(LOC+"/"+js);
    s.onerror=function(){ loadScript(DEP+"/"+js, true); };
  }

})(document,document.head,location.hostname);
<\\/script>`;
}
```

### 3. Update `generateIndexHtml` to separate app.js from page JS

In `generateIndexHtml`, replace the old single `jsFiles` array with:

```typescript
const allJs = outputs
  .filter((o) => o.path.endsWith(".js") && !o.path.endsWith(".js.map"))
  .map((o) => o.path.split("/dist/")[1]);

const appJs = allJs.find((f) => f === "app.js") ?? null;
const pageJs = allJs.filter((f) => f !== "app.js");

const cssFiles = outputs
  .filter((o) => o.path.endsWith(".css"))
  .map((o) => o.path.split("/dist/")[1]);

const loaderScript = hasVercel
  ? generateLoaderScript(appJs, pageJs, cssFiles, vercelUrl, localUrl)
  : null;
```

### 4. Add the loader script section to the HTML body

Replace the old per-file `onerror` boxes with a single loader block at the top of the `<body>`:

```typescript
${
  loaderScript
    ? `<h2>Loader Script</h2>
<p style="font-size:0.9em;color:var(--code-color)">Paste this into your Webflow site's <code>&lt;head&gt;</code> custom code. Loads from local dev server when on <code>.webflow.io</code>, falls back to deployed.</p>
<div class="loader-box">
  <span class="copy-hint">click to copy</span>
  <pre>${escapeHtml(loaderScript)}</pre>
</div>`
    : ""
}
```

### 5. Update the CSS class names

- Rename `.error-handler-box` → `.loader-box` in both styles and the click-to-copy JS
- The copy handler reads from `box.querySelector('pre').textContent` instead of `box.querySelector('code').textContent`

### 6. Add badges to JS file list

Optionally, label each JS file in the index page with its role:

```typescript
const jsLinks = allJs
  .map((relativePath) => {
    const isPage = pageJs.includes(relativePath);
    const slug = relativePath.replace(/\.js$/, "");
    const badge = isPage
      ? ` <span style="font-size:0.75em;opacity:0.6">(/${slug})</span>`
      : appJs === relativePath && pageJs.length > 0
      ? ` <span style="font-size:0.75em;opacity:0.6">(fallback)</span>`
      : "";
    return `<li>
      <a href="/${relativePath}" ...>${relativePath}</a>${badge}
      ...
    </li>`;
  })
  .join("\n");
```

---

## Summary

| Old behavior | New behavior |
|---|---|
| Per-file inline `onerror` attributes | Single unified `<script>` block |
| Always loads `app.js` | Matches URL path → page-specific JS, falls back to `app.js` |
| No preloading of fallback assets | Preloads deployed assets while trying local |
| Copy individual script/link tags | Copy one complete loader script |
| No production optimization | Production skips local attempt entirely |
