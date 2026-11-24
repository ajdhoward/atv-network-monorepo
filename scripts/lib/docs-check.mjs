// Checks that the project's knowledge is reachable from the repository alone.
// Kept apart from the CLI so each rule is testable against a fixture tree.

import fs from "node:fs";
import path from "node:path";

const ROOT_MARKDOWN = ["README.md", "AGENTS.md"];

export function markdownFiles(root = ".") {
  const files = ROOT_MARKDOWN.filter((file) => fs.existsSync(path.join(root, file)));
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".md")) files.push(rel);
    }
  };
  if (fs.existsSync(path.join(root, "docs"))) walk("docs");
  return files;
}

// A relative link to a file that is not there is a dead end for the agent that
// follows it, and the most common way a doc silently rots.
export function brokenLinks(files, root = ".") {
  const broken = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0].split("?")[0].trim();
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("/")) continue;
      if (!fs.existsSync(path.join(root, path.dirname(file), target))) {
        broken.push(`${file} -> ${target}`);
      }
    }
  }
  return broken;
}

// An unindexed doc is effectively private: nobody finds it unless they already
// know it exists.
export function unindexedDocs(files, index = "docs/README.md", root = ".") {
  const indexText = fs.readFileSync(path.join(root, index), "utf8");
  return files
    .filter((file) => file !== index && file.startsWith("docs/"))
    .filter((file) => !indexText.includes(file.slice("docs/".length)));
}

const INVENTORY_HEADING = "## Secret name inventory";

// The names live in a fenced block under a fixed heading, so the check reads the
// same text a person does rather than a special side-channel file.
export function inventoryNames(text) {
  const section = text.split(INVENTORY_HEADING)[1] ?? "";
  const fence = section.match(/```text\n([\s\S]*?)```/);
  if (!fence) return [];
  return [
    ...new Set(
      fence[1]
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[A-Z][A-Z0-9_]{3,}$/.test(line)),
    ),
  ];
}

// The other direction of the inventory rule, and the one that matters after an
// account is gone: a secret the Worker reads but the inventory does not name
// cannot be rebuilt from the repository, however green the first direction is.
//
// Secrets are the `ATV_*` entries typed `string` in `Env`. A KV namespace, a
// Fetcher, a Durable Object namespace or an Analytics Engine dataset is
// infrastructure with nothing to recover, and every plain `wrangler.toml` var
// this Worker reads is a non-`ATV_` name, so this rule does not have to parse
// the config as well.
export function envSecretNames(envText) {
  const names = new Set();
  for (const match of envText.matchAll(/(ATV_[A-Z0-9_]+)\??:\s*string\s*;/g)) {
    names.add(match[1]);
  }
  return [...names];
}

// Everything a repository file can plausibly hold a secret name in, excluding
// the docs themselves: a name that only the docs mention is drift.
export function repositoryNames(files, root = ".") {
  const corpus = files
    .filter((file) => !file.startsWith("docs/") && file !== "pnpm-lock.yaml")
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n");
  return (name) => corpus.includes(name);
}

// An active agent without a context file starts its next session blind, so the
// roster row and the file have to be created together.
export function activeRowsWithoutContext(rosterText) {
  // Only the Active table: the roster has other tables after it (Done, the
  // field reference), and scanning past them reports their headers as agents.
  const section = (rosterText.split(/\n## Active\b/)[1] ?? "").split(/\n## /)[0];
  const rows = section.split("\n").filter((line) => line.trim().startsWith("|"));
  return rows
    .slice(2) // header and separator
    .filter((row) => !row.includes("context/"))
    .map((row) => (row.split("|")[1] ?? "?").trim());
}

// A script nobody wrote down is a command only its author knows, and `AGENTS.md`
// already asks for README or docs to change with a command. This is what makes
// that true: every entry in `package.json` has to be named in some document, in
// either `pnpm <name>` or `pnpm run <name>` form.
const PNPM_SUBCOMMANDS = new Set(
  (
    "add audit bin config create dedupe deploy dlx doctor env exec fetch help i import init install " +
    "licenses link list ls outdated pack patch patch-commit prune publish rebuild remove rm root run " +
    "self-update server setup store uninstall unlink up update upgrade why"
  ).split(" "),
);

// The other direction of the same contract: a document naming a command the
// repository no longer has is a dead end that reads as current *because* it is
// written down, which is worse than an undocumented command. `pnpm <word>` is
// not always a script — pnpm has its own subcommands, and a flag or a placeholder
// (`pnpm <name>`) is not a reference — so only what is left has to resolve.
export function staleCommands(docsText, packageJsonText) {
  const scripts = new Set(Object.keys(JSON.parse(packageJsonText).scripts ?? {}));
  // Only code spans and fenced blocks: prose says "with pnpm 9" and "pnpm and
  // Prettier", and reading that as a command would fail on its own grammar.
  const snippets = [
    ...docsText.matchAll(/```[\s\S]*?```/g),
    ...docsText.matchAll(/`[^`\n]+`/g),
  ].map((match) => match[0]);
  const stale = new Set();
  for (const snippet of snippets) {
    for (const match of snippet.matchAll(/\bpnpm\s+(?:run\s+)?([^\s`"'()[\]]+)/g)) {
      const name = match[1].replace(/[.,;:!?]+$/, "");
      if (!name || name.startsWith("-") || /[<>{}]/.test(name)) continue;
      if (PNPM_SUBCOMMANDS.has(name) || scripts.has(name)) continue;
      stale.add(name);
    }
  }
  return [...stale].sort();
}

export function undocumentedScripts(packageJsonText, docsText) {
  const scripts = Object.keys(JSON.parse(packageJsonText).scripts ?? {});
  return scripts.filter(
    (name) => !docsText.includes(`pnpm ${name}`) && !docsText.includes(`pnpm run ${name}`),
  );
}

// The review window has to start somewhere, and "five changes" only counts if the
// commit the last record read is written down. Two sessions in a row noticed the
// trigger late because it was a judgement about whether enough had happened.
export function lastReviewSha(text) {
  return text.match(/Last review: `([0-9a-f]{7,40})`/)?.[1] ?? null;
}

const FORBIDDEN = [
  /^atv-config\.json$/,
  // A real env file, not a template: `.env.example`, `.env.sample` and
  // `.env.template` carry names only and are meant to be tracked.
  /(^|\/)\.env(\.(?!example$|sample$|template$)|$)/,
  // Wrangler's local secrets file, which `wrangler dev` loads. Its `.example`
  // template is tracked; anything else is a secret on disk.
  /(^|\/)\.dev\.vars(?!\.example$)(\.[^/]*)?$/,
  /\.(p12|jks|keystore|apk)$/,
];

export function forbiddenTracked(files) {
  return files.filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)));
}
