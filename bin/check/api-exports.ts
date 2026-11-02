import ts from "typescript";

export const METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

export interface ExportProblem {
  line: number;
  message: string;
}

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (m) => m.kind === ts.SyntaxKind.ExportKeyword
  );

/**
 * Everything a route file exports that the router wouldn't call, and a file
 * with no handler at all. Type-only exports vanish at runtime, so they're fine.
 */
export function apiExportProblems(
  file: string,
  source: string
): ExportProblem[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const problems: ExportProblem[] = [];
  let handlers = 0;

  const lineOf = (node: ts.Node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const record = (name: string, node: ts.Node) => {
    if (METHODS.includes(name)) {
      handlers += 1;
      return;
    }
    problems.push({
      line: lineOf(node),
      message: METHODS.includes(name.toUpperCase())
        ? `exports "${name}", but handlers must be named in capitals (${name.toUpperCase()})`
        : `exports "${name}", which is not an HTTP method handler`,
    });
  };

  for (const statement of sf.statements) {
    if (ts.isExportAssignment(statement)) {
      problems.push({
        line: lineOf(statement),
        message: "has a default export, which is not an HTTP method handler",
      });
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      if (!statement.exportClause) {
        problems.push({
          line: lineOf(statement),
          message: "uses export *, so its handlers can't be checked",
        });
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (!element.isTypeOnly) record(element.name.text, element);
        }
      } else {
        record(statement.exportClause.name.text, statement);
      }
    } else if (isExported(statement)) {
      const modifiers = ts.canHaveModifiers(statement)
        ? (ts.getModifiers(statement) ?? [])
        : [];
      if (modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        problems.push({
          line: lineOf(statement),
          message: "has a default export, which is not an HTTP method handler",
        });
      } else if (ts.isVariableStatement(statement)) {
        for (const decl of statement.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) record(decl.name.text, decl);
          else
            problems.push({
              line: lineOf(decl),
              message:
                "exports a destructured value, which is not an HTTP method handler",
            });
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement) ||
          ts.isModuleDeclaration(statement)) &&
        statement.name
      ) {
        record(statement.name.text, statement);
      }
      // interfaces and type aliases are erased
    }
  }

  if (handlers === 0 && problems.length === 0) {
    problems.push({
      line: 1,
      message:
        "exports no HTTP method handler, so every request to it is a 405",
    });
  }
  return problems;
}
