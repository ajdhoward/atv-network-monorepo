import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const drift = resolve("scripts/check-drift.mjs");
const dir = mkdtempSync(join(tmpdir(), "atv-drift-"));

// What the deployed origin would answer. Each test moves one piece, so a failure
// says which signal fired rather than that "the check failed".
type Health = Record<string, unknown>;
const state: { client: string; admin: string; health: Health; serveAssets: boolean } = {
  client: "Local111",
  admin: "Local222",
  health: {},
  serveAssets: true,
};

function healthy(): Health {
  return {
    status: "ok",
    schemaVersion: 1,
    config: {
      seeded: true,
      channels: 2,
      updatedAt: null,
      schemaMatches: true,
      checksumMatches: true,
    },
    resolve: { configured: 0, invalid: 0, missing: 2 },
    // `run()` pins ATV_BUILD_ID, so this comparison does not depend on the
    // working tree the suite happens to be running in.
    build: { id: "localbuild1" },
    deviceTokenSet: false,
    streamSigningKeySet: false,
    guideSnapshot: null,
  };
}

function page(script: string): string {
  return `<!doctype html><html><body><div id="root"></div><script type="module" crossorigin src="${script}"></script></body></html>`;
}

function build(client: string, admin: string): string {
  const root = mkdtempSync(join(dir, "build-"));
  mkdirSync(join(root, "admin"), { recursive: true });
  writeFileSync(join(root, "index.html"), page(`/assets/index-${client}.js`));
  writeFileSync(join(root, "admin", "index.html"), page(`/admin/assets/index-${admin}.js`));
  return root;
}

let server: Server;
let base = "";
let local: string;

beforeAll(async () => {
  state.health = healthy();
  local = build(state.client, state.admin);
  server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://local").pathname;
    if (path === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(`/assets/index-${state.client}.js`));
      return;
    }
    if (path === "/admin/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(page(`/admin/assets/index-${state.admin}.js`));
      return;
    }
    if (path === "/api/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(state.health));
      return;
    }
    if (path.startsWith("/api/")) {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "not found", code: "not_found" }));
      return;
    }
    if (path.endsWith(".js")) {
      const served =
        state.serveAssets &&
        (path === `/assets/index-${state.client}.js` ||
          path === `/admin/assets/index-${state.admin}.js`);
      res.writeHead(served ? 200 : 404, { "content-type": "text/javascript; charset=utf-8" });
      res.end(served ? "export {};" : "gone");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("gone");
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(dir, { recursive: true, force: true });
});

type Result = { status: number | null; stdout: string; stderr: string };

// Async on purpose: a synchronous spawn would block this process's event loop, so
// the stub origin above could never answer the child's requests.
function run(argv: string[], target = base): Promise<Result> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [drift, target, ...argv],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          ATV_BASE_URL: "",
          ATV_BUILD_ID: "localbuild1",
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

describe("check-drift", () => {
  it("passes when the deployment serves this checkout's build", async () => {
    const result = await run(["--build", local]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS  GET / (build)");
    expect(result.stdout).toContain("PASS  GET /admin/ (build)");
    expect(result.stdout).toContain("PASS  health build id — localbuild1");
    expect(result.stdout).toContain("8/8 checks matched");
  });

  // The failure the check exists for: the sandbox serving last week's bundle. A
  // paragraph in the backlog cannot fail a command; this can.
  it("fails when the deployed client is older than this checkout", async () => {
    state.client = "Deployed9";
    try {
      const result = await run(["--build", local]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL  GET / (build)");
      expect(result.stdout).toContain("serving /assets/index-Deployed9.js");
      expect(result.stdout).toContain("this checkout builds /assets/index-Local111.js");
      expect(result.stdout).toContain("pnpm deploy");
    } finally {
      state.client = "Local111";
    }
  });

  it("reports an admin build that drifted on its own", async () => {
    state.admin = "Deployed8";
    try {
      const result = await run(["--build", local]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL  GET /admin/ (build)");
      expect(result.stdout).toContain("PASS  GET / (build)");
    } finally {
      state.admin = "Local222";
    }
  });

  // A copied bundle over an old Worker is the other half: same assets, a health
  // body from before R6.
  it("fails a Worker older than this checkout even with matching assets", async () => {
    const { deviceTokenSet: _drop, ...older } = healthy();
    state.health = older;
    try {
      const result = await run(["--build", local]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("PASS  GET / (build)");
      expect(result.stdout).toContain("deviceTokenSet (R6)");
      expect(result.stdout).toContain("older than this checkout");
    } finally {
      state.health = healthy();
    }
  });

  // The reason the field exists: a change confined to `services/atv-core` leaves
  // every asset hash identical, so without the build id this deployment passes.
  it("fails a Worker-only change, where both asset checks match", async () => {
    state.health = { ...healthy(), build: { id: "deployedonly" } };
    try {
      const result = await run(["--build", local]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("PASS  GET / (build)");
      expect(result.stdout).toContain("PASS  GET /admin/ (build)");
      expect(result.stdout).toContain("FAIL  health build id");
      expect(result.stdout).toContain("deployed deployedonly, this checkout is localbuild1");
    } finally {
      state.health = healthy();
    }
  });

  // A deploy that did not carry the var is not a deployment this checkout can
  // vouch for, so it fails loudly and names the fix.
  it("fails a deployment that reports no build id at all", async () => {
    const { build: _drop, ...older } = healthy();
    state.health = older;
    try {
      const result = await run(["--build", local]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL  health build id");
      expect(result.stdout).toContain("deployed without ATV_BUILD_ID");
      expect(result.stdout).toContain("pnpm deploy");
    } finally {
      state.health = healthy();
    }
  });

  it("fails a stored schema this checkout does not serve", async () => {
    state.health = { ...healthy(), schemaVersion: 2 };
    try {
      const result = await run(["--build", local]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("FAIL  health schemaVersion — 2, this checkout is 1");
    } finally {
      state.health = healthy();
    }
  });

  it("fails when the page references an asset the deployment does not serve", async () => {
    state.serveAssets = false;
    try {
      const result = await run(["--build", local]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("does not serve");
    } finally {
      state.serveAssets = true;
    }
  });

  it("fails when there is no local build, naming the command that makes one", async () => {
    const result = await run(["--build", join(dir, "no-build-here")]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("pnpm run build:deploy");
  });

  it("fails an asset layer that answers /api/health instead of the Worker", async () => {
    const real = state.health;
    state.health = "not-an-object" as unknown as Health;
    try {
      const result = await run(["--build", local]);
      expect(result.status).toBe(1);
    } finally {
      state.health = real;
    }
  });

  it("reports an unreachable origin as a failure", async () => {
    const result = await run(["--build", local], "http://127.0.0.1:1");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL  connect");
  });

  it("rejects an unknown flag", async () => {
    const result = await run(["--nope"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown flag");
  });
});
