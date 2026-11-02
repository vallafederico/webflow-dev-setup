import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FALLBACK_COMPATIBILITY_DATE,
  type Io,
  type RunResult,
  type Runner,
  compatibilityDateFromVersion,
  connect,
  suggestName,
  workerdCompatibilityDate,
} from "./connect";
import { validateProjectConfig } from "./project-config";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "connect-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): RunResult => ({ code: 1, stdout: "", stderr });

function whoami(...ids: string[]): RunResult {
  return ok(
    JSON.stringify({
      loggedIn: true,
      accounts: ids.map((id) => ({ id, name: `Account ${id}` })),
    })
  );
}

type Handler = (args: string[]) => RunResult;

/** Fake wrangler. Records every call and answers by command, so no test reaches an account. */
function fakeRunner(handlers: Record<string, Handler> = {}) {
  const calls: { args: string[]; env?: Record<string, string> }[] = [];
  const run: Runner = async (args, options) => {
    calls.push({ args, env: options?.env });
    const key =
      args[0] === "r2"
        ? args
            .slice(0, args[2] === "domain" ? 4 : args[2] === "cors" ? 4 : 3)
            .join(" ")
        : args[0];
    const handler = handlers[key];
    if (!handler)
      throw new Error(`Unexpected wrangler call: ${args.join(" ")}`);
    return handler(args);
  };
  return { run, calls };
}

const MEDIA_OK: Record<string, Handler> = {
  "r2 bucket create": () => ok(),
  "r2 bucket domain list": () =>
    ok("There are no custom domains connected to this bucket."),
  "r2 bucket domain add": () => ok(),
  "r2 bucket cors set": () => ok(),
};

interface Session {
  io: Io;
  out: string[];
  err: string[];
}

function session(interactive = false, answers: string[] = []): Session {
  const out: string[] = [];
  const err: string[] = [];
  const queue = [...answers];
  const io: Io = {
    interactive,
    async ask(question, fallback) {
      const next = queue.shift();
      if (next === undefined) throw new Error(`Unexpected prompt: ${question}`);
      return next === "" ? (fallback ?? "") : next;
    },
    log: (message) => out.push(message),
    error: (message) => err.push(message),
  };
  return { io, out, err };
}

const NEWEST_DATE = () => "2026-10-23";

async function run(
  argv: string[],
  options: {
    runner?: ReturnType<typeof fakeRunner>;
    io?: Session;
    env?: Record<string, string>;
  } = {}
) {
  const runner = options.runner ?? fakeRunner();
  const io = options.io ?? session();
  const code = await connect(argv, {
    cwd: dir,
    run: runner.run,
    io: io.io,
    env: options.env ?? {},
    compatibilityDate: NEWEST_DATE,
  });
  return { code, runner, io };
}

const read = (file: string) => readFileSync(join(dir, file), "utf8");
const readJson = (file: string) => JSON.parse(read(file));
const snapshot = () =>
  Object.fromEntries(readdirSync(dir).map((f) => [f, read(f)]));

const CF = [
  "cloudflare",
  "--name",
  "acme",
  "--domain",
  "example.com",
  "--subdomain",
  "team",
  "--account-id",
  "abc",
];
const VC = ["vercel", "--name", "acme", "--suffix", "-your-team.vercel.app"];

describe("cloudflare", () => {
  test("writes the exact config and wrangler files", async () => {
    const { code, runner } = await run(CF);
    expect(code).toBe(0);
    expect(read("project.config.json")).toBe(
      `${JSON.stringify(
        {
          host: "cloudflare",
          name: "acme",
          deployUrl: "https://acme.example.com",
          mediaUrl: null,
          previewHostSuffix: "-acme.team.workers.dev",
        },
        null,
        2
      )}\n`
    );
    expect(read("wrangler.jsonc")).toBe(
      `${JSON.stringify(
        {
          name: "acme",
          account_id: "abc",
          compatibility_date: "2026-10-23",
          compatibility_flags: ["nodejs_compat"],
          main: ".generated/worker.ts",
          assets: { directory: "./dist", run_worker_first: ["/api/*"] },
          routes: [{ pattern: "acme.example.com", custom_domain: true }],
          preview_urls: true,
          previews: {},
        },
        null,
        2
      )}\n`
    );
    expect(validateProjectConfig(readJson("project.config.json"))).toEqual([]);
    expect(runner.calls).toEqual([]);
  });

  test("lowercases input", async () => {
    await run([
      "cloudflare",
      "--name",
      "Acme",
      "--domain",
      "Example.COM",
      "--subdomain",
      "Team",
      "--account-id",
      "abc",
    ]);
    expect(readJson("project.config.json").deployUrl).toBe(
      "https://acme.example.com"
    );
    expect(readJson("project.config.json").previewHostSuffix).toBe(
      "-acme.team.workers.dev"
    );
  });

  test("re-running with the same answers changes no bytes", async () => {
    await run(CF);
    const before = snapshot();
    const { code, io } = await run(CF);
    expect(code).toBe(0);
    expect(snapshot()).toEqual(before);
    expect(io.out.join("\n")).toContain("Nothing changed");
  });

  test("re-running with no flags reuses the existing values", async () => {
    await run(CF);
    const before = snapshot();
    const runner = fakeRunner({ whoami: () => whoami("abc") });
    const { code } = await run(["cloudflare"], { runner });
    expect(code).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  test("keeps an existing compatibility_date", async () => {
    await run(CF);
    const wrangler = readJson("wrangler.jsonc");
    writeFileSync(
      join(dir, "wrangler.jsonc"),
      `${JSON.stringify({ ...wrangler, compatibility_date: "2025-01-15" }, null, 2)}\n`
    );
    await run(CF);
    expect(readJson("wrangler.jsonc").compatibility_date).toBe("2025-01-15");
  });

  test("an older existing compatibility_date is kept byte for byte, and a newer one is lowered", async () => {
    await run(CF);
    const wrangler = readJson("wrangler.jsonc");
    writeFileSync(
      join(dir, "wrangler.jsonc"),
      `${JSON.stringify({ ...wrangler, compatibility_date: "2026-01-01" }, null, 2)}\n`
    );
    const kept = snapshot();
    const same = await run(CF);
    expect(snapshot()).toEqual(kept);
    expect(same.io.out.join("\n")).not.toContain("lowered");

    writeFileSync(
      join(dir, "wrangler.jsonc"),
      `${JSON.stringify({ ...wrangler, compatibility_date: "2026-11-02" }, null, 2)}\n`
    );
    const lowered = await run(CF);
    expect(readJson("wrangler.jsonc").compatibility_date).toBe("2026-10-23");
    expect(lowered.io.out.join("\n")).toContain("lowered to 2026-10-23");
  });

  test("a new project gets the workerd date, not today's", async () => {
    await run(CF);
    expect(readJson("wrangler.jsonc").compatibility_date).toBe("2026-10-23");
  });

  test("the workerd date comes from the installed workerd, with a fallback", () => {
    expect(compatibilityDateFromVersion("1.20261023.1")).toBe("2026-10-23");
    expect(compatibilityDateFromVersion("1.2026.1")).toBeUndefined();
    expect(compatibilityDateFromVersion("nonsense")).toBeUndefined();
    expect(workerdCompatibilityDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(FALLBACK_COMPATIBILITY_DATE).toBe("2026-10-23");
  });

  test("keeps hand-added wrangler keys, reads commented JSONC, and says it rewrites the file", async () => {
    writeFileSync(
      join(dir, "wrangler.jsonc"),
      `{\n  // set by hand\n  "compatibility_date": "2025-03-04",\n  "vars": { "A": "1", }, /* trailing */\n}\n`
    );
    const { code, io } = await run(CF);
    expect(code).toBe(0);
    const wrangler = readJson("wrangler.jsonc");
    expect(wrangler.compatibility_date).toBe("2025-03-04");
    expect(wrangler.vars).toEqual({ A: "1" });
    expect(Object.keys(wrangler).at(-1)).toBe("vars");
    expect(io.out.join("\n")).toContain("rewritten as plain JSON");
  });

  test("says nothing about rewriting when the file already matches", async () => {
    await run(CF);
    const { io } = await run(CF);
    expect(io.out.join("\n")).not.toContain("rewritten");
  });

  test("an invalid wrangler.jsonc stops the run with no changes", async () => {
    writeFileSync(join(dir, "wrangler.jsonc"), "{ nope");
    const { code, io } = await run(CF);
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("wrangler.jsonc is not valid JSON");
    expect(existsSync(join(dir, "project.config.json"))).toBe(false);
  });

  test("the next steps name the account and say the domain must be active on it", async () => {
    const { io } = await run(CF);
    const text = io.out.join("\n");
    expect(text).toContain(
      "example.com is an active zone on Cloudflare account abc"
    );
    expect(text).toContain("`pnpm build`");
    expect(text).toContain("non-production branches");
    expect(text).toContain("`bun dev`");
  });

  test("reads the base domain from WF_BASE_DOMAIN", async () => {
    const { code } = await run(
      [
        "cloudflare",
        "--name",
        "acme",
        "--subdomain",
        "team",
        "--account-id",
        "abc",
      ],
      {
        env: { WF_BASE_DOMAIN: "env.example.org" },
      }
    );
    expect(code).toBe(0);
    expect(readJson("project.config.json").deployUrl).toBe(
      "https://acme.env.example.org"
    );
  });

  test("never hard-codes a domain", async () => {
    const { code, io } = await run([
      "cloudflare",
      "--name",
      "acme",
      "--subdomain",
      "team",
      "--account-id",
      "abc",
    ]);
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("--domain");
    expect(
      readFileSync(join(import.meta.dir, "connect.ts"), "utf8")
    ).not.toContain("itsoffbrand");
  });

  test("a bare workers.dev name and a full workers.dev host are both accepted", async () => {
    await run([
      "cloudflare",
      "--name",
      "acme",
      "--domain",
      "example.com",
      "--subdomain",
      "team.workers.dev",
      "--account-id",
      "abc",
    ]);
    expect(readJson("project.config.json").previewHostSuffix).toBe(
      "-acme.team.workers.dev"
    );
  });

  test("keeps an existing mediaUrl", async () => {
    await run(CF);
    const config = readJson("project.config.json");
    writeFileSync(
      join(dir, "project.config.json"),
      `${JSON.stringify({ ...config, mediaUrl: "https://media.example.com" }, null, 2)}\n`
    );
    await run(CF);
    expect(readJson("project.config.json").mediaUrl).toBe(
      "https://media.example.com"
    );
  });

  test("prompts show the folder name and workers.dev guidance, and accept defaults", async () => {
    const folder = join(dir, "My Site");
    mkdirSync(folder);
    const asked: string[] = [];
    const s = session(true, ["", "example.com", "team"]);
    const original = s.io.ask;
    s.io.ask = (question, fallback) => {
      asked.push(`${question} [${fallback ?? ""}]`);
      return original(question, fallback);
    };
    const code = await connect(["cloudflare", "--account-id", "abc"], {
      cwd: folder,
      run: fakeRunner().run,
      io: s.io,
      env: {},
      compatibilityDate: NEWEST_DATE,
    });
    expect(code).toBe(0);
    expect(asked[0]).toContain("[my-site]");
    expect(asked[2]).toContain("Cloudflare dashboard under Workers");
    expect(asked[2]).toContain("`wrangler deploy` output");
    expect(
      JSON.parse(readFileSync(join(folder, "project.config.json"), "utf8")).name
    ).toBe("my-site");
  });

  test("an invalid prompt answer is asked again", async () => {
    const s = session(true, ["www", "acme", "example.com", "team"]);
    const { code } = await run(["cloudflare", "--account-id", "abc"], {
      io: s,
    });
    expect(code).toBe(0);
    expect(s.err.join("\n")).toContain("reserved");
  });
});

describe("accounts", () => {
  const noAccount = CF.filter((_, i) => i < CF.length - 2);

  test("runs `wrangler whoami` and uses the only account", async () => {
    const runner = fakeRunner({ whoami: () => whoami("only") });
    const { code } = await run(noAccount, { runner });
    expect(code).toBe(0);
    expect(runner.calls.map((c) => c.args)).toEqual([["whoami", "--json"]]);
    expect(readJson("wrangler.jsonc").account_id).toBe("only");
  });

  test("--account-id skips whoami", async () => {
    const runner = fakeRunner();
    await run(CF, { runner });
    expect(runner.calls).toEqual([]);
  });

  test("not logged in stops with instructions and writes nothing", async () => {
    const runner = fakeRunner({
      whoami: () => ok(JSON.stringify({ loggedIn: false })),
    });
    const { code, io } = await run(noAccount, { runner });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("wrangler login");
    expect(readdirSync(dir)).toEqual([]);
  });

  test("several accounts require --account-id without a TTY", async () => {
    const runner = fakeRunner({ whoami: () => whoami("one", "two") });
    const { code, io } = await run(noAccount, { runner });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("--account-id");
    expect(io.err.join("\n")).toContain("two");
    expect(readdirSync(dir)).toEqual([]);
  });

  test("several accounts are asked for on a TTY", async () => {
    const runner = fakeRunner({ whoami: () => whoami("one", "two") });
    const s = session(true, ["2"]);
    const { code } = await run(noAccount, { runner, io: s });
    expect(code).toBe(0);
    expect(readJson("wrangler.jsonc").account_id).toBe("two");
    expect(s.out.join("\n")).toContain("must be active");
  });

  test("a re-run keeps the account written last time when it is still listed", async () => {
    await run(CF.map((v) => (v === "abc" ? "two" : v)));
    const runner = fakeRunner({ whoami: () => whoami("one", "two") });
    const { code } = await run(noAccount, { runner });
    expect(code).toBe(0);
    expect(readJson("wrangler.jsonc").account_id).toBe("two");
  });

  test("a login that does not list the recorded account asks for --account-id", async () => {
    await run(CF);
    const before = snapshot();
    for (const ids of [["other"], ["other", "another"]]) {
      const runner = fakeRunner({ whoami: () => whoami(...ids) });
      const { code, io } = await run(noAccount, { runner });
      expect(code).toBe(1);
      expect(io.err.join("\n")).toContain("--account-id");
      expect(io.err.join("\n")).toContain("abc");
      expect(snapshot()).toEqual(before);
    }
    // Passing it is the confirmation.
    expect((await run(CF.map((v) => (v === "abc" ? "other" : v)))).code).toBe(
      0
    );
    expect(readJson("wrangler.jsonc").account_id).toBe("other");
  });

  test("an unreadable whoami names the output and --account-id", async () => {
    const runner = fakeRunner({ whoami: () => fail("boom") });
    const { code, io } = await run(noAccount, { runner });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("boom");
    expect(io.err.join("\n")).toContain("--account-id");
  });
});

describe("vercel", () => {
  test("writes the config only", async () => {
    writeFileSync(join(dir, "vercel.json"), '{"keep":true}\n');
    const { code } = await run(VC);
    expect(code).toBe(0);
    expect(read("project.config.json")).toBe(
      `${JSON.stringify(
        {
          host: "vercel",
          name: "acme",
          deployUrl: "https://acme.vercel.app",
          mediaUrl: null,
          previewHostSuffix: "-your-team.vercel.app",
        },
        null,
        2
      )}\n`
    );
    expect(existsSync(join(dir, "wrangler.jsonc"))).toBe(false);
    expect(read("vercel.json")).toBe('{"keep":true}\n');
    expect(validateProjectConfig(readJson("project.config.json"))).toEqual([]);
  });

  test("re-running changes no bytes, and the suffix comes from the file", async () => {
    await run(VC);
    const before = snapshot();
    expect((await run(VC)).code).toBe(0);
    expect((await run(["vercel"])).code).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  test.each([
    "yourteam.vercel.app",
    "vercel.app",
    "-",
    "-Team_x.vercel.app",
    "-a b.vercel.app",
    // Valid for the shared contract regex, but each would widen the allowlist past one team.
    ".vercel.app",
    ".app",
    "-vercel.app",
    "-.vercel.app",
    "-app",
    "...",
    "-team.vercel.app.evil.com",
    "-a.b.vercel.app",
    "-team-.vercel.app",
  ])("rejects the suffix %p", async (suffix) => {
    const { code, io } = await run([
      "vercel",
      "--name",
      "acme",
      "--suffix",
      suffix,
    ]);
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("--suffix");
    expect(readdirSync(dir)).toEqual([]);
  });

  test("explains why a suffix needs a leading - or .", async () => {
    const { io } = await run([
      "vercel",
      "--name",
      "acme",
      "--suffix",
      "yourteam.vercel.app",
    ]);
    expect(io.err.join("\n")).toContain("evil-notyourteam.vercel.app");
  });

  test("accepts a leading dot and lowercases", async () => {
    const { code } = await run([
      "vercel",
      "--name",
      "acme",
      "--suffix",
      ".Team.Vercel.App",
    ]);
    expect(code).toBe(0);
    expect(readJson("project.config.json").previewHostSuffix).toBe(
      ".team.vercel.app"
    );
  });

  test("cloudflare-only flags are rejected", async () => {
    for (const flag of [
      ["--domain", "example.com"],
      ["--media"],
      ["--account-id", "abc"],
    ]) {
      const { code, io } = await run([...VC, ...flag]);
      expect(code).toBe(1);
      expect(io.err.join("\n")).toContain("only applies to cloudflare");
    }
    expect((await run([...CF, "--suffix", "-x.vercel.app"])).code).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe("validation", () => {
  test.each(["Acme_x", "-acme", "acme-", "a.b", "acme site", "x".repeat(64)])(
    "rejects the name %p",
    async (name) => {
      const { code, io } = await run([
        "vercel",
        "--name",
        name,
        "--suffix",
        "-t.vercel.app",
      ]);
      expect(code).toBe(1);
      expect(io.err.join("\n")).toContain("--name");
      expect(readdirSync(dir)).toEqual([]);
    }
  );

  test.each(["www", "api", "cdn", "mail", "admin", "ftp", "app", "WWW"])(
    "rejects the reserved name %p",
    async (name) => {
      const { code, io } = await run([
        "vercel",
        "--name",
        name,
        "--suffix",
        "-t.vercel.app",
      ]);
      expect(code).toBe(1);
      expect(io.err.join("\n")).toContain("reserved");
    }
  );

  test.each(["evil.com/x", "evil.com", "-bad", "a_b", "x".repeat(64)])(
    "rejects the workers.dev subdomain %p",
    async (subdomain) => {
      const { code, io } = await run([
        "cloudflare",
        "--name",
        "acme",
        "--domain",
        "example.com",
        "--subdomain",
        subdomain,
        "--account-id",
        "abc",
      ]);
      expect(code).toBe(1);
      expect(io.err.join("\n")).toContain("--subdomain");
      expect(readdirSync(dir)).toEqual([]);
    }
  );

  test.each(["--zone-id=--force", "--zone-id=-x", "--account-id=--help"])(
    "rejects an ID that starts with a dash: %p",
    async (flag) => {
      const argv = flag.startsWith("--zone-id")
        ? [...CF, "--media", flag]
        : [...CF.slice(0, -2), flag];
      const { code, io } = await run(argv, { runner: fakeRunner(MEDIA_OK) });
      expect(code).toBe(1);
      expect(io.err.join("\n")).toContain(flag.split("=")[0]);
      expect(readdirSync(dir)).toEqual([]);
    }
  );

  test.each([
    "https://example.com",
    "example",
    "example.com/path",
    "-bad.com",
    "1.2",
  ])("rejects the domain %p", async (domain) => {
    const { code, io } = await run([
      "cloudflare",
      "--name",
      "acme",
      "--domain",
      domain,
      "--subdomain",
      "team",
      "--account-id",
      "abc",
    ]);
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("--domain");
  });

  test("a name too long for the media bucket is rejected only with --media", async () => {
    const name = "a".repeat(58);
    const base = [
      "cloudflare",
      "--name",
      name,
      "--domain",
      "example.com",
      "--subdomain",
      "team",
      "--account-id",
      "abc",
    ];
    expect((await run(base)).code).toBe(0);
    rmSync(join(dir, "project.config.json"));
    const { code, io } = await run([...base, "--media", "--zone-id", "z"], {
      runner: fakeRunner(MEDIA_OK),
    });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("63");
  });

  test("suggests the folder name, normalized", () => {
    expect(suggestName("My Cool_Site!")).toBe("my-cool-site");
    expect(suggestName("www")).toBeUndefined();
    expect(suggestName("___")).toBeUndefined();
  });

  test("unknown hosts and flags print usage and exit 1", async () => {
    for (const argv of [
      ["netlify"],
      [],
      ["cloudflare", "vercel"],
      ["vercel", "--nope"],
    ]) {
      const { code, io } = await run(argv);
      expect(code).toBe(1);
      expect(io.err.join("\n")).toContain("Usage: pnpm connect");
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  test("--help exits 0", async () => {
    const { code, io } = await run(["--help"]);
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain("Usage: pnpm connect");
  });
});

describe("no TTY", () => {
  test.each([
    [
      "--name",
      [
        "cloudflare",
        "--domain",
        "example.com",
        "--subdomain",
        "team",
        "--account-id",
        "abc",
      ],
    ],
    [
      "--domain",
      [
        "cloudflare",
        "--name",
        "acme",
        "--subdomain",
        "team",
        "--account-id",
        "abc",
      ],
    ],
    [
      "--subdomain",
      [
        "cloudflare",
        "--name",
        "acme",
        "--domain",
        "example.com",
        "--account-id",
        "abc",
      ],
    ],
    ["--suffix", ["vercel", "--name", "acme"]],
    ["--zone-id", [...CF, "--media"]],
  ])("a missing value names %s and does not hang", async (flag, argv) => {
    const { code, io } = await run(argv as string[]);
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain(flag as string);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("the folder name is only a suggestion, never used unattended", async () => {
    const { code, io } = await run(["vercel", "--suffix", "-t.vercel.app"]);
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("--name");
  });
});

describe("changing host", () => {
  test("is refused without --yes, with no changes", async () => {
    await run(VC);
    const before = snapshot();
    const { code, io } = await run(CF);
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("--yes");
    expect(snapshot()).toEqual(before);
  });

  test("goes ahead with --yes and keeps the other host's files", async () => {
    await run(VC);
    writeFileSync(join(dir, "vercel.json"), "{}\n");
    const { code } = await run([...CF, "--yes"]);
    expect(code).toBe(0);
    expect(readJson("project.config.json").host).toBe("cloudflare");
    expect(read("vercel.json")).toBe("{}\n");

    // And back again: wrangler.jsonc stays.
    const wrangler = read("wrangler.jsonc");
    expect((await run([...VC, "--yes"])).code).toBe(0);
    expect(readJson("project.config.json").host).toBe("vercel");
    expect(read("wrangler.jsonc")).toBe(wrangler);
  });

  test("on a TTY asks, and a no leaves everything alone", async () => {
    await run(VC);
    const before = snapshot();
    const refused = await run(CF, { io: session(true, ["no"]) });
    expect(refused.code).toBe(1);
    expect(snapshot()).toEqual(before);

    const accepted = await run(CF, { io: session(true, ["yes"]) });
    expect(accepted.code).toBe(0);
    expect(readJson("project.config.json").host).toBe("cloudflare");
  });

  test("switching keeps mediaUrl", async () => {
    await run(VC);
    const config = readJson("project.config.json");
    writeFileSync(
      join(dir, "project.config.json"),
      `${JSON.stringify({ ...config, mediaUrl: "https://m.example.com" }, null, 2)}\n`
    );
    await run([...CF, "--yes"]);
    expect(readJson("project.config.json").mediaUrl).toBe(
      "https://m.example.com"
    );
  });

  test("an invalid existing config stops the run", async () => {
    writeFileSync(join(dir, "project.config.json"), '{"host":"nope"}');
    const { code, io } = await run(VC);
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("project.config.json is invalid");
    expect(read("project.config.json")).toBe('{"host":"nope"}');
  });
});

describe("wrangler.jsonc hand edits", () => {
  async function edit(
    change: (wrangler: Record<string, any>) => void,
    argv = CF
  ) {
    await run(CF);
    const wrangler = readJson("wrangler.jsonc");
    change(wrangler);
    writeFileSync(
      join(dir, "wrangler.jsonc"),
      `${JSON.stringify(wrangler, null, 2)}\n`
    );
    expect((await run(argv)).code).toBe(0);
    return readJson("wrangler.jsonc");
  }

  test("assets keeps extra settings, while directory and the API route stay managed", async () => {
    const wrangler = await edit((w) => {
      w.assets = {
        directory: "./public",
        html_handling: "none",
        run_worker_first: ["/x/*"],
      };
    });
    expect(wrangler.assets).toEqual({
      directory: "./dist",
      html_handling: "none",
      run_worker_first: ["/x/*", "/api/*"],
    });
  });

  test("run_worker_first true is kept as it already covers the API", async () => {
    const wrangler = await edit((w) => {
      w.assets.run_worker_first = true;
    });
    expect(wrangler.assets.run_worker_first).toBe(true);
  });

  test("compatibility_flags is a union", async () => {
    const wrangler = await edit((w) => {
      w.compatibility_flags = ["global_fetch_strictly_public"];
    });
    expect(wrangler.compatibility_flags).toEqual([
      "global_fetch_strictly_public",
      "nodejs_compat",
    ]);
  });

  test("previews is kept", async () => {
    const wrangler = await edit((w) => {
      w.previews = { vars: { A: "1" } };
    });
    expect(wrangler.previews).toEqual({ vars: { A: "1" } });
  });

  test("extra routes stay after the managed one, and are not duplicated", async () => {
    const wrangler = await edit((w) => {
      w.routes.push("example.com/files/*", {
        pattern: "other.example.com",
        custom_domain: true,
      });
    });
    expect(wrangler.routes).toEqual([
      { pattern: "acme.example.com", custom_domain: true },
      "example.com/files/*",
      { pattern: "other.example.com", custom_domain: true },
    ]);
    const before = snapshot();
    await run(CF);
    expect(snapshot()).toEqual(before);
  });

  test("renaming drops the custom domain the old name wrote, but not hand-added routes", async () => {
    const wrangler = await edit(
      (w) => {
        w.routes.push("example.com/files/*");
      },
      CF.map((v) => (v === "acme" ? "acme2" : v))
    );
    expect(wrangler.routes).toEqual([
      { pattern: "acme2.example.com", custom_domain: true },
      "example.com/files/*",
    ]);
  });
});

describe("cloudflare --media", () => {
  const MEDIA = [...CF, "--media", "--zone-id", "zone1"];

  /** A fake R2 that remembers buckets and domains, so a retry sees what the first try left behind. */
  function statefulR2(state = { failCors: false }) {
    const buckets = new Set<string>();
    const domains = new Map<string, string>();
    const handlers: Record<string, Handler> = {
      "r2 bucket create": (args) => {
        if (buckets.has(args[3]))
          return fail(
            "The bucket you tried to create already exists, and you own it. [code: 10004]"
          );
        buckets.add(args[3]);
        return ok();
      },
      "r2 bucket domain list": (args) => {
        const mine = [...domains]
          .filter(([, bucket]) => bucket === args[4])
          .map(([host]) => `domain: ${host}`);
        return ok(
          mine.length > 0
            ? mine.join("\n\n")
            : "There are no custom domains connected to this bucket."
        );
      },
      "r2 bucket domain add": (args) => {
        const host = args[args.indexOf("--domain") + 1];
        if (domains.has(host))
          return fail("The domain is already in use by a bucket.");
        domains.set(host, args[4]);
        return ok();
      },
      "r2 bucket cors set": () =>
        state.failCors ? fail("cors exploded") : ok(),
    };
    return { handlers, state, domains };
  }

  test("creates the bucket, attaches the domain, sets CORS, then writes mediaUrl", async () => {
    const runner = fakeRunner(MEDIA_OK);
    let cors: unknown;
    const wrapped: Runner = async (args, options) => {
      if (args[2] === "cors")
        cors = JSON.parse(
          readFileSync(args[args.indexOf("--file") + 1], "utf8")
        );
      return runner.run(args, options);
    };
    const code = await connect(MEDIA, {
      cwd: dir,
      run: wrapped,
      io: session().io,
      env: {},
      compatibilityDate: NEWEST_DATE,
    });
    expect(code).toBe(0);
    expect(readJson("project.config.json").mediaUrl).toBe(
      "https://acme-media.example.com"
    );
    expect(runner.calls.map((c) => c.args)).toEqual([
      ["r2", "bucket", "create", "acme-media"],
      ["r2", "bucket", "domain", "list", "acme-media"],
      [
        "r2",
        "bucket",
        "domain",
        "add",
        "acme-media",
        "--domain",
        "acme-media.example.com",
        "--zone-id",
        "zone1",
        "--force",
      ],
      [
        "r2",
        "bucket",
        "cors",
        "set",
        "acme-media",
        "--file",
        expect.stringMatching(/cors\.json$/),
        "--force",
      ],
    ]);
    expect(cors).toEqual({
      rules: [
        {
          allowed: {
            origins: ["*"],
            methods: ["GET", "HEAD"],
            headers: ["Range", "Content-Type"],
          },
          exposeHeaders: [
            "Content-Length",
            "Content-Range",
            "Accept-Ranges",
            "ETag",
          ],
          maxAgeSeconds: 86400,
        },
      ],
    });
  });

  test("runs from an empty directory with the account in the environment, whatever wrangler.jsonc says", async () => {
    // wrangler.jsonc names account A. The run is told B. Wrangler would act on A if it ran here.
    await run(CF.map((v) => (v === "abc" ? "A" : v)));
    const seen: {
      cwd?: string;
      files: string[];
      env?: Record<string, string>;
    }[] = [];
    const runner = fakeRunner(MEDIA_OK);
    const code = await connect(
      MEDIA.map((v) => (v === "abc" ? "B" : v)),
      {
        cwd: dir,
        run: async (args, options) => {
          seen.push({
            cwd: options?.cwd,
            files: options?.cwd ? readdirSync(options.cwd) : [],
            env: options?.env,
          });
          return runner.run(args, options);
        },
        io: session().io,
        env: {},
        compatibilityDate: NEWEST_DATE,
      }
    );
    expect(code).toBe(0);
    expect(readJson("wrangler.jsonc").account_id).toBe("B");
    expect(seen).toHaveLength(4);
    for (const call of seen) {
      expect(call.cwd).toBeDefined();
      expect(call.cwd).not.toBe(dir);
      expect(call.files.filter((f) => f.startsWith("wrangler"))).toEqual([]);
      expect(call.env).toEqual({ CLOUDFLARE_ACCOUNT_ID: "B" });
    }
    expect(existsSync(seen[0].cwd as string)).toBe(false);
  });

  test("takes the zone ID from WF_ZONE_ID", async () => {
    const runner = fakeRunner(MEDIA_OK);
    const { code } = await run([...CF, "--media"], {
      runner,
      env: { WF_ZONE_ID: "envzone" },
    });
    expect(code).toBe(0);
    expect(runner.calls[2].args).toContain("envzone");
  });

  test.each([
    ["r2 bucket create", "Creating the R2 bucket", 1],
    ["r2 bucket domain list", "Listing the R2 bucket's custom domains", 2],
    ["r2 bucket domain add", "Attaching the custom domain", 3],
    ["r2 bucket cors set", "Setting CORS", 4],
  ])(
    "a failure at %s names the step and leaves everything unchanged",
    async (key, step, callCount) => {
      // Start from a connected project so there is a mediaUrl to protect.
      await run(CF);
      const before = snapshot();

      const runner = fakeRunner({
        ...MEDIA_OK,
        [key]: () => fail("nope from cloudflare"),
      });
      const { code, io } = await run(MEDIA, { runner });
      expect(code).toBe(1);
      expect(io.err.join("\n")).toContain(step as string);
      expect(io.err.join("\n")).toContain("nope from cloudflare");
      expect(io.err.join("\n")).toContain(
        "may already have changed your Cloudflare account"
      );
      expect(runner.calls).toHaveLength(callCount as number);
      expect(snapshot()).toEqual(before);
      expect(readJson("project.config.json").mediaUrl).toBeNull();
    }
  );

  test("a failure on a fresh folder writes nothing at all", async () => {
    const runner = fakeRunner({
      ...MEDIA_OK,
      "r2 bucket cors set": () => fail("x"),
    });
    expect((await run(MEDIA, { runner })).code).toBe(1);
    expect(readdirSync(dir)).toEqual([]);
  });

  test("a retry after a CORS failure succeeds, because the attached domain is found and skipped", async () => {
    const r2 = statefulR2({ failCors: true });
    const runner = fakeRunner(r2.handlers);

    const first = await run(MEDIA, { runner });
    expect(first.code).toBe(1);
    expect(first.io.err.join("\n")).toContain("Setting CORS");
    expect(readdirSync(dir)).toEqual([]);
    expect(r2.domains.get("acme-media.example.com")).toBe("acme-media");

    r2.state.failCors = false;
    const second = await run(MEDIA, { runner });
    expect(second.code).toBe(0);
    expect(second.io.out.join("\n")).toContain("already attached");
    expect(readJson("project.config.json").mediaUrl).toBe(
      "https://acme-media.example.com"
    );
    expect(runner.calls.filter((c) => c.args[3] === "add")).toHaveLength(1);
  });

  test("a bucket that already exists counts as success (UNCONFIRMED wording), and a re-run changes no bytes", async () => {
    const r2 = statefulR2();
    const runner = fakeRunner(r2.handlers);
    await run(MEDIA, { runner });
    const before = snapshot();

    const { code } = await run(MEDIA, { runner });
    expect(code).toBe(0);
    expect(snapshot()).toEqual(before);
  });

  test("a domain held by another bucket still fails", async () => {
    const r2 = statefulR2();
    r2.domains.set("acme-media.example.com", "someone-elses-bucket");
    const { code, io } = await run(MEDIA, { runner: fakeRunner(r2.handlers) });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("Attaching the custom domain");
    expect(io.err.join("\n")).toContain("already in use");
  });

  test("a longer hostname in the list does not count as this one", async () => {
    const runner = fakeRunner({
      ...MEDIA_OK,
      "r2 bucket domain list": () =>
        ok(
          "domain: xacme-media.example.com\n\ndomain: acme-media.example.com.evil.io"
        ),
    });
    const { code } = await run(MEDIA, { runner });
    expect(code).toBe(0);
    expect(runner.calls.some((c) => c.args[3] === "add")).toBe(true);
  });

  test("a different failure from create is not mistaken for an existing bucket", async () => {
    const runner = fakeRunner({
      ...MEDIA_OK,
      "r2 bucket create": () => fail("Authentication error [code: 10000]"),
    });
    expect((await run(MEDIA, { runner })).code).toBe(1);
  });

  test("--media is rejected on vercel", async () => {
    expect((await run([...VC, "--media"])).code).toBe(1);
  });
});
