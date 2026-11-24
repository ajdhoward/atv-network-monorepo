import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Imported by URL for the same reason `config-meta.test.ts` does: the helper is a
// `.mjs` with no declaration file, and `tsc --noEmit` runs over this suite.
const moduleUrl = pathToFileURL(resolve("scripts/build-id.mjs")).href;
type BuildIdModule = {
  ID_LENGTH: number;
  buildId: (cwd?: string) => string | null;
  gitBuildId: (cwd?: string) => string | null;
  isDirty: (id: string | null) => boolean;
  sameBuild: (a: string | null, b: string | null) => boolean;
};
let helpers: BuildIdModule;

const dir = mkdtempSync(join(tmpdir(), "atv-build-id-"));
const repo = join(dir, "repo");

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeAll(async () => {
  helpers = (await import(moduleUrl)) as BuildIdModule;
  // A clean environment: `ATV_BUILD_ID` would override git for every case.
  delete process.env.ATV_BUILD_ID;
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ATV_BUILD_ID;
});

describe("build id", () => {
  it("is the short commit of a clean checkout", () => {
    execFileSync("git", ["init", "-q", repo], { encoding: "utf8" });
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    writeFileSync(join(repo, "tracked.txt"), "one\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "fixture"]);

    const head = git(["rev-parse", "--short=12", "HEAD"]);
    expect(helpers.gitBuildId(repo)).toBe(head);
    expect(head).toHaveLength(helpers.ID_LENGTH);
    expect(helpers.isDirty(helpers.gitBuildId(repo))).toBe(false);
  });

  // A deployment built from uncommitted work matches no commit, so the id has to
  // say so rather than pretending to be the last one.
  it("marks a tracked change dirty", () => {
    writeFileSync(join(repo, "tracked.txt"), "two\n");
    try {
      const id = helpers.gitBuildId(repo);
      expect(id).toMatch(/-dirty$/);
      expect(helpers.isDirty(id)).toBe(true);
    } finally {
      git(["checkout", "--", "tracked.txt"]);
    }
  });

  // `dist/` and `.wrangler/` are ignored build output. Counting them would make
  // every CI run report a dirty deploy, which would fail drift on a good deploy.
  it("ignores untracked files", () => {
    writeFileSync(join(repo, ".gitignore"), "dist/\n");
    writeFileSync(join(repo, "untracked.txt"), "scratch\n");
    try {
      expect(helpers.gitBuildId(repo)).not.toMatch(/-dirty$/);
    } finally {
      rmSync(join(repo, ".gitignore"));
      rmSync(join(repo, "untracked.txt"));
    }
  });

  it("is null outside a git checkout", () => {
    const plain = mkdtempSync(join(dir, "plain-"));
    expect(helpers.gitBuildId(plain)).toBeNull();
  });

  // The escape hatch, and the reason drift and a deploy can agree in a checkout
  // with no `.git` at all.
  it("takes ATV_BUILD_ID over git", () => {
    process.env.ATV_BUILD_ID = "from-env";
    try {
      expect(helpers.buildId(repo)).toBe("from-env");
    } finally {
      delete process.env.ATV_BUILD_ID;
    }
  });

  it("treats a prefix as the same build, and different ids as different", () => {
    expect(helpers.sameBuild("abc123", "abc123")).toBe(true);
    // `--short` may extend past the requested length; a full SHA still names it.
    expect(helpers.sameBuild("abc123", "abc123def456")).toBe(true);
    expect(helpers.sameBuild("abc123", "abc124")).toBe(false);
    expect(helpers.sameBuild(null, "abc123")).toBe(false);
    expect(helpers.sameBuild("", "")).toBe(false);
  });
});
