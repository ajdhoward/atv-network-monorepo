import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const audit = resolve("scripts/check-streams.mjs");

// A resolved link looks like something an operator must never see in a log, so
// the tests assert it stays out of stdout/stderr.
const LINK = "https://cdn.example.invalid/private/a.m3u8";

// Requests the audit made to /api/resolve, so batching can be asserted.
const hits: string[] = [];
let rejectBatch = false;
// A deployment whose household token contains whitespace answers this to every
// resolve, batch and single alike.
let tokenInvalid = false;

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");

    // The upstream link the --probe tests follow.
    if (url.pathname === "/stream.m3u8") {
      res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
      res.end("#EXTM3U\n#EXT-X-VERSION:3\n");
      return;
    }
    if (url.pathname === "/login.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<html>sign in</html>");
      return;
    }
    if (url.pathname === "/dead.m3u8") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("gone");
      return;
    }

    if (url.pathname !== "/api/resolve") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found", code: "not_found" }));
      return;
    }
    hits.push(url.search);

    if (tokenInvalid) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "the deployment's household token cannot be sent in a header",
          code: "device_token_invalid",
        }),
      );
      return;
    }

    const link = (path: string, id: string) => ({ id, url: `${base}${path}` });

    const batch = url.searchParams.get("ids");
    if (batch !== null) {
      // Simulates a deployment that predates the batch form.
      if (rejectBatch) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found", code: "not_found" }));
        return;
      }
      const ids = batch.split(",").filter(Boolean);
      if (ids.includes("atv-limited")) {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "60" });
        res.end(JSON.stringify({ error: "too many requests", code: "rate_limited" }));
        return;
      }
      const resolved: unknown[] = [];
      const missing: string[] = [];
      const invalid: string[] = [];
      const unconfigured: string[] = [];
      for (const id of ids) {
        if (id === "atv-1") resolved.push({ id, url: LINK, profile: "1080p_hevc" });
        else if (id === "atv-probe") resolved.push(link("/stream.m3u8", id));
        // What P1's resolve actually answers for a Drive channel: a
        // same-origin path with no host, which the TV resolves against the page
        // and a Node `fetch` cannot parse.
        else if (id === "atv-ticket") resolved.push({ id, url: "/stream.m3u8" });
        else if (id === "atv-login") resolved.push(link("/login.html", id));
        else if (id === "atv-dead") resolved.push(link("/dead.m3u8", id));
        // A 200 the Worker should never produce: resolved without a url.
        else if (id === "atv-nourl") resolved.push({ id });
        else if (id === "atv-insecure") invalid.push(id);
        // P5: a Drive id this deployment cannot proxy, in its own list.
        else if (id === "atv-drive") unconfigured.push(id);
        else missing.push(id);
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ resolved, missing, invalid, unconfigured }));
      return;
    }

    const id = url.searchParams.get("id");
    if (id === "atv-1") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ url: LINK, profile: "1080p_hevc" }));
    } else if (id === "atv-limited") {
      res.writeHead(429, { "content-type": "application/json", "retry-after": "60" });
      res.end(JSON.stringify({ error: "too many requests", code: "rate_limited" }));
    } else if (id === "atv-nourl") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ profile: "1080p_hevc" }));
    } else if (id === "atv-insecure") {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "insecure url blocked - TLS 1.3 required",
          code: "insecure_url",
        }),
      );
    } else if (id === "atv-drive") {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "stream signing is not configured on this deployment",
          code: "stream_unconfigured",
        }),
      );
    } else if (id === "atv-broken") {
      // The other 503: the same status, a different fault.
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "resolve failed", code: "resolve_failed" }));
    } else {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found", code: "not_found" }));
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
});

type Result = { status: number | null; stdout: string; stderr: string };

// Async on purpose: a synchronous spawn would block this process's event loop,
// so the stub server above could never answer the child's requests.
function run(argv: string[]): Promise<Result> {
  return runAgainst(base, argv);
}

function runAgainst(target: string, argv: string[]): Promise<Result> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [audit, target, ...argv],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ATV_BASE_URL: "",
          CF_ACCESS_CLIENT_ID: "",
          CF_ACCESS_CLIENT_SECRET: "",
        },
      },
      (error, stdout, stderr) => {
        const code = error ? (error as NodeJS.ErrnoException).code : undefined;
        const status = typeof code === "number" ? code : error ? 1 : 0;
        done({ status, stdout, stderr });
      },
    );
  });
}

describe("check-streams", () => {
  it("passes when every audited channel resolves", async () => {
    const result = await run(["--ids", "atv-1"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  atv-1");
    expect(result.stdout).toContain("1/1 channel(s) resolve");
  });

  it("audits a lineup in a single batch request", async () => {
    hits.length = 0;
    const result = await run(["--ids", "atv-1,atv-missing,atv-insecure"]);
    expect(result.status).toBe(1);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("ids=");
    expect(result.stdout).toContain("PASS  atv-1");
    expect(result.stdout).toContain("502 insecure_url");
  });

  it("falls back to one request per id when the worker has no batch form", async () => {
    rejectBatch = true;
    hits.length = 0;
    try {
      const result = await run(["--ids", "atv-1,atv-missing"]);
      expect(result.status).toBe(1);
      // The rejected batch attempt, then one request per id.
      expect(hits).toHaveLength(3);
      expect(result.stdout).toContain("PASS  atv-1");
      expect(result.stdout).toContain("FAIL  atv-missing");
    } finally {
      rejectBatch = false;
    }
  });

  it("fails on a channel with no link and points at the setter", async () => {
    const result = await run(["--ids", "atv-1,atv-missing"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  atv-missing");
    expect(result.stderr).toContain("set-gdrive-map.mjs");
  });

  it("downgrades a missing link to a warning with --allow-missing", async () => {
    const result = await run(["--ids", "atv-1,atv-missing", "--allow-missing"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("MISS  atv-missing");
    expect(result.stdout).toContain("WARN");
  });

  it("fails on an insecure link even with --allow-missing", async () => {
    const result = await run(["--ids", "atv-insecure", "--allow-missing"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("502 insecure_url");
  });

  it("never prints a resolved link", async () => {
    const result = await run(["--ids", "atv-1,atv-missing"]);
    expect(result.stdout).not.toContain("cdn.example.invalid");
    expect(result.stdout).not.toContain("private/a.m3u8");
    expect(result.stderr).not.toContain("cdn.example.invalid");
  });

  it("rejects an unknown flag", async () => {
    const result = await run(["--nope"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
  });

  it("fails when the lineup file cannot be read", async () => {
    const result = await run(["--config", "does-not-exist.json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot read");
  });

  it("probes a healthy link and reports its kind", async () => {
    const result = await run(["--probe", "--ids", "atv-probe"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  atv-probe — hls playlist, HTTP 200");
  });

  it("probes a same-origin ticket, which has no host of its own", async () => {
    const result = await run(["--probe", "--ids", "atv-ticket"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  atv-ticket — hls playlist, HTTP 200");
  });

  // "What does this lineup actually serve" is a question the audit can answer
  // without printing a link: the tally is the content type of each probed link.
  it("tallies the formats the lineup resolves to", async () => {
    const result = await run(["--probe", "--ids", "atv-probe,atv-ticket"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Formats: 2 hls playlist");
    expect(result.stdout).toContain("docs/playback-formats.md");
  });

  // Without an upstream fetch there is no content type to count, and a tally of
  // zero would read as "nothing is HLS" rather than "nobody looked".
  it("prints no format tally without --probe", async () => {
    const result = await run(["--ids", "atv-probe"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Formats:");
  });

  it("fails a link the CDN no longer serves", async () => {
    const result = await run(["--probe", "--ids", "atv-dead"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("link answered HTTP 404");
  });

  it("fails a link that answers an HTML sign-in page", async () => {
    const result = await run(["--probe", "--ids", "atv-login"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("answered HTML");
  });

  it("keeps probing with --allow-missing and still tolerates a missing link", async () => {
    const result = await run(["--probe", "--allow-missing", "--ids", "atv-probe,atv-missing"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  atv-probe");
    expect(result.stdout).toContain("MISS  atv-missing");
  });

  it("stops the audit on a 429 instead of counting the rest as missing", async () => {
    const result = await run(["--ids", "atv-limited,atv-1"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("0/2 channel(s) resolve");
    expect(result.stdout).not.toContain("FAIL  atv-1");
    expect(result.stderr).toContain("rate limited");
    expect(result.stderr).toContain("Retry-After 60s");
  });

  it("fails a 200 that carries no url when probing", async () => {
    const result = await run(["--probe", "--ids", "atv-nourl"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("resolved without a url");
  });

  it("reports an unreachable worker as a failure", async () => {
    const result = await runAgainst("http://127.0.0.1:1", ["--ids", "atv-1"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  atv-1");
  });

  it("reports a Drive id the deployment cannot proxy as unconfigured", async () => {
    const result = await run(["--ids", "atv-1,atv-drive"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("PASS  atv-1");
    expect(result.stdout).toContain("FAIL  atv-drive — 503 stream_unconfigured");
  });

  it("reads the code on a per-id 503 instead of blaming the signing key", async () => {
    rejectBatch = true;
    try {
      const broken = await run(["--ids", "atv-broken"]);
      expect(broken.status).toBe(1);
      expect(broken.stdout).toContain("HTTP 503 resolve_failed");
      expect(broken.stdout).not.toContain("ATV_STREAM_SIGNING_KEY");

      const drive = await run(["--ids", "atv-drive"]);
      expect(drive.status).toBe(1);
      expect(drive.stdout).toContain("503 stream_unconfigured");
    } finally {
      rejectBatch = false;
    }
  });

  it("stops on an unpresentable household token and names it, not the signing key", async () => {
    tokenInvalid = true;
    hits.length = 0;
    try {
      const result = await run(["--ids", "atv-1,atv-missing"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("device_token_invalid");
      expect(result.stderr).toContain("ATV_DEVICE_TOKEN");
      expect(result.stderr).not.toContain("ATV_STREAM_SIGNING_KEY");
      expect(result.stderr).not.toContain("window resets");
      expect(result.stdout).not.toContain("stream_unconfigured");
      // One deployment-wide answer, not one failure per channel.
      expect(hits).toHaveLength(1);
    } finally {
      tokenInvalid = false;
    }
  });

  it("never prints the probed link either", async () => {
    const result = await run(["--probe", "--ids", "atv-probe,atv-dead,atv-login"]);
    // The audit target is printed on purpose; the paths that make up each link
    // are not, so nothing here may contain one.
    for (const path of ["/stream.m3u8", "/dead.m3u8", "/login.html"]) {
      expect(result.stdout).not.toContain(path);
      expect(result.stderr).not.toContain(path);
    }
  });
});
