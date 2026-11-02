import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DEV = resolve(import.meta.dir, "dev.ts");
const SRC = resolve(import.meta.dir, "..", "src");
// bin/dev.ts always listens on CONFIG.SERVE_PORT, so these can't run while `pnpm dev` does.
const ORIGIN = "http://localhost:6545";

let dir: string;
let proc: ReturnType<typeof Bun.spawn> | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "dev-"));
  mkdirSync(join(dir, "src", "styles"), { recursive: true });
  // Reaches every build-time define, so a missing one leaves its identifier in the bundle.
  writeFileSync(
    join(dir, "src", "app.ts"),
    `import { PUBLIC_ASSET_ORIGIN, mediaUrl } from ${JSON.stringify(join(SRC, "utils/public-asset.ts"))};
import { apiPath } from ${JSON.stringify(join(SRC, "utils/api-path.ts"))};
console.log(PUBLIC_ASSET_ORIGIN, mediaUrl("m.glb"), apiPath("test"));
`
  );
  writeFileSync(join(dir, "src", "styles", "app.css"), "body{margin:0}\n");
});

afterEach(async () => {
  proc?.kill();
  await proc?.exited;
  proc = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** Starts `bin/dev.ts` in the temp project and resolves once its first build has finished. */
async function startDev(): Promise<string> {
  const env = { ...process.env, NODE_ENV: "development" } as Record<string, string | undefined>;
  delete env.USE_SSL;
  delete env.PUBLIC_ASSET_ORIGIN;
  proc = Bun.spawn(["bun", "run", DEV], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });

  let log = "";
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    const reader = stream.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      log += decoder.decode(r.value);
    }
  };
  void read(proc.stdout as ReadableStream<Uint8Array>);
  void read(proc.stderr as ReadableStream<Uint8Array>);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (log.includes("Build complete")) return log;
    if (proc.exitCode !== null) throw new Error(`bin/dev.ts exited early:\n${log}`);
    await Bun.sleep(50);
  }
  throw new Error(`bin/dev.ts never finished building:\n${log}`);
}

describe("bin/dev.ts", () => {
  test("the dev bundle has every build-time define filled in", async () => {
    writeFileSync(
      join(dir, "project.config.json"),
      JSON.stringify({
        host: "cloudflare",
        name: "acme",
        deployUrl: "https://acme.itsoffbrand.dev",
        mediaUrl: null,
        previewHostSuffix: "-acme.team.workers.dev",
      })
    );
    await startDev();
    const js = readFileSync(join(dir, "dist", "app.js"), "utf8");
    expect(js).not.toMatch(/__(PUBLIC_ASSET|MEDIA|API_DEV)_ORIGIN__|__PREVIEW_HOST_SUFFIX__/);
    expect(js).toContain(ORIGIN);
    expect(js).toContain("http://localhost:6546");
    expect(js).toContain("-acme.team.workers.dev");
  });

  test("an invalid config doesn't crash the server and the index shows the error", async () => {
    writeFileSync(join(dir, "project.config.json"), JSON.stringify({ host: "netlify" }));
    const log = await startDev();
    expect(log).toContain("project.config.json is invalid");
    const html = await (await fetch(`${ORIGIN}/`)).text();
    expect(html).not.toContain("Loader Script");
    expect(html).toContain("project.config.json is invalid");
    expect(proc?.exitCode).toBeNull();
  });
});
