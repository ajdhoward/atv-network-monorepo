#!/usr/bin/env node
// Fails when project knowledge starts living outside the repository.
//
//   node scripts/check-continuity.mjs [root]
//
// Four rules, all mechanical:
//   1. no broken relative link in README.md, AGENTS.md or docs/;
//   2. every doc under docs/ is listed in docs/README.md;
//   3. every name in docs/continuity.md's secret inventory still exists in the
//      repository's workflows or config, so a rename cannot orphan the inventory;
//   4. nothing gitignored-but-vital is tracked (line-up, .env, keystore, APK).
//
// Rule 4 needs git. Without it the check reports SKIP and still runs the rest,
// so it works on a plain fixture tree in the tests.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  brokenLinks,
  forbiddenTracked,
  inventoryNames,
  markdownFiles,
  repositoryNames,
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
} else {
  record("docs/continuity.md exists", false);
}

if (tracked.status === 0) {
  const leaked = forbiddenTracked(trackedFiles);
  record("no vital ignored file is tracked", leaked.length === 0, leaked.join(", ") || undefined);
} else {
  console.log("SKIP  tracked-file check — git is unavailable here");
}

console.log(
  failures
    ? `\n${failures} continuity check(s) failed.`
    : "\nAll continuity checks passed: the repository is self-sufficient.",
);
process.exit(failures ? 1 : 0);
