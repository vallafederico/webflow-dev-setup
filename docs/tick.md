# Tick – Performance Timing & Metrics

The `tick` utility provides performance timing, Web Vitals–style metrics, animation/FPS tracking, and frame-drop detection. It logs a “start” event and optional Web Vitals when your app boots.

## Overview

- **Timing**: Time from page load to JS execution, DOM ready, first paint.
- **Web Vitals**: FCP, LCP, FID, CLS, TBT, TTI (Lighthouse-style).
- **Animation**: FPS, frame times, smoothness, optional on-screen FPS display.
- **Frame drops**: Detection and attribution (slow functions, marks/measures).

To get **real** script-load and eval timings (not just “time when tick ran”), you must add a small snippet in `<head>` **before** any other scripts. Without it, you still get useful metrics, but the “eval” timing line is omitted.

---

## Head code for real measurements

For accurate **script load / eval** timing, the tick module needs a timestamp from as early as possible in the page. That timestamp must be set in `<head>` **before** your main script is loaded.

### What to add in Webflow

In **Site settings → Custom code → Head code**, add this **at the very top** (so it runs before any other script):

```html
<script>
(function(){ window.TICK_FIRST_HIT = performance.now(); })();
</script>
```

Requirements:

- It must run in `<head>`.
- It must run **before** the script that loads your bundle (the one that includes `tick`).
- No other scripts should run between this snippet and your main app script if you want “first hit → your JS” to reflect real network + parse time.

### What you get with head code

With `TICK_FIRST_HIT` set, the first `tick.add(...)` log includes:

- **js → X.XXs** – Time from navigation start to when the tick module started executing.
- **eval → X.XXs** – Time from `TICK_FIRST_HIT` to tick execution (script load + parse + eval).
- **DOM → X.XXs** – Time to DOM ready (from tick start).
- **render → X.XXs** – First paint (FCP) or first contentful paint.

Without the head snippet, only **js →** (and DOM/render when available) are shown; **eval →** is omitted because there is no “first hit” reference.

---

## Usage

The module runs automatically and logs `tick.add("start", true)` on load (when `ENABLE_TICK_LOGGING` is true). You can add more events and optionally show Web Vitals:

```typescript
import { tick } from "@/utils/tick";

// Log a named event (first call also shows timing lines; subsequent show delta)
tick.add("app-ready");

// Log and show Web Vitals in console
tick.add("page-ready", true);
```

### Key API

| Method | Description |
|--------|-------------|
| `tick.add(eventName, showVitals?)` | Log a timing event; first call shows js/eval/DOM/render, then deltas. Set `showVitals` to `true` to print Web Vitals. |
| `tick.getJsLoadDelay()` | Milliseconds from navigation start to when tick started. |
| `tick.getTimeSincePageLoad()` | Milliseconds since navigation start. |
| `tick.getWebVitals()` | FCP, LCP, FID, CLS, TBT, TTI (and related). |
| `tick.showWebVitals()` | Print Web Vitals to console. |
| `tick.getAnimationMetrics()` | FPS, frame times, smoothness, etc. |
| `tick.showAnimationMetrics()` | Print animation metrics to console. |
| `tick.startFrameTracking()` / `tick.stopFrameTracking()` | Start/stop FPS and frame-time tracking. |
| `tick.toggleFpsDisplay()` / `tick.showFpsDisplay()` / `tick.hideFpsDisplay()` | Toggle or show/hide the on-screen FPS overlay. |
| `tick.enableFrameDropDetection(true)` | Enable frame-drop detection. |
| `tick.instrumentFunction(fn, name)` | Wrap a function to measure its duration. |
| `tick.getFrameDropHistory()` | List of recent frame drops and attributed slow work. |
| `tick.cleanup()` | Disconnect observers and remove listeners. |

---

## Logging and flags

- **`ENABLE_TICK_LOGGING`** (exported from `@/utils/tick`): when `true`, timing logs and Web Vitals are printed; when `false`, `tick.add` and automatic “start” logging are no-ops. Set to `false` in production if you don’t want console output.

---

## Frame drop detection (optional)

For debugging animation jank:

1. `tick.enableFrameDropDetection(true)` – turns on frame-drop detection.
2. Optionally `tick.enableFunctionInstrumentation(true)` and/or `tick.instrumentFunction(fn, "name")` or `tick.instrumentObjectMethods(obj, "Prefix")` to attribute slow frames to specific functions.
3. On a dropped frame, the console shows slow functions (from Performance marks/measures and from instrumented functions).
4. `tick.getFrameDropHistory()` and `tick.getInstrumentedFunctionStats()` for programmatic inspection.

---

## Summary

- Add the **head script** (`window.TICK_FIRST_HIT = performance.now();`) in **Custom code → Head code**, before any other scripts, to get real **eval** and full timing breakdown.
- Use `tick.add("eventName", showVitals)` to log milestones and optionally print Web Vitals.
- Use `tick.getWebVitals()`, `tick.getAnimationMetrics()`, and frame-drop APIs for deeper performance analysis.
