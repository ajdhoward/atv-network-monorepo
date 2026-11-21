import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const guard = resolve("scripts/check-deploy-target.mjs");
const dir = mkdtempSync(join(tmpdir(), "atv-guard-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function config(name: string, kvId: string): string {
  const path = join(dir, `${name}-${kvId.slice(0, 4)}.toml`);
  writeFileSync(
    path,
    [
      `name = "${name}"`,
      'main = "services/atv-core/src/index.ts"',
      "[[kv_namespaces]]",
      'binding = "ATV_CACHE"',
      `id = "${kvId}"`,
      "",
    ].join("\n"),
  );
  return path;
}

function run(path: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [guard, path], {
    encoding: "utf8",
    env: { ...process.env, ATV_ALLOW_PROD_DEPLOY: "", ATV_ALLOW_SHARED_KV: "", ...env },
  });
}

const PRODUCTION_ID = "7e635f2e4ac44488a336f9d509b63061";
const STAGING_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("check-deploy-target", () => {
  it("allows the sandbox worker with staging KV", () => {
    const result = run(config("atv-core-v2", STAGING_ID));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("atv-core-v2");
  });

  it("refuses the sandbox while it still binds production KV", () => {
    const result = run(config("atv-core-v2", PRODUCTION_ID));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("production KV bindings");
  });

  it("allows shared KV only with the override", () => {
    const result = run(config("atv-core-v2", PRODUCTION_ID), { ATV_ALLOW_SHARED_KV: "1" });
    expect(result.status).toBe(0);
  });

  it("refuses the production worker", () => {
    const result = run(config("atv-core-orchestrator", STAGING_ID));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("refusing to deploy to production");
  });

  it("allows production only with ATV_ALLOW_PROD_DEPLOY=1", () => {
    const result = run(config("atv-core-orchestrator", STAGING_ID), {
      ATV_ALLOW_PROD_DEPLOY: "1",
    });
    expect(result.status).toBe(0);
  });

  it("fails when the config is missing", () => {
    const result = run(join(dir, "does-not-exist.toml"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot read");
  });
});
