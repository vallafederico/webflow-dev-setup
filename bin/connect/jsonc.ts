/** Copies `text`, calling `visit` for each character outside a string. Return a replacement, or null to drop it. */
function walk(text: string, visit: (index: number) => { skip: number; out: string }): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(i, end + 1);
      i = end + 1;
    } else {
      const step = visit(i);
      out += step.out;
      i += step.skip;
    }
  }
  return out;
}

/** Removes line and block comments, leaving string contents alone. */
export function stripComments(text: string): string {
  return walk(text, (i) => {
    if (text[i] === "/" && text[i + 1] === "/") {
      let end = i;
      while (end < text.length && text[end] !== "\n") end++;
      return { skip: end - i, out: "" };
    }
    if (text[i] === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      return { skip: (close === -1 ? text.length : close + 2) - i, out: "" };
    }
    return { skip: 1, out: text[i] };
  });
}

function stripTrailingCommas(text: string): string {
  return walk(text, (i) => {
    if (text[i] === ",") {
      const rest = text.slice(i + 1).trimStart();
      if (rest[0] === "}" || rest[0] === "]") return { skip: 1, out: "" };
    }
    return { skip: 1, out: text[i] };
  });
}

export function parseJsonc(text: string): unknown {
  return JSON.parse(stripTrailingCommas(stripComments(text)));
}

export function hasComments(text: string): boolean {
  return stripComments(text).length !== text.length;
}
