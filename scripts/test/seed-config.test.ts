import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const seed = resolve("scripts/seed-kv.mjs");
const dir = mkdtempSync(join(tmpdir(), "atv-seed-config-"));
let lineup = "";
let sandboxConfig = "";
let productionConfig = "";

const PROD_CACHE = "7e635f2e4ac44488a336f9d509b63061";
const PROD_CONFIG = "a59048e76fbd47c185bd4fc62fc3111a";
const CUTOVER_CONFIG = "0123456789abcdef0123456789abcdef";

beforeAll(() => {
  lineup = join(dir, "atv-config.json");
  writeFileSync(
    lineup,
    JSON.stringify({
      version: 1,
      channels: [{ id: "atv-1", name: "One" }],
      gdrive_map: { "atv-1": "https://cdn.example/a.m3u8" },
    }),
  );

  // A cutover target: new name, new namespaces, not production KV.
  sandboxConfig = join(dir, "wrangler.cutover.toml");
  writeFileSync(
    sandboxConfig,
    [
      'name = "atv-core-prod"',
      "[[kv_namespaces]]",
      'binding = "ATV_CACHE"',
      `id = "${CUTOVER_CONFIG}"`,
      "[[kv_namespaces]]",
      'binding = "ATV_CONFIG"',
      `id = "${CUTOVER_CONFIG}"`,
      "",
    ].join("\n"),
  );

  // A config that would write into the live namespaces.
  productionConfig = join(dir, "wrangler.production.toml");
  writeFileSync(
    productionConfig,
    [
      'name = "atv-core-orchestrator"',
      "[[kv_namespaces]]",
      'binding = "ATV_CACHE"',
      `id = "${PROD_CACHE}"`,
      "[[kv_namespaces]]",
      'binding = "ATV_CONFIG"',
      `id = "${PROD_CONFIG}"`,
      "",
    ].join("\n"),
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(argv: string[]) {
  return spawnSync(process.execPath, [seed, "--file", lineup, ...argv], {
    encoding: "utf8",
    env: { ...process.env, ATV_ALLOW_SHARED_KV: "" },
  });
}

describe("seed-kv --config", () => {
  it("prints put commands against the given config", () => {
    const result = run(["--dry-run", "--config", sandboxConfig]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`--config ${sandboxConfig}`);
    expect(result.stdout).not.toContain("--config wrangler.toml");
    expect(result.stdout).toContain("ATV_CONFIG/channels");
  });

  it("still defaults to wrangler.toml", () => {
    const result = run(["--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--config wrangler.toml");
  });

  it("refuses a config bound to production KV", () => {
    const result = run(["--config", productionConfig]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${productionConfig} still binds production KV`);
    expect(result.stderr).toContain(PROD_CACHE);
    // The guard runs before any upload: nothing was written.
    expect(result.stdout).not.toContain("→ ATV_CONFIG/");
  });

  it("fails clearly when the config cannot be read", () => {
    const missing = join(dir, "nope.toml");
    const result = run(["--config", missing]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Cannot read ${missing}`);
  });
});
