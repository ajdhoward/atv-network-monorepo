import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cli = resolve("scripts/budget.mjs");

function run(argv: string[]) {
  return spawnSync(process.execPath, [cli, ...argv], { encoding: "utf8" });
}

describe("budget", () => {
  it("models one TV for one day with no cache hits", () => {
    const result = run([
      "--tvs",
      "1",
      "--days",
      "1",
      "--guide-loads",
      "2",
      "--resolves",
      "40",
      "--health-checks",
      "0",
    ]);
    expect(result.status).toBe(0);
    // 2 guide loads + 40 resolves, no health checks.
    expect(result.stdout).toMatch(/Worker requests\s+42\s/);
    // 2 guide builds read two keys each, plus one read per resolve.
    expect(result.stdout).toMatch(/KV reads\s+44\s/);
    // The cron snapshot writes once per run.
    expect(result.stdout).toMatch(/KV writes\s+144\s/);
    // The limiter object is asked once per resolve.
    expect(result.stdout).toMatch(/DO requests\s+40\s/);
    expect(result.stdout).toContain("Within the included allowance");
  });

  it("keeps the household defaults well inside every allowance", () => {
    const result = run([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Within the included allowance");
    expect(result.stdout).not.toContain("OVER");
  });

  it("fails and names the metric when traffic would leave the plan", () => {
    const result = run(["--tvs", "10000", "--days", "30"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Over the included allowance");
    expect(result.stdout).toMatch(/DO requests\s+[\d,]+\s+1,000,000\s+[\d.]+%\s+OVER/);
  });

  it("rejects an unknown flag and a non-numeric value", () => {
    expect(run(["--nope"]).status).toBe(1);
    expect(run(["--tvs", "three"]).status).toBe(1);
  });
});
