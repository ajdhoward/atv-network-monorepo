import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const cli = path.resolve("scripts/check-continuity.mjs");

function run(cwd: string) {
  return spawnSync(process.execPath, [cli], { cwd, encoding: "utf8" });
}

// A minimal repository: an index, one linked doc, and a continuity inventory
// whose names are backed by a workflow file.
function fixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atv-continuity-"));
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# r\n\n[x](docs/continuity.md)\n");
  fs.writeFileSync(
    path.join(dir, "docs", "README.md"),
    "# docs\n\n- [continuity](continuity.md)\n",
  );
  fs.writeFileSync(
    path.join(dir, "docs", "continuity.md"),
    "# continuity\n\n## Secret name inventory\n\n```text\nATV_TORBOX_API_KEY\n```\n",
  );
  fs.writeFileSync(
    path.join(dir, ".github", "workflows", "deploy.yml"),
    "env:\n  ATV_TORBOX_API_KEY: ${{ secrets.ATV_TORBOX_API_KEY }}\n",
  );
  return dir;
}

describe("continuity check", () => {
  it("passes the real repository", () => {
    const result = run(process.cwd());
    expect(result.stdout).toContain("no broken relative links");
    expect(result.stdout).toContain("every inventoried secret name still exists");
    expect(result.status).toBe(0);
  });

  it("catches a link to a file that is not there", () => {
    const dir = fixture();
    fs.appendFileSync(path.join(dir, "docs", "continuity.md"), "\n[gone](missing.md)\n");
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("docs/continuity.md -> missing.md");
  });

  it("catches a document nobody links to", () => {
    const dir = fixture();
    fs.writeFileSync(path.join(dir, "docs", "orphan.md"), "# orphan\n");
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("docs/orphan.md");
  });

  it("catches an inventory name the repository no longer mentions", () => {
    const dir = fixture();
    fs.writeFileSync(
      path.join(dir, "docs", "continuity.md"),
      "# continuity\n\n## Secret name inventory\n\n```text\nATV_OLD_TOKEN\n```\n",
    );
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("ATV_OLD_TOKEN");
  });

  // The inventory used to be checked in one direction only, so a secret could be
  // added to the Worker and never be writable down: green check, unrecoverable
  // account. This is the case the review found.
  it("catches a secret the Worker reads but the inventory omits", () => {
    const dir = fixture();
    // A git repository, so the other direction has a corpus to read and this test
    // fails only for the reason it is named after.
    const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    fs.mkdirSync(path.join(dir, "services", "atv-core", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "services", "atv-core", "src", "env.ts"),
      "export interface Env {\n  ATV_NEW_SECRET?: string;\n}\n",
    );
    git(["add", "-A"]);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("missing from the inventory: ATV_NEW_SECRET");
    expect(result.stdout).toContain("PASS  every inventoried secret name still exists");
  });

  // Bindings are infrastructure: nothing to rebuild, so nothing to inventory.
  it("does not demand an inventory entry for a binding", () => {
    const dir = fixture();
    const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    fs.mkdirSync(path.join(dir, "services", "atv-core", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "services", "atv-core", "src", "env.ts"),
      "export interface Env {\n  ATV_CACHE: KVNamespace;\n  ATV_LIMITER?: DurableObjectNamespace;\n}\n",
    );
    git(["add", "-A"]);
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("every secret the Worker reads is inventoried");
  });

  it("catches an active agent whose row links no context file", () => {
    const dir = fixture();
    fs.mkdirSync(path.join(dir, "docs", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "docs", "agents", "roster.md"),
      "# roster\n\n## Active\n\n| Agent | Paths owned |\n| --- | --- |\n| Zed | `android/` |\n",
    );
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("no context/ link: Zed");
  });

  // `wrangler dev` loads `.dev.vars`, which is where a local TorBox token would
  // sit. It is not a `.env`, and the pattern that catches `.env` files did not
  // reach it.
  it("catches a wrangler secrets file that got tracked", () => {
    const dir = fixture();
    const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(dir, ".dev.vars"), "ATV_TORBOX_API_KEY=left-in-git\n");
    git(["add", ".dev.vars"]);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(".dev.vars");
  });

  // The templates carry names and no values, so they are the two files of this
  // kind that belong in git: forbidding them is what made `.env.example` red.
  it("keeps the env templates that are meant to be tracked", () => {
    const dir = fixture();
    const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(dir, ".env.example"), "ATV_BASE_URL=\n");
    fs.writeFileSync(path.join(dir, ".dev.vars.example"), "ATV_TORBOX_API_KEY=\n");
    git(["add", ".env.example", ".dev.vars.example"]);
    const result = run(dir);
    expect(result.stdout).not.toContain(".env.example");
    expect(result.stdout).not.toContain(".dev.vars.example");
    expect(result.status).toBe(0);
  });

  // Two sessions noticed the five-change trigger late, because "five changes" was
  // a judgement about whether enough had happened. With the last record's commit
  // in the file, the count is arithmetic — and still only a warning, because
  // starting a review is the operator's call.
  it("warns when the review cadence has come due", () => {
    const dir = fixture();
    const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    fs.mkdirSync(path.join(dir, "docs", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "docs", "agents", "reviews.md"),
      "# reviews\n\nLast review: `0000000`\n",
    );
    // Indexed, or the fixture fails the unindexed-doc rule instead of testing
    // the cadence.
    fs.appendFileSync(path.join(dir, "docs", "README.md"), "- [reviews](agents/reviews.md)\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "fixture"]);
    const head = git(["rev-parse", "--short", "HEAD"]).stdout.trim();
    fs.writeFileSync(
      path.join(dir, "docs", "agents", "reviews.md"),
      `# reviews\n\nLast review: \`${head}\`\n`,
    );
    git(["commit", "-qam", "record the review"]);
    for (let i = 0; i < 5; i += 1) git(["commit", "-q", "--allow-empty", "-m", `change ${i}`]);

    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("change(s) since the last review");
    expect(result.stdout).toContain("WARN");
  });

  it("catches a line-up or keystore that got tracked", () => {
    const dir = fixture();
    const git = (args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    git(["init", "-q"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    fs.writeFileSync(path.join(dir, "atv-config.json"), '{"channels":[]}\n');
    git(["add", "atv-config.json"]);
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("atv-config.json");
  });
});
