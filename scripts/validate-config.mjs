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
// The Worker answers 502 for a link that is not https, so a seed carrying one
// would look valid here and fail per channel on the TV. Check each link where
// the mistake is still cheap to fix, as scripts/set-gdrive-map.mjs does.
if (raw.gdrive_map !== undefined) {
  if (!raw.gdrive_map || typeof raw.gdrive_map !== "object" || Array.isArray(raw.gdrive_map)) {
    problems.push("gdrive_map must be an object of id -> https url");
  } else {
    for (const [id, url] of Object.entries(raw.gdrive_map)) {
      if (typeof url !== "string" || !url.startsWith("https://"))
        problems.push(`gdrive_map.${id} must be an https url`);
    }
  }
}
// TorBox items are ids, not links: a typo here fails at resolve time on the TV,
// so catch it while the config is still local.
if (raw.torbox_map !== undefined) {
  if (!raw.torbox_map || typeof raw.torbox_map !== "object" || Array.isArray(raw.torbox_map)) {
    problems.push("torbox_map must be an object of id -> { kind?, <kind>Id, fileId }");
  } else {
    for (const [id, entry] of Object.entries(raw.torbox_map)) {
      const kind = entry?.kind ?? "torrent";
      if (!["torrent", "usenet", "webdl"].includes(kind)) {
        problems.push(`torbox_map.${id}.kind must be torrent, usenet or webdl`);
        continue;
      }
      if (!Number.isInteger(entry?.[`${kind}Id`]) || entry[`${kind}Id`] < 0)
        problems.push(`torbox_map.${id} needs an integer ${kind}Id`);
      if (!Number.isInteger(entry?.fileId) || entry.fileId < 0)
        problems.push(`torbox_map.${id} needs an integer fileId`);
    }
  }
}
for (const [i, ident] of (raw.idents || []).entries()) {
  if (typeof ident !== "string" || !ident.startsWith("https://"))
    problems.push(`idents[${i}] must be an https url`);
}

if (problems.length) {
  console.error(`✗ ${file} does not match the config shape:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Config valid: ${file} (${raw.channels.length} channels)`);
