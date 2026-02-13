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

### JavaScript Integration

Add this script to your Webflow project's head:

```html
<script>
  function onErrorLoader() {
    const script = document.createElement("script");
    script.src = "{YOUR VERCEL PROJECT URL/app.js}";
    script.defer = "true";
    document.head.appendChild(script);
  }
</script>

<script
  defer
  src="http://localhost:6545/app.js"
  onerror="onErrorLoader()"
></script>
```

### CSS Integration

Add these stylesheets to your Webflow project:

```html
<!-- Production CSS -->
<link
  rel="stylesheet"
  href="http://localhost:6545/styles/out.css"
  onerror="this.onerror=null;this.href='{YOUR VERCEL PROJECT URL}/styles/out.css'"
/>

<!-- Designer CSS -->
<link rel="stylesheet" href="{YOUR VERCEL PROJECT URL}/styles/out.css" />
<link rel="stylesheet" href="http://localhost:6545/styles/app.css" />
```

> **Note**: See [CSS setup notes](./docs/css-issues.md) for handling potential styling conflicts.

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
      ├── out.css      # Compiled CSS output
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
