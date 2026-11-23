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

const FORBIDDEN = [/^atv-config\.json$/, /(^|\/)\.env(\.|$)/, /\.(p12|jks|keystore|apk)$/];

export function forbiddenTracked(files) {
  return files.filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)));
}
