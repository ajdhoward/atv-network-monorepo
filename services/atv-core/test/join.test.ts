import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import worker from "../src/index";
import { repoUrl } from "../src/join";

function makeEnv(username = "ajdhoward"): Env {
  return { GITHUB_USERNAME: username, SYSTEM_ENV: "test" } as unknown as Env;
}

async function get(path: string, env: Env = makeEnv()) {
  const res = await worker.fetch(new Request(`https://atv.test${path}`), env);
  return { res, text: await res.text() };
}

describe("join page", () => {
  it("documents both authorisation paths and the repository", async () => {
    const { res, text } = await get("/join");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(text).toContain(repoUrl("ajdhoward"));
    // The device flow only works if the agent knows the exact command and the
    // address the operator has to visit.
    expect(text).toContain("gh auth login --hostname github.com --git-protocol https --web");
    expect(text).toContain("github.com/login/device");
    expect(text).toContain("gh auth setup-git");
    expect(text).toContain("gh repo clone ajdhoward/atv-network-monorepo");
    expect(text).toContain("GH_TOKEN");
  });

  it("says plainly what a device-code token reaches", async () => {
    const { text } = await get("/join");
    expect(text).toContain("account-wide");
    expect(text).toContain("every repository the");
    expect(text).toContain("gh auth logout");
  });

  it("limits the ask to authoring and reviewing", async () => {
    const { text } = await get("/join");
    expect(text).toContain("Author and Reviewer only");
    expect(text).toContain("Do not push <code>main</code>");
    expect(text).toContain("No deploys");
  });

  it("never asks for a credential to be pasted anywhere", async () => {
    const { text } = await get("/join");
    expect(text).toContain("Never paste a token");
    // Nothing on a public page may look like a credential.
    expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{16,}/);
  });

  it("loads nothing off-origin and answers the trailing-slash form", async () => {
    const { res, text } = await get("/join/");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(text).toContain(repoUrl("ajdhoward"));
    expect(text).not.toContain("<script");
  });

  it("follows the configured owner", async () => {
    const { text } = await get("/join", makeEnv("another-owner"));
    expect(text).toContain(repoUrl("another-owner"));
    expect(text).toContain("gh repo clone another-owner/atv-network-monorepo");
  });
});
