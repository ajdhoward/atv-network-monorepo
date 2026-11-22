import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const dev = resolve("scripts/dev.mjs");

// atv-config.json is gitignored, so a clean checkout (CI) has no lineup. The
// test must not depend on the machine having one.
const dir = mkdtempSync(join(tmpdir(), "atv-dev-"));
const lineup = join(dir, "lineup.json");
writeFileSync(lineup, JSON.stringify({ version: 1, channels: [{ id: "atv-1" }] }));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(argv: string[]) {
  return spawnSync(process.execPath, [dev, ...argv], { encoding: "utf8" });
}

describe("dev", () => {
  it("dry-run seeds the local store and then starts the worker", () => {
    const result = run(["--dry-run", "--file", lineup]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`seed-kv.mjs --local --file ${lineup}`);
    expect(result.stdout).toContain("wrangler dev --local --config wrangler.toml --port 8788");
  });

  it("honours --port and --no-seed", () => {
    const result = run(["--dry-run", "--no-seed", "--port", "9099"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("seed-kv.mjs");
    expect(result.stdout).toContain("--port 9099");
  });

  it("does not try to seed a lineup that is not there", () => {
    const result = run(["--dry-run", "--file", join(dir, "missing.json")]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("seed-kv.mjs");
    expect(result.stdout).toContain("wrangler dev");
  });
});
