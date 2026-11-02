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
import { discoverCloudflare, handleConnect } from "./connect-panel";
import type { Runner } from "./connect";

const ORIGIN = "http://localhost:6545";
const TOKEN = "secret-wrangler-token";
const ACCOUNT = "0123456789abcdef0123456789abcdef";

let dir: string;
let rebuilds: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "connect-panel-"));
  rebuilds = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const fakeRun =
  (whoami: object): Runner =>
  async (args) => ({
    code: 0,
    stderr: "",
    stdout:
      args[0] === "whoami"
        ? JSON.stringify(whoami)
        : JSON.stringify({ type: "oauth", token: TOKEN }),
  });

const LOGGED_IN = { loggedIn: true, accounts: [{ id: ACCOUNT, name: "Acme" }] };

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/_connect`, {
    method: "POST",
    headers: { host: "localhost:6545", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function send(req: Request, ip = "127.0.0.1") {
  return handleConnect(req, {
    cwd: dir,
    ip,
    onConnected: async () => {
      rebuilds++;
    },
    run: fakeRun(LOGGED_IN),
    fetch: (() => {
      throw new Error("no network in this test");
    }) as unknown as typeof fetch,
  });
}

const VERCEL = { host: "vercel", name: "acme", suffix: "-team.vercel.app" };
const configPath = () => join(dir, "project.config.json");

describe("who may use it", () => {
  test.each([
    ["another site", { origin: "https://evil.example" }, "127.0.0.1"],
    ["no origin", { origin: "" }, "127.0.0.1"],
    ["a rebinding host", { host: "evil.example:6545" }, "127.0.0.1"],
    ["another machine", {}, "192.168.1.20"],
  ])("a POST from %s is refused and writes nothing", async (_, headers, ip) => {
    const request = post(VERCEL, headers as Record<string, string>);
    if ((headers as { origin?: string }).origin === "")
      request.headers.delete("origin");
    const response = await send(request, ip);
    expect(response.status).toBe(403);
    expect(existsSync(configPath())).toBe(false);
  });

  test("another site can't read the account", async () => {
    const response = await send(
      new Request(`${ORIGIN}/_connect/cloudflare`, {
        headers: { host: "localhost:6545", origin: "https://evil.example" },
      })
    );
    expect(response.status).toBe(403);
  });
});

describe("connecting", () => {
  test("writes the config, rebuilds and returns the next steps", async () => {
    const response = await send(post(VERCEL));
    const result = await response.json();
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Next steps");
    expect(JSON.parse(readFileSync(configPath(), "utf8")).deployUrl).toBe(
      "https://acme.vercel.app"
    );
    expect(rebuilds).toBe(1);
  });

  test("a bad value comes back as a message and writes nothing", async () => {
    const response = await send(post({ ...VERCEL, suffix: ".vercel.app" }));
    const result = await response.json();
    expect(response.status).toBe(422);
    expect(result.ok).toBe(false);
    expect(result.output).toContain("--suffix");
    expect(existsSync(configPath())).toBe(false);
    expect(rebuilds).toBe(0);
  });

  test("a value can't turn into another flag", async () => {
    const response = await send(post({ ...VERCEL, name: "--yes" }));
    expect(response.status).toBe(422);
    expect(existsSync(configPath())).toBe(false);
  });

  test("fields it doesn't know are ignored, so media can't be turned on", async () => {
    const response = await send(
      post({ ...VERCEL, media: true, "zone-id": "x" })
    );
    expect(response.status).toBe(200);
  });

  test("an existing config is left alone", async () => {
    writeFileSync(configPath(), "{}");
    const response = await send(post(VERCEL));
    expect(response.status).toBe(409);
    expect(readFileSync(configPath(), "utf8")).toBe("{}");
  });
});

describe("discoverCloudflare", () => {
  const api = (async (url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get("authorization")).toBe(
      `Bearer ${TOKEN}`
    );
    return Response.json({
      result: String(url).includes("/subdomain")
        ? { subdomain: "my-team" }
        : [{ name: "example.com" }],
    });
  }) as unknown as typeof fetch;

  test("fills in the account, subdomain and domains, and never the token", async () => {
    const info = await discoverCloudflare(fakeRun(LOGGED_IN), api, null);
    expect(info).toEqual({
      loggedIn: true,
      accounts: LOGGED_IN.accounts,
      accountId: ACCOUNT,
      subdomain: "my-team",
      domains: ["example.com"],
    });
    expect(JSON.stringify(info)).not.toContain(TOKEN);
  });

  test("logged out, it says so and calls nothing", async () => {
    const info = await discoverCloudflare(
      fakeRun({ loggedIn: false, accounts: [] }),
      (() => {
        throw new Error("must not be called");
      }) as unknown as typeof fetch,
      null
    );
    expect(info.loggedIn).toBe(false);
    expect(info.domains).toEqual([]);
  });

  test("with several accounts it waits for a choice", async () => {
    const other = { id: "f".repeat(32), name: "Other" };
    const accounts = [...LOGGED_IN.accounts, other];
    const run = fakeRun({ loggedIn: true, accounts });
    expect((await discoverCloudflare(run, api, null)).accountId).toBeNull();
    expect((await discoverCloudflare(run, api, other.id)).accountId).toBe(
      other.id
    );
  });

  test("when the API fails the fields stay empty", async () => {
    const down = (async () =>
      new Response("no", { status: 403 })) as unknown as typeof fetch;
    const info = await discoverCloudflare(fakeRun(LOGGED_IN), down, null);
    expect(info.accountId).toBe(ACCOUNT);
    expect(info.subdomain).toBeNull();
    expect(info.domains).toEqual([]);
  });
});
