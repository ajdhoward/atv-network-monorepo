import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The command is exercised the way the operator runs it, matching the other
// script suites: no import of an untyped .mjs helper into the typed project.
const cli = path.resolve("scripts/handoff.mjs");

function workdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "atv-handoff-"));
}

function write(dir: string, name: string, contents: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

function run(argv: string[], cwd: string) {
  return spawnSync(process.execPath, [cli, ...argv], { cwd, encoding: "utf8" });
}

const VALID = `# z.ai handoff

Name: Z.ai
Tool: GLM
Roles: Author, Reviewer
Paths: services/atv-core/src, services/atv-core/test
Task: Build the Google Drive stream proxy behind signed URLs.
Date: 2026-11-23

## What I read
AGENTS.md, docs/agents/roster.md, docs/agents/decisions.md, docs/agents/backlog.md

## What I propose
P1, the Drive proxy, with Range passthrough and a signature that expires.

## Objections
None.
`;

describe("handoff command", () => {
  it("validates a filled template and prints the destination", () => {
    const dir = workdir();
    const file = write(dir, "sample.md", VALID);
    const result = run([file, "--dry-run"], dir);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("lands: docs/agents/handoffs/z-ai.md");
    expect(result.stdout).toContain("Build the Google Drive stream proxy");
    expect(result.stdout).toContain("nothing written");
    expect(fs.existsSync(path.join(dir, "docs"))).toBe(false);
  });

  it("writes the file under the derived slug, then refuses a duplicate", () => {
    const dir = workdir();
    const file = write(dir, "atv-agent-Zed.md", VALID.replace("Name: Z.ai", "Name: atv-agent-Zed"));
    const first = run([file], dir);
    expect(first.status).toBe(0);
    const target = path.join(dir, "docs", "agents", "handoffs", "zed.md");
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.readFileSync(target, "utf8")).toContain("Name: atv-agent-Zed");

    const second = run([file], dir);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("already exists");
  });

  it("names every missing field instead of writing a half-filled handoff", () => {
    const dir = workdir();
    const file = write(dir, "thin.md", "# x\n\nName: X\n");
    const result = run([file], dir);
    expect(result.status).toBe(1);
    for (const field of ["'tool:'", "'roles:'", "'paths:'", "'task:'"]) {
      expect(result.stderr).toContain(field);
    }
    expect(fs.existsSync(path.join(dir, "docs"))).toBe(false);
  });

  it("rejects a credential rather than trusting the agent to have removed it", () => {
    const dir = workdir();
    const file = write(dir, "leaky.md", `${VALID}\nghp_${"a".repeat(30)}\n`);
    const result = run([file], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("credential");
    expect(fs.existsSync(path.join(dir, "docs"))).toBe(false);
  });

  it("rejects roles a guest agent does not hold", () => {
    const dir = workdir();
    const file = write(dir, "wrong-roles.md", VALID.replace("Author, Reviewer", "Sentinel"));
    const result = run([file], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Author and/or Reviewer");
  });

  it("refuses an unreadable path with a message a person can act on", () => {
    const dir = workdir();
    const result = run([path.join(dir, "missing.md")], dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot read");
  });
});
