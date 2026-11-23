#!/usr/bin/env node
// Lands an agent's handoff file in the repository.
//
//   node scripts/handoff.mjs <file> [--dry-run] [--commit] [--push] [--force]
//
// For an agent that cannot reach GitHub: it returns one Markdown file, the
// operator runs this, and the file becomes docs/agents/handoffs/<slug>.md where
// every other agent already looks. The file is validated first — required
// fields, no credential-shaped strings, a sane size — because this repository
// is public and a handoff is a paste like any other.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fieldValue, handoffPath, slugFor, validateHandoff } from "./lib/handoff.mjs";

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const valueOf = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};

const file = args.find((arg) => !arg.startsWith("--") && arg !== valueOf("slug"));
const dryRun = has("dry-run");
const commit = has("commit");
const push = has("push");
const force = has("force");

function fail(message, detail) {
  console.error(`✗ ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

if (!file) {
  fail(
    "usage: node scripts/handoff.mjs <file> [--dry-run] [--commit] [--push] [--force]",
    "The file is what an agent with no repository access returned to you.",
  );
}

let text;
try {
  text = fs.readFileSync(file, "utf8");
} catch (err) {
  fail(`cannot read ${file}`, err instanceof Error ? err.message : String(err));
}

const check = validateHandoff(text);
if (!check.ok) {
  fail(`${file} is not a usable handoff:`, check.problems.map((p) => `  · ${p}`).join("\n"));
}

const slug = slugFor(valueOf("slug") || fieldValue(text, "name"));
if (!slug || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) {
  fail(
    "cannot derive a file name from the handoff",
    "Pass --slug <name>; it becomes docs/agents/handoffs/<slug>.md.",
  );
}

const target = handoffPath(slug);
const name = fieldValue(text, "name");
const roles = fieldValue(text, "roles");
const paths = fieldValue(text, "paths");
const task = fieldValue(text, "task");

console.log(`valid handoff: ${name || slug} (${roles}) — ${check.bytes} bytes`);
console.log(`  task:  ${task}`);
console.log(`  paths: ${paths}`);
console.log(`  lands: ${target}`);

if (dryRun) {
  console.log("dry run: nothing written.");
  process.exit(0);
}

if (fs.existsSync(target) && !force) {
  fail(
    `${target} already exists`,
    "Another handoff owns that name. Pass --slug <other-name>, or --force to replace it.",
  );
}
fs.mkdirSync("docs/agents/handoffs", { recursive: true });
fs.writeFileSync(target, text);
console.log(`wrote ${target}`);

if (!commit) {
  console.log(`now: git add ${target} && git commit`);
  process.exit(0);
}

const run = (cmd, argv) => {
  const result = spawnSync(cmd, argv, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(`${cmd} ${argv.join(" ")} failed`, (result.stderr || result.stdout || "").trim());
  }
  return result.stdout.trim();
};

run("git", ["add", target]);
run("git", [
  "commit",
  "-m",
  `Add handoff from ${name || slug}`,
  "-m",
  `${name || "A new agent"} has no repository access, so this file is its announcement and its
proposal: roles ${roles}, paths ${paths}, task "${task}". Other agents read it here; a
roster row is still the operator's to add if access is granted.`,
]);
console.log(`committed ${target}`);

if (push) {
  run("git", ["push"]);
  console.log("pushed.");
} else {
  console.log("commit only; run `git push` when you are ready.");
}
