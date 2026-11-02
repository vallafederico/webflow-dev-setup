# Webflow Developer Setup

> As fast as it gets (thanks bun) development setup for Webflow development with bundling, CSS splitting, live reload, and advanced component lifecycle management.

_Technically part of [TheCodeFlowCo](https://www.thecodeflow.co/) lessons but was too good not to share 👀._

## Quick Start

```bash
# Create and enter project directory
mkdir your-project && cd your-project

# Clone this repo
degit vallafederico/webflow-dev-setup

# Install dependencies (Node 22 and pnpm; Bun is installed as a dev dependency)
pnpm i

# Start development
bun dev
```

`bun dev` works straight away, with no accounts. Its index page (`http://localhost:6545`) shows a "run `pnpm connect`" notice until you pick a host. When you're ready to deploy, choose Cloudflare or Vercel:

```bash
pnpm connect cloudflare   # or: pnpm connect vercel
```

See [Hosting](./docs/hosting.md) for the flags and the dashboard steps. Once connected, the same page prints the loader script to paste into Webflow.

## Features

- Local development with live reload
- Automatic bundling of JS and CSS
- Production deployment on Cloudflare or Vercel, chosen with `pnpm connect`
- API routes support
- Local script execution
- Optimized for speed
- **Enhanced Scroll System** with Lenis integration
- **Advanced Observer & Track System** for viewport detection and scroll tracking
- **Subscription System** with priority-based Raf and Resize management
- **Webflow Editor Integration** with automatic detection and handling
- **Component Lifecycle Management** with declarative hooks
- **Page Transition System** with Taxi.js integration (opt-in, off by default)
- **Checks agents and CI can run**: `pnpm check` and `pnpm check:all`, with house rules for modules

## Documentation

### Core Documentation

- [First-time Setup](./docs/setup.md)
- [Hosting: Cloudflare and Vercel](./docs/hosting.md)
- [Configuration Guide](./docs/config.md)
- [Changelog](./docs/changelog.md)
- [Project Rationale](./docs/rationale.md)

### System Documentation

- [Component Lifecycle & Page Transitions](./docs/component-lifecycle.md)
- [Scroll System](./docs/scroll-system.md)
- [Observer & Track System](./docs/observer-track-system.md)
- [Subscription System](./docs/subscription-system.md)
- [Tick – Performance Timing & Metrics](./docs/tick.md)
- [Webflow Integration](./docs/webflow-integration.md)
- [Loader Script](./docs/loader.md) – where JS/CSS load from, and every URL parameter
- [Mobile JS Loading / Safari Privacy Fix](./docs/mobile-js-loading-fix.md)
- [Branch Previews on `.webflow.io`](./docs/branch-previews.md)
- [House Rules](./docs/house-rules.md) – what `pnpm check` enforces on modules, and how to fix it

### Integrations

- [Webflow MCP in Cursor](./docs/webflow-mcp-cursor.md) – Use the Webflow MCP server in Cursor to manage sites, CMS, and Designer via chat

### Development Guides

- [Multiple Entry Points](./docs/multiple-entry-points.md)
- [JavaScript Usage](./docs/javascript.md)
- [Internal Architecture](./docs/bin.md)
- [CSS Issues](./docs/css-issues.md)
- [Environment Configuration](./docs/env-configuration.md)
- [SSL Setup](./docs/ssl.md)

## Project Setup

### Webflow Integration

Paste the **unified loader script** into your Webflow site's **Custom Code → Head Code**. The dev server at `http://localhost:6545` generates the full script for you — just click to copy.

The loader handles everything (JS + CSS) in a single `<script>` block. Simplified version below; the dev server output also includes page routing and the [branch preview](./docs/branch-previews.md) gate:

```html
<script>
(function(d,h,host){
  var isWF = host.endsWith(".webflow.io");
  var DEP = "{YOUR DEPLOY URL}";
  var LOC = "https://localhost:6545";
  // Phones/tablets cannot reach the developer's localhost; skip it there.
  var tryLocal = isWF && !matchMedia("(pointer: coarse)").matches && location.search.indexOf("local=0") === -1;

  function loadScript(src){
    var s=d.createElement("script");
    s.src=src;
    s.defer=true;
    h.appendChild(s); return s;
  }
  // Written while parsing so defer applies; appended scripts ignore it.
  function deferScript(src){
    if(d.readyState==="loading" && d.currentScript) d.write('<script defer src="'+src+'"><\/script>');
    else loadScript(src);
  }
  function loadCSS(href){
    var l=d.createElement("link");
    l.rel="stylesheet"; l.href=href;
    h.appendChild(l); return l;
  }

  var css = ["app.css"];
  var js = "app.js";

  function loadFromDeploy(){
    css.forEach(function(f){ loadCSS(DEP+"/"+f); });
    if(js) deferScript(DEP+"/"+js);
  }

  if(!isWF || !tryLocal){
    loadFromDeploy();
    return;
  }

  if(js){
    var p=d.createElement("link");
    p.rel="preload"; p.as="script"; p.href=DEP+"/"+js;
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
    s.onerror=function(){ loadScript(DEP+"/"+js); };
  }

})(document,document.head,location.hostname);
</script>
```

**How it works:**

- **Production** (non `.webflow.io`): loads JS and CSS directly from your deployment (the `deployUrl` in `project.config.json`) — fastest path, no fallback logic. The JS tag is written into the page so `defer` is honoured and the bundle never runs before `<body>` exists (see [Loader Script](./docs/loader.md#why-the-loader-looks-the-way-it-does)).
- **Dev** (on `.webflow.io`, desktop): preloads deployed assets, tries local dev server first, falls back to deployed on error.
- **Phones / tablets** on `.webflow.io`, or any page with `?local=0`: skips localhost and loads straight from the deployment.
- **iOS Simulator** (or any touch device that can reach your dev server): add `?local=1` to try localhost anyway, with the usual fallback. It's remembered for the tab; `?local=0` clears it. On the HTTPS staging domain this needs `USE_SSL=true` and the repo's certificate authority trusted in the Simulator (see [SSL Setup](./docs/ssl.md#ios-simulator)).

All loader URL parameters are listed in [Loader Script](./docs/loader.md).
- **Branch previews** (on `.webflow.io` only): add `?js=<preview url>` to load JS from a branch deployment, and/or `&css=<preview url>` for CSS. Localhost is skipped, page routing still applies, and the choice is remembered for that browser tab so a client can click around and reload. `?js=off` / `?css=off` clears it. Only `https` hosts ending in the `previewHostSuffix` from `project.config.json` are accepted, and a loader with no suffix accepts none. Production domains ignore these parameters. See [Branch Previews](./docs/branch-previews.md).
- **Page routing**: if you have page-specific scripts in `src/pages/`, the loader auto-generates a pages map and picks the right JS file based on the URL path (e.g. `/home` loads `home.js`). Falls back to `app.js` if no page matches. See [Multiple Entry Points](./docs/multiple-entry-points.md).
- **CSS is fully managed by the loader** — no need for separate stylesheet tags or custom CSS inside Webflow.

> **Note**: Run `pnpm connect`, then `bun dev` and visit `http://localhost:6545` to get the generated loader with your actual URLs pre-filled.

## Component System

### Module Structure

Create modules in `src/modules/` with automatic discovery:

```typescript
// src/modules/example.ts
import {
  onMount,
  onDestroy,
  onEditor,
  onPageIn,
  onPageOut,
  onView,
  onTrack,
} from "@/modules/_";
import { Raf, Resize } from "@lib/subs";
import { Scroll } from "@lib/scroll";
import gsap from "@lib/gsap";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  // Skip the effects below inside the Webflow Designer
  let inEditor = false;
  onEditor((isEditor) => {
    inEditor = isEditor;
  });

  // Lifecycle hooks
  onMount(() => {
    console.log("Component mounted");
  });

  onPageIn(async () => {
    if (inEditor) return;
    await gsap.to(element, { opacity: 1, duration: 0.5 });
  });

  onPageOut(async () => {
    await gsap.to(element, { opacity: 0, duration: 0.3 });
  });

  // Viewport detection
  const observer = onView(element, {
    threshold: 0.1,
    autoStart: true,
    callback: ({ isIn }) => {
      element.classList.toggle("in-view", isIn);
    },
  });

  // Scroll tracking
  const track = onTrack(element, {
    bounds: [0, 1],
    callback: (value) => {
      element.style.setProperty("--scroll-progress", value.toString());
    },
  });

  // Subscriptions
  const rafUnsubscribe = Raf.add(({ deltaTime }) => {
    if (inEditor) return;
    element.style.transform = `rotate(${deltaTime * 50}deg)`;
  });

  const resizeUnsubscribe = Resize.add(({ width }) => {
    element.style.fontSize = width < 768 ? "14px" : "18px";
  });

  const scrollUnsubscribe = Scroll.add(({ progress }) => {
    element.style.transform = `translateY(${progress * 100}px)`;
  });

  // Cleanup
  onDestroy(() => {
    rafUnsubscribe();
    resizeUnsubscribe();
    scrollUnsubscribe();
  });
}
```

### HTML Integration

```html
<div data-module="example">Your content here</div>
```

`pnpm new:module <name>` writes a module that already passes the house rules. See [House Rules](./docs/house-rules.md).

## Development Workflow

### Local Development

```bash
bun dev        # Start development server
pnpm add pkg   # Install packages
```

### Checks

```bash
pnpm check       # Format, lint, types, house rules, unit tests. Run after every change
pnpm check:all   # Adds the production build, bundle and host checks, and a browser run. Run before calling work done
pnpm check:live  # Compares the deployed files with the current commit. Run after a push
pnpm fix         # Applies the safe autofixes
```

Exit code `0` means passed, `1` findings, `2` a tool failed (never a pass). CI runs `pnpm check:all` on every pull request (`.github/workflows/check.yml`).

### API Development

```bash
bun api        # Run API locally
vercel dev     # Run with Vercel capabilities (Vercel projects only)
```

### All (dev and APIs)

```bash
bun all        # Run both API and dev
```

## Advanced Topics

- [Multiple Entry Points](./docs/multiple-entry-points.md)
- [JavaScript Usage](./docs/javascript.md)
- [Internal Architecture](./docs/bin.md)

## Project Structure

```
src/
  ├── app.ts           # Main application entry
  ├── lib/             # Core libraries
  │   ├── scroll.ts    # Scroll system with Lenis
  │   ├── pages.ts     # Page transition system (Taxi, off by default)
  │   ├── subs.ts      # Subscription system (Raf/Resize)
  │   └── gsap.ts      # GSAP configuration
  ├── modules/         # Component modules
  │   ├── _/           # Core module system
  │   │   ├── create.ts    # Module discovery
  │   │   ├── runner.ts    # Lifecycle hooks
  │   │   ├── observe.ts   # Observer system
  │   │   └── track.ts     # Track system
  │   └── *.ts         # Your component modules
  ├── webflow/         # Webflow integration
  │   └── detect-editor.ts # Editor detection
  └── styles/
      ├── app.css      # Main CSS entry with imports
      ├── media.css    # Media queries
      ├── editor.css   # Editor-specific styles
      └── mod/         # CSS modules
api/                   # API routes
bin/                   # Build, connect and check scripts
docs/                  # Documentation
project.config.json    # Host settings, written by `pnpm connect`
wrangler.jsonc         # Cloudflare settings, written by `pnpm connect cloudflare`
.claude/skills/        # Agent skills (source), copied by `pnpm sync:skills`
.cursor/rules/         # Cursor IDE rules
```

## Important Notes

> **Note**: If you're not using any API routes, delete the api folder so you don't deploy random stuffs to your host

> **Note**: The system automatically detects Webflow editor mode and adjusts behavior accordingly

> **Note**: All components are automatically discovered and managed based on `data-module` attributes

## License

This project is licensed under the [MIT License](./LICENSE) © [Federico Valla](https://github.com/vallafederico)
