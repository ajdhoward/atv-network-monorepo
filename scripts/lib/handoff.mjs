// Rules for the file an agent sends when it has no way into the repository.
// Kept apart from the CLI so the shape and the safety checks are testable
// without touching disk.

export const REQUIRED_FIELDS = ["name", "tool", "roles", "paths", "task"];
export const MAX_BYTES = 20 * 1024;

// A handoff file is exactly the kind of paste that carries a credential by
// accident, and this repository is public. Reject rather than warn.
export const CREDENTIAL_PATTERN =
  /(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,}|tb_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;

export function fieldValue(text, field) {
  const pattern = new RegExp(`^\\s*(?:[-*]\\s*)?${field}\\s*:\\s*(.+)$`, "im");
  const match = text.match(pattern);
  return match ? match[1].trim() : "";
}

export function validateHandoff(text) {
  const problems = [];
  const bytes = Buffer.byteLength(text, "utf8");
  if (!text.trim()) problems.push("the file is empty");
  if (bytes > MAX_BYTES) {
    problems.push(`the file is ${bytes} bytes; keep it under ${MAX_BYTES}`);
  }
  if (CREDENTIAL_PATTERN.test(text)) {
    problems.push(
      "the file contains something that looks like a credential; remove it and send it separately",
    );
  }
  if (!/^#\s+\S/m.test(text)) {
    problems.push("start with a '# <name> handoff' heading");
  }
  for (const field of REQUIRED_FIELDS) {
    if (!fieldValue(text, field)) problems.push(`missing the '${field}:' line`);
  }
  const roles = fieldValue(text, "roles").toLowerCase();
  if (roles && !roles.includes("author") && !roles.includes("reviewer")) {
    problems.push("roles must name Author and/or Reviewer, which is all a guest agent holds");
  }
  return { ok: problems.length === 0, problems, bytes };
}

// The file name is the agent's identity in the repository, so normalise it
// instead of trusting a path: `Atv Agent Z.ai!.md` becomes `z-ai`.
export function slugFor(name, fallback = "") {
  return (name || fallback)
    .replace(/^atv-agent-/i, "")
    .replace(/\.md$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function handoffPath(slug) {
  return `docs/agents/handoffs/${slug}.md`;
}
