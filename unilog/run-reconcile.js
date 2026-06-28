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
  client: {
    include: [
      "apps/client/src/emby.js",
      "apps/client/src/srvr.js",
      "apps/client/src/tvdb.js",
      "apps/client/src/main.js",
      "apps/client/src/mapUtil.js",
      "apps/client/src/util.js",
      "apps/client/src/globalMessages.js",
      "apps/client/src/paneHelp.js",
      "apps/client/src/components/App.vue",
      "apps/client/src/components/actor.vue",
      "apps/client/src/components/actors.vue",
      "apps/client/src/components/browse.vue",
      "apps/client/src/components/buttons.vue",
      "apps/client/src/components/down.vue",
      "apps/client/src/components/flex.vue",
      "apps/client/src/components/hdrbot.vue",
      "apps/client/src/components/hdrmsg.vue",
      "apps/client/src/components/hdrtop.vue",
      "apps/client/src/components/info.vue",
      "apps/client/src/components/keyboard-pane.vue",
      "apps/client/src/components/list.vue",
      "apps/client/src/components/local.vue",
      "apps/client/src/components/map.vue",
      "apps/client/src/components/meta.vue",
      "apps/client/src/components/qbt.vue",
      "apps/client/src/components/reel-gallery.vue",
      "apps/client/src/components/reviews.vue",
      "apps/client/src/components/shows.vue",
      "apps/client/src/components/stream.vue",
      "apps/client/src/components/tor.vue",
      "apps/client/src/components/trailer.vue",
      "apps/client/src/components/tree-node.vue",
      "apps/client/src/components/tvpane.vue",
      "apps/client/src/components/usb.vue",
      "apps/client/src/components/video-player.vue",
    ],
    // log.js is the client unilog facade itself — never instrument it.
    exclude: [
      "apps/client/src/log.js",
      "apps/client/src/config.js",
      "apps/client/src/urls.js",
      "apps/client/src/evtBus.js",
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
  return (
    /import\s*\{[^}]*\bunilog\b[^}]*\}/.test(text) ||
    /const\s*\{[^}]*\bunilog\b/.test(text) ||
    /unilog\s*=\s*epd\.unilog/.test(text)
  );
}

// Compute relative path from a source file to apps/client/src/log.js.
function clientLogImport(file) {
  const from = path.dirname(path.resolve(file));
  const to = path.resolve("apps/client/src/log.js");
  let rel = path.relative(from, to).replace(/\\/g, "/");
  if (!rel.startsWith(".")) rel = "./" + rel;
  return rel;
}

function injectUnilogImport(text, file) {
  const isVue = file.endsWith(".vue");
  const isClient = file.includes("apps/client/");

  if (isVue) {
    return injectIntoVue(text, file, isClient);
  }

  const lines = text.split("\n");
  const importLine = isClient
    ? `import { unilog } from "${clientLogImport(file)}";`
    : 'import { unilog } from "@tv/share";';

  // Case 1: named import from @tv/share — add unilog to it.
  const lastShareIdx = lastIndexOf(lines, (l) => /@tv\/share/.test(l));
  if (lastShareIdx >= 0 && !isClient) {
    const existing = lines[lastShareIdx];
    const namedMatch = /^(import\s*\{)([^}]+)(\}\s*from\s*"@tv\/share")/.exec(
      existing,
    );
    if (namedMatch) {
      lines[lastShareIdx] =
        `${namedMatch[1]}${namedMatch[2].trimEnd()}, unilog${namedMatch[3]}`;
      return lines.join("\n");
    }
    lines.splice(lastShareIdx + 1, 0, importLine);
    return lines.join("\n");
  }

  // Case 2: insert after last import STATEMENT end (handles multi-line imports).
  const lastImportIdx = lastIndexOf(
    lines,
    (l) => /\bfrom\s+["']/.test(l) || /^import\s+["']/.test(l),
  );
  const insertAt = lastImportIdx >= 0 ? lastImportIdx + 1 : 0;
  lines.splice(insertAt, 0, importLine);
  return lines.join("\n");
}

function injectIntoVue(text, file, isClient) {
  const lines = text.split("\n");
  const importLine = isClient
    ? `import { unilog } from "${clientLogImport(file)}";`
    : 'import { unilog } from "@tv/share";';

  // Find the <script> block start.
  const scriptIdx = lines.findIndex(
    (l) => /^<script[\s>]/.test(l) || l === "<script>",
  );
  if (scriptIdx < 0) return text; // no script block

  // Try to add to an existing @tv/share or log.js named import.
  const scriptEndIdx = lines.findIndex(
    (l, i) => i > scriptIdx && /^<\/script>/.test(l),
  );
  const scriptLines = lines.slice(
    scriptIdx + 1,
    scriptEndIdx < 0 ? undefined : scriptEndIdx,
  );
  const relShareIdx = scriptLines.findIndex(
    (l) => /@tv\/share/.test(l) || /\/log\.js/.test(l),
  );
  if (relShareIdx >= 0) {
    const absIdx = scriptIdx + 1 + relShareIdx;
    const existing = lines[absIdx];
    const namedMatch = /^(import\s*\{)([^}]+)(\}\s*from\s*["'][^"']+["'])/.exec(
      existing,
    );
    if (namedMatch) {
      lines[absIdx] =
        `${namedMatch[1]}${namedMatch[2].trimEnd()}, unilog${namedMatch[3]}`;
      return lines.join("\n");
    }
    lines.splice(absIdx + 1, 0, importLine);
    return lines.join("\n");
  }

  // Find last import line within the script block and insert after.
  // Use the end of the last import STATEMENT (the line with `from "..."` or
  // a bare `import "..."`) to avoid splitting multi-line named imports.
  const lastImportEndInScript = lastIndexOf(
    scriptLines,
    (l) => /\bfrom\s+["']/.test(l) || /^import\s+["']/.test(l),
  );
  const insertAt =
    lastImportEndInScript >= 0
      ? scriptIdx + 1 + lastImportEndInScript + 1
      : scriptIdx + 1;
  lines.splice(insertAt, 0, importLine);
  return lines.join("\n");
}

function lastIndexOf(arr, predicate) {
  for (let i = arr.length - 1; i >= 0; i--) if (predicate(arr[i])) return i;
  return -1;
}
