#!/usr/bin/env node
// The build id a deployment reports at /api/health, so `pnpm drift` can compare a
// running Worker with this checkout — including a change that never touches the
// client bundle, which the asset hashes cannot see.
//
//   node scripts/build-id.mjs        # print the id, or fail saying why there is none
//
// The id is the commit the Worker was built from, `-dirty` when tracked files
// differ from it. Untracked files are ignored deliberately: `dist/` and
// `.wrangler/` are ignored build output, so a CI checkout must not look dirty
// because a build step wrote them.
//
// `ATV_BUILD_ID` in the environment wins over git, so a test, or a rebuild from a
// tarball with no `.git`, can say what it is. A deploy and a drift check agree
// because both read this one function.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Twelve hex characters: the same length the deploy workflow would get from a
// commit sha, so the two sources cannot disagree about the shape of the value.
export const ID_LENGTH = 12;

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

// The commit alone, or null when this is not a git checkout (or git is missing).
export function gitBuildId(cwd = process.cwd()) {
  try {
    const head = git(["rev-parse", `--short=${ID_LENGTH}`, "HEAD"], cwd);
    if (!/^[0-9a-f]{7,40}$/.test(head)) return null;
    // Tracked changes only: an untracked artifact says nothing about the sources
    // that were built, and reporting it as dirty would make every CI run fail.
    const changed = git(["status", "--porcelain", "--untracked-files=no"], cwd);
    return changed.length > 0 ? `${head}-dirty` : head;
  } catch {
    return null;
  }
}

// What this process considers itself. The environment override exists for tests
// and for a checkout without `.git`; everything else uses the commit.
export function buildId(cwd = process.cwd()) {
  const override = process.env.ATV_BUILD_ID?.trim();
  if (override) return override;
  return gitBuildId(cwd);
}

// `-dirty` is not a commit, so a deployment carrying it cannot be tied to one.
export function isDirty(id) {
  return typeof id === "string" && id.endsWith("-dirty");
}

// Two ids name the same build when they are equal or one is a prefix of the
// other: `git rev-parse --short` may extend past the requested length in a very
// large repository, and a build could be labelled with a full SHA.
export function sameBuild(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

// `import.meta.url` is the vitest entry when this file is imported by a test, so
// the CLI half runs only when it is the program being started.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const id = buildId();
  if (!id) {
    console.error("✗ No build id: this is not a git checkout, or git is unavailable.");
    console.error("  A deploy needs one so `pnpm drift` can compare an origin with a commit.");
    process.exit(1);
  }
  console.log(id);
}
