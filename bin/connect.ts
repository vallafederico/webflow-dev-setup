import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type Runner, StepError, setupMedia } from "./connect/media";
import {
  NAME,
  PROJECT_CONFIG_FILE,
  type ProjectConfig,
  type ProjectHost,
  SUFFIX,
  readProjectConfig,
  validateProjectConfig,
} from "./project-config";

export type { RunResult, Runner } from "./connect/media";

const WRANGLER_FILE = "wrangler.jsonc";
const RESERVED_NAMES = ["www", "api", "cdn", "mail", "admin", "ftp", "app"];
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
// A Vercel preview suffix is exactly one team label plus .vercel.app. Anything looser, such as
// `.vercel.app` or `-app`, would widen the loader's allowlist beyond one team.
const VERCEL_SUFFIX = /^[-.][a-z0-9]([a-z0-9-]*[a-z0-9])?\.vercel\.app$/;
// No leading "-", so an ID can never be read as a flag by wrangler.
const ID = /^\w[\w-]*$/;
// R2 bucket names, and so `<name>-media`, are at most 63 characters.
const MAX_NAME_WITH_MEDIA = 63 - "-media".length;

const USAGE = `Usage: pnpm connect <cloudflare|vercel> [flags]

Flags (each one answers a prompt, so the command can run unattended):
  --name <name>          Project name, a lowercase DNS label
  --yes, -y              Confirm a host change without asking

  cloudflare only:
  --domain <domain>      Base domain on your Cloudflare account (env: WF_BASE_DOMAIN)
  --subdomain <name>     Your workers.dev subdomain
  --account-id <id>      Cloudflare account that owns the domain (skips \`wrangler whoami\`)
  --media                Create the R2 media bucket and its domain
  --zone-id <id>         Zone ID of the base domain, for --media (env: WF_ZONE_ID)

  vercel only:
  --suffix <suffix>      Team preview suffix, like -your-team.vercel.app`;

/** A problem the user can fix. Printed without a stack trace, exit code 1. */
export class UserError extends Error {}

export interface Io {
  interactive: boolean;
  ask(question: string, fallback?: string): Promise<string>;
  log(message: string): void;
  error(message: string): void;
  close?(): void;
}

export interface ConnectDeps {
  cwd: string;
  run: Runner;
  io: Io;
  env: Record<string, string | undefined>;
  /** Newest compatibility date to write. Injected so tests don't depend on the installed workerd. */
  compatibilityDate: () => string;
}

function createIo(): Io {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let rl: ReturnType<typeof createInterface> | undefined;
  return {
    interactive,
    async ask(question, fallback) {
      rl ??= createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(`${question}${fallback ? ` [${fallback}]` : ""}: `);
      return answer.trim();
    },
    log: (message) => console.log(message),
    error: (message) => console.error(message),
    close: () => rl?.close(),
  };
}

function wranglerBin(cwd: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const found = [join(cwd, "node_modules/.bin/wrangler"), join(here, "../node_modules/.bin/wrangler")];
  return found.find(existsSync) ?? "wrangler";
}

/** Spawns wrangler with no stdin, so a prompt inside it fails instead of hanging. */
export function createRunner(cwd: string): Runner {
  return (args, options) =>
    new Promise((done) => {
      const child = spawn(wranglerBin(cwd), args, {
        cwd: options?.cwd ?? cwd,
        env: { ...process.env, ...options?.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => done({ code: 127, stdout, stderr: String(error) }));
      child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
    });
}

/** Folder name as a DNS label, or `undefined` when nothing usable is left. */
export function suggestName(folder: string): string | undefined {
  const name = folder
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/, "");
  return NAME.test(name) && !RESERVED_NAMES.includes(name) ? name : undefined;
}

export function validateName(input: string, media = false): string {
  const name = input.trim().toLowerCase();
  if (!NAME.test(name)) {
    throw new UserError(
      `"${input}" is not a valid name. Use a lowercase DNS label: letters, digits and hyphens, not starting or ending with a hyphen, up to 63 characters.`
    );
  }
  if (RESERVED_NAMES.includes(name)) {
    throw new UserError(
      `"${name}" is reserved (${RESERVED_NAMES.join(", ")}). Pick a name that is specific to this project.`
    );
  }
  if (media && name.length > MAX_NAME_WITH_MEDIA) {
    throw new UserError(
      `"${name}" is too long for --media: the bucket "${name}-media" would pass R2's 63 character limit. Use at most ${MAX_NAME_WITH_MEDIA} characters.`
    );
  }
  return name;
}

export function validateDomain(input: string): string {
  const domain = input.trim().toLowerCase().replace(/\.$/, "");
  const labels = domain.split(".");
  if (
    domain.length > 253 ||
    labels.length < 2 ||
    !labels.every((label) => label.length <= 63 && LABEL.test(label)) ||
    !/[a-z]/.test(labels[labels.length - 1])
  ) {
    throw new UserError(
      `"${input}" is not a base domain. Enter just the domain, like example.com, with no https:// or path.`
    );
  }
  return domain;
}

export function validateSubdomain(input: string): string {
  const subdomain = input
    .trim()
    .toLowerCase()
    .replace(/\.workers\.dev$/, "");
  if (!LABEL.test(subdomain) || subdomain.length > 63) {
    throw new UserError(
      `"${input}" is not a workers.dev subdomain. Enter just the label, like "my-team" from my-team.workers.dev.`
    );
  }
  return subdomain;
}

export function validateSuffix(input: string): string {
  const suffix = input.trim().toLowerCase();
  if (!/^[-.]/.test(suffix)) {
    throw new UserError(
      `"${input}" needs a leading "-" or ".". Without one, "${suffix}" would also match evil-not${suffix}, a project on someone else's team. Write it like -your-team.vercel.app.`
    );
  }
  if (!SUFFIX.test(suffix)) {
    throw new UserError(
      `"${input}" is not a valid preview suffix. Use lowercase letters, digits, dots and hyphens, like -your-team.vercel.app.`
    );
  }
  if (!VERCEL_SUFFIX.test(suffix)) {
    throw new UserError(
      `"${input}" is not a Vercel team preview suffix. It must be a dash or dot, your team name, then .vercel.app, like -your-team.vercel.app. Anything looser would let other Vercel projects through.`
    );
  }
  return suffix;
}

function validateId(label: string) {
  return (input: string): string => {
    const id = input.trim();
    if (!ID.test(id)) throw new UserError(`"${input}" is not a valid ${label}.`);
    return id;
  };
}

interface ValueSpec {
  /** Flag to name when the value is missing or invalid. */
  flag: string;
  label: string;
  hint?: string;
  /** From a flag or env var. `source` is named in errors. */
  given?: { value: string | undefined; source: string };
  /** Existing value. Accepted without asking when there is no TTY. */
  existing?: string;
  /** Only offered in a prompt, never accepted unattended. */
  suggestion?: string;
  validate: (value: string) => string;
}

async function resolveValue(io: Io, spec: ValueSpec): Promise<string> {
  if (spec.given?.value !== undefined && spec.given.value !== "") {
    try {
      return spec.validate(spec.given.value);
    } catch (error) {
      if (error instanceof UserError) throw new UserError(`${spec.given.source}: ${error.message}`);
      throw error;
    }
  }

  if (!io.interactive) {
    if (spec.existing === undefined) {
      throw new UserError(`${spec.label} is required. Pass ${spec.flag}.`);
    }
    return spec.validate(spec.existing);
  }

  const fallback = spec.existing ?? spec.suggestion;
  for (;;) {
    const answer = (await io.ask(`${spec.label}${spec.hint ? ` (${spec.hint})` : ""}`, fallback)) || fallback;
    try {
      if (!answer) throw new UserError(`${spec.label} is required.`);
      return spec.validate(answer);
    } catch (error) {
      if (!(error instanceof UserError)) throw error;
      io.error(error.message);
    }
  }
}

interface Account {
  id: string;
  name?: string;
}

function parseWhoami(stdout: string): { loggedIn: boolean; accounts: Account[] } | null {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1));
    const accounts: Account[] = Array.isArray(parsed.accounts)
      ? parsed.accounts.filter((account: Account) => typeof account?.id === "string")
      : [];
    return { loggedIn: parsed.loggedIn === true, accounts };
  } catch {
    return null;
  }
}

async function resolveAccount(
  { io, run }: Pick<ConnectDeps, "io" | "run">,
  given: string | undefined,
  existing: string | undefined
): Promise<string> {
  if (given) {
    try {
      return validateId("account ID")(given);
    } catch (error) {
      if (error instanceof UserError) throw new UserError(`--account-id: ${error.message}`);
      throw error;
    }
  }

  const result = await run(["whoami", "--json"]);
  const whoami = parseWhoami(result.stdout);
  const noLogin = new UserError(
    "Wrangler is not logged in. Run `pnpm wrangler login` (or set CLOUDFLARE_API_TOKEN), then run this again. To skip the login check, pass --account-id."
  );
  if (!whoami) {
    if (/not (authenticated|logged in)/i.test(result.stdout + result.stderr)) throw noLogin;
    throw new UserError(
      `Could not read \`wrangler whoami\`: ${(result.stderr || result.stdout).trim() || `exit code ${result.code}`}\nPass --account-id to skip this check.`
    );
  }
  if (!whoami.loggedIn) throw noLogin;

  const { accounts } = whoami;
  if (accounts.length === 0) {
    throw new UserError("Wrangler is logged in but listed no accounts. Pass --account-id.");
  }
  if (existing && !accounts.some((a) => a.id === existing)) {
    throw new UserError(
      `${WRANGLER_FILE} has account_id ${existing}, but this login does not list it. Logging in as someone else would silently change the account. Pass --account-id to confirm which account to use.`
    );
  }
  if (accounts.length === 1) return accounts[0].id;

  const listing = accounts.map((a, i) => `  ${i + 1}. ${a.name ?? "(unnamed)"}  ${a.id}`).join("\n");
  const fallback = existing;
  if (!io.interactive) {
    if (fallback) return fallback;
    throw new UserError(
      `Wrangler is logged in to several accounts, and the base domain must be on the one you pick. Pass --account-id.\n${listing}`
    );
  }
  io.log(`Wrangler is logged in to several accounts. The base domain must be active on the one you pick:\n${listing}`);
  for (;;) {
    const answer = (await io.ask("Account number or ID", fallback)) || fallback || "";
    const match = accounts[Number(answer) - 1] ?? accounts.find((a) => a.id === answer);
    if (match) return match.id;
    io.error(`"${answer}" is not in the list.`);
  }
}

function readJsonc(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = Bun.JSONC.parse(text);
  } catch (error) {
    throw new UserError(`${basename(path)} is not valid JSON: ${error}. Fix it or delete it, then run this again.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UserError(`${basename(path)} must contain a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** The existing list in its order, then any wanted entries it lacks. */
function union<T>(current: unknown, wanted: T[]): unknown[] {
  const list = Array.isArray(current) ? current : [];
  return [...list, ...wanted.filter((item) => !list.includes(item))];
}

const routePattern = (route: unknown): unknown => (typeof route === "string" ? route : asRecord(route).pattern);

/** Routes added by hand, minus the managed one and the one an earlier run wrote for the old name. */
function keptRoutes(current: unknown, drop: (string | undefined)[]): unknown[] {
  return (Array.isArray(current) ? current : []).filter((route) => !drop.includes(routePattern(route) as string));
}

/** The custom domain an earlier `connect` run wrote, so renaming a project doesn't strand it. */
function oldRoute(existing: ProjectConfig | null, wasCloudflare: boolean): string | undefined {
  return wasCloudflare && existing ? existing.deployUrl.replace("https://", "") : undefined;
}

/** The newest date the bundled workerd in Wrangler 4.155 understands. Used when it can't be read. */
export const FALLBACK_COMPATIBILITY_DATE = "2026-10-23";

/** workerd versions are `1.YYYYMMDD.patch`, and the date is its newest supported compatibility date. */
export function compatibilityDateFromVersion(version: string): string | undefined {
  const match = version.match(/^\d+\.(\d{4})(\d{2})(\d{2})\./);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

/**
 * Today's date would be refused by `wrangler dev` whenever it is newer than the workerd Wrangler
 * ships, so the default is that workerd's own date.
 */
export function workerdCompatibilityDate(): string {
  try {
    // workerd isn't hoisted by pnpm, so resolve it from where wrangler lives.
    const fromWrangler = createRequire(createRequire(import.meta.url).resolve("wrangler/package.json"));
    return compatibilityDateFromVersion(fromWrangler("workerd/package.json").version) ?? FALLBACK_COMPATIBILITY_DATE;
  } catch {
    return FALLBACK_COMPATIBILITY_DATE;
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

type Flags = ReturnType<typeof parseFlags>;

const STRING_FLAGS = ["--name", "--domain", "--subdomain", "--account-id", "--suffix", "--zone-id"];

/** Joins `--suffix -team.vercel.app` into `--suffix=-team.vercel.app`, which parseArgs would otherwise reject. */
function joinFlagValues(argv: string[]): string[] {
  const joined: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (STRING_FLAGS.includes(argv[i]) && next !== undefined && !next.startsWith("--")) {
      joined.push(`${argv[i]}=${next}`);
      i++;
    } else {
      joined.push(argv[i]);
    }
  }
  return joined;
}

function parseFlags(argv: string[]) {
  return parseArgs({
    args: joinFlagValues(argv),
    allowPositionals: true,
    strict: true,
    options: {
      name: { type: "string" },
      domain: { type: "string" },
      subdomain: { type: "string" },
      "account-id": { type: "string" },
      suffix: { type: "string" },
      media: { type: "boolean" },
      "zone-id": { type: "string" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });
}

const FLAG_HOSTS: Record<string, ProjectHost> = {
  domain: "cloudflare",
  subdomain: "cloudflare",
  "account-id": "cloudflare",
  media: "cloudflare",
  "zone-id": "cloudflare",
  suffix: "vercel",
};

interface Plan {
  files: Record<string, string>;
  summary: string[];
  steps: string[];
}

async function planCloudflare(
  deps: ConnectDeps,
  flags: Flags["values"],
  name: string,
  existing: ProjectConfig | null,
  mediaUrl: string | null
): Promise<Plan> {
  const { io, env, cwd } = deps;
  const wranglerPath = resolve(cwd, WRANGLER_FILE);
  const currentWrangler = readJsonc(wranglerPath);
  const currentText = currentWrangler ? readFileSync(wranglerPath, "utf8") : undefined;
  const wasCloudflare = existing?.host === "cloudflare";

  const domainPrefix = wasCloudflare ? `https://${existing.name}.` : undefined;
  const existingDomain = domainPrefix && existing?.deployUrl.startsWith(domainPrefix) ? existing.deployUrl.slice(domainPrefix.length) : undefined;
  const domain = await resolveValue(io, {
    flag: "--domain",
    label: "Base domain",
    hint: "a domain on your Cloudflare account, like example.com",
    given: flags.domain
      ? { value: flags.domain, source: "--domain" }
      : { value: env.WF_BASE_DOMAIN, source: "WF_BASE_DOMAIN" },
    existing: existingDomain,
    validate: validateDomain,
  });

  const existingSubdomain = wasCloudflare
    ? existing.previewHostSuffix.match(/^-[a-z0-9-]+\.([a-z0-9-]+)\.workers\.dev$/)?.[1]
    : undefined;
  const subdomain = await resolveValue(io, {
    flag: "--subdomain",
    label: "workers.dev subdomain",
    hint: "shown in the Cloudflare dashboard under Workers, and in `wrangler deploy` output as <name>.<subdomain>.workers.dev",
    given: { value: flags.subdomain, source: "--subdomain" },
    existing: existingSubdomain,
    validate: validateSubdomain,
  });

  let zoneId: string | undefined;
  if (flags.media) {
    zoneId = await resolveValue(io, {
      flag: "--zone-id",
      label: "Zone ID of the base domain",
      hint: "Cloudflare dashboard, domain overview, right sidebar",
      given: flags["zone-id"]
        ? { value: flags["zone-id"], source: "--zone-id" }
        : { value: env.WF_ZONE_ID, source: "WF_ZONE_ID" },
      validate: validateId("zone ID"),
    });
  }

  const existingAccount = currentWrangler?.account_id;
  const accountId = await resolveAccount(
    deps,
    flags["account-id"],
    typeof existingAccount === "string" ? existingAccount : undefined
  );

  if (flags.media && zoneId) {
    const bucket = `${name}-media`;
    const mediaHost = `${bucket}.${domain}`;
    const url = `https://${mediaHost}`;
    await setupMedia({
      run: deps.run,
      accountId,
      bucket,
      mediaHost,
      zoneId,
      log: io.log,
    });
    mediaUrl = url;
  }

  const config: ProjectConfig = {
    host: "cloudflare",
    name,
    deployUrl: `https://${name}.${domain}`,
    mediaUrl,
    previewHostSuffix: `-${name}.${subdomain}.workers.dev`,
  };

  const newest = deps.compatibilityDate();
  let compatibilityDate = newest;
  const currentDate = currentWrangler?.compatibility_date;
  if (typeof currentDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(currentDate)) {
    if (currentDate <= newest) {
      compatibilityDate = currentDate;
    } else {
      io.log(`Note: compatibility_date ${currentDate} is newer than the local workerd supports, so it was lowered to ${newest}.`);
    }
  }
  const route = `${name}.${domain}`;
  const currentAssets = asRecord(currentWrangler?.assets);
  const managed = {
    name,
    account_id: accountId,
    compatibility_date: compatibilityDate,
    compatibility_flags: union(currentWrangler?.compatibility_flags, ["nodejs_compat"]),
    main: ".generated/worker.ts",
    // Hand-added asset settings such as html_handling survive. directory is ours.
    assets: {
      ...currentAssets,
      directory: "./dist",
      run_worker_first: currentAssets.run_worker_first === true ? true : union(currentAssets.run_worker_first, ["/api/*"]),
    },
    routes: [
      { pattern: route, custom_domain: true },
      ...keptRoutes(currentWrangler?.routes, [route, oldRoute(existing, wasCloudflare)]),
    ],
    preview_urls: true,
    previews: currentWrangler?.previews ?? {},
  };
  // Keep anything else the user added by hand, such as vars or bindings.
  const extras = Object.entries(currentWrangler ?? {}).filter(([key]) => !(key in managed));
  const wrangler = { ...managed, ...Object.fromEntries(extras) };
  const wranglerText = json(wrangler);

  if (currentText !== undefined && currentText !== wranglerText) {
    io.log(`Note: ${WRANGLER_FILE} is rewritten as plain JSON with a fixed key order, so any comments and formatting in it are not kept.`);
  }

  return {
    files: { [PROJECT_CONFIG_FILE]: json(config), [WRANGLER_FILE]: wranglerText },
    summary: [
      `${PROJECT_CONFIG_FILE}  deployUrl ${config.deployUrl}`,
      `${WRANGLER_FILE}  account_id ${accountId}`,
      ...(mediaUrl ? [`mediaUrl ${mediaUrl}`] : []),
    ],
    steps: [
      `Make sure ${domain} is an active zone on Cloudflare account ${accountId}, the account written to ${WRANGLER_FILE}. If it is on another account, deploy cannot create ${name}.${domain}.`,
      "Commit and push " + `${PROJECT_CONFIG_FILE} and ${WRANGLER_FILE}.`,
      "In the Cloudflare dashboard open Workers & Pages, create an application and connect this repository (Workers Builds).",
      "Set the build command to `pnpm build`. Leave the deploy command as the default.",
      "Under Branch control, enable builds for non-production branches, so each branch gets a preview URL.",
      "Run `bun dev` and paste the loader it prints into the site's custom code in Webflow.",
    ],
  };
}

async function planVercel(
  deps: ConnectDeps,
  flags: Flags["values"],
  name: string,
  existing: ProjectConfig | null,
  mediaUrl: string | null
): Promise<Plan> {
  const suffix = await resolveValue(deps.io, {
    flag: "--suffix",
    label: "Team preview suffix",
    hint: "like -your-team.vercel.app, see Vercel project settings, Domains",
    given: { value: flags.suffix, source: "--suffix" },
    existing: existing?.host === "vercel" ? existing.previewHostSuffix : undefined,
    validate: validateSuffix,
  });

  const config: ProjectConfig = {
    host: "vercel",
    name,
    deployUrl: `https://${name}.vercel.app`,
    mediaUrl,
    previewHostSuffix: suffix,
  };
  return {
    files: { [PROJECT_CONFIG_FILE]: json(config) },
    summary: [`${PROJECT_CONFIG_FILE}  deployUrl ${config.deployUrl}`],
    steps: [
      `Commit and push ${PROJECT_CONFIG_FILE}. vercel.json is left as it is.`,
      `In Vercel, import this repository as a project named "${name}", so production is ${config.deployUrl}.`,
      "Turn off Deployment Protection for preview deployments, or the loader cannot fetch them from Webflow.",
      "Run `bun dev` and paste the loader it prints into the site's custom code in Webflow.",
    ],
  };
}

/** Returns the exit code: 0 on success, 1 for a user error or a failed step. */
export async function connect(argv: string[], overrides: Partial<ConnectDeps> = {}): Promise<number> {
  const io = overrides.io ?? createIo();
  const cwd = overrides.cwd ?? process.cwd();
  const deps: ConnectDeps = {
    cwd,
    io,
    run: overrides.run ?? createRunner(cwd),
    env: overrides.env ?? process.env,
    compatibilityDate: overrides.compatibilityDate ?? workerdCompatibilityDate,
  };

  try {
    return await execute(argv, deps);
  } catch (error) {
    if (error instanceof StepError) {
      io.error(
        `${error.message}\nNo project files were written. Steps before this one may already have changed your Cloudflare account (bucket, domain); running the same command again picks up where it stopped.`
      );
    } else if (error instanceof UserError) {
      io.error(error.message);
    } else if (error instanceof Error && (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")) {
      io.error(`${error.message}\n\n${USAGE}`);
    } else {
      throw error;
    }
    return 1;
  } finally {
    io.close?.();
  }
}

async function execute(argv: string[], deps: ConnectDeps): Promise<number> {
  const { io, cwd } = deps;
  const { values: flags, positionals } = parseFlags(argv);
  if (flags.help) {
    io.log(USAGE);
    return 0;
  }

  const [host, ...extra] = positionals;
  if ((host !== "cloudflare" && host !== "vercel") || extra.length > 0) {
    io.error(`${host ? `Unknown host "${positionals.join(" ")}".` : "Missing host."}\n\n${USAGE}`);
    return 1;
  }
  for (const [flag, owner] of Object.entries(FLAG_HOSTS)) {
    if (flags[flag as keyof typeof flags] !== undefined && owner !== host) {
      throw new UserError(`--${flag} only applies to ${owner}, not ${host}.`);
    }
  }

  let existing: ProjectConfig | null;
  try {
    existing = readProjectConfig(cwd);
  } catch (error) {
    throw new UserError(`${error instanceof Error ? error.message : error}\nFix or delete ${PROJECT_CONFIG_FILE}, then run this again.`);
  }

  if (existing && existing.host !== host) {
    const message = `${PROJECT_CONFIG_FILE} is connected to ${existing.host}. Switching to ${host} replaces its URLs; ${existing.host}'s own config files stay.`;
    if (!flags.yes) {
      if (!io.interactive) throw new UserError(`${message}\nNothing was changed. Pass --yes to switch.`);
      io.log(message);
      const answer = await io.ask(`Switch to ${host}? Type yes to continue`, "no");
      if (!/^y(es)?$/i.test(answer)) throw new UserError("Nothing was changed.");
    }
  }

  const name = await resolveValue(io, {
    flag: "--name",
    label: "Project name",
    hint: "a lowercase DNS label, used in URLs",
    given: { value: flags.name, source: "--name" },
    existing: existing?.name,
    suggestion: suggestName(basename(cwd)),
    validate: (value) => validateName(value, flags.media),
  });

  const mediaUrl = existing?.mediaUrl ?? null;
  const plan =
    host === "cloudflare"
      ? await planCloudflare(deps, flags, name, existing, mediaUrl)
      : await planVercel(deps, flags, name, existing, mediaUrl);

  // Checked against the contract before anything is written.
  const problems = validateProjectConfig(JSON.parse(plan.files[PROJECT_CONFIG_FILE]));
  if (problems.length > 0) throw new UserError(`Generated an invalid config: ${problems.join("; ")}`);

  const changed: string[] = [];
  for (const [file, content] of Object.entries(plan.files)) {
    const path = resolve(cwd, file);
    if (existsSync(path) && readFileSync(path, "utf8") === content) continue;
    writeFileSync(path, content);
    changed.push(file);
  }

  io.log(
    changed.length > 0
      ? `Connected "${name}" to ${host}. Wrote ${changed.join(" and ")}.`
      : `Connected "${name}" to ${host}. Nothing changed.`
  );
  for (const line of plan.summary) io.log(`  ${line}`);
  io.log(`\nNext steps:\n${plan.steps.map((step, i) => `  ${i + 1}. ${step}`).join("\n")}`);
  return 0;
}

if (import.meta.main) {
  process.exit(await connect(process.argv.slice(2)));
}
