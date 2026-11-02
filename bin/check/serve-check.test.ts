import { describe, expect, test } from "bun:test";
import { formatTable, pickPage, probes } from "./serve-check";

describe("serving probes", () => {
  test("cover the table in the plan", () => {
    const table = probes("pages/about.js").map(
      (p) => `${p.method} ${p.path} ${p.status}`
    );
    expect(table).toEqual([
      "GET /app.js 200",
      "GET /pages/about.js 200",
      "GET /check-model.glb 200",
      "GET /check-model.gltf 200",
      "GET /_headers 404",
      "GET /nope.js 404",
      "GET /api/nope 404",
      "GET /api/test 200",
      "OPTIONS /api/test 200",
      "POST /api/test 405",
      "HEAD /api/test 405",
    ]);
  });

  test("a project with no page entry skips only the page probe", () => {
    expect(probes(null).some((p) => p.path.startsWith("/pages/"))).toBe(false);
  });

  test("picks pages/about.js, else the first page, else none", () => {
    expect(pickPage(["app.js", "pages/about.js", "pages/a.js"])).toBe(
      "pages/about.js"
    );
    expect(pickPage(["app.js", "pages/b.js", "pages/a.js"])).toBe("pages/b.js");
    expect(pickPage(["app.js"])).toBeNull();
  });
});

describe("formatTable", () => {
  test("marks failing rows and aligns columns", () => {
    const text = formatTable([
      { request: "GET /a", expected: "200", actual: "200", ok: true },
      { request: "POST /api/test", expected: "405", actual: "200", ok: false },
    ]);
    expect(text.split("\n")).toEqual([
      "   request         expected  actual",
      "ok GET /a          200       200",
      "XX POST /api/test  405       200",
      "",
    ]);
  });
});
