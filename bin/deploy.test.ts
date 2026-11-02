import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DEPLOY = resolve(import.meta.dir, "deploy.ts");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deploy-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Async, so a hook server in this process can answer while deploy.ts runs. */
async function run(host: "cloudflare" | "vercel" | null, hook?: string) {
  if (host) {
    writeFileSync(
      join(dir, "project.config.json"),
      JSON.stringify({
        host,
        name: "acme",
        deployUrl: `https://acme.${host === "vercel" ? "vercel.app" : "itsoffbrand.dev"}`,
        mediaUrl: null,
        previewHostSuffix: "-acme.team.workers.dev",
      })
    );
  }
  const env = { ...process.env };
  delete env.VERCEL_DEPLOY_HOOK;
  if (hook) env.VERCEL_DEPLOY_HOOK = hook;
  const proc = Bun.spawn(["bun", "run", DEPLOY], {
    cwd: dir,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: out + err };
}

describe("deploy", () => {
  test("cloudflare says pushing to main deploys, and never calls the hook", async () => {
    let called = false;
    const hook = Bun.serve({
      port: 0,
      fetch: () => ((called = true), Response.json({})),
    });
    try {
      const { code, out } = await run("cloudflare", String(hook.url));
      expect(code).toBe(0);
      expect(out).toContain("Push to main");
      expect(out).toContain("https://acme.itsoffbrand.dev");
      expect(called).toBe(false);
    } finally {
      hook.stop(true);
    }
  });

  test("vercel posts to the deploy hook and shows the deployment URL", async () => {
    const methods: string[] = [];
    const hook = Bun.serve({
      port: 0,
      fetch: (req) => (
        methods.push(req.method), Response.json({ job: { id: "j1" } })
      ),
    });
    try {
      const { code, out } = await run("vercel", String(hook.url));
      expect(code).toBe(0);
      expect(methods).toEqual(["POST"]);
      expect(out).toContain("j1");
      expect(out).toContain("Deployment URL: https://acme.vercel.app");
    } finally {
      hook.stop(true);
    }
  });

  test("vercel without a hook asks for it", async () => {
    const { code, out } = await run("vercel");
    expect(code).toBe(0);
    expect(out).toContain("VERCEL_DEPLOY_HOOK is not set");
  });

  test("no config still posts to the hook once, and says how to record the URL", async () => {
    const methods: string[] = [];
    const hook = Bun.serve({
      port: 0,
      fetch: (req) => (
        methods.push(req.method), Response.json({ job: { id: "j2" } })
      ),
    });
    try {
      const { code, out } = await run(null, String(hook.url));
      expect(code).toBe(0);
      expect(methods).toEqual(["POST"]);
      expect(out).toContain("j2");
      expect(out).toContain(
        "No project.config.json. Run `pnpm connect vercel`"
      );
      expect(out).not.toContain("Deployment URL");
    } finally {
      hook.stop(true);
    }
  });

  test("no config and no hook asks for the hook", async () => {
    const { code, out } = await run(null);
    expect(code).toBe(0);
    expect(out).toContain("VERCEL_DEPLOY_HOOK is not set");
  });
});
