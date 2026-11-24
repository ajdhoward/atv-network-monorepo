import { describe, expect, it, vi } from "vitest";
import type { HealthPayload } from "@atv/ui-shared";
import { DRIVE_PROXY_OFF_NOTE, fetchHealth, summariseHealth } from "../src/health";

function health(over: Partial<HealthPayload> = {}): HealthPayload {
  return {
    status: "ok",
    schemaVersion: 1,
    config: {
      seeded: true,
      channels: 12,
      updatedAt: "2026-11-22T00:00:00.000Z",
      schemaMatches: true,
      checksumMatches: true,
    },
    resolve: { configured: 12, invalid: 0, missing: 0 },
    guideSnapshot: { generatedAt: 1_700_000_000_000, total: 12 },
    ...over,
  };
}

describe("summariseHealth", () => {
  it("reports a fully configured worker as ok with no problems", () => {
    const summary = summariseHealth(health());
    expect(summary.status).toBe("ok");
    expect(summary.reachable).toBe(true);
    expect(summary.channels).toBe(12);
    expect(summary.links).toEqual({ configured: 12, invalid: 0, missing: 0 });
    expect(summary.problems).toEqual([]);
  });

  it("lists channels with no link", () => {
    const summary = summariseHealth(
      health({ status: "degraded", resolve: { configured: 2, invalid: 0, missing: 10 } }),
    );
    expect(summary.status).toBe("degraded");
    expect(summary.problems).toContain("10 channel(s) have no stream link");
  });

  it("lists links that are not usable https URLs", () => {
    const summary = summariseHealth(
      health({ resolve: { configured: 11, invalid: 1, missing: 0 } }),
    );
    expect(summary.problems).toContain("1 channel(s) have a link that is not a usable https URL");
  });

  it("explains an unseeded lineup", () => {
    const summary = summariseHealth(
      health({
        status: "degraded",
        config: {
          seeded: false,
          channels: 0,
          updatedAt: null,
          schemaMatches: null,
          checksumMatches: null,
        },
        resolve: { configured: 0, invalid: 0, missing: 0 },
      }),
    );
    expect(summary.problems).toContain("Lineup is not seeded");
  });

  it("explains a schema mismatch", () => {
    const summary = summariseHealth(
      health({
        status: "degraded",
        config: {
          seeded: true,
          channels: 12,
          updatedAt: null,
          schemaMatches: false,
          checksumMatches: true,
        },
      }),
    );
    expect(summary.problems).toContain(
      "Stored config uses a schema version this worker does not serve",
    );
  });

  it("explains channels that drifted from the seed", () => {
    const summary = summariseHealth(
      health({
        config: {
          seeded: true,
          channels: 12,
          updatedAt: null,
          schemaMatches: true,
          checksumMatches: false,
        },
      }),
    );
    expect(summary.problems).toContain("Stored channels differ from the seed config");
  });

  it("treats a missing payload as unreachable", () => {
    const summary = summariseHealth(null);
    expect(summary).toMatchObject({
      reachable: false,
      status: "unreachable",
      channels: 0,
      problems: ["Health check did not answer"],
    });
  });

  it("reports the Drive proxy live when the signing key is set", () => {
    const summary = summariseHealth(health({ streamSigningKeySet: true }));
    expect(summary.driveProxy).toBe("live");
    expect(summary.driveProxyNote).toBeNull();
    expect(summary.problems).toEqual([]);
  });

  it("explains a proxy with no signing key beside the state, not as a problem", () => {
    const summary = summariseHealth(health({ streamSigningKeySet: false }));
    expect(summary.driveProxy).toBe("off");
    expect(summary.driveProxyNote).toBe(DRIVE_PROXY_OFF_NOTE);
    expect(summary.problems).toEqual([]);
  });

  it("does not guess about a deployment that never reports the flag", () => {
    const summary = summariseHealth(health());
    expect(summary.driveProxy).toBe("unknown");
    expect(summary.driveProxyNote).toBeNull();
    expect(summary.problems).toEqual([]);
  });

  it("reads the household token flag neutrally", () => {
    expect(summariseHealth(health({ deviceTokenSet: true })).householdToken).toBe("set");
    const unset = summariseHealth(health({ deviceTokenSet: false }));
    expect(unset.householdToken).toBe("unset");
    // The rollout order (R8) makes an unset token correct until enforcement
    // lands, so this is a state to show, never a problem to report.
    expect(unset.problems).toEqual([]);
    expect(summariseHealth(health()).householdToken).toBe("unknown");
  });

  it("tolerates a deployment without link counts", () => {
    const old = health();
    delete (old as { resolve?: unknown }).resolve;
    const summary = summariseHealth(old);
    expect(summary.links).toEqual({ configured: 0, invalid: 0, missing: 0 });
  });

  it("never puts a URL in what it shows", () => {
    const summary = summariseHealth(
      health({ resolve: { configured: 0, invalid: 2, missing: 10 } }),
    );
    for (const problem of summary.problems) expect(problem).not.toMatch(/https?:\/\//);
  });
});

describe("fetchHealth", () => {
  it("returns the payload from a healthy worker", async () => {
    const body = health();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    await expect(fetchHealth(fetchImpl as unknown as typeof fetch)).resolves.toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("returns null when the worker answers an error", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));
    await expect(fetchHealth(fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
  });

  it("returns null when the body is not a health payload", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ hello: "world" })));
    await expect(fetchHealth(fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
  });

  it("returns null when the request throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(fetchHealth(fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
  });
});
