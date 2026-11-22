#!/usr/bin/env node
// Estimates this network's monthly usage against the Workers Paid inclusions.
//   node scripts/budget.mjs
//   node scripts/budget.mjs --tvs 10 --resolves 120
//   node scripts/budget.mjs --days 365
//
// It exits non-zero when a modelled metric would exceed the included allowance,
// so it can gate a deployment decision instead of only printing a table. The
// numbers are upper bounds: no CDN cache and no isolate memo is assumed.
import { estimate } from "./lib/budget.mjs";

const VALUE_FLAGS = {
  tvs: "tvs",
  days: "days",
  "guide-loads": "guideLoadsPerTvPerDay",
  resolves: "resolvesPerTvPerDay",
  "health-checks": "healthChecksPerDay",
  "cpu-ms": "cpuMsPerRequest",
  "do-gb-s": "doGbSecondsPerRequest",
};

const args = process.argv.slice(2);
const overrides = {};
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!arg.startsWith("--")) {
    console.error(`✗ Unexpected argument ${arg}`);
    process.exit(1);
  }
  const key = arg.slice(2);
  const target = VALUE_FLAGS[key];
  if (!target) {
    console.error(`✗ Unknown flag ${arg}`);
    process.exit(1);
  }
  const raw = args[++i];
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    console.error(`✗ ${arg} needs a non-negative number, got ${raw ?? "nothing"}`);
    process.exit(1);
  }
  overrides[target] = value;
}

const { inputs, rows, over } = estimate(overrides);

const num = (value) => Math.round(value).toLocaleString("en-US");
const pct = (share) => `${(share * 100).toFixed(share < 0.01 ? 2 : 1)}%`;

console.log("ATV budget model — Workers Paid ($5/month account minimum)");
console.log(
  `assumptions: ${inputs.tvs} TV(s), ${inputs.days} day(s), ` +
    `${inputs.guideLoadsPerTvPerDay} guide load(s)/TV/day, ` +
    `${inputs.resolvesPerTvPerDay} resolve(s)/TV/day, ` +
    `${inputs.healthChecksPerDay} health check(s)/day, ` +
    `cron ${inputs.cronRunsPerDay}x/day, ${inputs.cpuMsPerRequest} CPU ms/request`,
);
console.log();

const width = Math.max(...rows.map((row) => row.label.length));
console.log(
  `${"metric".padEnd(width)}  ${"used/month".padStart(12)}  ${"included".padStart(12)}  ${"share".padStart(7)}`,
);
for (const row of rows) {
  console.log(
    `${row.label.padEnd(width)}  ${num(row.used).padStart(12)}  ` +
      `${num(row.included).padStart(12)}  ${pct(row.share).padStart(7)}` +
      (row.share > 1 ? "  OVER" : ""),
  );
}
console.log();

if (over.length) {
  console.error(`✗ Over the included allowance: ${over.map((row) => row.label).join(", ")}`);
  console.error("  Reduce traffic, cache more, or accept the overage charge.");
  process.exit(1);
}
console.log("Within the included allowance — no charge beyond $5/month.");
