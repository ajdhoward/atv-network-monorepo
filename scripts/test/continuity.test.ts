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
