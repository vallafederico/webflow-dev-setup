import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  connect,
  createRunner,
  type Io,
  parseWhoami,
  type Runner,
  suggestName,
} from "./connect";
import { PROJECT_CONFIG_FILE, type ProjectConfig } from "./project-config";

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
}

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

/** What the project is connected to, and the steps from connecting if they just happened. */
export function connectedPanelHtml(config: ProjectConfig): string {
  const row = (label: string, value: string) =>
    `<dt>${label}</dt><dd>${value}</dd>`;
  const link = (url: string) =>
    `<a href="${escapeHtml(url)}" target="_blank">${escapeHtml(url)}</a>`;
  return `<section class="panel">
          <h2>Project</h2>
          <dl>
            ${row("Host", escapeHtml(config.host))}
            ${row("Name", escapeHtml(config.name))}
            ${row("Deploy URL", link(config.deployUrl))}
            ${config.mediaUrl ? row("Media URL", link(config.mediaUrl)) : ""}
            ${row("Preview hosts", `<code>*${escapeHtml(config.previewHostSuffix)}</code>`)}
          </dl>
          <div id="next-steps" hidden>
            <h3>Next steps</h3>
            <pre></pre>
            <button type="button" class="plain">Done</button>
          </div>
          <script>
            (function () {
              var box = document.getElementById("next-steps");
              var text = sessionStorage.getItem("wf-connect-output");
              if (!text) return;
              box.querySelector("pre").textContent = text;
              box.hidden = false;
              box.querySelector("button").addEventListener("click", function () {
                sessionStorage.removeItem("wf-connect-output");
                box.hidden = true;
              });
            })();
          </script>
        </section>`;
}

/** The form shown when the project has no config. */
export function connectFormHtml(cwd = process.cwd()): string {
  const name = suggestName(basename(cwd)) ?? "";
  const domain = process.env.WF_BASE_DOMAIN ?? "";
  return `<section class="panel" id="connect">
          <h2>Connect a host</h2>
          <p class="hint">This project has no host yet. Pick one to get its deploy link and full loader. This only writes the config files, so nothing changes on your account. For R2 media, run <code>pnpm connect cloudflare --media</code> in a terminal.</p>
          <form>
            <div class="hosts">
              <label><input type="radio" name="host" value="cloudflare" checked> Cloudflare</label>
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
                fetch("/_connect", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(Object.fromEntries(new FormData(form))),
                })
                  .then(function (response) { return response.json(); })
                  .then(function (result) {
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
