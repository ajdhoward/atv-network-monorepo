#!/usr/bin/env node
// `wrangler deploy` with the build id attached.
//
//   node scripts/deploy-worker.mjs wrangler.toml
//   node scripts/deploy-worker.mjs wrangler.production.toml   # the override only
//
// A Worker cannot learn which commit it was built from: there is no binding for
// its own deployment, and asking the Cloudflare API would put a token in the
// request path. So the id travels with the deploy as the `ATV_BUILD_ID` var, and
// `/api/health` reports it — which is the only way `node scripts/check-drift.mjs`
// can see a change that left the client bundle byte-identical.
//
// It is a script rather than a `--var` written inline in `package.json` for two
// reasons: the value comes from `scripts/build-id.mjs`, the same function a drift
// check reads, so a deploy and the comparison cannot disagree; and command
// substitution in a package script does not work in a Windows shell.
import { execFileSync } from "node:child_process";
import { buildId } from "./build-id.mjs";

const config = process.argv[2] || "wrangler.toml";
const id = buildId();
if (!id) {
  console.error("✗ No build id: this is not a git checkout, so the deploy would carry no");
  console.error("  commit and `pnpm drift` could not compare it. Run from a clone, or set");
  console.error("  ATV_BUILD_ID to the commit you mean.");
  process.exit(1);
}

// Windows resolves the executable, not a shim, so the command name differs there.
const wrangler = process.platform === "win32" ? "wrangler.cmd" : "wrangler";
try {
  // `--var` merges with the config's own `[vars]`: this adds one, it does not
  // replace the block.
  execFileSync(wrangler, ["deploy", "--config", config, "--var", `ATV_BUILD_ID:${id}`], {
    stdio: "inherit",
  });
} catch (err) {
  process.exit(typeof err?.status === "number" ? err.status : 1);
}
