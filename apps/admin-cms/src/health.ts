import type { HealthPayload, ResolveCoverage } from "@atv/ui-shared";

export type HealthSummary = {
  reachable: boolean;
  status: "ok" | "degraded" | "unreachable";
  channels: number;
  links: ResolveCoverage;
  problems: string[];
};

const NO_LINKS: ResolveCoverage = { configured: 0, invalid: 0, missing: 0 };

// Turns a health payload into what the panel shows. Kept free of React and of
// the network so the wording and the degraded rules can be tested directly.
// Nothing here includes a stream link: the worker only ever sends counts.
export function summariseHealth(health: HealthPayload | null): HealthSummary {
  if (!health) {
    return {
      reachable: false,
      status: "unreachable",
      channels: 0,
      links: { ...NO_LINKS },
      problems: ["Health check did not answer"],
    };
  }
  // A deployment older than the coverage field simply reports zero counts
  // rather than crashing the panel.
  const links: ResolveCoverage = { ...NO_LINKS, ...health.resolve };
  const problems: string[] = [];
  if (!health.config.seeded) problems.push("Lineup is not seeded");
  if (health.config.schemaMatches === false) {
    problems.push("Stored config uses a schema version this worker does not serve");
  }
  if (health.config.checksumMatches === false) {
    problems.push("Stored channels differ from the seed config");
  }
  if (links.invalid > 0) {
    problems.push(`${links.invalid} channel(s) have a link that is not a usable https URL`);
  }
  if (links.missing > 0) {
    problems.push(`${links.missing} channel(s) have no stream link`);
  }
  return {
    reachable: true,
    status: health.status,
    channels: health.config.channels,
    links,
    problems,
  };
}

// Reads /api/health from whatever origin serves the panel. Returns null on any
// failure so the panel can say "unreachable" instead of showing stale numbers.
export async function fetchHealth(
  fetchImpl: typeof fetch = fetch,
  path = "/api/health",
): Promise<HealthPayload | null> {
  try {
    const res = await fetchImpl(path, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as HealthPayload | null;
    if (!body || typeof body !== "object" || !body.config || !body.status) return null;
    return body;
  } catch {
    return null;
  }
}
