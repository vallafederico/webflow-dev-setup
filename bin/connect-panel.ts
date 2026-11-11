import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  connect,
  createRunner,
  type Io,
  parseWhoami,
  projectLinks,
  type Runner,
  suggestName,
} from "./connect";
import {
  PROJECT_CONFIG_FILE,
  type ProjectConfig,
  readProjectConfig,
} from "./project-config";
import {
  createGit,
  type Git,
  originRepo,
  readTeamConfig,
  type TeamConfig,
} from "./team";
import { prepareTeamProject } from "./team-setup";

const API = "https://api.cloudflare.com/client/v4";
const RUN_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface PanelContext {
  cwd?: string;
  /** Address of the client, from `server.requestIP`. */
  ip: string | undefined;
  /** Rebuilds the bundle, since it has the deploy URL baked in. */
  onConnected: () => Promise<unknown>;
  run?: Runner;
  fetch?: typeof fetch;
  git?: Git;
  gh?: Git;
  /** One-use states for the creator's redirect back. Shared by default. */
  states?: Map<string, PendingState>;
  now?: () => number;
}

export interface PendingState {
  name: string;
  expires: number;
}

const STATE_TTL_MS = 15 * 60_000;
const defaultStates = new Map<string, PendingState>();

/**
 * The dev server listens on every interface and websites can send requests to
 * localhost, so only this machine and this page may write the project's config
 * or read its Cloudflare account.
 */
function isAllowed(req: Request, ip: string | undefined): boolean {
  if (!ip || !/^(127\.|::1$|::ffff:127\.)/.test(ip)) return false;
  // A rebinding attack arrives with its own domain in Host.
  const host = req.headers.get("host") ?? "";
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host)) return false;
  const origin = req.headers.get("origin");
  if (origin === null) return req.method === "GET";
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function withTimeout(run: Runner): Runner {
  return (args, options) =>
    Promise.race([
      run(args, options),
      new Promise<Awaited<ReturnType<Runner>>>((done) =>
        setTimeout(
          () =>
            done({
              code: 124,
              stdout: "",
              stderr: `wrangler ${args[0]} did not answer within ${RUN_TIMEOUT_MS / 1000}s`,
            }),
          RUN_TIMEOUT_MS
        ).unref()
      ),
    ]);
}

export interface CloudflareInfo {
  loggedIn: boolean;
  accounts: { id: string; name?: string }[];
  accountId: string | null;
  subdomain: string | null;
  domains: string[];
}

async function readApi<T>(
  doFetch: typeof fetch,
  path: string,
  token: string
): Promise<T | null> {
  try {
    const response = await doFetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return ((await response.json()) as { result: T }).result;
  } catch {
    return null;
  }
}

/**
 * Read-only lookups that fill in the form. Anything it can't find stays empty
 * for the user to type. Wrangler's token stays on the server.
 */
export async function discoverCloudflare(
  run: Runner,
  doFetch: typeof fetch,
  account: string | null
): Promise<CloudflareInfo> {
  const whoami = parseWhoami((await run(["whoami", "--json"])).stdout);
  const empty: CloudflareInfo = {
    loggedIn: whoami?.loggedIn === true,
    accounts: whoami?.accounts ?? [],
    accountId: null,
    subdomain: null,
    domains: [],
  };
  if (!whoami?.loggedIn || whoami.accounts.length === 0) return empty;

  const chosen =
    whoami.accounts.find((a) => a.id === account) ??
    (whoami.accounts.length === 1 ? whoami.accounts[0] : undefined);
  if (!chosen) return empty;

  let token: unknown;
  try {
    const { stdout } = await run(["auth", "token", "--json"]);
    token = JSON.parse(
      stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1)
    ).token;
  } catch {
    token = undefined;
  }
  if (typeof token !== "string" || !token)
    return { ...empty, accountId: chosen.id };

  const id = encodeURIComponent(chosen.id);
  const [subdomain, zones] = await Promise.all([
    readApi<{ subdomain?: string }>(
      doFetch,
      `/accounts/${id}/workers/subdomain`,
      token
    ),
    readApi<{ name: string }[]>(
      doFetch,
      `/zones?account.id=${id}&status=active&per_page=50`,
      token
    ),
  ]);
  return {
    ...empty,
    accountId: chosen.id,
    subdomain: subdomain?.subdomain ?? null,
    domains: Array.isArray(zones) ? zones.map((zone) => zone.name) : [],
  };
}

const FLAGS = {
  name: "name",
  domain: "domain",
  subdomain: "subdomain",
  accountId: "account-id",
  suffix: "suffix",
} as const;

async function submit(req: Request, ctx: PanelContext, cwd: string) {
  if (existsSync(resolve(cwd, PROJECT_CONFIG_FILE))) {
    return Response.json(
      {
        ok: false,
        output: `This project already has ${PROJECT_CONFIG_FILE}. To change it, run pnpm connect in a terminal.`,
      },
      { status: 409 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, output: "The request wasn't valid JSON." },
      { status: 400 }
    );
  }

  // `--flag=value`, so a value starting with a dash can't become another flag.
  const argv = [String(body.host)];
  for (const [key, flag] of Object.entries(FLAGS)) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) {
      argv.push(`--${flag}=${value.trim()}`);
    }
  }

  const lines: string[] = [];
  const io: Io = {
    interactive: false,
    ask: async () => "",
    log: (message) => lines.push(message),
    error: (message) => lines.push(message),
  };
  const code = await connect(argv, {
    cwd,
    io,
    run: withTimeout(ctx.run ?? createRunner(cwd)),
  });
  if (code === 0) {
    // The config is written by now, so a failed rebuild mustn't report a failed connect.
    await ctx.onConnected().catch((error) => {
      lines.push(`\nThe rebuild failed, so edit a file to retry it: ${error}`);
    });
  }
  return Response.json(
    { ok: code === 0, output: lines.join("\n") },
    { status: code === 0 ? 200 : 422 }
  );
}

function onTeamDomain(config: ProjectConfig, team: TeamConfig): boolean {
  return (
    config.host === "cloudflare" &&
    new URL(config.deployUrl).hostname ===
      `${config.name}.${team.cloudflare.domain}`
  );
}

/**
 * Writes the team config, commits and pushes it to main, looks up the repo ID
 * on this machine, and returns the creator link to open. The creator checks
 * the repo again, so nothing here has to be trusted.
 */
async function teamCreate(req: Request, ctx: PanelContext, cwd: string) {
  const team = readTeamConfig(cwd);
  if (!team) return new Response("Not found", { status: 404 });
  const result = await prepareTeamProject({
    cwd,
    team,
    git: ctx.git ?? createGit(cwd),
    gh: ctx.gh ?? createGit(cwd, "gh"),
    run: withTimeout(ctx.run ?? createRunner(cwd)),
    fetch: ctx.fetch ?? fetch,
    onConnected: ctx.onConnected,
  });
  if (!result.ok)
    return Response.json(
      { ok: false, output: [...result.log, result.message].join("\n") },
      { status: result.status }
    );
  const state = crypto.randomUUID();
  (ctx.states ?? defaultStates).set(state, {
    name: result.name,
    expires: (ctx.now ?? Date.now)() + STATE_TTL_MS,
  });
  return Response.json({
    ok: true,
    output: result.log.join("\n"),
    url: result.link({ state, return: new URL(req.url).origin }),
  });
}

/**
 * Where the creator sends the browser back. The state must be one this server
 * handed out, once, so another site can't fake a "created" page.
 */
function created(url: URL, ctx: PanelContext, cwd: string): Response {
  const states = ctx.states ?? defaultStates;
  const state = url.searchParams.get("state") ?? "";
  const pending = states.get(state);
  states.delete(state);
  const config = (() => {
    try {
      return readProjectConfig(cwd);
    } catch {
      return null;
    }
  })();
  if (
    !pending ||
    pending.expires < (ctx.now ?? Date.now)() ||
    pending.name !== url.searchParams.get("name") ||
    config?.name !== pending.name
  ) {
    return new Response(
      "This link isn't from this dev server, or it was already used. Nothing was changed.",
      { status: 403 }
    );
  }
  const text = [
    `Created "${config.name}". The first build is running and takes about a minute.`,
    "",
    ...projectLinks(config, wranglerAccount(cwd)).map(
      (link) => `${link.label.padEnd(16)} ${link.url}`
    ),
    "",
    "Next: paste the loader below into the site's custom code in Webflow, and run pnpm check:live once the build is done.",
  ].join("\n");
  return new Response(
    `<!doctype html><meta charset="utf-8"><script>sessionStorage.setItem("wf-connect-output", ${JSON.stringify(text).replace(/</g, "\\u003c")});location.replace("/");</script>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function wranglerAccount(cwd: string): string | undefined {
  try {
    const wrangler = Bun.JSONC.parse(
      readFileSync(resolve(cwd, "wrangler.jsonc"), "utf8")
    ) as { account_id?: unknown };
    return typeof wrangler.account_id === "string"
      ? wrangler.account_id
      : undefined;
  } catch {
    return undefined;
  }
}

/** Answers `/_connect` and `/_connect/cloudflare` for the dev index page. */
export async function handleConnect(
  req: Request,
  ctx: PanelContext
): Promise<Response> {
  if (!isAllowed(req, ctx.ip)) {
    return new Response("Only the dev server's own page can do this", {
      status: 403,
    });
  }
  const cwd = ctx.cwd ?? process.cwd();
  const url = new URL(req.url);
  if (url.pathname === "/_connect" && req.method === "POST") {
    return submit(req, ctx, cwd);
  }
  if (url.pathname === "/_connect/team" && req.method === "POST") {
    return teamCreate(req, ctx, cwd);
  }
  if (url.pathname === "/_connect/created" && req.method === "GET") {
    return created(url, ctx, cwd);
  }
  if (url.pathname === "/_connect/cloudflare" && req.method === "GET") {
    return Response.json(
      await discoverCloudflare(
        withTimeout(ctx.run ?? createRunner(cwd)),
        ctx.fetch ?? fetch,
        url.searchParams.get("account")
      )
    );
  }
  return new Response("Not found", { status: 404 });
}

export const PANEL_CSS = `
          .panel {
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 1rem 1.25rem;
            margin-bottom: 1.5rem;
          }
          .panel h2 { margin-top: 0; }
          .panel .hint { font-size: 0.85em; color: var(--code-color); }
          .panel label { display: block; margin-bottom: 0.75rem; }
          .panel label > span { display: block; font-size: 0.85em; margin-bottom: 0.25rem; }
          .panel input[type="text"], .panel select {
            width: 100%;
            max-width: 28rem;
            box-sizing: border-box;
            padding: 0.4rem 0.5rem;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: transparent;
            color: inherit;
            font: inherit;
          }
          .panel .hosts { display: flex; gap: 1.25rem; margin-bottom: 0.75rem; }
          .panel .hosts label { display: inline-block; margin: 0; cursor: pointer; }
          .panel button {
            padding: 0.45rem 1rem;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            background: var(--link-color);
            color: #fff;
            font: inherit;
            cursor: pointer;
          }
          .panel button.plain { background: transparent; color: inherit; }
          .panel button:disabled { opacity: 0.5; cursor: wait; }
          .panel pre { white-space: pre-wrap; font-size: 0.85em; }
          .panel .error { color: #d33; }
          .panel dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.25rem 1rem; margin: 0; }
          .panel dt { font-size: 0.85em; color: var(--code-color); }
          .panel dd { margin: 0; }
`;

/** What the project is connected to, its links, whether it's live, and the steps from connecting if they just happened. */
export function connectedPanelHtml(
  config: ProjectConfig,
  cwd = process.cwd()
): string {
  const row = (label: string, value: string) =>
    `<dt>${label}</dt><dd>${value}</dd>`;
  const link = (url: string) =>
    url.includes("<")
      ? `<code>${escapeHtml(url)}</code>`
      : `<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</a>`;
  const team = readTeamConfig(cwd);
  const teamManaged = team !== null && onTeamDomain(config, team);
  const links = projectLinks(
    config,
    config.host === "cloudflare" ? wranglerAccount(cwd) : undefined
  );
  return `<section class="panel" id="project">
          <h2>Project</h2>
          <dl>
            ${row("Host", escapeHtml(teamManaged && team ? `${config.host} (${team.name})` : config.host))}
            ${row("Name", escapeHtml(config.name))}
            ${row("Deploy URL", link(config.deployUrl))}
            ${config.mediaUrl ? row("Media URL", link(config.mediaUrl)) : ""}
            ${row("Status", `<span data-live>Checking ${escapeHtml(config.deployUrl)}...</span>`)}
            ${links.map((l) => row(escapeHtml(l.label), link(l.url))).join("\n            ")}
          </dl>
          ${
            teamManaged && team
              ? `<div data-create hidden>
            <p class="hint">Not live yet. If the Worker hasn't been created, this commits and pushes the config to main, then opens ${escapeHtml(team.creatorUrl)} to create it. You sign in there with your work email.</p>
            <button type="button">Create on ${escapeHtml(team.name)}</button>
            <pre class="error" data-error hidden></pre>
          </div>`
              : ""
          }
          <div id="next-steps" hidden>
            <h3>Next steps</h3>
            <pre></pre>
            <button type="button" class="plain">Done</button>
          </div>
          <script>
            (function () {
              var box = document.getElementById("next-steps");
              var text = sessionStorage.getItem("wf-connect-output");
              if (text) {
                box.querySelector("pre").textContent = text;
                box.hidden = false;
                box.querySelector("button").addEventListener("click", function () {
                  sessionStorage.removeItem("wf-connect-output");
                  box.hidden = true;
                });
              }

              var live = document.querySelector("#project [data-live]");
              var create = document.querySelector("#project [data-create]");
              fetch(${JSON.stringify(`${config.deployUrl}/build-manifest.json`)}, { cache: "no-store" })
                .then(function (response) {
                  if (!response.ok) throw new Error(String(response.status));
                  return response.json();
                })
                .then(function (manifest) {
                  live.textContent = "Live" + (manifest.commit ? ", commit " + String(manifest.commit).slice(0, 7) : "") + (manifest.timestamp ? ", built " + new Date(manifest.timestamp).toLocaleString() : "");
                })
                .catch(function () {
                  live.textContent = "Not live yet. A new project's first build takes about a minute.";
                  if (create) create.hidden = false;
                });

              if (!create) return;
              var button = create.querySelector("button");
              var errorBox = create.querySelector("[data-error]");
              button.addEventListener("click", function () {
                button.disabled = true;
                errorBox.hidden = true;
                fetch("/_connect/team", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: ${JSON.stringify(config.name)} }),
                })
                  .then(function (response) { return response.json(); })
                  .then(function (result) {
                    if (result.ok && result.url) { location.href = result.url; return; }
                    errorBox.textContent = result.output;
                    errorBox.hidden = false;
                    button.disabled = false;
                  })
                  .catch(function (error) {
                    errorBox.textContent = String(error);
                    errorBox.hidden = false;
                    button.disabled = false;
                  });
              });
            })();
          </script>
        </section>`;
}

/** The form shown when the project has no config. */
export function connectFormHtml(cwd = process.cwd()): string {
  const name = suggestName(basename(cwd)) ?? "";
  const domain = process.env.WF_BASE_DOMAIN ?? "";
  const team = readTeamConfig(cwd);
  const remote = team ? originRepo(cwd) : null;
  const hasOrigin =
    team !== null &&
    spawnSync("git", ["remote", "get-url", "origin"], { cwd, timeout: 5000 })
      .status === 0;
  const inOrg =
    team !== null &&
    remote !== null &&
    remote.owner.toLowerCase() === team.githubOrg.toLowerCase();
  // With no origin, the button creates <org>/<folder name>, so that's the name.
  const repoName =
    inOrg && remote ? (suggestName(remote.repo) ?? "") : hasOrigin ? "" : name;
  const after = team
    ? `commits and pushes <code>project.config.json</code> and <code>wrangler.jsonc</code> to <code>main</code>, then opens ${escapeHtml(team.creatorUrl)}, where you sign in with your work email. It makes the Worker and starts the first build. No Cloudflare login is needed.`
    : "";
  const teamBlock = team
    ? `<div data-host="team"${inOrg || !hasOrigin ? "" : " data-blocked"}>
              ${
                inOrg && remote
                  ? `<p class="hint">Repo: <code>${escapeHtml(`${remote.owner}/${remote.repo}`)}</code>. The project is named after it. Create ${after}</p>`
                  : !hasOrigin
                    ? `<p class="hint">No GitHub repo yet. Create makes the private repo <code>${escapeHtml(team.githubOrg)}/${escapeHtml(name || "<folder>")}</code> with your <code>gh</code> login and pushes this folder, then ${after}</p>`
                    : `<p class="error">This folder's <code>origin</code> isn't a repo in github.com/${escapeHtml(team.githubOrg)}. Team projects live in the org: move the repo there, or point <code>origin</code> at a repo in it, then reload.</p>`
              }
            </div>`
    : "";
  return `<section class="panel" id="connect">
          <h2>Connect a host</h2>
          <p class="hint">This project has no host yet. Pick one to get its deploy link and full loader.${team ? ` <strong>${escapeHtml(team.name)} team</strong> creates the project on the team's Cloudflare account for you.` : ""} Cloudflare and Vercel only write the config files, so nothing changes on your account. For R2 media, run <code>pnpm connect cloudflare --media</code> in a terminal.</p>
          <form>
            <div class="hosts">
              ${team ? `<label><input type="radio" name="host" value="team" checked> ${escapeHtml(team.name)} team</label>` : ""}
              <label><input type="radio" name="host" value="cloudflare"${team ? "" : " checked"}> Cloudflare</label>
              <label><input type="radio" name="host" value="vercel"> Vercel</label>
            </div>
            <label><span>Project name</span><input type="text" name="name" value="${escapeHtml(name)}" required></label>
            <div data-host="cloudflare">
              <p class="hint" data-status>Checking Wrangler...</p>
              <button type="button" class="plain" data-recheck hidden>Check again</button>
              <label data-accounts hidden><span>Cloudflare account</span><select name="accountId"></select></label>
              <label><span>Base domain</span><input type="text" name="domain" list="connect-domains" value="${escapeHtml(domain)}" placeholder="example.com" required></label>
              <datalist id="connect-domains"></datalist>
              <label><span>workers.dev subdomain</span><input type="text" name="subdomain" placeholder="my-team" required></label>
            </div>
            ${teamBlock}
            <div data-host="vercel" hidden>
              <label><span>Team preview suffix (Vercel project settings, Domains)</span><input type="text" name="suffix" placeholder="-your-team.vercel.app" required></label>
            </div>
            <p class="hint">Deploy link: <code data-link></code></p>
            <button type="submit">Connect</button>
            <pre class="error" data-error hidden></pre>
          </form>
          <script>
            (function () {
              var form = document.querySelector("#connect form");
              var status = form.querySelector("[data-status]");
              var recheck = form.querySelector("[data-recheck]");
              var accounts = form.querySelector("[data-accounts]");
              var select = form.elements.accountId;
              var list = document.getElementById("connect-domains");
              var errorBox = form.querySelector("[data-error]");

              function updateLink() {
                var name = form.elements.name.value.trim() || "<name>";
                var host = form.elements.host.value;
                form.querySelector("[data-link]").textContent = host === "vercel"
                  ? "https://" + name + ".vercel.app"
                  : host === "team"
                    ? "https://" + name + "." + ${JSON.stringify(team?.cloudflare.domain ?? "")}
                    : "https://" + name + "." + (form.elements.domain.value.trim() || "<domain>");
              }

              // Disabled fields aren't required or sent, so only one host's count.
              function showHost() {
                var host = form.elements.host.value;
                form.querySelectorAll("[data-host]").forEach(function (block) {
                  var active = block.dataset.host === host;
                  block.hidden = !active;
                  block.querySelectorAll("input, select").forEach(function (field) {
                    field.disabled = !active;
                  });
                });
                // A team project is always named after its repo.
                if (host === "team") {
                  form.elements.name.dataset.typed = form.elements.name.dataset.typed || form.elements.name.value;
                  form.elements.name.value = ${JSON.stringify(repoName)};
                  form.elements.name.readOnly = true;
                } else if (form.elements.name.readOnly) {
                  form.elements.name.readOnly = false;
                  form.elements.name.value = form.elements.name.dataset.typed || "";
                }
                var blocked = form.querySelector('[data-host="' + host + '"][data-blocked]');
                var submit = form.querySelector("button[type=submit]");
                submit.disabled = Boolean(blocked);
                submit.textContent = host === "team" ? "Create" : "Connect";
                updateLink();
              }

              function fill(info) {
                recheck.hidden = info.loggedIn;
                if (!info.loggedIn) {
                  status.textContent = "Wrangler isn't logged in. Run pnpm wrangler login in a terminal to fill these in for you, or type them below.";
                  return;
                }
                accounts.hidden = info.accounts.length < 2;
                select.required = info.accounts.length > 1;
                if (select.options.length === 0) {
                  if (info.accounts.length > 1) select.add(new Option("Choose an account", ""));
                  info.accounts.forEach(function (account) {
                    select.add(new Option(account.name ? account.name + " (" + account.id + ")" : account.id, account.id));
                  });
                }
                if (info.accountId) select.value = info.accountId;
                list.replaceChildren();
                info.domains.forEach(function (domain) { list.appendChild(new Option(domain)); });
                if (info.domains.length === 1 && !form.elements.domain.value) form.elements.domain.value = info.domains[0];
                if (info.subdomain) form.elements.subdomain.value = info.subdomain;
                status.textContent = !info.accountId
                  ? "Choose an account to fill in the rest."
                  : info.domains.length === 0
                    ? "Logged in, but no active domains were found on this account. The base domain must be on it for the deploy link to work."
                    : "Filled in from your Cloudflare account. Check it's right.";
                updateLink();
              }

              function lookUp(account) {
                status.textContent = "Checking Wrangler...";
                fetch("/_connect/cloudflare" + (account ? "?account=" + encodeURIComponent(account) : ""))
                  .then(function (response) { return response.json(); })
                  .then(fill)
                  .catch(function () {
                    status.textContent = "Couldn't reach Wrangler. Type these in yourself.";
                  });
              }

              form.addEventListener("change", function (event) {
                if (event.target.name === "host") showHost();
                if (event.target === select && select.value) lookUp(select.value);
              });
              form.addEventListener("input", updateLink);
              recheck.addEventListener("click", function () { lookUp(); });

              form.addEventListener("submit", function (event) {
                event.preventDefault();
                var button = form.querySelector("button[type=submit]");
                button.disabled = true;
                errorBox.hidden = true;
                var team = form.elements.host.value === "team";
                fetch(team ? "/_connect/team" : "/_connect", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(team ? { name: form.elements.name.value } : Object.fromEntries(new FormData(form))),
                })
                  .then(function (response) { return response.json(); })
                  .then(function (result) {
                    if (result.ok && result.url) {
                      location.href = result.url;
                      return;
                    }
                    if (result.ok) {
                      sessionStorage.setItem("wf-connect-output", result.output);
                      location.reload();
                      return;
                    }
                    errorBox.textContent = result.output;
                    errorBox.hidden = false;
                    button.disabled = false;
                  })
                  .catch(function (error) {
                    errorBox.textContent = String(error);
                    errorBox.hidden = false;
                    button.disabled = false;
                  });
              });

              showHost();
              lookUp();
            })();
          </script>
        </section>`;
}
