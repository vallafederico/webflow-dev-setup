import { describe, expect, test } from "bun:test";
import { apiExportProblems } from "./api-exports";

const problems = (source: string) =>
  apiExportProblems("api/x.ts", source).map((p) => p.message);

describe("apiExportProblems", () => {
  test("method handlers in every export form pass", () => {
    expect(
      problems(`
        export function GET(r: Request) { return new Response("a"); }
        export async function POST() { return new Response("b"); }
        export const DELETE = () => new Response("c");
        const put = () => new Response("d");
        export { put as PUT };
        export type Body = { a: number };
        export interface Other {}
      `)
    ).toEqual([]);
  });

  test("an export that is not a method is reported with its name", () => {
    expect(problems("export function GET() {}\nexport const foo = 1;")).toEqual(
      ['exports "foo", which is not an HTTP method handler']
    );
  });

  test("a lowercase handler is called out as a capitalisation mistake", () => {
    expect(problems("export function get() {}")[0]).toContain("capitals (GET)");
  });

  test("default exports, export * and renamed exports are reported", () => {
    expect(problems("export default function () {}")[0]).toContain(
      "default export"
    );
    expect(problems('export * from "./other";')[0]).toContain("export *");
    expect(problems("const a = 1; export { a };")[0]).toContain('"a"');
    expect(problems("export default { fetch() {} };")[0]).toContain(
      "default export"
    );
  });

  test("a route file with no handler is reported, since every request would be a 405", () => {
    expect(problems("const a = 1;")[0]).toContain("no HTTP method handler");
  });

  test("reports the line of the offending export", () => {
    const [problem] = apiExportProblems(
      "api/x.ts",
      "export function GET() {}\n\nexport const foo = 1;"
    );
    expect(problem?.line).toBe(3);
  });

  test("classes, enums and destructured exports are reported", () => {
    expect(problems("export class A {}")[0]).toContain('"A"');
    expect(problems("export enum E { a }")[0]).toContain('"E"');
    expect(problems("export const { a } = { a: 1 };")[0]).toContain(
      "destructured"
    );
  });
});
