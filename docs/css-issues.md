# CSS Integration

## How CSS is Loaded

All CSS is managed by the **unified loader script** — there is no need to add separate `<link>` tags or custom CSS inside Webflow's Designer.

The loader injects `app.css` using the same local-first-with-fallback strategy as JavaScript:

- **Production**: CSS loads directly from Vercel.
- **Dev** (`.webflow.io`): tries local dev server first, falls back to Vercel on error.

## CSS Entrypoint

The single CSS entrypoint is `src/styles/app.css`. It imports all sub-files and is built by Bun's CSS bundler to `dist/app.css`.

Additional CSS entrypoints can be added in `bin/config.ts` if needed.

## Writing CSS

Write all your styles in the `src/styles/` directory. Use `@import` in `app.css` to organize:

```css
/* src/styles/app.css */
@import "./media.css";
@import "./editor.css";
@import "./mod/fluid-type.css";
@import "./mod/utils.css";
```

Since **no custom CSS is written inside Webflow**, there are no specificity conflicts between Webflow's styles and your custom styles. Your CSS always loads after Webflow's built-in styles, so overrides work naturally.

## Webflow Editor Styles

Use `src/styles/editor.css` for styles that should only apply or adjust behavior inside the Webflow Designer. The editor detection system (`handleEditor`) handles JS-side adjustments, but CSS-only tweaks can go here.

## Troubleshooting

If styles aren't updating during development:

1. Make sure `bun dev` is running — the loader tries local first
2. Hard-refresh the Webflow preview (Cmd+Shift+R)
3. Check the browser console for CSS load errors
4. If the local server is down, the loader automatically falls back to the last deployed version
