#!/usr/bin/env node
// Validates a config file against the shape the Worker and admin CMS expect.
//   node scripts/validate-config.mjs [path]   # defaults to the example config
import fs from "fs";

const file = process.argv[2] || "packages/ui-shared/src/config.example.json";
let raw;
try {
  raw = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (err) {
  console.error(`⚠ CRITICAL FAILURE: cannot read ${file}: ${err.message}`);
  process.exit(1);
}

const problems = [];
if (raw.version !== 1) problems.push("version must be 1");
if (typeof raw.gdrive?.identsFolder !== "string")
  problems.push("gdrive.identsFolder must be a string");
if (!Array.isArray(raw.channels)) problems.push("channels must be an array");
for (const [i, c] of (raw.channels || []).entries()) {
  if (!c || typeof c.id !== "string") problems.push(`channels[${i}].id must be a string`);
  if (c && c.genre !== undefined && !Array.isArray(c.genre))
    problems.push(`channels[${i}].genre must be an array when present`);
  if (c && c.genres !== undefined && !Array.isArray(c.genres))
    problems.push(`channels[${i}].genres must be an array when present`);
}
if (
  raw.gdrive_map !== undefined &&
  (typeof raw.gdrive_map !== "object" || Array.isArray(raw.gdrive_map))
) {
  problems.push("gdrive_map must be an object of id -> https url");
}
for (const [i, ident] of (raw.idents || []).entries()) {
  if (typeof ident !== "string" || !ident.startsWith("https://"))
    problems.push(`idents[${i}] must be an https url`);
}

if (problems.length) {
  console.error("⚠ CRITICAL FAILURE: Layout Config Collision Detected. Inspection Required.");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Config valid: ${file} (${raw.channels.length} channels)`);
