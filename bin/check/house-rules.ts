import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { toPosix } from "./tools";
import { type Check, type Finding, type Severity, toResult } from "./types";

/** A text replacement that fixes a finding without changing behaviour. */
export interface Edit {
  file: string;
  start: number;
  end: number;
  text: string;
}

export interface Analysis {
  findings: Finding[];
  edits: Edit[];
}

export const RULES = [
  "module/default-export",
  "module/signature",
  "module/filename",
  "imports/lifecycle",
  "imports/subs",
  "imports/gsap",
  "subs/no-raw",
  "cleanup/subscription",
  "cleanup/state-listener",
  "cleanup/listener",
  "boot/no-body-at-load",
  "browser/no-process-env",
  "editor/handled",
  "debug/console",
  "house-ignore/reason",
] as const;

export type Rule = (typeof RULES)[number];

const WARNING_RULES = new Set<string>([
  "boot/no-body-at-load",
  "debug/console",
]);

const LIFECYCLE_SPECIFIER = "@/modules/_";
const SUBS_SPECIFIER = "@lib/subs";

/** Names that tell a reader nothing about what the module does. */
const GENERIC_NAMES = new Set([
  "module",
  "modules",
  "index",
  "main",
  "util",
  "utils",
  "helper",
  "helpers",
  "component",
  "components",
  "script",
  "scripts",
  "default",
  "new",
  "untitled",
]);

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Why a module name is refused, or null when it is fine. */
export function moduleNameProblem(name: string): string | null {
  if (!KEBAB_CASE.test(name)) {
    return `"${name}" is not kebab-case (lowercase words joined by "-", starting with a letter)`;
  }
  if (GENERIC_NAMES.has(name)) {
    return `"${name}" is too generic, so name the module after what it does`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Paths and imports
// ---------------------------------------------------------------------------

const ALIASES: Array<[prefix: string, target: string]> = [
  ["@/", "src/"],
  ["@modules/", "src/modules/"],
  ["@lifecycle/", "src/modules/"],
  ["@utils/", "src/utils/"],
  ["@lib/", "src/lib/"],
  ["@webflow/", "src/webflow/"],
];

/** Repo-relative path an import points at, or null for a package. */
function resolveSpecifier(from: string, specifier: string): string | null {
  let resolved: string | null = null;
  if (specifier.startsWith(".")) {
    resolved = path.posix.normalize(
      path.posix.join(path.posix.dirname(from), specifier)
    );
  } else {
    for (const [prefix, target] of ALIASES) {
      if (specifier.startsWith(prefix)) {
        resolved = target + specifier.slice(prefix.length);
        break;
      }
    }
  }
  if (!resolved) return null;
  return resolved
    .replace(/\.(ts|tsx|js|jsx|mts|mjs)$/, "")
    .replace(/\/index$/, "")
    .replace(/\/$/, "");
}

const isLifecycleModule = (resolved: string) =>
  resolved === "src/modules/_" || resolved.startsWith("src/modules/_/");

interface ImportBinding {
  /** Repo-relative module path, or the package name for a bare import. */
  module: string;
  /** "default", "*" or the exported name. */
  imported: string;
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

const isModuleFile = (file: string) => /^src\/modules\/[^/]+\.ts$/.test(file);
const isPageFile = (file: string) => file.startsWith("src/pages/");

function listSourceFiles(root: string): string[] {
  const dir = path.join(root, "src");
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .map(toPosix)
    .filter(
      (entry) =>
        /\.(ts|tsx|js|jsx|mts|mjs)$/.test(entry) &&
        !entry.endsWith(".d.ts") &&
        statSync(path.join(dir, entry)).isFile()
    )
    .map((entry) => `src/${entry}`)
    .sort();
}

// ---------------------------------------------------------------------------
// Analysis of one file
// ---------------------------------------------------------------------------

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.ConstructorDeclaration;

const isFunctionLike = (node: ts.Node): node is FunctionLike =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node) ||
  ts.isConstructorDeclaration(node);

/** A function written in place, so it can't be named and removed later. */
const isInlineFunction = (node: ts.Node) =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

const compact = (text: string) => text.replace(/\s+/g, "");

const HOOK_NAME = /^on[A-Z]/;
const OBSERVERS = new Set([
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
]);
/** GSAP members that read or configure rather than animate. */
const GSAP_PASSIVE = new Set([
  "utils",
  "registerPlugin",
  "defaults",
  "config",
  "parseEase",
  "getProperty",
]);

type Stored =
  | { kind: "stored"; name: string }
  | { kind: "destroy" }
  | { kind: "lost" };

class FileAnalyzer {
  readonly sf: ts.SourceFile;
  readonly lines: string[];
  readonly imports = new Map<string, ImportBinding>();
  readonly findings: Finding[] = [];
  readonly edits: Edit[] = [];
  private readonly functions = new Map<string, FunctionLike[]>();
  private destroyCalls: ts.CallExpression[] = [];
  private destroyRefs = new Set<string>();
  private validIgnores = new Map<number, Set<string>>();

  constructor(
    readonly file: string,
    readonly text: string
  ) {
    this.sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.ESNext,
      true,
      /\.(js|mjs|jsx)$/.test(file) ? ts.ScriptKind.JS : undefined
    );
    this.lines = text.split(/\r?\n/);
    this.collectImports();
    this.collectFunctions();
    this.collectIgnores();
  }

  // -- reporting -----------------------------------------------------------

  private lineOf(node: ts.Node): number {
    return (
      this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf)).line + 1
    );
  }

  /** Line of the first statement, for findings about the whole file. */
  private fileLine(): number {
    const first = this.sf.statements[0];
    return first ? this.lineOf(first) : 1;
  }

  private report(
    rule: Rule,
    line: number,
    message: string,
    fix: string,
    severity?: Severity
  ) {
    const ignored = this.validIgnores.get(line - 1);
    if (ignored?.has(rule)) return false;
    this.findings.push({
      rule,
      severity: severity ?? (WARNING_RULES.has(rule) ? "warning" : "error"),
      file: this.file,
      line,
      message,
      fix,
    });
    return true;
  }

  private reportAt(rule: Rule, node: ts.Node, message: string, fix: string) {
    return this.report(rule, this.lineOf(node), message, fix);
  }

  // -- collection ----------------------------------------------------------

  private collectImports() {
    for (const statement of this.sf.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const clause = statement.importClause;
      if (!clause || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const module = resolveSpecifier(this.file, specifier) ?? specifier;
      if (clause.name) {
        this.imports.set(clause.name.text, { module, imported: "default" });
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        this.imports.set(bindings.name.text, { module, imported: "*" });
      } else if (bindings) {
        for (const element of bindings.elements) {
          this.imports.set(element.name.text, {
            module,
            imported: (element.propertyName ?? element.name).text,
          });
        }
      }
    }
  }

  private collectFunctions() {
    const add = (name: string, fn: FunctionLike) => {
      this.functions.set(name, [...(this.functions.get(name) ?? []), fn]);
    };
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        add(node.name.text, node);
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const init = unwrap(node.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          add(node.name.text, init);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(this.sf);
  }

  /**
   * `// house-ignore <rule>: <reason>` on the line above silences a rule. An
   * ignore without a reason silences nothing and is reported instead.
   */
  private collectIgnores() {
    this.lines.forEach((raw, index) => {
      const comment = /^\s*\/\/\s*house-ignore\b(.*)$/.exec(raw);
      if (!comment) return;
      const rest = comment[1] ?? "";
      const valid = /^\s+([\w/-]+(?:[\s,]+[\w/-]+)*?)\s*:\s*(\S.*)$/.exec(rest);
      if (valid) {
        const rules = (valid[1] ?? "").split(/[\s,]+/).filter(Boolean);
        this.validIgnores.set(index + 1, new Set(rules));
      } else {
        this.pendingReasonLines.push(index + 1);
      }
    });
  }

  private pendingReasonLines: number[] = [];

  // -- name resolution -----------------------------------------------------

  private binding(node: ts.Node | undefined): ImportBinding | undefined {
    if (!node) return undefined;
    const target = unwrap(node as ts.Expression);
    return ts.isIdentifier(target) ? this.imports.get(target.text) : undefined;
  }

  private isNamedImport(
    node: ts.Node | undefined,
    module: (resolved: string) => boolean,
    name: string
  ): boolean {
    const binding = this.binding(node);
    return !!binding && module(binding.module) && binding.imported === name;
  }

  private isLifecycle(node: ts.Node | undefined, name: string) {
    return this.isNamedImport(node, isLifecycleModule, name);
  }

  private isSubscribable(node: ts.Node | undefined) {
    return (
      this.isNamedImport(node, (m) => m === "src/lib/subs", "Raf") ||
      this.isNamedImport(node, (m) => m === "src/lib/subs", "Resize") ||
      this.isNamedImport(node, (m) => m === "src/lib/scroll", "Scroll")
    );
  }

  private isRaf(node: ts.Node | undefined) {
    return this.isNamedImport(node, (m) => m === "src/lib/subs", "Raf");
  }

  /** `State`, whatever the default import from lib/hey is called. */
  private isState(node: ts.Node | undefined) {
    return this.isNamedImport(node, (m) => m === "src/lib/hey", "default");
  }

  private isGsapRoot(node: ts.Node | undefined) {
    const lib = (m: string) => m === "src/lib/gsap";
    return (
      this.isNamedImport(node, lib, "default") ||
      this.isNamedImport(node, lib, "ScrollTrigger")
    );
  }

  private calls(root: ts.Node): ts.CallExpression[] {
    const found: ts.CallExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) found.push(node);
      ts.forEachChild(node, visit);
    };
    visit(root);
    return found;
  }

  // -- destroy regions -----------------------------------------------------

  /**
   * Collects every call that runs inside an `onDestroy` callback, following
   * local helper functions that the callback calls.
   */
  private collectDestroyRegions() {
    const regions: ts.Node[] = [];
    const seen = new Set<ts.Node>();
    const addRegion = (node: ts.Node) => {
      if (seen.has(node)) return;
      seen.add(node);
      regions.push(node);
    };
    const addNamed = (name: string) => {
      for (const fn of this.functions.get(name) ?? []) addRegion(fn);
    };

    for (const call of this.calls(this.sf)) {
      if (!this.isLifecycle(call.expression, "onDestroy")) continue;
      const arg = call.arguments[0];
      if (!arg) continue;
      const target = unwrap(arg);
      if (isInlineFunction(target)) {
        addRegion(target);
      } else if (ts.isIdentifier(target)) {
        this.destroyRefs.add(target.text);
        addNamed(target.text);
      } else {
        this.destroyRefs.add(compact(target.getText(this.sf)));
      }
    }

    // Follow helpers: onDestroy(() => cleanup()) runs cleanup's body too.
    for (let index = 0; index < regions.length; index++) {
      for (const call of this.calls(regions[index] as ts.Node)) {
        const callee = unwrap(call.expression);
        if (ts.isIdentifier(callee)) addNamed(callee.text);
      }
    }

    this.destroyCalls = regions.flatMap((region) => this.calls(region));
  }

  /** Is `target()` or `target?.()` called in a destroy callback? */
  private invokedInDestroy(target: string) {
    return (
      this.destroyRefs.has(target) ||
      this.destroyCalls.some(
        (call) => compact(unwrap(call.expression).getText(this.sf)) === target
      )
    );
  }

  /** Is `receiver.method(handler?)` called in a destroy callback? */
  private methodInDestroy(
    receiver: string,
    method: string,
    handler?: string
  ): boolean {
    return this.destroyCalls.some((call) => {
      const callee = unwrap(call.expression);
      if (!ts.isPropertyAccessExpression(callee)) return false;
      if (callee.name.text !== method) return false;
      if (compact(callee.expression.getText(this.sf)) !== receiver) {
        return false;
      }
      return (
        handler === undefined ||
        call.arguments.some((arg) => compact(arg.getText(this.sf)) === handler)
      );
    });
  }

  /** Where the value of this expression ends up: `x` in `const x = value`. */
  private storedAs(node: ts.Node): Stored {
    let current: ts.Node = node;
    while (
      current.parent &&
      (ts.isParenthesizedExpression(current.parent) ||
        ts.isNonNullExpression(current.parent) ||
        ts.isAsExpression(current.parent))
    ) {
      current = current.parent;
    }
    const parent = current.parent;
    if (
      parent &&
      ts.isVariableDeclaration(parent) &&
      parent.initializer === current &&
      ts.isIdentifier(parent.name)
    ) {
      return { kind: "stored", name: parent.name.text };
    }
    if (
      parent &&
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.right === current
    ) {
      return { kind: "stored", name: compact(parent.left.getText(this.sf)) };
    }
    if (
      parent &&
      ts.isCallExpression(parent) &&
      parent.arguments.includes(current as ts.Expression) &&
      this.isLifecycle(parent.expression, "onDestroy")
    ) {
      return { kind: "destroy" };
    }
    return { kind: "lost" };
  }

  // -- rules ---------------------------------------------------------------

  run(): Analysis {
    const moduleFile = isModuleFile(this.file);
    const sourceFile = this.file.startsWith("src/");

    if (sourceFile) {
      this.checkImports();
      this.checkProcessEnv();
    }
    if (moduleFile || isPageFile(this.file)) this.checkRawSubscriptions();
    if (moduleFile) {
      this.collectDestroyRegions();
      this.checkModuleShape();
      this.checkSubscriptions();
      this.checkStateListeners();
      this.checkListeners();
      this.checkBodyAtLoad();
      this.checkEditor();
      this.checkConsole();
    }

    // Unlike the rules above, this one can't be silenced by an ignore.
    for (const line of this.pendingReasonLines) {
      this.findings.push({
        rule: "house-ignore/reason",
        severity: "error",
        file: this.file,
        line,
        message:
          "house-ignore needs a rule and a reason, so it silences nothing",
        fix: "Write it as // house-ignore <rule>: <reason> on the line above the finding",
      });
    }
    return { findings: this.findings, edits: this.edits };
  }

  private checkImports() {
    for (const statement of this.sf.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const literal = statement.moduleSpecifier;
      const specifier = literal.text;
      const resolved = resolveSpecifier(this.file, specifier);

      if (resolved === "src/lib/subs" && specifier !== SUBS_SPECIFIER) {
        this.fixableImport(
          "imports/subs",
          statement,
          literal,
          SUBS_SPECIFIER,
          `Subscriptions are imported from "${SUBS_SPECIFIER}", not "${specifier}"`
        );
      }

      if (resolved && isLifecycleModule(resolved)) {
        const names = this.importedNames(statement);
        const importsHook = names.some((name) => HOOK_NAME.test(name));
        const insideLifecycle = this.file.startsWith("src/modules/_/");
        const misspelled = specifier !== LIFECYCLE_SPECIFIER;
        if (importsHook && misspelled && !insideLifecycle) {
          this.fixableImport(
            "imports/lifecycle",
            statement,
            literal,
            LIFECYCLE_SPECIFIER,
            `Lifecycle hooks are imported from "${LIFECYCLE_SPECIFIER}", not "${specifier}"`
          );
        }
      }

      const isGsapPackage =
        specifier === "gsap" || specifier.startsWith("gsap/");
      if (isGsapPackage && this.file !== "src/lib/gsap.ts") {
        this.reportAt(
          "imports/gsap",
          statement,
          `"${specifier}" is imported directly, so plugins registered in src/lib/gsap.ts may be missing`,
          'Import gsap and its plugins from "@lib/gsap" instead'
        );
      }
    }
  }

  private importedNames(statement: ts.ImportDeclaration): string[] {
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return [];
    return bindings.elements.map(
      (element) => (element.propertyName ?? element.name).text
    );
  }

  private fixableImport(
    rule: Rule,
    statement: ts.ImportDeclaration,
    literal: ts.StringLiteral,
    replacement: string,
    message: string
  ) {
    const reported = this.reportAt(
      rule,
      statement,
      message,
      `Import from "${replacement}" instead. pnpm fix does this`
    );
    if (reported) {
      this.edits.push({
        file: this.file,
        start: literal.getStart(this.sf),
        end: literal.getEnd(),
        text: `"${replacement}"`,
      });
    }
  }

  private checkProcessEnv() {
    const visit = (node: ts.Node) => {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "process" &&
        node.name.text === "env"
      ) {
        const parent = node.parent;
        const allowed =
          (ts.isPropertyAccessExpression(parent) &&
            parent.expression === node &&
            parent.name.text === "NODE_ENV") ||
          (ts.isElementAccessExpression(parent) &&
            parent.expression === node &&
            ts.isStringLiteralLike(parent.argumentExpression) &&
            parent.argumentExpression.text === "NODE_ENV");
        if (!allowed) {
          this.reportAt(
            "browser/no-process-env",
            node,
            "process.env does not exist in the browser, and the build only replaces NODE_ENV",
            "Read the value at build time (a define in bin/build.ts or the project config) or pass it in a data attribute"
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(this.sf);
  }

  private checkRawSubscriptions() {
    for (const call of this.calls(this.sf)) {
      const callee = unwrap(call.expression);
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : "";
      if (
        name === "requestAnimationFrame" &&
        (ts.isIdentifier(callee) ||
          compact(callee.getText(this.sf)) === "window.requestAnimationFrame")
      ) {
        this.reportAt(
          "subs/no-raw",
          call,
          "requestAnimationFrame runs its own loop next to the shared ticker",
          'Use Raf.add from "@lib/subs" and call the result in onDestroy'
        );
      }
      const first = call.arguments[0];
      if (
        name === "addEventListener" &&
        first &&
        ts.isStringLiteralLike(first) &&
        first.text === "resize"
      ) {
        this.reportAt(
          "subs/no-raw",
          call,
          "A resize listener runs next to the shared, debounced Resize subscription",
          'Use Resize.add from "@lib/subs" and call the result in onDestroy'
        );
      }
    }
  }

  // -- module rules --------------------------------------------------------

  private checkModuleShape() {
    const base = path.posix.basename(this.file, ".ts");
    const problem = moduleNameProblem(base);
    if (problem) {
      this.report(
        "module/filename",
        this.fileLine(),
        `Module file name ${problem}`,
        "Rename the file to a kebab-case name that says what it does, and update its data-module attribute"
      );
    }

    const found = this.findDefaultExport();
    if (!found.fn) {
      this.report(
        "module/default-export",
        found.node ? this.lineOf(found.node) : this.fileLine(),
        "A module must default-export the function that receives its element",
        "Add export default function (element: HTMLElement, dataset: DOMStringMap) { ... }"
      );
      return;
    }

    const params = found.fn.parameters;
    const expected = ["HTMLElement", "DOMStringMap"];
    const fix =
      "Declare the signature as (element: HTMLElement, dataset: DOMStringMap), and drop trailing parameters you don't use";
    if (params.length > expected.length) {
      this.reportAt(
        "module/signature",
        params[expected.length] as ts.Node,
        `Module takes ${params.length} parameters, but only (element, dataset) are passed`,
        fix
      );
      return;
    }
    params.forEach((param, index) => {
      const type = param.type ? compact(param.type.getText(this.sf)) : "";
      if (
        !ts.isIdentifier(param.name) ||
        param.dotDotDotToken ||
        type !== expected[index]
      ) {
        this.reportAt(
          "module/signature",
          param,
          `Parameter ${index + 1} is \`${param.getText(this.sf)}\` but must be typed ${expected[index]}`,
          fix
        );
      }
    });
  }

  private findDefaultExport(): { fn: FunctionLike | null; node?: ts.Node } {
    const resolveName = (name: string): FunctionLike | null =>
      this.functions.get(name)?.[0] ?? null;

    for (const statement of this.sf.statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.modifiers?.some(
          (m) => m.kind === ts.SyntaxKind.DefaultKeyword
        )
      ) {
        return { fn: statement };
      }
      if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
        const expression = unwrap(statement.expression);
        if (
          ts.isArrowFunction(expression) ||
          ts.isFunctionExpression(expression)
        ) {
          return { fn: expression };
        }
        const fn = ts.isIdentifier(expression)
          ? resolveName(expression.text)
          : null;
        return { fn, node: statement };
      }
      if (
        ts.isExportDeclaration(statement) &&
        !statement.moduleSpecifier &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements) {
          if (element.name.text === "default") {
            const local = (element.propertyName ?? element.name).text;
            return { fn: resolveName(local), node: statement };
          }
        }
      }
    }
    return { fn: null };
  }

  private checkSubscriptions() {
    for (const call of this.calls(this.sf)) {
      const callee = unwrap(call.expression);
      if (
        !ts.isPropertyAccessExpression(callee) ||
        callee.name.text !== "add" ||
        !this.isSubscribable(callee.expression)
      ) {
        continue;
      }
      const label = compact(callee.getText(this.sf));
      const where = this.storedAs(call);
      if (where.kind === "destroy") continue;
      if (where.kind === "lost") {
        this.reportAt(
          "cleanup/subscription",
          call,
          `${label} returns the function that unsubscribes, but its result is not kept`,
          `Store it (const stop = ${label}(...)) and call stop() inside onDestroy`
        );
      } else if (!this.invokedInDestroy(where.name)) {
        this.reportAt(
          "cleanup/subscription",
          call,
          `${label} is stored as ${where.name} but ${where.name}() is never called in onDestroy, so it keeps running after the page leaves`,
          `Call ${where.name}() inside onDestroy`
        );
      }
    }
  }

  private checkStateListeners() {
    for (const call of this.calls(this.sf)) {
      const callee = unwrap(call.expression);
      if (
        !ts.isPropertyAccessExpression(callee) ||
        callee.name.text !== "on" ||
        !this.isState(callee.expression)
      ) {
        continue;
      }
      const receiver = compact(callee.expression.getText(this.sf));
      const handler = call.arguments[1] && unwrap(call.arguments[1]);
      if (!handler) continue;

      if (
        !ts.isIdentifier(handler) &&
        !ts.isPropertyAccessExpression(handler)
      ) {
        this.reportAt(
          "cleanup/state-listener",
          call,
          `${receiver}.on is given an inline function, which can't be removed, so the listener outlives the page`,
          `Name the handler (const onChange = (data) => {...}), pass it to ${receiver}.on, and call ${receiver}.off with the same name inside onDestroy`
        );
        continue;
      }
      const handlerText = compact(handler.getText(this.sf));
      if (!this.methodInDestroy(receiver, "off", handlerText)) {
        this.reportAt(
          "cleanup/state-listener",
          call,
          `${receiver}.on has no matching ${receiver}.off for ${handlerText} in onDestroy, so the listener outlives the page`,
          `Call ${receiver}.off with the same event and ${handlerText} inside onDestroy`
        );
      }
    }
  }

  private checkListeners() {
    for (const call of this.calls(this.sf)) {
      const callee = unwrap(call.expression);
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : "";

      if (
        name === "addEventListener" &&
        ts.isPropertyAccessExpression(callee)
      ) {
        this.checkEventListener(call, callee);
      }
      if (
        name === "setInterval" &&
        (ts.isIdentifier(callee) ||
          compact(callee.getText(this.sf)) === "window.setInterval")
      ) {
        this.checkInterval(call);
      }
    }

    const visit = (node: ts.Node) => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        OBSERVERS.has(node.expression.text)
      ) {
        this.checkObserver(node, node.expression.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(this.sf);
  }

  private checkEventListener(
    call: ts.CallExpression,
    callee: ts.PropertyAccessExpression
  ) {
    const target = compact(callee.expression.getText(this.sf));
    const type = call.arguments[0];
    const handler = call.arguments[1] && unwrap(call.arguments[1]);
    const options = call.arguments[2] && unwrap(call.arguments[2]);

    if (options && ts.isObjectLiteralExpression(options)) {
      const property = (key: string) =>
        options.properties.find(
          (p) => ts.isPropertyAssignment(p) && p.name.getText(this.sf) === key
        ) as ts.PropertyAssignment | undefined;
      if (property("once")?.initializer.kind === ts.SyntaxKind.TrueKeyword) {
        return;
      }
      const hasSignal =
        !!property("signal") ||
        options.properties.some(
          (p) => ts.isShorthandPropertyAssignment(p) && p.name.text === "signal"
        );
      if (hasSignal) {
        const aborted = this.destroyCalls.some((c) => {
          const f = unwrap(c.expression);
          return ts.isPropertyAccessExpression(f) && f.name.text === "abort";
        });
        if (!aborted) {
          this.reportAt(
            "cleanup/listener",
            call,
            `${target}.addEventListener uses an AbortController signal, but abort() is never called in onDestroy`,
            "Call controller.abort() inside onDestroy"
          );
        }
        return;
      }
    }

    const typeText = type ? type.getText(this.sf) : "event";
    if (
      !handler ||
      (!ts.isIdentifier(handler) && !ts.isPropertyAccessExpression(handler))
    ) {
      this.reportAt(
        "cleanup/listener",
        call,
        `${target}.addEventListener(${typeText}) is given an inline function, which can't be removed`,
        `Name the handler and call ${target}.removeEventListener(${typeText}, handler) inside onDestroy, or pass { once: true }`
      );
      return;
    }
    const handlerText = compact(handler.getText(this.sf));
    if (!this.methodInDestroy(target, "removeEventListener", handlerText)) {
      this.reportAt(
        "cleanup/listener",
        call,
        `${target}.addEventListener(${typeText}) has no matching removeEventListener for ${handlerText} in onDestroy`,
        `Call ${target}.removeEventListener(${typeText}, ${handlerText}) inside onDestroy, or pass { once: true }`
      );
    }
  }

  private checkInterval(call: ts.CallExpression) {
    const where = this.storedAs(call);
    const cleared = (name: string) =>
      this.destroyCalls.some((c) => {
        const f = compact(unwrap(c.expression).getText(this.sf));
        return (
          (f === "clearInterval" || f === "window.clearInterval") &&
          !!c.arguments[0] &&
          compact(c.arguments[0].getText(this.sf)) === name
        );
      });
    if (where.kind === "stored" && cleared(where.name)) return;
    if (where.kind === "stored") {
      this.reportAt(
        "cleanup/listener",
        call,
        `setInterval is stored as ${where.name} but clearInterval(${where.name}) is never called in onDestroy`,
        `Call clearInterval(${where.name}) inside onDestroy`
      );
    } else {
      this.reportAt(
        "cleanup/listener",
        call,
        "setInterval's id is not kept, so the interval can't be cleared and keeps running after the page leaves",
        "Store the id (const id = setInterval(...)) and call clearInterval(id) inside onDestroy"
      );
    }
  }

  private checkObserver(node: ts.NewExpression, name: string) {
    const where = this.storedAs(node);
    if (where.kind === "stored") {
      if (this.methodInDestroy(where.name, "disconnect")) return;
      this.reportAt(
        "cleanup/listener",
        node,
        `${name} is stored as ${where.name} but ${where.name}.disconnect() is never called in onDestroy`,
        `Call ${where.name}.disconnect() inside onDestroy`
      );
    } else {
      this.reportAt(
        "cleanup/listener",
        node,
        `${name} is not stored, so it can't be disconnected and keeps observing after the page leaves`,
        `Store it (const observer = new ${name}(...)) and call observer.disconnect() inside onDestroy`
      );
    }
  }

  private checkBodyAtLoad() {
    const isCondition = (node: ts.Node) => {
      const parent = node.parent;
      if (!parent) return false;
      if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent)) {
        return (
          ("expression" in parent && parent.expression === node) ||
          ("condition" in parent && parent.condition === node)
        );
      }
      if (ts.isPrefixUnaryExpression(parent)) {
        return parent.operator === ts.SyntaxKind.ExclamationToken;
      }
      if (ts.isBinaryExpression(parent)) {
        return [
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken,
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(parent.operatorToken.kind);
      }
      return (
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        !!parent.questionDotToken
      );
    };

    const visit = (node: ts.Node) => {
      // Code inside a function runs later, when <body> exists.
      if (isFunctionLike(node)) return;
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "document" &&
        node.name.text === "body" &&
        !isCondition(node)
      ) {
        this.reportAt(
          "boot/no-body-at-load",
          node,
          "document.body is read while the file loads, and it is null when the script runs from <head>",
          "Move it inside onMount or a function that runs later, or wait for DOMContentLoaded"
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(this.sf);
  }

  private checkEditor() {
    const hasEditor = this.calls(this.sf).some((call) =>
      this.isLifecycle(call.expression, "onEditor")
    );
    if (hasEditor) return;

    const effect = (node: ts.Node): string | null => {
      if (ts.isNewExpression(node)) {
        return this.isNamedImport(
          node.expression,
          (m) => m === "src/lib/gsap",
          "SplitText"
        )
          ? "new SplitText"
          : null;
      }
      if (!ts.isCallExpression(node)) return null;
      const callee = unwrap(node.expression);
      if (this.isLifecycle(callee, "onView")) return "onView";
      if (!ts.isPropertyAccessExpression(callee)) return null;
      if (callee.name.text === "add" && this.isRaf(callee.expression)) {
        return "Raf.add";
      }
      // Walk down gsap.timeline().to() style chains to the identifier.
      const members: string[] = [callee.name.text];
      let root: ts.Expression = callee.expression;
      for (;;) {
        root = unwrap(root);
        if (ts.isPropertyAccessExpression(root)) {
          members.unshift(root.name.text);
          root = root.expression;
        } else if (ts.isCallExpression(root)) {
          root = root.expression;
        } else {
          break;
        }
      }
      if (this.isGsapRoot(root) && !GSAP_PASSIVE.has(members[0] as string)) {
        return `${compact(root.getText(this.sf))}.${members[0]}`;
      }
      return null;
    };

    let first: { node: ts.Node; label: string } | null = null;
    const visit = (node: ts.Node) => {
      if (first) return;
      const label = effect(node);
      if (label) {
        first = { node, label };
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(this.sf);

    if (first) {
      const { node, label } = first as { node: ts.Node; label: string };
      this.reportAt(
        "editor/handled",
        node,
        `${label} runs in this module, but it never calls onEditor, so it also runs inside the Webflow editor`,
        'Import onEditor from "@/modules/_" and call onEditor((isEditor) => { ... }) to skip or reset the effect when isEditor is true'
      );
    }
  }

  private checkConsole() {
    for (const call of this.calls(this.sf)) {
      const callee = unwrap(call.expression);
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === "console" &&
        callee.name.text === "log"
      ) {
        this.reportAt(
          "debug/console",
          call,
          "console.log left in a module",
          "Delete it before finishing, or keep it behind a debug flag"
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Analyses a source string as if it lived at `file`. Used by the tests. */
export function analyzeSource(file: string, text: string): Analysis {
  return new FileAnalyzer(file, text).run();
}

/** Analyses every file under `<root>/src`. */
export function analyzeRoot(root: string): Analysis {
  const findings: Finding[] = [];
  const edits: Edit[] = [];
  for (const file of listSourceFiles(root)) {
    const result = analyzeSource(
      file,
      readFileSync(path.join(root, file), "utf8")
    );
    findings.push(...result.findings);
    edits.push(...result.edits);
  }
  return { findings, edits };
}

/** Applies edits back to front so earlier offsets stay valid. */
export function applyEdits(text: string, edits: Edit[]): string {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}

export const houseRules: Check = {
  name: "house-rules",
  tier: "fast",
  async run({ root }) {
    return toResult("house-rules", analyzeRoot(root).findings);
  },
};
