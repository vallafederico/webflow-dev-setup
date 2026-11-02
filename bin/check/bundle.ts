import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { MANIFEST_FILE, requireBuild } from "./build";
import { readChecksConfig } from "./checks-config";
import { toPosix } from "./tools";
import { type Check, type Finding, ToolFailure, toResult } from "./types";

/** Build-time placeholders. One left in a bundle means a define never ran. */
export const PLACEHOLDERS = [
  "__PUBLIC_ASSET_ORIGIN__",
  "__MEDIA_ORIGIN__",
  "__API_DEV_ORIGIN__",
  "__PREVIEW_HOST_SUFFIX__",
];

/** Env files Bun reads for a production build, in the order it would. */
const ENV_FILES = [
  ".env",
  ".env.production",
  ".env.local",
  ".env.production.local",
];
const SECRET_KEY = /hook|token|secret|key/i;
const MIN_SECRET_LENGTH = 16;

const TEXT_EXTENSIONS = [".js", ".css", ".txt"];

/** Every file under `dir`, as sorted dist-relative posix paths. */
export function listFiles(dir: string, prefix = ""): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(path.join(dir, prefix), {
    withFileTypes: true,
  })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(dir, relative));
    else files.push(relative);
  }
  return files.sort();
}

/** `KEY=value` lines, with quotes and `export ` stripped. Enough for the keys we match. */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][\w.-]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = (match[2] as string).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.lastIndexOf(quote) > 0) {
      value = value.slice(1, value.lastIndexOf(quote));
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    values[match[1] as string] = value;
  }
  return values;
}

/** Secret-looking values from the project's env files, keyed by name. Only names, never values, are reported. */
export function readSecrets(root: string): Map<string, string> {
  const secrets = new Map<string, string>();
  for (const name of ENV_FILES) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(
      parseEnv(readFileSync(file, "utf8"))
    )) {
      if (SECRET_KEY.test(key) && value.length >= MIN_SECRET_LENGTH) {
        secrets.set(`${key}`, value);
      }
    }
  }
  return secrets;
}

export function gzipSize(data: Buffer | string): number {
  return gzipSync(data, { level: 9 }).length;
}

/** The budget for a built entry: an exact key wins over a glob. */
export function budgetFor(
  budgets: Record<string, number>,
  entry: string
): { key: string; bytes: number } | null {
  const exact = budgets[entry];
  if (exact !== undefined) return { key: entry, bytes: exact };
  for (const key of Object.keys(budgets).sort()) {
    if (/[*?[{]/.test(key) && new Bun.Glob(key).match(entry)) {
      return { key, bytes: budgets[key] as number };
    }
  }
  return null;
}

interface ManifestFile {
  path: string;
}

function readEntries(root: string): string[] {
  let manifest: {
    javascript?: { files?: ManifestFile[] };
    css?: { files?: ManifestFile[] };
  };
  try {
    manifest = JSON.parse(readFileSync(path.join(root, MANIFEST_FILE), "utf8"));
  } catch (error) {
    throw new ToolFailure(
      `could not read ${MANIFEST_FILE}: ${(error as Error).message}`,
      {
        fix: "Run pnpm build, or run pnpm check:all, which builds first",
      }
    );
  }
  const files = [
    ...(manifest.javascript?.files ?? []),
    ...(manifest.css?.files ?? []),
  ];
  const entries = files
    .map((file) => file.path)
    .filter((file) => !file.endsWith(".map"));
  if (entries.length === 0) {
    throw new ToolFailure(`${MANIFEST_FILE} lists no JS or CSS entry`, {
      fix: "Run pnpm build and read its output",
    });
  }
  return [...new Set(entries)].sort();
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (
    let i = text.indexOf("\n");
    i !== -1 && i < index;
    i = text.indexOf("\n", i + 1)
  )
    line++;
  return line;
}

export const bundle: Check = {
  name: "bundle",
  tier: "all",
  async run({ root }) {
    requireBuild(root);
    const dist = path.join(root, "dist");
    const config = readChecksConfig(root);
    const findings: Finding[] = [];
    const add = (
      finding: Omit<Finding, "severity" | "line"> & {
        line?: number;
        severity?: Finding["severity"];
      }
    ) => findings.push({ severity: "error", line: 1, ...finding });

    // -- Size budgets, per built entry
    const entries = readEntries(root);
    const used = new Set<string>();
    for (const entry of entries) {
      const file = path.join(dist, entry);
      if (!existsSync(file)) {
        add({
          rule: "bundle/missing-entry",
          file: `dist/${entry}`,
          message: `${MANIFEST_FILE} lists dist/${entry}, which does not exist`,
          fix: "Run pnpm build again and check its output",
        });
        continue;
      }
      const budget = budgetFor(config.budgets, entry);
      if (!budget) {
        add({
          rule: "bundle/no-budget",
          file: `dist/${entry}`,
          message: `dist/${entry} has no gzip budget in checks.config.json`,
          fix: `Add a budget for ${entry} (or a glob that matches it) to "budgets" in checks.config.json`,
        });
        continue;
      }
      used.add(budget.key);
      const size = gzipSize(readFileSync(file));
      if (size > budget.bytes) {
        add({
          rule: "bundle/over-budget",
          file: `dist/${entry}`,
          message: `dist/${entry} is ${size} bytes gzipped, over its budget of ${budget.bytes} bytes (${budget.key})`,
          fix: "Remove or lazy-load what made the bundle grow. Raise the budget in checks.config.json only if the growth is intended",
        });
      }
    }
    for (const key of Object.keys(config.budgets).sort()) {
      if (used.has(key)) continue;
      const isGlob = /[*?[{]/.test(key);
      add({
        rule: "bundle/unused-budget",
        severity: isGlob ? "warning" : "error",
        file: "checks.config.json",
        message: `budget "${key}" matches no built entry, so nothing is checked against it`,
        fix: `Rename or remove "${key}" in checks.config.json to match the entries in dist/`,
      });
    }

    // -- Leftovers and secrets
    const secrets = readSecrets(root);
    const secretBuffers = [...secrets].map(([key, value]) => {
      const escaped = JSON.stringify(value).slice(1, -1);
      return {
        key,
        variants: [...new Set([value, escaped])].map((text) =>
          Buffer.from(text)
        ),
      };
    });

    for (const relative of listFiles(dist)) {
      const file = path.join(dist, relative);
      const data = readFileSync(file);
      const display = toPosix(path.join("dist", relative));

      for (const secret of secretBuffers) {
        if (secret.variants.some((variant) => data.includes(variant))) {
          add({
            rule: "bundle/secret",
            file: display,
            message: `${display} contains the value of ${secret.key} from the project's env file`,
            fix: `Stop the value reaching the build: remove ${secret.key} from the code, define or public/ file that carries it, then rebuild`,
          });
        }
      }

      const isText =
        !relative.endsWith(".map") &&
        TEXT_EXTENSIONS.some((ext) => relative.endsWith(ext));
      if (!isText) continue;
      const text = data.toString("utf8");

      const local = /[\w:/.-]*localhost[\w:/.-]*/i.exec(text);
      if (local) {
        add({
          rule: "bundle/localhost",
          file: display,
          line: lineOf(text, local.index),
          message: `${display} contains "${local[0].slice(0, 60)}", which only works on the developer's machine`,
          fix: "Build with pnpm build (NODE_ENV=production) and take the URL from PUBLIC_ASSET_ORIGIN or project.config.json deployUrl instead of writing localhost",
        });
      }
      for (const placeholder of PLACEHOLDERS) {
        const at = text.indexOf(placeholder);
        if (at !== -1) {
          add({
            rule: "bundle/placeholder",
            file: display,
            line: lineOf(text, at),
            message: `${display} still contains ${placeholder}, so the build never replaced it`,
            fix: `Make sure the build passes getBunDefine() as Bun.build's define and that ${placeholder} is spelled as in bin/public-asset-origin.ts`,
          });
        }
      }
    }
    return toResult("bundle", findings);
  },
};
