# First Time Setup

**Needs**

A **terminal** (also the one inside VScode or something is fine). A **code editor** (VScode, Cursor, whatever). A **github** account (ideally I'd link this to your code editor so it's easier to use). Node 22.13 or newer and **pnpm**.

For development you need nothing else. To deploy you need an account on one host: **Cloudflare** (with a domain on it) or **Vercel**. You pick it later with `pnpm connect`, see [Hosting](./hosting.md).

| **Package** | **Why**                                                  |
| ----------- | -------------------------------------------------------- |
| pnpm        | installs the project and runs every command, and pins the tool versions |
| Bun         | because YES. The bundler and runtime behind the commands. `pnpm i` installs it, so don't install it yourself |

## Use pnpm, not Bun

Every command here starts with `pnpm`: `pnpm i`, `pnpm dev`, `pnpm build`, `pnpm check`. The scripts call Bun for you, at the version in `pnpm-lock.yaml`, so a build on your machine and one on the host use the same Bun. A global Bun can be a different version, so don't use one for this project.

Don't run `bun install`, `bun add` or `bun <script>`. `bun install` replaces packages in `node_modules` and writes a `bun.lock`. `pnpm i` then reports "Already up to date" without repairing them, and `pnpm check` fails on `tsc` with errors about `undici-types`. To recover:

```shell
rm -rf bun.lock node_modules
pnpm i --frozen-lockfile
```

## Getting started

> If you are on windows godspeed go google how to install those stuffs I have no idea I'm sorry good luck

Strongly suggesting also degit so you can get a clean version when you start a new project without git history.

```shell
pnpm i -g degit
```

Then, in your project folder:

```shell
pnpm i
pnpm dev
```

`pnpm dev` runs without any account. Open `http://localhost:6545`: it has a **Loader Script (local only)** box to click, copy and paste into Webflow, so you can start building straight away. Before you publish, run `pnpm connect` and paste the full loader over it: [Hosting](./hosting.md).
