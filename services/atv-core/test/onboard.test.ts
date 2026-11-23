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

describe("onboard page", () => {
  it("routes both paths and names the repository", async () => {
    const { res, text } = await get("/onboard");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(text).toContain("Path A: you can reach GitHub");
    expect(text).toContain("Path B: you cannot reach GitHub");
    expect(text).toContain(repoUrl("ajdhoward"));
    expect(text).toContain("gh repo clone ajdhoward/atv-network-monorepo");
  });

  it("points at the four logs and the backlog review rule", async () => {
    const { text } = await get("/onboard");
    for (const file of ["roster.md", "backlog.md", "decisions.md", "reviews.md"]) {
      expect(text).toContain(`docs/agents/${file}`);
    }
    expect(text).toContain("ack — &lt;name&gt;");
  });

  it("ships the handoff template every field the validator requires", async () => {
    const { text } = await get("/onboard");
    for (const field of ["Name:", "Tool:", "Roles:", "Paths:", "Task:", "Date:"]) {
      expect(text).toContain(field);
    }
    // The operator's set method, and the template's own safety rail.
    expect(text).toContain("pnpm handoff");
    expect(text).toContain("docs/agents/handoffs/");
    expect(text).toContain("--dry-run");
    expect(text).toContain("Under 20 KB, no tokens");
  });

  it("sends an unauthorised agent to the authorisation page, not to a token form", async () => {
    const { text } = await get("/onboard");
    expect(text).toContain('href="/join"');
    expect(text).toContain("Do not ask for a token");
    expect(text).toContain("Push <code>main</code>");
    // A public page must not contain anything credential-shaped.
    expect(text).not.toMatch(/gh[pousr]_[A-Za-z0-9]{16,}/);
  });

  it("loads nothing off-origin and answers the trailing-slash form", async () => {
    const { res, text } = await get("/onboard/");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(text).not.toContain("<script");
  });

  it("follows the configured owner", async () => {
    const { text } = await get("/onboard", makeEnv("another-owner"));
    expect(text).toContain(repoUrl("another-owner"));
    expect(text).toContain("gh repo clone another-owner/atv-network-monorepo");
  });
});
