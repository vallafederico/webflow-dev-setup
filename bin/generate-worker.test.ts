import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateWorker, listApiRoutes } from "./generate-worker";

let dir: string;
let n = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "worker-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const api = (files: Record<string, string>) => {
  mkdirSync(join(dir, "api", "utils"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, "api", name), body);
  }
};

/** Generates the worker in the temp project and imports it. */
async function load() {
  const file = await generateWorker(dir);
  return (await import(`${file}?case=${n++}`)).default as {
    fetch(request: Request): Promise<Response>;
  };
}

const call = async (
  worker: { fetch(r: Request): Promise<Response> },
  path: string,
  method = "GET"
) => worker.fetch(new Request(`https://acme.test${path}`, { method }));

describe("generated worker", () => {
  test("serves handlers by path and method", async () => {
    api({
      "test.ts": `export const GET = () => Response.json({ ok: true });
export const OPTIONS = () => new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
export async function POST(request: Request) { return new Response(await request.text()); }`,
    });
    const worker = await load();

    const get = await call(worker, "/api/test");
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ ok: true });

    const options = await call(worker, "/api/test", "OPTIONS");
    expect(options.status).toBe(200);
    expect(options.headers.get("access-control-allow-origin")).toBe("*");

    const post = await worker.fetch(
      new Request("https://acme.test/api/test", { method: "POST", body: "hi" })
    );
    expect(await post.text()).toBe("hi");
  });

  test("a route without the method gives 405 with Allow", async () => {
    api({ "test.ts": "export const GET = () => new Response('x');" });
    const worker = await load();
    for (const method of [
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
      "HEAD",
    ]) {
      const res = await call(worker, "/api/test", method);
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("GET");
    }
  });

  test("method names outside the allowlist are never dispatched", async () => {
    // `Object.hasOwn` is true for these, so only the allowlist keeps them out.
    api({
      "test.ts":
        "export const GET = () => new Response('x'); export const TRACE = () => new Response('trace');",
    });
    const worker = await load();
    expect((await call(worker, "/api/test", "TRACE")).status).toBe(405);
  });

  test("exports that are not functions are not handlers", async () => {
    api({ "test.ts": "export const GET = 'nope';" });
    const worker = await load();
    expect((await call(worker, "/api/test")).status).toBe(405);
  });

  test("unknown routes and paths outside /api/ give 404", async () => {
    api({ "test.ts": "export const GET = () => new Response('x');" });
    const worker = await load();
    for (const path of [
      "/api/nope",
      "/api/",
      "/api",
      "/api/test/",
      "/api/utils/api-cors",
      "/api/constructor",
      "/api/__proto__",
      "/api/toString",
      "/app.js",
      "/nope.js",
      "/_headers",
      "/",
    ]) {
      expect((await call(worker, path)).status).toBe(404);
    }
  });

  test("a throwing handler gives 500", async () => {
    api({
      "boom.ts": "export const GET = () => { throw new Error('boom'); };",
    });
    const worker = await load();
    const original = console.error;
    console.error = () => {};
    try {
      expect((await call(worker, "/api/boom")).status).toBe(500);
    } finally {
      console.error = original;
    }
  });

  test("helpers, dotfiles, tests and declarations are not routes", async () => {
    const handler = "export const GET = () => new Response('x');";
    api({
      "a.ts": handler,
      "_shared.ts": handler,
      ".hidden.ts": handler,
      "foo.test.ts": "import { test } from 'bun:test'; test('x', () => {});",
      "b.d.ts": "export {};",
      "notes.md": "x",
    });
    expect(await listApiRoutes(join(dir, "api"))).toEqual(["a"]);
    const worker = await load();
    expect(
      readFileSync(join(dir, ".generated", "worker.ts"), "utf8")
    ).not.toContain("foo.test");
    expect((await call(worker, "/api/a")).status).toBe(200);
    for (const path of [
      "/api/_shared",
      "/api/.hidden",
      "/api/foo.test",
      "/api/foo",
    ]) {
      expect((await call(worker, path)).status).toBe(404);
    }
  });

  test("HEAD is 405 unless the route exports HEAD, with no GET fallback", async () => {
    api({
      "get.ts": "export const GET = () => new Response('x');",
      "head.ts":
        "export const HEAD = () => new Response(null, { headers: { 'x-head': '1' } });",
    });
    const worker = await load();
    const noHead = await call(worker, "/api/get", "HEAD");
    expect(noHead.status).toBe(405);
    expect(noHead.headers.get("allow")).toBe("GET");
    const withHead = await call(worker, "/api/head", "HEAD");
    expect(withHead.status).toBe(200);
    expect(withHead.headers.get("x-head")).toBe("1");
  });

  test("only top-level .ts files become routes", async () => {
    api({
      "a.ts": "export const GET = () => new Response('a');",
      "b.d.ts": "export {};",
      "notes.md": "x",
    });
    writeFileSync(
      join(dir, "api", "utils", "helper.ts"),
      "export const GET = () => new Response('h');"
    );
    expect(await listApiRoutes(join(dir, "api"))).toEqual(["a"]);
    const worker = await load();
    expect((await call(worker, "/api/a")).status).toBe(200);
    expect((await call(worker, "/api/utils/helper")).status).toBe(404);
  });

  test("an empty api/ folder gives a router that always returns 404", async () => {
    mkdirSync(join(dir, "api"));
    const worker = await load();
    expect((await call(worker, "/api/test")).status).toBe(404);
    expect((await call(worker, "/app.js")).status).toBe(404);
  });

  test("a missing api/ folder still generates a router", async () => {
    const worker = await load();
    expect((await call(worker, "/api/test")).status).toBe(404);
  });

  test("imports resolve from .generated/ and are written deterministically", async () => {
    api({
      "b.ts": "export const GET = () => new Response('b');",
      "a.ts": "export const GET = () => new Response('a');",
    });
    const file = await generateWorker(dir);
    const first = readFileSync(file, "utf8");
    expect(file).toBe(join(dir, ".generated", "worker.ts"));
    expect(first).toContain('from "../api/a"');
    expect(first.indexOf("../api/a")).toBeLessThan(first.indexOf("../api/b"));
    await generateWorker(dir);
    expect(readFileSync(file, "utf8")).toBe(first);
  });
});
