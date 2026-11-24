#!/usr/bin/env node
// Fails when project knowledge starts living outside the repository.
//
//   node scripts/check-continuity.mjs [root]
//
// Four rules, all mechanical:
//   1. no broken relative link in README.md, AGENTS.md or docs/;
//   2. every doc under docs/ is listed in docs/README.md;
//   3. every name in docs/continuity.md's secret inventory still exists in the
//      repository's workflows or config (so a rename cannot orphan the
//      inventory) and every secret the Worker reads is in that inventory (so a
//      new one cannot arrive unrecorded);
//   4. nothing gitignored-but-vital is tracked (line-up, .env, keystore, APK).
//
// Rule 4 needs git. Without it the check reports SKIP and still runs the rest,
// so it works on a plain fixture tree in the tests.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  activeRowsWithoutContext,
  brokenLinks,
  envSecretNames,
  forbiddenTracked,
  inventoryNames,
  lastReviewSha,
  markdownFiles,
  repositoryNames,
  undocumentedScripts,
  unindexedDocs,
} from "./lib/docs-check.mjs";

const root = process.argv[2] || ".";
const INDEX = "docs/README.md";
const CONTINUITY = "docs/continuity.md";

let failures = 0;
function record(name, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const files = markdownFiles(root);
record("documents found", files.length > 0, `${files.length} Markdown file(s)`);

const broken = brokenLinks(files, root);
record("no broken relative links", broken.length === 0, broken.join("; ") || undefined);

if (fs.existsSync(path.join(root, INDEX))) {
  const unindexed = unindexedDocs(files, INDEX, root);
  record(
    "every doc is listed in docs/README.md",
    unindexed.length === 0,
    unindexed.join(", ") || undefined,
  );
} else {
  record("docs/README.md exists", false, "the index is what makes the other documents findable");
}

// A command that exists and is written down nowhere is the same class of loss as
// a secret that is inventoried nowhere: the next session cannot find it without
// reading package.json and guessing what it does.
const packagePath = path.join(root, "package.json");
if (fs.existsSync(packagePath)) {
  const docsText = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
  const undocumented = undocumentedScripts(fs.readFileSync(packagePath, "utf8"), docsText);
  record(
    "every package script is written down",
    undocumented.length === 0,
    undocumented.length ? `not named in any doc: ${undocumented.join(", ")}` : undefined,
  );
}

// The tracked list is the corpus: a secret name that only the docs mention is
// drift, so the check has to read the code and config, not just Markdown.
const tracked = spawnSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
const trackedFiles = tracked.status === 0 ? tracked.stdout.split("\n").filter(Boolean) : files;

if (fs.existsSync(path.join(root, CONTINUITY))) {
  const names = inventoryNames(fs.readFileSync(path.join(root, CONTINUITY), "utf8"));
  record("secret inventory is not empty", names.length > 0, `${names.length} name(s)`);
  const present = repositoryNames(trackedFiles, root);
  const missing = names.filter((name) => !present(name));
  record(
    "every inventoried secret name still exists in the repository",
    missing.length === 0,
    missing.length ? `not found outside docs: ${missing.join(", ")}` : undefined,
  );

  // The direction that survives the account: an inventory can be complete about
  // the names it knows and still miss the one the Worker started reading last
  // week, which is the name a rebuild would have no way to learn.
  const envPath = path.join(root, "services/atv-core/src/env.ts");
  if (fs.existsSync(envPath)) {
    const declared = envSecretNames(fs.readFileSync(envPath, "utf8"));
    const unrecorded = declared.filter((name) => !names.includes(name));
    record(
      "every secret the Worker reads is inventoried",
      unrecorded.length === 0,
      unrecorded.length ? `missing from the inventory: ${unrecorded.join(", ")}` : undefined,
    );
  } else {
    console.log("SKIP  secret-direction check — no services/atv-core/src/env.ts here");
  }
} else {
  record("docs/continuity.md exists", false);
}

const rosterPath = path.join(root, "docs/agents/roster.md");
if (fs.existsSync(rosterPath)) {
  const missing = activeRowsWithoutContext(fs.readFileSync(rosterPath, "utf8"));
  record(
    "every active agent links a context file",
    missing.length === 0,
    missing.length ? `no context/ link: ${missing.join(", ")}` : undefined,
  );
}

if (tracked.status === 0) {
  const leaked = forbiddenTracked(trackedFiles);
  record("no vital ignored file is tracked", leaked.length === 0, leaked.join(", ") || undefined);
} else {
  console.log("SKIP  tracked-file check — git is unavailable here");
}

// The review cadence is the operator's call, so this is a warning and never a
// failure: a due review is information, not a broken repository.
const reviewsPath = path.join(root, "docs/agents/reviews.md");
if (tracked.status === 0 && fs.existsSync(reviewsPath)) {
  const sha = lastReviewSha(fs.readFileSync(reviewsPath, "utf8"));
  const count = sha
    ? spawnSync("git", ["rev-list", "--count", `${sha}..HEAD`], { cwd: root, encoding: "utf8" })
    : null;
  if (!sha) {
    console.log("WARN  reviews.md records no last-review commit, so the cadence cannot be counted");
  } else if (count?.status !== 0) {
    console.log(`WARN  cannot count changes since the last review (${sha}) — unknown commit?`);
  } else {
    const since = Number(count.stdout.trim());
    console.log(
      since >= 5
        ? `WARN  ${since} change(s) since the last review (${sha}) — reviews.md triggers one at 5`
        : `PASS  ${since} change(s) since the last review (${sha}), under the trigger of 5`,
    );
  }
}

console.log(
  failures
    ? `\n${failures} continuity check(s) failed.`
    : "\nAll continuity checks passed: the repository is self-sufficient.",
);
process.exit(failures ? 1 : 0);
