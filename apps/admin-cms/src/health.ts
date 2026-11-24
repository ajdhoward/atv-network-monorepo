import type { HealthPayload, ResolveCoverage } from "@atv/ui-shared";

// Shown under the Drive proxy line rather than in `problems`: it explains the
// state beside it instead of reporting a second, separate fault.
export const DRIVE_PROXY_OFF_NOTE =
  "No signing key, so Drive channels resolve to their stored link.";

export type HealthSummary = {
  reachable: boolean;
  status: "ok" | "degraded" | "unreachable";
  channels: number;
  links: ResolveCoverage;
  // Whether the Drive proxy has its signing key. `unknown` is an older
  // deployment that does not report the field, never an assumption that the
  // proxy is off: the panel must not blame a key it cannot see.
  driveProxy: "live" | "off" | "unknown";
  driveProxyNote: string | null;
  // Whether "enforcement" has a token to enforce. `unset` is the expected state
  // until R8 sets the secret, so it is shown but never reported as a problem:
  // an amber warning there would train the operator to ignore the page.
  householdToken: "set" | "unset" | "unknown";
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
      driveProxy: "unknown",
      driveProxyNote: null,
      householdToken: "unknown",
      problems: ["Health check did not answer"],
    };
  }
  // A deployment older than the coverage field simply reports zero counts
  // rather than crashing the panel.
  const links: ResolveCoverage = { ...NO_LINKS, ...health.resolve };
  const driveProxy =
    typeof health.streamSigningKeySet === "boolean"
      ? health.streamSigningKeySet
        ? "live"
        : "off"
      : "unknown";
  const driveProxyNote = driveProxy === "off" ? DRIVE_PROXY_OFF_NOTE : null;
  const householdToken =
    typeof health.deviceTokenSet === "boolean"
      ? health.deviceTokenSet
        ? "set"
        : "unset"
      : "unknown";
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
    driveProxy,
    driveProxyNote,
    householdToken,
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
