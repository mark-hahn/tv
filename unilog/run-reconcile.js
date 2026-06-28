#!/usr/bin/env node
// unilog/run-reconcile.js — local deploy-time reconciler.
// Usage: node unilog/run-reconcile.js <project>   e.g.  node unilog/run-reconcile.js srvr
//
// Finds all .js files for the project, reconciles them (stub activation +
// old-style single-literal upgrade), calls the srvr HTTPS endpoint to allocate
// real IDs (tv-srvr is the only ID generator), rewrites local source files, and
// injects the `unilog` import into files that got new calls.
//
// Run this BEFORE ./srvr <project> so the activated source ships in the deploy.
// (unilog plumbing — console with `// no-unilog`.)

import fs from "node:fs";
import path from "node:path";
import { reconcileFilesWithDb, projectOf } from "./reconcile.js";

const SRVR_HTTPS_URL = "https://hahnca.com/tv-srvr";

// Hard-wired project → source file globs (no env vars per repo convention).
const PROJECT_FILES = {
  srvr: {
    include: [
      "apps/srvr/index.js",
      "apps/srvr/src/asr.js",
      "apps/srvr/src/bif.js",
      "apps/srvr/src/email.js",
      "apps/srvr/src/emb.js",
      "apps/srvr/src/emby.js",
      "apps/srvr/src/fix.js",
      "apps/srvr/src/groupCounts.js",
      "apps/srvr/src/history.js",
      "apps/srvr/src/lastViewed.js",
      "apps/srvr/src/rotten.js",
      "apps/srvr/src/tmdb.js",
      "apps/srvr/src/tvdb.js",
      "apps/srvr/src/util.js",
    ],
    // unilogDb.js uses `// no-unilog` throughout; safe to skip explicitly.
    exclude: [
      "apps/srvr/src/unilogDb.js",
      "apps/srvr/src/srvrPaths.js",
      "apps/srvr/src/urls.js",
    ],
  },
};

const project = process.argv[2];
if (!project || !PROJECT_FILES[project]) {
  console.error(
    `usage: node unilog/run-reconcile.js <project>  (known: ${Object.keys(PROJECT_FILES).join(", ")})`,
  ); // no-unilog
  process.exit(1);
}

// ---- create an instrumentation group on the remote DB --------------------

async function postJson(path, body) {
  const r = await fetch(`${SRVR_HTTPS_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`POST ${path} → ${r.status}: ${text}`);
  }
  return r.json();
}

const now = new Date()
  .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  .replace(/-/g, "/");
const { id: groupId } = await postJson("/api/unilog/group", {
  groupType: "task",
  description: `${project} step4 instrumentation ${now}`,
});
console.log(`[run-reconcile] created group id=${groupId}`); // no-unilog

// ---- createSiteFn: calls srvr endpoint -----------------------------------

async function createSiteFn(site) {
  const { ids } = await postJson("/api/unilog/sites", [site]);
  return ids[0];
}

// ---- file list -----------------------------------------------------------

const { include, exclude = [] } = PROJECT_FILES[project];
const excSet = new Set(exclude.map((f) => path.resolve(f)));
const files = include
  .map((f) => path.resolve(f))
  .filter((f) => !excSet.has(f) && fs.existsSync(f));

console.log(`[run-reconcile] ${project}: ${files.length} files to process`); // no-unilog

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// ---- reconcile -----------------------------------------------------------

const summary = await reconcileFilesWithDb(files, {
  createSiteFn,
  groupIds: [groupId],
  repoRoot: REPO_ROOT,
});

// ---- inject unilog import into files that got new calls ------------------

for (const s of summary) {
  if (!s.created) continue;
  const text = fs.readFileSync(s.file, "utf8");
  if (hasUnilogInScope(text)) continue;
  const patched = injectUnilogImport(text, s.file);
  if (patched !== text) {
    fs.writeFileSync(s.file, patched, "utf8");
    console.log(`[run-reconcile] injected unilog import: ${s.file}`); // no-unilog
  }
}

// ---- report --------------------------------------------------------------

let totalCreated = 0;
for (const s of summary) {
  if (s.created || s.refreshed)
    console.log(
      `  ${s.file.replace(/^.*apps\//, "apps/")}  +${s.created} sites, ${s.refreshed} refreshed`,
    ); // no-unilog
  totalCreated += s.created || 0;
}
console.log(
  `[run-reconcile] done. ${totalCreated} new sites created in group ${groupId}.`,
); // no-unilog
console.log(`[run-reconcile] now run: ./srvr ${project}`); // no-unilog

// ---- helpers -------------------------------------------------------------

function hasUnilogInScope(text) {
  // Already imported as { unilog } or bound as const { unilog }
  return (
    /import\s*\{[^}]*\bunilog\b[^}]*\}/.test(text) ||
    /const\s*\{[^}]*\bunilog\b/.test(text) ||
    // Imported the whole share ns and unilog is destructured
    /unilog\s*=\s*epd\.unilog/.test(text)
  );
}

function injectUnilogImport(text, file) {
  const lines = text.split("\n");

  // Case 1: file already has `import * as epd from "@tv/share"` — add a
  // destructuring const right after the last @tv/share import line.
  const lastShareIdx = lastIndexOf(lines, (l) => /@tv\/share/.test(l));
  if (lastShareIdx >= 0) {
    const existing = lines[lastShareIdx];
    // If it's `import { foo, bar } from "@tv/share"`, add unilog to it.
    const namedMatch = /^(import\s*\{)([^}]+)(\}\s*from\s*"@tv\/share")/.exec(
      existing,
    );
    if (namedMatch) {
      lines[lastShareIdx] =
        `${namedMatch[1]}${namedMatch[2].trimEnd()}, unilog${namedMatch[3]}`;
      return lines.join("\n");
    }
    // Otherwise (namespace import `* as X`), add a new named import line after.
    lines.splice(lastShareIdx + 1, 0, 'import { unilog } from "@tv/share";');
    return lines.join("\n");
  }

  // Case 2: no @tv/share import at all — find last `import` line and insert after.
  const lastImportIdx = lastIndexOf(lines, (l) => /^import /.test(l));
  const insertAt = lastImportIdx >= 0 ? lastImportIdx + 1 : 0;
  lines.splice(insertAt, 0, 'import { unilog } from "@tv/share";');
  return lines.join("\n");
}

function lastIndexOf(arr, predicate) {
  for (let i = arr.length - 1; i >= 0; i--) if (predicate(arr[i])) return i;
  return -1;
}
