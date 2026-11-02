/** Header rules as pattern -> lowercase header name -> value, so two formats compare directly. */
export type HeaderRules = Map<string, Map<string, string>>;

export interface VercelHeaderEntry {
  source: string;
  headers: { key: string; value: string }[];
}

function ruleFor(rules: HeaderRules, pattern: string): Map<string, string> {
  let rule = rules.get(pattern);
  if (!rule) {
    rule = new Map();
    rules.set(pattern, rule);
  }
  return rule;
}

/**
 * Cloudflare's `_headers` format: an unindented path, then indented
 * `Name: value` lines. `# comments` and blank lines are ignored.
 */
export function parseHeadersFile(text: string): HeaderRules {
  const rules: HeaderRules = new Map();
  let current: Map<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (!/^\s/.test(raw)) {
      current = ruleFor(rules, raw.trim());
      continue;
    }
    const colon = raw.indexOf(":");
    if (!current || colon === -1) continue;
    current.set(
      raw.slice(0, colon).trim().toLowerCase(),
      raw.slice(colon + 1).trim()
    );
  }
  return rules;
}

/**
 * `/(.*)` -> `/*` and `/(.*\.glb)` -> `/*.glb`: the two shapes vercel.json
 * uses here. Anything with regex syntax left over can't be compared, and
 * returns null.
 */
export function vercelSourceToPattern(source: string): string | null {
  const wrapped = /^\/\((.*)\)$/.exec(source);
  const inner = wrapped ? (wrapped[1] as string) : source.replace(/^\//, "");
  const pattern = inner.replace(/\.\*/g, "*").replace(/\\\./g, ".");
  if (/[()\\+?[\]|^$]/.test(pattern)) return null;
  return `/${pattern}`.replace(/^\/\//, "/");
}

export function vercelRules(entries: VercelHeaderEntry[]): {
  rules: HeaderRules;
  unsupported: string[];
} {
  const rules: HeaderRules = new Map();
  const unsupported: string[] = [];
  for (const entry of entries) {
    const pattern = vercelSourceToPattern(entry.source);
    if (!pattern) {
      unsupported.push(entry.source);
      continue;
    }
    const rule = ruleFor(rules, pattern);
    for (const header of entry.headers)
      rule.set(header.key.toLowerCase(), header.value);
  }
  return { rules, unsupported };
}

/** Differences from `expected` to `actual`, worded for a finding, in a stable order. */
export function diffRules(
  expected: HeaderRules,
  actual: HeaderRules
): string[] {
  const problems: string[] = [];
  const patterns = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  for (const pattern of patterns) {
    const want = expected.get(pattern);
    const have = actual.get(pattern);
    if (!want) {
      problems.push(`${pattern} has rules that vercel.json does not have`);
      continue;
    }
    if (!have) {
      problems.push(`${pattern} is missing`);
      continue;
    }
    for (const name of [...new Set([...want.keys(), ...have.keys()])].sort()) {
      const a = want.get(name);
      const b = have.get(name);
      if (a === undefined)
        problems.push(`${pattern}: extra header ${name}: ${b}`);
      else if (b === undefined)
        problems.push(`${pattern}: missing header ${name}: ${a}`);
      else if (a !== b)
        problems.push(`${pattern}: ${name} is "${b}", vercel.json has "${a}"`);
    }
  }
  return problems;
}
