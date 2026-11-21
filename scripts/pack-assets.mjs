#!/usr/bin/env node
// Copies the admin CMS build under the TV client's dist, which is the one asset
// directory the Worker serves. /admin is then served by the same Worker.
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve("apps/tv-client/dist/admin");
const source = resolve("apps/admin-cms/dist");

if (!existsSync(source)) {
  console.error("✗ apps/admin-cms/dist is missing — run `pnpm run build:admin` first.");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`→ packed admin CMS into ${target}`);
