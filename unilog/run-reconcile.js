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
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { reconcileFilesWithDb, projectOf } from "./reconcile.js";

const SRVR_HTTPS_URL = "https://hahnca.com/tv-srvr";
const SSH_HOST = "hahnca.com";
const REMOTE_DB = "/root/dev/apps/tv/unilog/unilog.sqlite";

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
  api: {
    include: [
      "apps/api/src/browse.js",
      "apps/api/src/download.js",
      "apps/api/src/imdb-credits.js",
      "apps/api/src/local.js",
      "apps/api/src/normalize.js",
      "apps/api/src/reviews.js",
      "apps/api/src/search-worker.js",
      "apps/api/src/search.js",
      "apps/api/src/searchInChild.js",
      "apps/api/src/server.js",
      "apps/api/src/sshTunnel.js",
      "apps/api/src/tv-proc.js",
      "apps/api/src/tvmaze.js",
      "apps/api/src/usb.js",
    ],
    exclude: ["apps/api/src/tvPaths.js"],
  },
  down: {
    include: [
      "apps/down/src/main.js",
      "apps/down/src/movie-rsync.js",
      "apps/down/src/tvJson.js",
      "apps/down/src/worker.js",
    ],
    exclude: [],
  },
  asr: {
    include: ["apps/asr/asr.js"],
    exclude: [],
  },
  tv: {
    include: ["apps/tv/src/main.js", "apps/tv/bravia.js", "apps/tv/bravia2.js"],
    exclude: ["apps/tv/usb-cp-tampermonkey.user.js"],
  },
};

const project = process.argv[2];
if (!project || !PROJECT_FILES[project]) {
  console.error(
    `usage: node unilog/run-reconcile.js <project>  (known: ${Object.keys(PROJECT_FILES).join(", ")})`,
  ); // no-unilog
  process.exit(1);
}

// ---- id allocation: HTTPS endpoint, fall back to direct ssh+sqlite3 -------
//
// Normal path: POST to the running tv-srvr (the single DB writer). If srvr is
// down/unreachable, fall back to talking to the DB directly over ssh. With srvr
// stopped there is exactly one writer, so no locking is needed — so we stop the
// tv-srvr pm2 task before the first direct write (it restarts on deploy anyway).

let useSsh = false;
let srvrStopped = false;

async function postJson(path, body) {
  const r = await fetch(`${SRVR_HTTPS_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

function sqlOne(sql) {
  const r = spawnSync(
    "ssh",
    [SSH_HOST, `sqlite3 ${REMOTE_DB} ${JSON.stringify(sql)}`],
    { encoding: "utf8" },
  );
  if (r.status !== 0)
    throw new Error((r.stderr || "ssh sqlite3 failed").trim());
  return (r.stdout || "").trim();
}

const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

function ensureSrvrStopped() {
  if (srvrStopped) return;
  console.log(
    "[run-reconcile] srvr endpoint unavailable — stopping tv-srvr and writing DB over ssh",
  ); // no-unilog
  spawnSync("ssh", [SSH_HOST, "pm2 stop tv-srvr"], { encoding: "utf8" });
  srvrStopped = true;
}

function nowPst() {
  // Identical format to apps/srvr/src/unilogDb.js nowPst(): yyyy/mm/dd hh:mm:ss,
  // hour 24 -> 00, so all ts/created_at fields match across tables.
  const d = new Date();
  const date = d
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .replace(/-/g, "/");
  let time = d.toLocaleTimeString("en-GB", {
    timeZone: "America/Los_Angeles",
    hour12: false,
  });
  if (time.startsWith("24:")) time = "00:" + time.slice(3);
  return `${date} ${time}`;
}

const now = new Date()
  .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  .replace(/-/g, "/");

let groupId = null;
async function ensureGroup() {
  if (groupId != null) return groupId;
  const desc = `${project} instrumentation ${now}`;
  if (!useSsh) {
    try {
      groupId = (
        await postJson("/api/unilog/group", {
          groupType: "task",
          description: desc,
        })
      ).id;
      console.log(`[run-reconcile] created group id=${groupId}`); // no-unilog
      return groupId;
    } catch {
      useSsh = true; // switch to ssh fallback for the rest of the run
    }
  }
  ensureSrvrStopped();
  sqlOne(
    `INSERT INTO log_groups (group_id, group_type, ts, description) ` +
      `VALUES ((SELECT COALESCE(MAX(group_id),0)+1 FROM log_groups), 'task', ${q(nowPst())}, ${q(desc)});`,
  );
  groupId = Number(sqlOne("SELECT MAX(group_id) FROM log_groups;"));
  console.log(`[run-reconcile] created group id=${groupId} (ssh)`); // no-unilog
  return groupId;
}

async function createSiteFn(site) {
  const gid = await ensureGroup();
  if (!useSsh) {
    try {
      const { ids } = await postJson("/api/unilog/sites", [
        { ...site, groupIds: [gid] },
      ]);
      return ids[0];
    } catch {
      useSsh = true;
      ensureSrvrStopped();
    }
  }
  sqlOne(
    `INSERT INTO log_sites (log_id, tag, description, level, src_file, src_line, old_log, project, created_at) ` +
      `VALUES ((SELECT COALESCE(MAX(log_id),0)+1 FROM log_sites), ${q(site.tag)}, ${q(site.description)}, ` +
      `${q(site.level || "info")}, ${q(site.srcFile)}, ${site.srcLine ?? "NULL"}, NULL, ${q(site.project)}, ${q(nowPst())});`,
  );
  const id = Number(sqlOne("SELECT MAX(log_id) FROM log_sites;"));
  sqlOne(
    `INSERT OR IGNORE INTO site_groups (log_id, group_id) VALUES (${id}, ${gid});`,
  );
  return id;
}

async function flushRefreshes() {
  if (pendingRefreshes.length === 0) return;
  if (!useSsh) {
    try {
      await postJson("/api/unilog/refresh-sites", pendingRefreshes);
      return;
    } catch {
      useSsh = true;
      ensureSrvrStopped();
    }
  }
  const statements = pendingRefreshes.map(
    (s) =>
      `UPDATE log_sites SET src_file = ${q(s.srcFile)}, src_line = ${s.srcLine ?? "NULL"} WHERE log_id = ${Number(s.logId)};`,
  );
  const script = "BEGIN;\n" + statements.join("\n") + "\nCOMMIT;";
  const r = spawnSync("ssh", [SSH_HOST, `sqlite3 ${REMOTE_DB}`], {
    input: script,
    encoding: "utf8",
  });
  if (r.status !== 0)
    throw new Error((r.stderr || "batch refresh failed").trim());
}

// ---- file hash + site-location cache (skip unchanged files / lines) ----

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CACHE_FILE = new URL("./reconcile-cache.json", import.meta.url).pathname;

// Cache shape: { [relPath]: { hash: string, sites: { [logId]: srcLine } } }
let hashCache = {};
try {
  hashCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
} catch {
  /* first run or missing */
}

function fileHash(absPath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(absPath))
    .digest("hex");
}

// ---- file list -----------------------------------------------------------

const { include, exclude = [] } = PROJECT_FILES[project];
const excSet = new Set(exclude.map((f) => path.resolve(f)));
const allFiles = include
  .map((f) => path.resolve(f))
  .filter((f) => !excSet.has(f) && fs.existsSync(f));

const files = allFiles.filter((f) => {
  const rel = path.relative(REPO_ROOT, f);
  return fileHash(f) !== hashCache[rel]?.hash;
});

console.log(
  `[run-reconcile] ${project}: ${files.length}/${allFiles.length} files to process`,
); // no-unilog

// ---- reconcile -----------------------------------------------------------

// pendingRefreshes: only sites whose srcLine actually changed (for DB write).
// currentSitesByFile: all current sites in processed files (for cache update).
const pendingRefreshes = [];
const currentSitesByFile = {};
function refreshSiteFn({ logId, srcFile, srcLine }) {
  if (!currentSitesByFile[srcFile]) currentSitesByFile[srcFile] = {};
  currentSitesByFile[srcFile][String(logId)] = srcLine;
  const cached = hashCache[srcFile]?.sites?.[String(logId)];
  if (cached === srcLine) return; // line number unchanged — skip DB write
  pendingRefreshes.push({ logId, srcFile, srcLine });
}

const summary = await reconcileFilesWithDb(files, {
  createSiteFn,
  refreshSiteFn,
  repoRoot: REPO_ROOT,
});

await flushRefreshes();

// Update cache: processed files get new hash + current site locations;
// unprocessed files just keep their existing cache entry (already correct).
for (const f of files) {
  const rel = path.relative(REPO_ROOT, f);
  hashCache[rel] = { hash: fileHash(f), sites: currentSitesByFile[rel] ?? {} };
}
// Ensure every file has a cache entry (first run after adding new files).
for (const f of allFiles) {
  const rel = path.relative(REPO_ROOT, f);
  if (!hashCache[rel]) hashCache[rel] = { hash: fileHash(f), sites: {} };
}
fs.writeFileSync(CACHE_FILE, JSON.stringify(hashCache, null, 2) + "\n", "utf8");

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

// Count actually-changed line numbers per file from pendingRefreshes.
const changedByFile = {};
for (const r of pendingRefreshes) {
  changedByFile[r.srcFile] = (changedByFile[r.srcFile] ?? 0) + 1;
}

let totalCreated = 0;
for (const s of summary) {
  const rel = path.relative(REPO_ROOT, s.file).replace(/\\/g, "/");
  const changed = changedByFile[rel] ?? 0;
  if (s.created || changed)
    console.log(
      `  ${rel.replace(/^.*apps\//, "apps/")}  +${s.created} sites, ${changed} lines moved`,
    ); // no-unilog
  totalCreated += s.created || 0;
}
console.log(
  `[run-reconcile] done. ${totalCreated} new sites created in group ${groupId}.`,
); // no-unilog

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

  // Case 1: named import from @tv/share — add unilog to it. Only match real
  // import statements (not comments/strings that mention the package).
  const lastShareIdx = lastIndexOf(lines, (l) =>
    /^\s*import\b.*@tv\/share/.test(l),
  );
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

  // Case 2: insert after last import STATEMENT (line must start with import).
  const lastImportIdx = lastIndexOf(
    lines,
    (l) => /^\s*import\b/.test(l) && /from\s+["']/.test(l),
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
