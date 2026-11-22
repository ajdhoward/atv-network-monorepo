import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const validate = resolve("scripts/validate-config.mjs");
const dir = mkdtempSync(join(tmpdir(), "atv-config-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// The smallest config the validator accepts; each case varies one field.
const base = {
  version: 1,
  gdrive: { identsFolder: "folder" },
  channels: [{ id: "atv-1" }],
};

let files = 0;
function config(overrides: Record<string, unknown>): string {
  files += 1;
  const path = join(dir, `config-${files}.json`);
  writeFileSync(path, JSON.stringify({ ...base, ...overrides }));
  return path;
}

function run(path: string) {
  return spawnSync(process.execPath, [validate, path], { encoding: "utf8" });
}

describe("validate-config gdrive_map", () => {
  it("accepts an https link for a channel", () => {
    const result = run(config({ gdrive_map: { "atv-1": "https://cdn.example/a.m3u8" } }));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Config valid");
  });

  it("accepts a config with no gdrive_map at all", () => {
    expect(run(config({})).status).toBe(0);
  });

  it("rejects a non-https link and names the id", () => {
    const result = run(config({ gdrive_map: { "atv-1": "http://cdn.example/a.m3u8" } }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("gdrive_map.atv-1 must be an https url");
  });

  it("rejects a non-string link", () => {
    const result = run(config({ gdrive_map: { "atv-1": 42 } }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("gdrive_map.atv-1 must be an https url");
  });

  it("rejects an array where the map belongs", () => {
    const result = run(config({ gdrive_map: ["https://cdn.example/a.m3u8"] }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("gdrive_map must be an object");
  });

  it("rejects a null map instead of letting it through", () => {
    const result = run(config({ gdrive_map: null }));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("gdrive_map must be an object");
  });

  it("reports every bad link, not just the first", () => {
    const result = run(
      config({ gdrive_map: { "atv-1": "ftp://a", "atv-2": "http://b", "atv-3": "https://ok" } }),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("gdrive_map.atv-1");
    expect(result.stderr).toContain("gdrive_map.atv-2");
    expect(result.stderr).not.toContain("gdrive_map.atv-3");
  });
});
