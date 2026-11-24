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
  // Q10: `Bearer` carries one token, so a secret with a space inside it can never
  // be presented. Answering `reject` told every TV with the right value that it was
  // wrong; the deployment is what needs fixing, so it has its own verdict.
  it("names a secret that cannot be presented as one token", async () => {
    expect(await checkDeviceToken("Bearer correct horse battery", "correct horse battery")).toBe(
      "unpresentable",
    );
    // Even with no header at all: the fault is the secret, not the caller.
    expect(await checkDeviceToken(null, "correct horse battery")).toBe("unpresentable");
  });

  // Whitespace at the ends is what a copy-paste produces and the trim already
  // handles it, so it must stay an ordinary token rather than a 503.
  it("still accepts a secret whose only whitespace is at the ends", async () => {
    expect(await checkDeviceToken(`Bearer ${TOKEN}`, `  ${TOKEN}\n`)).toBe("allow");
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
