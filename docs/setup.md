# First Time Setup

**Needs**

A **terminal** (also the one inside VScode or something is fine). A **code editor** (VScode, Cursor, whatever). A **github** account (ideally I'd link this to your code editor so it's easier to use). Node 22.13 or newer and **pnpm**.

For development you need nothing else. To deploy you need an account on one host: **Cloudflare** (with a domain on it) or **Vercel**. You pick it later with `pnpm connect`, see [Hosting](./hosting.md).

| **Package** | **Why**                                                  |
| ----------- | -------------------------------------------------------- |
| pnpm        | installs the project, and pins the tool versions          |
| Bun         | because YES. Installed by `pnpm i`, so a global one is optional |

`bun <script>` commands need a global Bun, `pnpm <script>` doesn't. These docs use `pnpm`. To have a global Bun anyway:

```shell
pnpm i -g bun
```

```shell
npm i -g bun
```

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

`pnpm dev` runs without any account. Open `http://localhost:6545`: it shows a notice to run `pnpm connect` until you've picked a host. Do that when you're ready to deploy: [Hosting](./hosting.md).
