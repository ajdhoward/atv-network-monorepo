import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { CONFIG_SCHEMA_VERSION, checksum } from "../../services/atv-core/src/config-meta";

// One contract, two copies. The Worker refuses a lineup whose schema version it
// does not know and warns whenever the checksum it computes differs from the one
// the seed wrote, so `scripts/lib/config-meta.mjs` has to stay equivalent to
// `services/atv-core/src/config-meta.ts` — and nothing compared them until this
// test. A drift does not fail a build: it warns on every guide request against a
// deployment that looks seeded, which is the quiet kind of wrong.
//
// The helper is plain ESM the typed project cannot import, so it is asked in a
// child process rather than declared. `scripts/test/` already drives its scripts
// that way.
const helper = pathToFileURL(resolve("scripts/lib/config-meta.mjs")).href;

const samples: unknown[] = [
  { version: 1, channels: [{ id: "atv-1", name: "One" }] },
  { version: 1, channels: [], gdrive_map: { "atv-1": "https://example.invalid/a.m3u8" } },
  "a string, not an object",
  null,
  [1, 2, 3],
  { unicode: "naïve — ✨", nested: { deep: true } },
];

function fromHelper(): { version: unknown; sums: string[] } {
  const script = [
    `const mod = await import(${JSON.stringify(helper)});`,
    `const samples = ${JSON.stringify(samples)};`,
    "console.log(JSON.stringify({ version: mod.CONFIG_SCHEMA_VERSION, sums: samples.map((v) => mod.configChecksum(v)) }));",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe("config meta parity (worker ↔ seed)", () => {
  it("agrees on the schema version", () => {
    expect(fromHelper().version).toBe(CONFIG_SCHEMA_VERSION);
  });

  it("computes the same checksum as the seed script", () => {
    const { sums } = fromHelper();
    expect(sums).toEqual(samples.map((value) => checksum(value)));
  });
});
