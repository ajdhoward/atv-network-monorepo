import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const audit = resolve("scripts/check-streams.mjs");

// A resolved link looks like something an operator must never see in a log, so
// the tests assert it stays out of stdout/stderr.
const LINK = "https://cdn.example.invalid/private/a.m3u8";

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

    const id = url.searchParams.get("id");
    const link = (path: string) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ url: `${base}${path}`, profile: "1080p_hevc" }));
    };

    if (id === "atv-1") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ url: LINK, profile: "1080p_hevc" }));
    } else if (id === "atv-probe") {
      link("/stream.m3u8");
    } else if (id === "atv-login") {
      link("/login.html");
    } else if (id === "atv-dead") {
      link("/dead.m3u8");
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
