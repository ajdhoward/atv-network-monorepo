import { describe, expect, it } from "vitest";
import { DEFAULT_TTL_S, checkStreamTicket, signStreamUrl } from "../src/stream-sign";

const SECRET = "stream-signing-secret-4b2e";
const NOW = Date.UTC(2026, 10, 24, 12, 0, 0);

function parse(url: string) {
  const parsed = new URL(url, "https://atv.test");
  // Empty rather than null: a signed URL always has both, and the "missing"
  // cases pass their own nulls.
  return {
    path: parsed.pathname,
    exp: parsed.searchParams.get("exp") ?? "",
    sig: parsed.searchParams.get("sig") ?? "",
  };
}

describe("signStreamUrl", () => {
  it("signs a path a video element can use as-is", async () => {
    const url = await signStreamUrl("news-us", SECRET, { now: NOW });
    const { path, exp, sig } = parse(url);

    expect(path).toBe("/api/stream/news-us");
    expect(Number(exp)).toBe(Math.floor(NOW / 1000) + DEFAULT_TTL_S);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps an id with a slash in one segment and still signs the decoded id", async () => {
    const url = await signStreamUrl("news/us", SECRET, { now: NOW });
    const { path, exp, sig } = parse(url);

    expect(path).toBe("/api/stream/news%2Fus");
    expect(await checkStreamTicket({ id: "news/us", exp, sig, secret: SECRET, now: NOW })).toBe(
      "ok",
    );
  });

  it("honours a shorter ttl", async () => {
    const { exp } = parse(await signStreamUrl("news-us", SECRET, { now: NOW, ttlS: 60 }));

    expect(Number(exp)).toBe(Math.floor(NOW / 1000) + 60);
  });
});

describe("checkStreamTicket", () => {
  it("accepts the ticket it just signed", async () => {
    const { exp, sig } = parse(await signStreamUrl("news-us", SECRET, { now: NOW }));

    expect(await checkStreamTicket({ id: "news-us", exp, sig, secret: SECRET, now: NOW })).toBe(
      "ok",
    );
  });

  it("refuses a ticket past its expiry, and accepts it one second earlier", async () => {
    const { exp, sig } = parse(await signStreamUrl("news-us", SECRET, { now: NOW, ttlS: 60 }));

    expect(
      await checkStreamTicket({ id: "news-us", exp, sig, secret: SECRET, now: NOW + 60_000 }),
    ).toBe("expired");
    expect(
      await checkStreamTicket({ id: "news-us", exp, sig, secret: SECRET, now: NOW + 59_000 }),
    ).toBe("ok");
  });

  // The whole point of signing the id: one ticket is not a master key for the drive.
  it("refuses a ticket minted for another channel", async () => {
    const { exp, sig } = parse(await signStreamUrl("news-us", SECRET, { now: NOW }));

    expect(await checkStreamTicket({ id: "sport-uk", exp, sig, secret: SECRET, now: NOW })).toBe(
      "bad-signature",
    );
  });

  it("refuses an edited expiry, a truncated signature and another secret", async () => {
    const { exp, sig } = parse(await signStreamUrl("news-us", SECRET, { now: NOW }));
    const later = String(Number(exp) + 3600);

    expect(
      await checkStreamTicket({ id: "news-us", exp: later, sig, secret: SECRET, now: NOW }),
    ).toBe("bad-signature");
    expect(
      await checkStreamTicket({
        id: "news-us",
        exp,
        sig: sig.slice(0, -2),
        secret: SECRET,
        now: NOW,
      }),
    ).toBe("bad-signature");
    expect(
      await checkStreamTicket({ id: "news-us", exp, sig, secret: "another-secret", now: NOW }),
    ).toBe("bad-signature");
  });

  it("separates a missing parameter, a non-integer expiry and no secret", async () => {
    const { exp, sig } = parse(await signStreamUrl("news-us", SECRET, { now: NOW }));

    expect(await checkStreamTicket({ id: "news-us", exp: null, sig, secret: SECRET })).toBe(
      "missing",
    );
    expect(await checkStreamTicket({ id: "news-us", exp, sig: null, secret: SECRET })).toBe(
      "missing",
    );
    expect(await checkStreamTicket({ id: "news-us", exp: "tomorrow", sig, secret: SECRET })).toBe(
      "bad-signature",
    );
    // A deployment without the secret is misconfigured, not under attack.
    expect(await checkStreamTicket({ id: "news-us", exp, sig, secret: undefined })).toBe(
      "unconfigured",
    );
    expect(await checkStreamTicket({ id: "news-us", exp, sig, secret: "   " })).toBe(
      "unconfigured",
    );
  });
});
