#!/usr/bin/env node
// unilog/migrate-cache-invert.js — one-time migration of reconcile-cache.json.
//
// v1 cache keyed each file's `sites` map by log_id  ({ "<logId>": <srcLine> }),
// which cannot represent two source lines sharing one id. v2 keys by line number
// ({ "<srcLine>": <logId> }) — line numbers are unique per file (one unilog call
// per line), so duplicate ids within a file are now representable.
//
// Idempotent: a cache already tagged `"version": 2` is left untouched.
// run-reconcile.js also auto-migrates on load, so running this is optional — it
// just makes the on-disk file canonical. (unilog plumbing — console + no-unilog.)

import fs from "node:fs";

const CACHE_FILE = new URL("./reconcile-cache.json", import.meta.url).pathname;

let cache;
try {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
} catch {
  console.log("[migrate-cache-invert] no cache file — nothing to do"); // no-unilog
  process.exit(0);
}

if (cache.version === 2) {
  console.log("[migrate-cache-invert] cache already v2 — nothing to do"); // no-unilog
  process.exit(0);
}

const out = { version: 2 };
let files = 0;
let sites = 0;
for (const [rel, entry] of Object.entries(cache)) {
  if (rel === "version" || !entry || typeof entry !== "object") continue;
  const inverted = {};
  for (const [logId, line] of Object.entries(entry.sites ?? {})) {
    inverted[String(line)] = Number(logId); // id->line  =>  line->id
    sites++;
  }
  out[rel] = { hash: entry.hash, sites: inverted };
  files++;
}

fs.writeFileSync(CACHE_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(
  `[migrate-cache-invert] inverted ${sites} site(s) across ${files} file(s) -> v2`,
); // no-unilog
