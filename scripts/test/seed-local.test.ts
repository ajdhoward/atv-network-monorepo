import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const seed = resolve("scripts/seed-kv.mjs");
const dir = mkdtempSync(join(tmpdir(), "atv-seed-"));
let config = "";

beforeAll(() => {
  config = join(dir, "atv-config.json");
  writeFileSync(
    config,
    JSON.stringify({
      version: 1,
      channels: [{ id: "atv-1", name: "One" }],
      gdrive_map: { "atv-1": "https://cdn.example/a.m3u8" },
    }),
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(argv: string[]) {
  return spawnSync(process.execPath, [seed, "--dry-run", "--file", config, ...argv], {
    encoding: "utf8",
    env: { ...process.env, ATV_ALLOW_SHARED_KV: "" },
  });
}

describe("seed-kv --local", () => {
  it("targets the local store instead of remote KV", () => {
    const result = run(["--local"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--local");
    expect(result.stdout).not.toContain("--remote");
    // The keys the Worker reads are all covered.
    for (const key of ["channels", "system_config", "config_meta", "gdrive_map"]) {
      expect(result.stdout).toContain(`ATV_CONFIG/${key}`);
    }
  });

  it("still writes remote KV without the flag", () => {
    const result = run([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--remote");
    expect(result.stdout).not.toContain("--local");
  });
});
