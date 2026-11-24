import { describe, expect, it } from "vitest";
import { bearerToken, checkDeviceToken } from "../src/device-token";

const TOKEN = "household-secret-7f3a";

describe("bearerToken", () => {
  it("reads the credential out of the scheme", () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerToken(`  BEARER   ${TOKEN}  `)).toBe(TOKEN);
  });

  it("treats a missing, empty or foreign header as no token", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("   ")).toBeNull();
    expect(bearerToken("Basic dXNlcjpwYXNz")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer   ")).toBeNull();
  });

  // A value with a space in it is not what `wrangler secret put` produces; reading
  // half of it would turn one wrong guess into a partial match.
  it("does not split a value that contains spaces", () => {
    expect(bearerToken("Bearer two words")).toBeNull();
  });
});

describe("checkDeviceToken", () => {
  // The trap the runbook warns about, and the reason it now recommends a token with
  // no whitespace: `Bearer` carries one token, so a secret with a space in it can
  // never be presented. Today that is a plain `reject`, which the TV can only report
  // as "that token was not accepted" even though the value is right; Q10 proposes
  // the deployment's own answer for it.
  it("rejects a secret that cannot be presented as one token", async () => {
    expect(await checkDeviceToken("Bearer correct horse battery", "correct horse battery")).toBe(
      "reject",
    );
  });

  it("does not enforce while the deployment has no token", async () => {
    expect(await checkDeviceToken(null, undefined)).toBe("unenforced");
    expect(await checkDeviceToken("Bearer anything", "")).toBe("unenforced");
    expect(await checkDeviceToken(null, "   ")).toBe("unenforced");
  });

  it("allows the household token", async () => {
    expect(await checkDeviceToken(`Bearer ${TOKEN}`, TOKEN)).toBe("allow");
    // A secret copy-pasted with a trailing newline must still match.
    expect(await checkDeviceToken(`Bearer ${TOKEN}`, `${TOKEN}\n`)).toBe("allow");
  });

  it("rejects a wrong token, including one that shares a prefix", async () => {
    expect(await checkDeviceToken("Bearer household-secret-7f3b", TOKEN)).toBe("reject");
    expect(await checkDeviceToken("Bearer household-secret", TOKEN)).toBe("reject");
    // The scheme is case-insensitive; the secret is not.
    expect(await checkDeviceToken(`Bearer ${TOKEN.toUpperCase()}`, TOKEN)).toBe("reject");
  });

  it("rejects a missing or malformed authorization header", async () => {
    expect(await checkDeviceToken(null, TOKEN)).toBe("reject");
    expect(await checkDeviceToken("", TOKEN)).toBe("reject");
    expect(await checkDeviceToken(`Basic ${TOKEN}`, TOKEN)).toBe("reject");
    expect(await checkDeviceToken("Bearer", TOKEN)).toBe("reject");
  });

  it("answers with a verdict and never with the token", async () => {
    const verdict = await checkDeviceToken(`Bearer ${TOKEN}`, TOKEN);

    expect(["allow", "reject", "unenforced"]).toContain(verdict);
    expect(String(verdict)).not.toContain(TOKEN);
  });
});
