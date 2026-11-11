import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, projectLinks, type Io } from "./connect";
import {
  connectedPanelHtml,
  connectFormHtml,
  handleConnect,
  type PendingState,
} from "./connect-panel";
import {
  type Git,
  lookUpRepoId,
  parseGithubRemote,
  readTeamConfig,
} from "./team";
import { foreignRoutes } from "./wrangler-routes";

const ORIGIN = "http://localhost:6545";
const TEAM = {
  name: "Off+Brand",
  creatorUrl: "https://new.itsoffbrand.dev",
  githubOrg: "itsoffbrand",
  cloudflare: {
    accountId: "5397e49e27a3bdf3feb44682527cc6e6",
    domain: "itsoffbrand.dev",
    subdomain: "ob-ops",
  },
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "team-"));
  writeFileSync(join(dir, "team.config.json"), JSON.stringify(TEAM));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const noRun = async () => ({
  code: 1,
  stdout: "",
  stderr: "no wrangler in this test",
});
const quiet = (lines: string[] = []): Io => ({
  interactive: false,
  ask: async () => "",
  log: (m) => lines.push(m),
  error: (m) => lines.push(m),
});

/** A fake git that records calls and answers from a table. */
function fakeGit(
  answers: Partial<
    Record<string, { code?: number; stdout?: string; stderr?: string }>
  > = {},
  calls: string[][] = []
): Git {
  return async (args) => {
    calls.push(args);
    const key = args.slice(0, 2).join(" ");
    const answer = answers[key] ?? answers[args[0]] ?? {};
    return {
      code: answer.code ?? 0,
      stdout: answer.stdout ?? "",
      stderr: answer.stderr ?? "",
    };
  };
}

const IN_ORG = {
  "remote get-url": { stdout: "git@github.com:itsoffbrand/acme-site.git\n" },
  "rev-parse --abbrev-ref": { stdout: "main\n" },
  "diff --cached": { code: 1 },
};
const GH_OK = fakeGit({ api: { stdout: "1454001533\n" } });

function teamPost(
  body: unknown,
  opts: { git?: Git; gh?: Git; states?: Map<string, PendingState> } = {}
) {
  let rebuilds = 0;
  const response = handleConnect(
    new Request(`${ORIGIN}/_connect/team`, {
      method: "POST",
      headers: { host: "localhost:6545", origin: ORIGIN },
      body: JSON.stringify(body),
    }),
    {
      cwd: dir,
      ip: "127.0.0.1",
      onConnected: async () => {
        rebuilds++;
      },
      run: noRun,
      git: opts.git ?? fakeGit(IN_ORG),
      gh: opts.gh ?? GH_OK,
      states: opts.states ?? new Map(),
      fetch: (() => {
        throw new Error("no network in this test");
      }) as unknown as typeof fetch,
    }
  );
  return { response, rebuilds: () => rebuilds };
}

describe("pnpm connect cloudflare --team", () => {
  test("uses the team's account, domain and subdomain with no wrangler login", async () => {
    const lines: string[] = [];
    expect(
      await connect(["cloudflare", "--team", "--name", "acme-site"], {
        cwd: dir,
        io: quiet(lines),
        run: noRun,
        compatibilityDate: () => "2026-10-23",
        origin: () => ({ owner: "itsoffbrand", repo: "acme-site" }),
      })
    ).toBe(0);
    const config = JSON.parse(
      readFileSync(join(dir, "project.config.json"), "utf8")
    );
    const wrangler = JSON.parse(
      readFileSync(join(dir, "wrangler.jsonc"), "utf8")
    );
    expect(config.deployUrl).toBe("https://acme-site.itsoffbrand.dev");
    expect(config.previewHostSuffix).toBe("-acme-site.ob-ops.workers.dev");
    expect(wrangler.account_id).toBe(TEAM.cloudflare.accountId);
    const out = lines.join("\n");
    expect(out).toContain("https://acme-site.itsoffbrand.dev/app.js");
    expect(out).toContain("https://<branch>-acme-site.ob-ops.workers.dev");
    expect(out).toContain("Create on Off+Brand");
    expect(out).not.toContain("Workers & Pages, create an application");
  });

  test("refuses flags the team file sets, and --media", async () => {
    for (const extra of [
      ["--domain", "x.com"],
      ["--account-id", "abc"],
      ["--media"],
    ]) {
      const lines: string[] = [];
      expect(
        await connect(["cloudflare", "--team", "--name", "acme", ...extra], {
          cwd: dir,
          io: quiet(lines),
          run: noRun,
          origin: () => ({ owner: "itsoffbrand", repo: "acme" }),
        })
      ).toBe(1);
      expect(existsSync(join(dir, "project.config.json"))).toBe(false);
    }
  });

  test("names the project after its repo", async () => {
    const lines: string[] = [];
    const origin = () => ({ owner: "itsoffbrand", repo: "Acme_Site" });
    expect(
      await connect(["cloudflare", "--team"], {
        cwd: dir,
        io: quiet(lines),
        run: noRun,
        compatibilityDate: () => "2026-10-23",
        origin,
      })
    ).toBe(0);
    expect(
      JSON.parse(readFileSync(join(dir, "project.config.json"), "utf8")).name
    ).toBe("acme-site");
    expect(
      await connect(["cloudflare", "--team", "--name", "other"], {
        cwd: dir,
        io: quiet(lines),
        run: noRun,
        origin,
      })
    ).toBe(1);
    expect(lines.join("\n")).toContain('named after its repo: "acme-site"');
  });

  test("needs a repo in the org", async () => {
    const lines: string[] = [];
    expect(
      await connect(["cloudflare", "--team"], {
        cwd: dir,
        io: quiet(lines),
        run: noRun,
        origin: () => ({ owner: "someone", repo: "acme" }),
      })
    ).toBe(1);
    expect(lines.join("\n")).toContain("gh repo create itsoffbrand/");
    expect(existsSync(join(dir, "project.config.json"))).toBe(false);
  });

  test("needs the team file", async () => {
    rmSync(join(dir, "team.config.json"));
    expect(
      await connect(["cloudflare", "--team", "--name", "acme"], {
        cwd: dir,
        io: quiet(),
        run: noRun,
      })
    ).toBe(1);
  });
});

describe("the dev page's team flow", () => {
  test("writes the config, commits and pushes only those files to main, then returns the creator link", async () => {
    const calls: string[][] = [];
    const { response, rebuilds } = teamPost(
      { name: "acme-site" },
      { git: fakeGit(IN_ORG, calls) }
    );
    const res = await response;
    const result = await res.json();
    expect(res.status).toBe(200);
    const url = new URL(result.url);
    expect(url.origin).toBe("https://new.itsoffbrand.dev");
    expect(url.pathname).toBe("/new");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      name: "acme-site",
      repo: "itsoffbrand/acme-site",
      repoId: "1454001533",
      return: ORIGIN,
    });
    expect(url.searchParams.get("state")).toMatch(/^[0-9a-f-]{36}$/);
    expect(rebuilds()).toBe(1);
    expect(calls).toContainEqual([
      "add",
      "--",
      "project.config.json",
      "wrangler.jsonc",
    ]);
    expect(calls.find((c) => c[0] === "commit")?.slice(-3)).toEqual([
      "--",
      "project.config.json",
      "wrangler.jsonc",
    ]);
    expect(calls).toContainEqual(["push", "origin", "HEAD:main"]);
  });

  test("refuses a repo outside the org, and touches nothing", async () => {
    const calls: string[][] = [];
    const git = fakeGit(
      {
        ...IN_ORG,
        "remote get-url": { stdout: "git@github.com:someone/acme.git" },
      },
      calls
    );
    const res = await teamPost({ name: "acme" }, { git }).response;
    expect(res.status).toBe(422);
    expect((await res.json()).output).toContain("gh repo create itsoffbrand/");
    expect(existsSync(join(dir, "project.config.json"))).toBe(false);
    expect(calls.some((c) => c[0] === "push")).toBe(false);
  });

  test("refuses another branch", async () => {
    const git = fakeGit({
      ...IN_ORG,
      "rev-parse --abbrev-ref": { stdout: "feature\n" },
    });
    const res = await teamPost({ name: "acme" }, { git }).response;
    expect(res.status).toBe(422);
    expect(existsSync(join(dir, "project.config.json"))).toBe(false);
  });

  test("won't move a project connected somewhere else", async () => {
    const other =
      '{"host":"vercel","name":"acme","deployUrl":"https://acme.vercel.app","mediaUrl":null,"previewHostSuffix":"-t.vercel.app"}';
    writeFileSync(join(dir, "project.config.json"), other);
    const res = await teamPost({ name: "acme" }).response;
    expect(res.status).toBe(409);
    expect(readFileSync(join(dir, "project.config.json"), "utf8")).toBe(other);
  });

  test("a failed push stops before the creator link", async () => {
    const git = fakeGit({ ...IN_ORG, push: { code: 1, stderr: "rejected" } });
    const res = await teamPost({ name: "acme" }, { git }).response;
    const result = await res.json();
    expect(res.status).toBe(422);
    expect(result.url).toBeUndefined();
    expect(result.output).toContain("rejected");
  });

  test("with no GitHub login it says how to log in", async () => {
    const res = await teamPost(
      { name: "acme" },
      {
        gh: fakeGit({ api: { code: 1 } }),
        git: fakeGit({ ...IN_ORG, credential: { code: 1 } }),
      }
    ).response;
    expect(res.status).toBe(422);
    expect((await res.json()).output).toContain("gh auth login");
  });

  test("another site can't start it", async () => {
    const res = await handleConnect(
      new Request(`${ORIGIN}/_connect/team`, {
        method: "POST",
        headers: { host: "localhost:6545", origin: "https://evil.example" },
        body: "{}",
      }),
      {
        cwd: dir,
        ip: "127.0.0.1",
        onConnected: async () => {},
        run: noRun,
        git: fakeGit(IN_ORG),
      }
    );
    expect(res.status).toBe(403);
    expect(existsSync(join(dir, "project.config.json"))).toBe(false);
  });
});

describe("the creator's return link", () => {
  async function start(states: Map<string, PendingState>) {
    const result = await (
      await teamPost({ name: "acme-site" }, { states }).response
    ).json();
    return new URL(result.url).searchParams.get("state") as string;
  }
  const back = (
    states: Map<string, PendingState>,
    params: Record<string, string>
  ) =>
    handleConnect(
      new Request(`${ORIGIN}/_connect/created?${new URLSearchParams(params)}`, {
        headers: { host: "localhost:6545" },
      }),
      { cwd: dir, ip: "127.0.0.1", onConnected: async () => {}, states }
    );

  test("works once with the state this server handed out, and shows the links", async () => {
    const states = new Map<string, PendingState>();
    const state = await start(states);
    const res = await back(states, { state, name: "acme-site" });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("https://acme-site.itsoffbrand.dev/app.js");
    expect(html).toContain("location.replace");
    expect((await back(states, { state, name: "acme-site" })).status).toBe(403);
  });

  test("a made-up state or another name is refused", async () => {
    const states = new Map<string, PendingState>();
    const state = await start(states);
    expect(
      (await back(states, { state: "nope", name: "acme-site" })).status
    ).toBe(403);
    expect((await back(states, { state, name: "other" })).status).toBe(403);
  });
});

describe("the dev page HTML", () => {
  test("the team option shows only with team.config.json", () => {
    expect(connectFormHtml(dir)).toContain('value="team"');
    rmSync(join(dir, "team.config.json"));
    expect(connectFormHtml(dir)).not.toContain('value="team"');
  });

  test("a connected team project shows its links and the create button", () => {
    const config = {
      host: "cloudflare" as const,
      name: "acme",
      deployUrl: "https://acme.itsoffbrand.dev",
      mediaUrl: null,
      previewHostSuffix: "-acme.ob-ops.workers.dev",
    };
    const html = connectedPanelHtml(config, dir);
    expect(html).toContain("https://acme.itsoffbrand.dev/app.js");
    expect(html).toContain("&lt;branch&gt;-acme.ob-ops.workers.dev");
    expect(html).toContain("Create on Off+Brand");
    expect(html).toContain("build-manifest.json");
  });
});

describe("helpers", () => {
  test("parseGithubRemote", () => {
    for (const url of [
      "git@github.com:itsoffbrand/acme.git",
      "https://github.com/itsoffbrand/acme",
      "https://x-token@github.com/itsoffbrand/acme.git",
      "ssh://git@github.com/itsoffbrand/acme.git",
    ])
      expect(parseGithubRemote(url)).toEqual({
        owner: "itsoffbrand",
        repo: "acme",
      });
    expect(parseGithubRemote("https://gitlab.com/itsoffbrand/acme")).toBeNull();
  });

  test("lookUpRepoId falls back to git's stored credential", async () => {
    let auth = "";
    const id = await lookUpRepoId("itsoffbrand", "acme", {
      gh: fakeGit({ api: { code: 127 } }),
      git: fakeGit({
        credential: {
          stdout:
            "protocol=https\nhost=github.com\nusername=x\npassword=ghp_example\n",
        },
      }),
      fetch: (async (_url: string, init: RequestInit) => {
        auth = new Headers(init.headers).get("authorization") ?? "";
        return Response.json({ id: 42 });
      }) as unknown as typeof fetch,
    });
    expect(id).toBe("42");
    expect(auth).toBe("Bearer ghp_example");
  });

  test("readTeamConfig rejects a malformed file", () => {
    writeFileSync(
      join(dir, "team.config.json"),
      JSON.stringify({ ...TEAM, creatorUrl: "http://evil" })
    );
    expect(readTeamConfig(dir)).toBeNull();
  });

  test("projectLinks for Vercel", () => {
    const links = projectLinks({
      host: "vercel",
      name: "acme",
      deployUrl: "https://acme.vercel.app",
      mediaUrl: null,
      previewHostSuffix: "-team.vercel.app",
    });
    expect(links.map((l) => l.url)).toContain(
      "https://acme-git-<branch>-team.vercel.app"
    );
  });
});

describe("foreignRoutes", () => {
  const deploy = "https://acme.itsoffbrand.dev";
  test("the project's own domain is fine", () => {
    expect(
      foreignRoutes(
        [{ pattern: "acme.itsoffbrand.dev", custom_domain: true }],
        deploy
      )
    ).toEqual([]);
  });
  test("another project's domain on the same base domain is caught", () => {
    expect(
      foreignRoutes(
        [
          { pattern: "acme.itsoffbrand.dev", custom_domain: true },
          { pattern: "client.itsoffbrand.dev", custom_domain: true },
        ],
        deploy
      )
    ).toEqual(["client.itsoffbrand.dev"]);
    expect(
      foreignRoutes(["*.itsoffbrand.dev/*", "itsoffbrand.dev/api/*"], deploy)
    ).toEqual(["*.itsoffbrand.dev/*", "itsoffbrand.dev/api/*"]);
  });
  test("routes on the owner's other domains are left alone", () => {
    expect(
      foreignRoutes(
        [{ pattern: "shop.example.com/*", zone_name: "example.com" }],
        deploy
      )
    ).toEqual([]);
  });
});
