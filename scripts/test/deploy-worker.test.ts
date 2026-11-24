import { execFile, execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// `scripts/deploy-worker.mjs` is the only thing that attaches the build id, and it
// had no test: the `--var` form came from wrangler's help text rather than from
// anything that ran it. A real wrangler needs an account, so the executable is a
// stand-in first on PATH that records the argv it was handed — the wrapper's output
// is the thing under test, not wrangler's.
const deploy = resolve("scripts/deploy-worker.mjs");
const dir = mkdtempSync(join(tmpdir(), "atv-deploy-worker-"));
const bin = join(dir, "bin");
let calls = 0;

beforeAll(() => {
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, "wrangler");
  // One argument per line, then the exit status the test asked for.
  writeFileSync(stub, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$STUB_ARGV"\nexit "$STUB_EXIT"\n');
  chmodSync(stub, 0o755);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Result = {
  status: number | null;
  stdout: string;
  stderr: string;
  // The arguments the stand-in received, or null when it never ran.
  argv: string[] | null;
};

function run(
  args: string[],
  options: { cwd?: string; buildId?: string; exit?: number } = {},
): Promise<Result> {
  const argvFile = join(dir, `argv-${(calls += 1)}`);
  return new Promise((done) => {
    execFile(
      process.execPath,
      [deploy, ...args],
      {
        encoding: "utf8",
        cwd: options.cwd ?? dir,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
          STUB_ARGV: argvFile,
          STUB_EXIT: String(options.exit ?? 0),
          // An empty value is how the git path is reached, and keeps this suite
          // independent of whatever the shell exported.
          ATV_BUILD_ID: options.buildId ?? "",
        },
      },
      (error, stdout, stderr) => {
        const code = error ? (error as NodeJS.ErrnoException).code : undefined;
        const status = typeof code === "number" ? code : error ? 1 : 0;
        const argv = existsSync(argvFile)
          ? readFileSync(argvFile, "utf8").split("\n").slice(0, -1)
          : null;
        done({ status, stdout, stderr, argv });
      },
    );
  });
}

// The wrapper runs `wrangler`, but on Windows it runs `wrangler.cmd`, and a `.cmd`
// stand-in cannot record split arguments or be skipped by this same mechanism.
describe.skipIf(process.platform === "win32")("deploy-worker", () => {
  // What the deploy actually sends: wrangler's `--var` (an array of KEY:VALUE), so
  // the var merges with the config's own [vars] instead of replacing them.
  it("attaches the build id as a var, to the config it was given", async () => {
    const result = await run(["wrangler.production.toml"], { buildId: "abc123def456" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.argv).toEqual([
      "deploy",
      "--config",
      "wrangler.production.toml",
      "--var",
      "ATV_BUILD_ID:abc123def456",
    ]);
  });

  it("deploys the sandbox config when no config is named", async () => {
    const result = await run([], { buildId: "abc123def456" });
    expect(result.status).toBe(0);
    expect(result.argv?.[2]).toBe("wrangler.toml");
  });

  // The value a deploy stamps is the one `pnpm drift` compares with, and neither
  // may come from anywhere but this commit, so the git path is exercised here too.
  it("reads the id from git when the environment names none", async () => {
    const repo = mkdtempSync(join(dir, "repo-"));
    execFileSync("git", ["init", "-q", repo], { encoding: "utf8" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
    writeFileSync(join(repo, "wrangler.toml"), 'id = "committed"\n');
    execFileSync("git", ["add", "-A"], { cwd: repo });
    execFileSync("git", ["commit", "-qm", "fixture"], { cwd: repo });
    const head = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();

    const result = await run([], { cwd: repo });
    expect(result.status).toBe(0);
    expect(result.argv?.at(-1)).toBe(`ATV_BUILD_ID:${head}`);
  });

  // A failed deploy has to fail the step that ran it, or the job reads green and
  // the drift check is the only thing that notices.
  it("exits with the status wrangler failed with", async () => {
    const result = await run([], { buildId: "abc123def456", exit: 7 });
    expect(result.status).toBe(7);
  });

  // A deployment with no id is one drift cannot vouch for, so the wrapper refuses
  // before it spends a deploy on it.
  it("refuses without an id, and never calls wrangler", async () => {
    const plain = mkdtempSync(join(dir, "plain-"));
    const result = await run([], { cwd: plain });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No build id");
    expect(result.argv).toBeNull();
  });
});
