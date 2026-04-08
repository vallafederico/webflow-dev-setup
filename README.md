# Webflow Developer Setup

> As fast as it gets (thanks bun) development setup for Webflow development with bundling, CSS splitting, live reload, and advanced component lifecycle management.

_Technically part of [TheCodeFlowCo](https://www.thecodeflow.co/) lessons but was too good not to share 👀._

## Quick Start

```bash
# Create and enter project directory
mkdir your-project && cd your-project

# Clone this repo
degit vallafederico/webflow-dev-setup

# Install dependencies
bun install

# Start development
bun dev
```

## Features

- Local development with live reload
- Automatic bundling of JS and CSS
- Seamless production deployment
- API routes support
- Local script execution
- Optimized for speed
- **Enhanced Scroll System** with Lenis integration
- **Advanced Observer & Track System** for viewport detection and scroll tracking
- **Subscription System** with priority-based Raf and Resize management
- **Webflow Editor Integration** with automatic detection and handling
- **Component Lifecycle Management** with declarative hooks
- **Page Transition System** with Taxi.js integration

## Documentation

### Core Documentation

- [First-time Setup](./docs/setup.md)
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

The loader handles everything (JS + CSS) in a single `<script>` block:

```html
<script>
(function(d,h,host){
  var isWF = host.endsWith(".webflow.io");
  var DEP = "{YOUR VERCEL URL}";
  var LOC = "https://localhost:6545";

  function loadScript(src,cors){
    var s=d.createElement("script");
    s.src=src; s.defer=1;
    if(cors) s.crossOrigin="anonymous";
    h.appendChild(s); return s;
  }
  function loadCSS(href){
    var l=d.createElement("link");
    l.rel="stylesheet"; l.href=href;
    h.appendChild(l); return l;
  }

  var css = ["app.css"];
  var js = "app.js";

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
</script>
```

**How it works:**

- **Production** (non `.webflow.io`): loads JS and CSS directly from your Vercel deployment — fastest path, no fallback logic.
- **Dev** (on `.webflow.io`): preloads deployed assets, tries local dev server first, falls back to deployed on error.
- **Page routing**: if you have page-specific scripts in `src/pages/`, the loader auto-generates a pages map and picks the right JS file based on the URL path (e.g. `/home` loads `home.js`). Falls back to `app.js` if no page matches. See [Multiple Entry Points](./docs/multiple-entry-points.md).
- **CSS is fully managed by the loader** — no need for separate stylesheet tags or custom CSS inside Webflow.

> **Note**: Run `bun dev` and visit `http://localhost:6545` to get the generated loader with your actual URLs pre-filled.

## Component System

### Module Structure

Create modules in `src/modules/` with automatic discovery:

```typescript
// src/modules/example.ts
import {
  onMount,
  onDestroy,
  onPageIn,
  onPageOut,
  onView,
  onTrack,
} from "@/modules/_";
import { Raf, Resize } from "@lib/subs";
import { Scroll } from "@lib/scroll";
import gsap from "@lib/gsap";

export default function (element: HTMLElement, dataset: DOMStringMap) {
  // Lifecycle hooks
  onMount(() => {
    console.log("Component mounted");
  });

  onPageIn(async () => {
    await gsap.to(element, { opacity: 1, duration: 0.5 });
  });

  onPageOut(async () => {
    await gsap.to(element, { opacity: 0, duration: 0.3 });
  });

  // Viewport detection
  const observer = onView(element, {
    threshold: 0.1,
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
  const rafUnsubscribe = Raf.add(({ time }) => {
    element.style.transform = `rotate(${time * 50}deg)`;
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

## Development Workflow

### Local Development

```bash
bun dev        # Start development server
bun add pkg    # Install packages
```

### API Development

```bash
bun api        # Run API locally
vercel dev     # Run with Vercel capabilities
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
  │   ├── pages.ts     # Page transition system
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
bin/                   # Build scripts
docs/                  # Documentation
.cursor/rules/         # Cursor IDE rules
```

## Important Notes

> **Note**: If you're not using any API routes, delete the api folder so you don't deploy random stuffs to vercel

> **Note**: The system automatically detects Webflow editor mode and adjusts behavior accordingly

> **Note**: All components are automatically discovered and managed based on `data-module` attributes

## License

This project is licensed under the [MIT License](./LICENSE) © [Federico Valla](https://github.com/vallafederico)
