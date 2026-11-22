import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dev = resolve("scripts/dev.mjs");

function run(argv: string[]) {
  return spawnSync(process.execPath, [dev, ...argv], { encoding: "utf8" });
}

describe("dev", () => {
  it("dry-run seeds the local store and then starts the worker", () => {
    const result = run(["--dry-run", "--file", "atv-config.json"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("seed-kv.mjs --local --file atv-config.json");
    expect(result.stdout).toContain("wrangler dev --local --config wrangler.toml --port 8788");
  });

  it("honours --port and --no-seed", () => {
    const result = run(["--dry-run", "--no-seed", "--port", "9099"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("seed-kv.mjs");
    expect(result.stdout).toContain("--port 9099");
  });

  it("does not try to seed a lineup that is not there", () => {
    const result = run(["--dry-run", "--file", "does-not-exist.json"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("seed-kv.mjs");
    expect(result.stdout).toContain("wrangler dev");
  });
});
