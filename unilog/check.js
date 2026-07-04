#!/usr/bin/env node
// unilog/check.js — offline validator. Reports problems WITHOUT deploying or
// touching the DB:
//   - duplicate log_ids (same id on more than one source line)
//   - (info) count of active sites per project
//
// Usage: node unilog/check.js <project|all>
//   e.g. node unilog/check.js tv      node unilog/check.js all
//
// Exit code 1 if any duplicate ids are found, else 0.
// (unilog plumbing — console with `// no-unilog`.)

import fs from "node:fs";
import path from "node:path";
import { findLogCalls } from "./parse.js";
import { PROJECT_DIRS, findProjectFiles } from "./projects.js";

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const projectArg = process.argv.filter((a) => !a.startsWith("-"))[2];
if (!projectArg || (!PROJECT_DIRS[projectArg] && projectArg !== "all")) {
  console.error(
    `usage: node unilog/check.js <project|all>  (known: ${Object.keys(PROJECT_DIRS).join(", ")})`,
  ); // no-unilog
  process.exit(1);
}

const projects =
  projectArg === "all" ? Object.keys(PROJECT_DIRS) : [projectArg];
const files = [
  ...new Set(projects.flatMap((p) => findProjectFiles(p, REPO_ROOT))),
];

const sites = []; // { rel, line, logId }

for (const abs of files) {
  const rel = path.relative(REPO_ROOT, abs);
  const text = fs.readFileSync(abs, "utf8");

  for (const h of findLogCalls(text, { vue: abs.endsWith(".vue") })) {
    if (h.kind === "active") sites.push({ rel, line: h.line, logId: h.logId });
  }
}

// ---- duplicate ids -------------------------------------------------------
const byId = new Map();
for (const s of sites) {
  if (!byId.has(s.logId)) byId.set(s.logId, []);
  byId.get(s.logId).push(s);
}
const dupes = [...byId.entries()]
  .filter(([, list]) => list.length > 1)
  .sort((a, b) => a[0] - b[0]);

// ---- report --------------------------------------------------------------
console.log(
  `[check] ${projectArg}: ${files.length} files, ${sites.length} active sites`,
); // no-unilog

if (dupes.length > 0) {
  console.log(`\n[check] DUPLICATE log_id(s): ${dupes.length} group(s)`); // no-unilog
  for (const [id, list] of dupes) {
    console.log(`  id ${id}:`); // no-unilog
    for (const s of list) console.log(`    ${s.rel}:${s.line}`); // no-unilog
  }
}

const problems = dupes.length;
if (problems === 0) console.log("[check] OK — no problems"); // no-unilog
process.exit(problems > 0 ? 1 : 0);
