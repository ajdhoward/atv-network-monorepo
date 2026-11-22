// Traffic model for the Workers Paid plan, so a change that would leave the
// included allowance is visible before it ships rather than on an invoice.
//
// Allowances checked 2026-11-22 against Cloudflare's published pricing:
//   Workers  https://developers.cloudflare.com/workers/platform/pricing
//   KV       https://developers.cloudflare.com/kv/platform/pricing
//   DO       https://developers.cloudflare.com/durable-objects/platform/pricing
//
// Workers Paid is a $5/month account minimum with these monthly inclusions.
// Static asset requests are free and unlimited, so they are not counted here.
// Analytics Engine is not modelled: the dataset is optional, and its included
// volume is far above anything this Worker writes at 10% log sampling.
export const PLAN = {
  requests: 10_000_000,
  cpuMs: 30_000_000,
  kvReads: 10_000_000,
  kvWrites: 1_000_000,
  doRequests: 1_000_000,
  doGs: 400_000,
};

// Defaults describe a household network: a handful of TVs that load the guide a
// couple of times a day and resolve a channel now and then, plus a 5-minute
// health monitor. The cron trigger fires every 10 minutes (wrangler.toml).
export const DEFAULTS = {
  tvs: 3,
  days: 30,
  guideLoadsPerTvPerDay: 2,
  resolvesPerTvPerDay: 40,
  healthChecksPerDay: 288,
  cronRunsPerDay: 144,
  cpuMsPerRequest: 2,
  // One Durable Object call is a few milliseconds in a small isolate; 0.05 GB-s
  // is deliberately generous, since the counter object holds no state beyond one
  // number and an alarm.
  doGbSecondsPerRequest: 0.05,
};

// Reads are deliberately modelled with no cache: the guide memoises for 30 s and
// the edge caches it, KV reads are memoised per isolate for 60 s, so these are
// upper bounds rather than expectations.
export function estimate(overrides = {}) {
  const i = { ...DEFAULTS, ...overrides };
  const guideRequests = i.tvs * i.guideLoadsPerTvPerDay * i.days;
  const resolveRequests = i.tvs * i.resolvesPerTvPerDay * i.days;
  const healthRequests = i.healthChecksPerDay * i.days;
  const requests = guideRequests + resolveRequests + healthRequests;
  // A guide build reads channels + config_meta; health reads config_meta,
  // channels and the snapshot; a resolve reads gdrive_map.
  const kvReads = guideRequests * 2 + resolveRequests + healthRequests * 3;

  const usage = {
    requests,
    cpuMs: requests * i.cpuMsPerRequest,
    kvReads,
    kvWrites: i.cronRunsPerDay * i.days,
    doRequests: resolveRequests,
    doGs: resolveRequests * i.doGbSecondsPerRequest,
  };

  const labels = {
    requests: "Worker requests",
    cpuMs: "CPU time (ms)",
    kvReads: "KV reads",
    kvWrites: "KV writes",
    doRequests: "DO requests",
    doGs: "DO duration (GB-s)",
  };

  const rows = Object.keys(usage).map((metric) => ({
    metric,
    label: labels[metric],
    used: usage[metric],
    included: PLAN[metric],
    share: usage[metric] / PLAN[metric],
  }));

  const over = rows.filter((row) => row.share > 1);
  return { inputs: i, rows, over, within: over.length === 0 };
}
