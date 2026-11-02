# House Rules

`pnpm check` runs these rules over `src/` with the TypeScript compiler API (`bin/check/house-rules.ts`). Each one comes from a mistake that has cost real time: a leaked listener, a bundle that crashed before `<body>` existed, an animation that ran inside the Webflow Designer. A finding names the rule, the file and line, and a fix.

```
FAIL  house-rules (1 error)
  cleanup/state-listener  src/modules/nav.ts:11
    State.on is given an inline function, which can't be removed, so the listener outlives the page
    fix: Name the handler ...
```

Rules marked **warning** don't fail the check. Everything else is an error. For machine-readable output, see `CLAUDE.md`.

## Rules

Scope is the file set a rule looks at. "Modules" means `src/modules/*.ts` and `src/modules/*.js`, not the `_/` folder.

| Rule | Scope | Enforces | Why | How to fix |
|---|---|---|---|---|
| `module/default-export` | modules | The file default-exports the function that receives the element | The module system mounts the default export on each `data-module` element | `export default function (element: HTMLElement, dataset: DOMStringMap) { ... }` |
| `module/signature` | modules | Parameters are `(element: HTMLElement, dataset: DOMStringMap)`, or fewer. A `.js` module only has its shape checked | Only the element and its dataset are passed in | Type the parameters this way and drop extra ones |
| `module/filename` | modules | Kebab-case, starting with a letter, and not a generic name (`module`, `modules`, `index`, `main`, ...) | The filename is the `data-module` value in Webflow, so it should say what the module does | Rename the file and update its `data-module` attribute |
| `imports/lifecycle` | all `src/` | Lifecycle hooks (`onMount`, `onDestroy`, `onEditor`, ...) are imported from `@/modules/_`, not a relative or deeper path such as `@/modules/_/runner` | One import path keeps the hooks greppable | Change the import. `pnpm fix` does it |
| `imports/subs` | all `src/` | `Raf` and `Resize` are imported from `@lib/subs`, not a relative or other alias path | Same as above | Change the import. `pnpm fix` does it |
| `imports/gsap` | all `src/`, except `src/lib/gsap.ts` | GSAP and its plugins come from `@lib/gsap`, including `import()` and `require()`. `import type` is fine | Plugins are registered once in `src/lib/gsap.ts`, so a direct `gsap` import can be missing them | `import gsap, { ScrollTrigger, SplitText } from "@lib/gsap"` |
| `subs/no-raw` | modules and `src/pages/` | No `requestAnimationFrame` and no `resize` listener or `onresize` | They run next to the shared ticker and the debounced `Resize` subscription | `Raf.add` or `Resize.add` from `@lib/subs`, and call the result in `onDestroy` |
| `cleanup/subscription` | modules | The function returned by `Raf.add`, `Resize.add` or `Scroll.add` is kept and called in `onDestroy` | Without it the callback keeps running after the page leaves | `const stop = Raf.add(...)`, then `onDestroy(stop)` or call `stop()` in it |
| `cleanup/state-listener` | modules | Each `State.on(event, handler)` has a `State.off(event, handler)` with the same handler in `onDestroy`. An inline arrow always fails. `State.once` is exempt | The listener outlives the page and runs against removed elements | Name the handler, pass it to both `on` and `off` |
| `cleanup/listener` | modules | `addEventListener`, `setInterval`, `IntersectionObserver`, `ResizeObserver` and `MutationObserver` are undone in `onDestroy`: matching `removeEventListener`, `clearInterval`, `disconnect()`. `{ once: true }` doesn't exempt a listener | Same as above. A `once` listener that never fires still outlives the page | Name the handler and remove it in `onDestroy`; store the interval id or observer and clear or disconnect it |
| `boot/no-body-at-load` | modules, **warning** | No `document.body` read at the top level of a file, outside a function. A condition such as `if (document.body)` is fine | The bundle can run from `<head>`, where `document.body` is `null`. This crashed the whole bundle on phones, see [Loader Script](./loader.md#why-the-loader-looks-the-way-it-does) | Read it inside `onMount` or a function, or wait for `DOMContentLoaded` |
| `browser/no-process-env` | all `src/` | No `process.env` except `process.env.NODE_ENV`, and no copying or destructuring `process` | `process` doesn't exist in the browser, and the build only replaces `NODE_ENV` | Read the value at build time (a define in `bin/public-asset-origin.ts` or `project.config.json`) or pass it in a data attribute |
| `editor/handled` | modules | A module that calls `Raf.add`, `onView`, `new SplitText` or an animating GSAP method (`gsap.to`, `gsap.timeline`, ...) also calls `onEditor`. `onTrack` and `Scroll` are exempt, because `src/lib/scroll.ts` already stops Lenis in the editor. GSAP calls that only read or configure (`utils`, `registerPlugin`, `defaults`, ...) don't count | Effects must not run inside the Webflow Designer | Import `onEditor` from `@/modules/_` and call `onEditor((isEditor) => { ... })` to skip or reset the effect when `isEditor` is true. It releases its listener on destroy |
| `debug/console` | modules, **warning** | No `console.log` | Left-over logging | Delete it, or keep it behind a debug flag |
| `house-ignore/reason` | all `src/` | A `// house-ignore` comment names a rule and gives a reason | An exception without a reason silences a rule without explanation. This rule can't itself be ignored | Write the comment as shown below |

## Exceptions

When a rule is wrong for one line, put a comment on the line above it:

```ts
// house-ignore cleanup/listener: the page reloads on this click, so there is nothing to undo
element.addEventListener("click", reload);
```

The form is `// house-ignore <rule>: <reason>`. It silences that rule for the next line only. Without a rule or a reason it silences nothing, and the comment itself is a `house-ignore/reason` error.

## What these rules can't see

The rules match syntax, not behaviour, so they can pass code that is wrong. These cases come from the checker's own list of limits (`LIMITS` in `bin/check/house-rules.ts`):

- Conditional cleanup counts as cleanup: `if (false) stop()` and `if (x) onDestroy(stop)` both pass.
- An `onDestroy` inside a function that is never called still counts.
- Names are matched as written, so a local variable that shadows an import (`const Raf = ...`) or an alias of one (`const r = Raf; r.add(...)`) isn't followed.
- A no-op `onEditor(() => {})` satisfies `editor/handled`. The rule checks that the helper is called, not what the callback does.
- Listener removal is matched on target, event and handler. A mismatch in the capture flag or other options isn't seen.
- A helper that subscribes on the module's behalf (`function track() { Raf.add(...) }` called from the module) is only checked inside the helper's own file.
- A subscription stored in a variable that is later reassigned (`let s = Raf.add(a); s = Raf.add(b); onDestroy(s)`) passes, though the first one leaks.
- Collections are followed only when filled by an array literal or `push`/`unshift` and drained by `forEach` or `for...of` in `onDestroy`.
- A cleanup passed through a function call, a callback argument or an object method isn't followed beyond local helpers.

`pnpm check:all` also runs the modules in a real browser (`bin/check/runtime.ts`), which catches some of these by behaviour: a count of subscriptions and listeners that grows after `onDestroy` and a remount, an error on load, or a crash when the script runs before `<body>` exists. A green `pnpm check` means no known mistakes, not no mistakes, so run `pnpm check:all` before calling work done.

Things no check decides, such as whether an animation feels right, stay with the skills in `.claude/skills/`.
