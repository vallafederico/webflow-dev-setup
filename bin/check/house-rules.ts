import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { toPosix } from "./tools";
import {
  type Check,
  type Finding,
  type Severity,
  ToolFailure,
  toResult,
} from "./types";

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

/**
 * What the rules can't see, because they match syntax and not behaviour. The
 * browser run is the check for these. Used by docs/house-rules.md.
 */
export const LIMITS: string[] = [
  "Conditional cleanup counts as cleanup: `if (false) stop()` and `if (x) onDestroy(stop)` both pass.",
  "An onDestroy inside a function that is never called still counts.",
  "Names are matched as written, so a local variable that shadows an import (`const Raf = ...`) or an alias of one (`const r = Raf; r.add(...)`) is not followed.",
  "A no-op `onEditor(() => {})` satisfies editor/handled. The rule checks that the helper is called, not what the callback does.",
  "Listener removal is matched on target, event and handler. A mismatch in the capture flag or other options is not seen.",
  "A helper that subscribes on the module's behalf (`function track() { Raf.add(...) }` called from the module) is only checked inside the helper's own file.",
  "A subscription stored in a variable that is later reassigned (`let s = Raf.add(a); s = Raf.add(b); onDestroy(s)`) passes, though the first one leaks.",
  "Collections are followed only when filled by an array literal or push/unshift and drained by forEach or for...of in onDestroy.",
  "A cleanup that is passed through a function call, a callback argument or an object method is not followed beyond local helpers.",
];

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

const isModuleFile = (file: string) =>
  /^src\/modules\/[^/]+\.(ts|js)$/.test(file);
const isPageFile = (file: string) => file.startsWith("src/pages/");

function listSourceFiles(root: string): string[] {
  const dir = path.join(root, "src");
  if (!existsSync(dir)) {
    throw new ToolFailure(
      "src/ does not exist, so there is no code for the house rules to check",
      { fix: "Run the check from the project root, which holds src/" }
    );
  }
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

const GLOBALS = new Set(["window", "self", "globalThis"]);

/** Strips parentheses, casts, `!` and `await` from an expression. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isAwaitExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** The outermost wrapper around `node`, such as `(process as any)`. */
function outerExpression(node: ts.Node): ts.Node {
  let current = node;
  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isTypeAssertionExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent)) &&
    current.parent.expression === current
  ) {
    current = current.parent;
  }
  return current;
}

type MemberAccess = ts.PropertyAccessExpression | ts.ElementAccessExpression;

function isMemberOf(parent: ts.Node, node: ts.Node): parent is MemberAccess {
  return (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent)) &&
    parent.expression === node
  );
}

/** `b` in `a.b` and in `a["b"]`. Null for anything computed. */
function memberName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) {
    const key = unwrap(node.argumentExpression);
    return ts.isStringLiteralLike(key) ? key.text : null;
  }
  return null;
}

/** `window`, `self`, `globalThis`, or one reached through another of them. */
function isGlobalObject(node: ts.Expression): boolean {
  const target = unwrap(node);
  if (ts.isIdentifier(target)) return GLOBALS.has(target.text);
  return (
    (ts.isPropertyAccessExpression(target) ||
      ts.isElementAccessExpression(target)) &&
    GLOBALS.has(memberName(target) ?? "") &&
    isGlobalObject(target.expression)
  );
}

/**
 * `fn`, `window.fn`, `self["fn"]` and `(globalThis as any).fn` all name the
 * same global function. Returns `fn`, or null for any other receiver.
 */
function globalCallName(callee: ts.Expression): string | null {
  const target = unwrap(callee);
  if (ts.isIdentifier(target)) return target.text;
  if (
    (ts.isPropertyAccessExpression(target) ||
      ts.isElementAccessExpression(target)) &&
    isGlobalObject(target.expression)
  ) {
    return memberName(target);
  }
  return null;
}

/** `fn` for `fn()` and `x.fn()` whatever `x` is. */
function memberOrBareName(callee: ts.Expression): string | null {
  const target = unwrap(callee);
  return ts.isIdentifier(target) ? target.text : memberName(target);
}

/** Does a binding pattern bind the property `name`? */
function bindsName(pattern: ts.BindingName, name: string): boolean {
  return (
    ts.isObjectBindingPattern(pattern) &&
    pattern.elements.some(
      (element) => (element.propertyName ?? element.name).getText() === name
    )
  );
}

const isGsapPackage = (specifier: string) =>
  specifier === "gsap" || specifier.startsWith("gsap/");

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
  | { kind: "collection"; name: string }
  | { kind: "destroy" }
  | { kind: "lost" };

class FileAnalyzer {
  readonly sf: ts.SourceFile;
  readonly lines: string[];
  readonly imports = new Map<string, ImportBinding>();
  readonly findings: Finding[] = [];
  readonly edits: Edit[] = [];
  private readonly functions = new Map<string, FunctionLike[]>();
  private destroyRegions: ts.Node[] = [];
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
      const valid = /^\s+([\w/-]+)\s*:\s*(\S.*)$/.exec(rest);
      if (valid) {
        this.validIgnores.set(index + 1, new Set([valid[1] as string]));
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
      this.isNamedImport(node, lib, "ScrollTrigger") ||
      this.isNamedImport(node, lib, "SplitText")
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

    this.destroyRegions = regions;
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

  /** Is `call` a call of `receiver.method(...)`? */
  private isMethod(call: ts.CallExpression, receiver: string, method: string) {
    const callee = unwrap(call.expression);
    return (
      isMemberOf(callee, (callee as MemberAccess).expression) &&
      memberName(callee) === method &&
      compact((callee as MemberAccess).expression.getText(this.sf)) === receiver
    );
  }

  /**
   * Does a destroy callback make a call that `match` accepts and whose first
   * arguments read as `args`?
   */
  private callInDestroy(
    match: (call: ts.CallExpression) => boolean,
    args: string[]
  ): boolean {
    return this.destroyCalls.some(
      (call) =>
        match(call) &&
        args.every(
          (text, index) =>
            !!call.arguments[index] &&
            compact(call.arguments[index]?.getText(this.sf) ?? "") === text
        )
    );
  }

  /**
   * Does a destroy callback go through every entry of the array `name`, as in
   * `name.forEach((entry) => entry())` or `for (const entry of name) ...`?
   */
  private drainedInDestroy(
    name: string,
    how: "call" | "disconnect" | "clear"
  ): boolean {
    const uses = (body: ts.Node, entry: string) =>
      this.calls(body).some((call) => {
        const callee = unwrap(call.expression);
        if (how === "call") {
          return ts.isIdentifier(callee) && callee.text === entry;
        }
        if (how === "disconnect") {
          return (
            isMemberOf(callee, (callee as MemberAccess).expression) &&
            memberName(callee) === "disconnect" &&
            compact((callee as MemberAccess).expression.getText(this.sf)) ===
              entry
          );
        }
        return (
          globalCallName(callee) === "clearInterval" &&
          call.arguments.some((arg) => compact(arg.getText(this.sf)) === entry)
        );
      });

    let drained = false;
    const visit = (node: ts.Node) => {
      if (drained) return;
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        const arg = node.arguments[0] && unwrap(node.arguments[0]);
        if (
          arg &&
          isMemberOf(callee, (callee as MemberAccess).expression) &&
          memberName(callee) === "forEach" &&
          compact((callee as MemberAccess).expression.getText(this.sf)) === name
        ) {
          if (
            how === "clear" &&
            globalCallName(arg) === "clearInterval" &&
            ts.isIdentifier(arg)
          ) {
            drained = true;
          } else if (isInlineFunction(arg)) {
            const first = (arg as FunctionLike).parameters[0];
            if (first && ts.isIdentifier(first.name)) {
              drained = uses(arg, first.name.text);
            }
          }
        }
      }
      if (
        ts.isForOfStatement(node) &&
        compact(node.expression.getText(this.sf)) === name
      ) {
        const init = node.initializer;
        const entry = ts.isVariableDeclarationList(init)
          ? init.declarations[0]?.name
          : undefined;
        if (entry && ts.isIdentifier(entry)) {
          drained = uses(node.statement, entry.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    for (const region of this.destroyRegions) visit(region);
    return drained;
  }

  /**
   * Where the value of this expression ends up: `x` in `const x = value`, the
   * array `list` in `list.push(value)` or `const list = [value]`, or straight
   * into onDestroy.
   */
  private storedAs(node: ts.Node): Stored {
    const current = outerExpression(node);
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
      parent.arguments.includes(current as ts.Expression)
    ) {
      if (this.isLifecycle(parent.expression, "onDestroy")) {
        return { kind: "destroy" };
      }
      const callee = unwrap(parent.expression);
      if (
        isMemberOf(callee, (callee as MemberAccess).expression) &&
        ["push", "unshift"].includes(memberName(callee) ?? "")
      ) {
        return {
          kind: "collection",
          name: compact((callee as MemberAccess).expression.getText(this.sf)),
        };
      }
    }
    if (parent && ts.isArrayLiteralExpression(parent)) {
      const array = this.storedAs(parent);
      if (array.kind === "stored") {
        return { kind: "collection", name: array.name };
      }
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
    const exempt = this.file === "src/lib/gsap.ts";
    for (const statement of this.sf.statements) {
      const isImport = ts.isImportDeclaration(statement);
      const isReExport =
        ts.isExportDeclaration(statement) && !!statement.moduleSpecifier;
      if (!isImport && !isReExport) continue;
      const literal = statement.moduleSpecifier;
      if (!literal || !ts.isStringLiteral(literal)) continue;
      const specifier = literal.text;
      const resolved = resolveSpecifier(this.file, specifier);
      const names = this.importedNames(statement);

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
        const importsHook = names.some((name) => HOOK_NAME.test(name));
        const insideLifecycle = this.file.startsWith("src/modules/_/");
        if (
          importsHook &&
          specifier !== LIFECYCLE_SPECIFIER &&
          !insideLifecycle
        ) {
          this.fixableImport(
            "imports/lifecycle",
            statement,
            literal,
            LIFECYCLE_SPECIFIER,
            `Lifecycle hooks are imported from "${LIFECYCLE_SPECIFIER}", not "${specifier}"`
          );
        }
      }

      if (!exempt && isGsapPackage(specifier) && !this.isTypeOnly(statement)) {
        this.reportGsap(statement, specifier);
      }
    }

    // import("gsap") and require("gsap") load it just as directly.
    if (!exempt) {
      for (const call of this.calls(this.sf)) {
        const callee = call.expression;
        const loads =
          callee.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(callee) && callee.text === "require");
        const first = call.arguments[0];
        if (
          loads &&
          first &&
          ts.isStringLiteralLike(first) &&
          isGsapPackage(first.text)
        ) {
          this.reportGsap(call, first.text);
        }
      }
    }
  }

  private reportGsap(node: ts.Node, specifier: string) {
    this.reportAt(
      "imports/gsap",
      node,
      `"${specifier}" is loaded directly, so plugins registered in src/lib/gsap.ts may be missing`,
      'Import gsap and its plugins from "@lib/gsap" instead'
    );
  }

  /** `import type` and `export type` are erased, so they load nothing. */
  private isTypeOnly(statement: ts.ImportDeclaration | ts.ExportDeclaration) {
    if (ts.isExportDeclaration(statement)) return statement.isTypeOnly;
    const clause = statement.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    const bindings = clause.namedBindings;
    return (
      !clause.name &&
      !!bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((element) => element.isTypeOnly)
    );
  }

  private importedNames(
    statement: ts.ImportDeclaration | ts.ExportDeclaration
  ): string[] {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      return clause && ts.isNamedExports(clause)
        ? clause.elements.map((e) => (e.propertyName ?? e.name).text)
        : [];
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return [];
    return bindings.elements.map(
      (element) => (element.propertyName ?? element.name).text
    );
  }

  private fixableImport(
    rule: Rule,
    statement: ts.Node,
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
    const env = (node: ts.Node) =>
      this.reportAt(
        "browser/no-process-env",
        node,
        "process.env does not exist in the browser, and the build only replaces NODE_ENV",
        "Read the value at build time (a define in bin/build.ts or the project config) or pass it in a data attribute"
      );
    const alias = (node: ts.Node) =>
      this.reportAt(
        "browser/no-process-env",
        node,
        "process is copied or destructured, which hides its env reads, and process.env does not exist in the browser",
        "Use process.env.NODE_ENV directly, or read the value at build time or from a data attribute"
      );

    const visit = (node: ts.Node) => {
      if (this.isProcessReference(node)) {
        const use = outerExpression(node);
        const parent = use.parent;
        if (parent && isMemberOf(parent, use)) {
          const name = memberName(parent);
          if (name === "env" || name === null) this.checkEnvUse(parent, env);
        } else if (
          parent &&
          ts.isVariableDeclaration(parent) &&
          parent.initializer &&
          outerExpression(parent.initializer) === use
        ) {
          if (ts.isIdentifier(parent.name)) alias(parent);
          else if (bindsName(parent.name, "env")) alias(parent);
        } else if (
          parent &&
          ts.isBinaryExpression(parent) &&
          parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          outerExpression(parent.right) === use
        ) {
          alias(parent);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(this.sf);
  }

  /** `process.env` is `access`: only NODE_ENV may be read from it. */
  private checkEnvUse(access: ts.Node, report: (node: ts.Node) => void) {
    const value = outerExpression(access);
    const parent = value.parent;
    if (parent && isMemberOf(parent, value)) {
      if (memberName(parent) !== "NODE_ENV") report(parent);
      return;
    }
    if (
      parent &&
      ts.isVariableDeclaration(parent) &&
      ts.isObjectBindingPattern(parent.name) &&
      parent.name.elements.length > 0 &&
      parent.name.elements.every(
        (element) =>
          !element.dotDotDotToken &&
          (element.propertyName ?? element.name).getText(this.sf) === "NODE_ENV"
      )
    ) {
      return;
    }
    report(value);
  }

  /** `process`, `globalThis.process` or `window["process"]`. */
  private isProcessReference(node: ts.Node): boolean {
    if (ts.isIdentifier(node) && node.text === "process") {
      const parent = node.parent;
      if (!parent) return false;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        return false;
      }
      if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
      if (ts.isVariableDeclaration(parent) && parent.name === node) {
        return false;
      }
      if (ts.isParameter(parent) && parent.name === node) return false;
      if (ts.isBindingElement(parent)) return false;
      if (ts.isTypeOfExpression(parent)) return false;
      return true;
    }
    return (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      memberName(node) === "process" &&
      isGlobalObject(node.expression)
    );
  }

  private checkRawSubscriptions() {
    const frame = (node: ts.Node) =>
      this.reportAt(
        "subs/no-raw",
        node,
        "requestAnimationFrame runs its own loop next to the shared ticker",
        'Use Raf.add from "@lib/subs" and call the result in onDestroy'
      );
    const resize = (node: ts.Node) =>
      this.reportAt(
        "subs/no-raw",
        node,
        "A resize listener runs next to the shared, debounced Resize subscription",
        'Use Resize.add from "@lib/subs" and call the result in onDestroy'
      );

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        if (globalCallName(callee) === "requestAnimationFrame") frame(node);
        const first = node.arguments[0];
        if (
          memberOrBareName(callee) === "addEventListener" &&
          first &&
          ts.isStringLiteralLike(first) &&
          first.text === "resize"
        ) {
          resize(node);
        }
      }
      // const raf = window.requestAnimationFrame, or a bare reference.
      if (
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        memberName(node) === "requestAnimationFrame" &&
        isGlobalObject(node.expression)
      ) {
        const use = outerExpression(node);
        const parent = use.parent;
        const isCallee =
          parent && ts.isCallExpression(parent) && parent.expression === use;
        if (!isCallee) frame(node);
      }
      // const { requestAnimationFrame } = window
      if (
        ts.isBindingElement(node) &&
        (node.propertyName ?? node.name).getText(this.sf) ===
          "requestAnimationFrame" &&
        node.parent.parent &&
        ts.isVariableDeclaration(node.parent.parent) &&
        node.parent.parent.initializer &&
        isGlobalObject(unwrap(node.parent.parent.initializer))
      ) {
        frame(node);
      }
      // window.onresize = fn
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      ) {
        const left = unwrap(node.left);
        const isOnResize =
          (ts.isIdentifier(left) && left.text === "onresize") ||
          ((ts.isPropertyAccessExpression(left) ||
            ts.isElementAccessExpression(left)) &&
            memberName(left) === "onresize" &&
            isGlobalObject(left.expression));
        if (isOnResize) resize(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(this.sf);
  }

  // -- module rules --------------------------------------------------------

  private checkModuleShape() {
    const base = path.posix.basename(this.file).replace(/\.(ts|js)$/, "");
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
    // A .js module can't carry types, so only the shape of its parameters
    // is checked.
    const typed = this.file.endsWith(".ts");
    params.forEach((param, index) => {
      const type = param.type ? compact(param.type.getText(this.sf)) : "";
      if (
        !ts.isIdentifier(param.name) ||
        param.dotDotDotToken ||
        (typed && type !== expected[index])
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
      } else if (where.kind === "collection") {
        if (!this.drainedInDestroy(where.name, "call")) {
          this.reportAt(
            "cleanup/subscription",
            call,
            `${label} is added to ${where.name}, but onDestroy never calls each entry`,
            `Call ${where.name}.forEach((stop) => stop()) inside onDestroy`
          );
        }
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
      const event = call.arguments[0];
      const handler = call.arguments[1] && unwrap(call.arguments[1]);
      if (!event || !handler) continue;

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
      const eventText = compact(event.getText(this.sf));
      const handlerText = compact(handler.getText(this.sf));
      if (
        !this.callInDestroy(
          (c) => this.isMethod(c, receiver, "off"),
          [eventText, handlerText]
        )
      ) {
        this.reportAt(
          "cleanup/state-listener",
          call,
          `${receiver}.on(${eventText}) has no matching ${receiver}.off(${eventText}, ${handlerText}) in onDestroy, so the listener outlives the page`,
          `Call ${receiver}.off(${eventText}, ${handlerText}) inside onDestroy`
        );
      }
    }
  }

  private checkListeners() {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const listener = this.listenerCall(node);
        if (listener?.method === "addEventListener") {
          this.checkEventListener(node, listener.target);
        }
        if (globalCallName(node.expression) === "setInterval") {
          this.checkInterval(node);
        }
      }
      if (ts.isNewExpression(node)) {
        const name = globalCallName(node.expression);
        if (name && OBSERVERS.has(name)) this.checkObserver(node, name);
      }
      ts.forEachChild(node, visit);
    };
    visit(this.sf);
  }

  /**
   * An add/removeEventListener call and what it is attached to. A bare call
   * and one on self or globalThis are on window.
   */
  private listenerCall(
    call: ts.CallExpression
  ): { method: string; target: string } | null {
    const callee = unwrap(call.expression);
    const method = memberOrBareName(callee);
    if (method !== "addEventListener" && method !== "removeEventListener") {
      return null;
    }
    if (ts.isIdentifier(callee)) return { method, target: "window" };
    const receiver = (callee as MemberAccess).expression;
    return {
      method,
      target: isGlobalObject(receiver)
        ? "window"
        : compact(receiver.getText(this.sf)),
    };
  }

  private checkEventListener(call: ts.CallExpression, target: string) {
    const type = call.arguments[0];
    const handler = call.arguments[1] && unwrap(call.arguments[1]);
    const typeText = type ? compact(type.getText(this.sf)) : "event";
    if (
      !handler ||
      (!ts.isIdentifier(handler) && !ts.isPropertyAccessExpression(handler))
    ) {
      this.reportAt(
        "cleanup/listener",
        call,
        `${target}.addEventListener(${typeText}) is given an inline function, which can't be removed`,
        `Name the handler and call ${target}.removeEventListener(${typeText}, handler) inside onDestroy`
      );
      return;
    }
    const handlerText = compact(handler.getText(this.sf));
    const removed = this.callInDestroy(
      (c) => {
        const other = this.listenerCall(c);
        return (
          other?.method === "removeEventListener" && other.target === target
        );
      },
      [typeText, handlerText]
    );
    if (!removed) {
      this.reportAt(
        "cleanup/listener",
        call,
        `${target}.addEventListener(${typeText}) has no matching removeEventListener(${typeText}, ${handlerText}) on ${target} in onDestroy`,
        `Call ${target}.removeEventListener(${typeText}, ${handlerText}) inside onDestroy`
      );
    }
  }

  private checkInterval(call: ts.CallExpression) {
    const where = this.storedAs(call);
    const clears = (c: ts.CallExpression) =>
      globalCallName(c.expression) === "clearInterval";
    if (where.kind === "stored") {
      const cleared = this.callInDestroy(clears, [where.name]);
      if (cleared) return;
      this.reportAt(
        "cleanup/listener",
        call,
        `setInterval is stored as ${where.name} but clearInterval(${where.name}) is never called in onDestroy`,
        `Call clearInterval(${where.name}) inside onDestroy`
      );
    } else if (where.kind === "collection") {
      if (this.drainedInDestroy(where.name, "clear")) return;
      this.reportAt(
        "cleanup/listener",
        call,
        `setInterval's id is added to ${where.name}, but onDestroy never clears each entry`,
        `Call ${where.name}.forEach((id) => clearInterval(id)) inside onDestroy`
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
      if (
        this.callInDestroy(
          (c) => this.isMethod(c, where.name, "disconnect"),
          []
        )
      ) {
        return;
      }
      this.reportAt(
        "cleanup/listener",
        node,
        `${name} is stored as ${where.name} but ${where.name}.disconnect() is never called in onDestroy`,
        `Call ${where.name}.disconnect() inside onDestroy`
      );
    } else if (where.kind === "collection") {
      if (this.drainedInDestroy(where.name, "disconnect")) return;
      this.reportAt(
        "cleanup/listener",
        node,
        `${name} is added to ${where.name}, but onDestroy never disconnects each entry`,
        `Call ${where.name}.forEach((observer) => observer.disconnect()) inside onDestroy`
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
