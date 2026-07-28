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
import {
  reconcileFilesWithDb,
  projectOf,
  scanText,
  findDuplicateIds,
} from "./reconcile.js";
import { findLogCalls } from "./parse.js";
import { PROJECT_DIRS, findProjectFiles } from "./projects.js";

const SRVR_HTTPS_URL = "https://hahnca.com/tv-srvr";
const SSH_HOST = "hahnca.com";
const REMOTE_DB = "/root/dev/apps/tv/unilog/unilog.sqlite";

const forceAll = process.argv.includes("--force");
const projectArg = process.argv.filter((a) => !a.startsWith("-"))[2];
if (!projectArg || (!PROJECT_DIRS[projectArg] && projectArg !== "all")) {
  console.error(
    `usage: node unilog/run-reconcile.js <project|all> [--force]  (known: ${Object.keys(PROJECT_DIRS).join(", ")})`,
  ); // no-unilog
  process.exit(1);
}
const project = projectArg; // may be "all" — handled in file-list block below

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
  // Identical format to apps/srvr/src/unilogDb.js nowPst(): yyyy/mm/dd hh:mm:ss.SSS,
  // hour 24 -> 00, so ts/created_at fields match across tables.
  const d = new Date();
  const date = d
    .toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
    .replace(/-/g, "/");
  let time = d.toLocaleTimeString("en-GB", {
    timeZone: "America/Los_Angeles",
    hour12: false,
  });
  if (time.startsWith("24:")) time = "00:" + time.slice(3);
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${date} ${time}.${ms}`;
}

// ---- named groups (from logHere `grp`) ------------------------------------
// A site is linked only to the named groups it declares — there is no per-run
// "task" group. Each name is resolved to a group_id once (memoized).
const namedGroupIds = new Map(); // name -> group_id
async function ensureNamedGroup(name) {
  if (namedGroupIds.has(name)) return namedGroupIds.get(name);
  let id;
  if (!useSsh) {
    try {
      id = (
        await postJson("/api/unilog/find-or-create-group", {
          description: name,
        })
      ).id;
    } catch {
      useSsh = true;
      ensureSrvrStopped();
    }
  }
  if (id == null) {
    const existing = sqlOne(
      `SELECT group_id FROM log_groups WHERE description = ${q(name)} COLLATE NOCASE;`,
    );
    if (existing) {
      id = Number(existing);
    } else {
      sqlOne(
        `INSERT INTO log_groups (group_id, ts, description) ` +
          `VALUES ((SELECT COALESCE(MAX(group_id),0)+1 FROM log_groups), ${q(nowPst())}, ${q(name)});`,
      );
      id = Number(
        sqlOne(
          `SELECT group_id FROM log_groups WHERE description = ${q(name)} COLLATE NOCASE;`,
        ),
      );
    }
  }
  namedGroupIds.set(name, id);
  return id;
}

// Resolve a site's declared group names to ids.
async function resolveGroupIds(site) {
  const ids = [];
  for (const name of site.grpNames || [])
    ids.push(await ensureNamedGroup(name));
  return ids;
}

async function createSiteFn(site) {
  const groupIds = await resolveGroupIds(site);
  if (!useSsh) {
    try {
      const { ids } = await postJson("/api/unilog/sites", [
        { ...site, groupIds },
      ]);
      return ids[0];
    } catch {
      useSsh = true;
      ensureSrvrStopped();
    }
  }
  // Group ids resolved above are valid regardless of transport (same DB).
  sqlOne(
    `INSERT INTO log_sites (log_id, tag, description, level, src_file, src_line, old_log, project, created_at) ` +
      `VALUES ((SELECT COALESCE(MAX(log_id),0)+1 FROM log_sites), ${q(site.tag)}, ${q(site.description)}, ` +
      `${q(site.level || "info")}, ${q(site.srcFile)}, ${site.srcLine ?? "NULL"}, NULL, ${q(site.project)}, ${q(nowPst())});`,
  );
  const id = Number(sqlOne("SELECT MAX(log_id) FROM log_sites;"));
  for (const gid of groupIds)
    sqlOne(
      `INSERT OR IGNORE INTO site_groups (log_id, group_id) VALUES (${id}, ${gid});`,
    );
  return id;
}

// Split a duplicate id into a fresh one. API first, ssh fallback. When the old
// id has a DB row the new row is a copy of it (with new location) and inherits
// its groups; otherwise a fresh row is created with no group links. Returns the
// new log_id.
async function createDuplicateSiteFn({ oldLogId, project, srcFile, srcLine }) {
  if (!useSsh) {
    try {
      const { id } = await postJson("/api/unilog/duplicate-site", {
        oldLogId,
        project,
        srcFile,
        srcLine,
      });
      return id;
    } catch {
      useSsh = true;
      ensureSrvrStopped();
    }
  }
  const hasOrig =
    oldLogId != null &&
    sqlOne(
      `SELECT COUNT(*) FROM log_sites WHERE log_id = ${Number(oldLogId)};`,
    ) !== "0";
  const newId = Number(
    sqlOne("SELECT COALESCE(MAX(log_id),0)+1 FROM log_sites;"),
  );
  if (hasOrig) {
    sqlOne(
      `INSERT INTO log_sites (log_id, tag, description, level, src_file, src_line, old_log, project, created_at) ` +
        `SELECT ${newId}, tag, description, level, ${q(srcFile)}, ${srcLine ?? "NULL"}, old_log, ${q(project)}, ${q(nowPst())} ` +
        `FROM log_sites WHERE log_id = ${Number(oldLogId)};`,
    );
    sqlOne(
      `INSERT OR IGNORE INTO site_groups (log_id, group_id) ` +
        `SELECT ${newId}, group_id FROM site_groups WHERE log_id = ${Number(oldLogId)};`,
    );
  } else {
    sqlOne(
      `INSERT INTO log_sites (log_id, tag, description, level, src_file, src_line, old_log, project, created_at) ` +
        `VALUES (${newId}, NULL, NULL, 'info', ${q(srcFile)}, ${srcLine ?? "NULL"}, NULL, ${q(project)}, ${q(nowPst())});`,
    );
  }
  return newId;
}

async function flushRefreshes() {
  if (pendingRefreshes.length === 0) return;

  // Query current DB values, filter to only stale entries, then write.
  // All via API if available; all via SSH if srvr is stopped.
  async function queryDbLines(logIds) {
    if (!useSsh) {
      try {
        return await postJson("/api/unilog/query-sites", logIds);
      } catch {
        useSsh = true;
        ensureSrvrStopped();
      }
    }
    const ids = logIds.join(",");
    const qr = spawnSync("ssh", [SSH_HOST, `sqlite3 ${REMOTE_DB}`], {
      input: `SELECT log_id, src_line FROM log_sites WHERE log_id IN (${ids});`,
      encoding: "utf8",
    });
    const result = {};
    for (const row of (qr.stdout || "").trim().split("\n").filter(Boolean)) {
      const [id, val] = row.split("|");
      result[Number(id)] = val === "" || val === "NULL" ? null : Number(val);
    }
    return result;
  }

  const logIds = pendingRefreshes.map((s) => Number(s.logId));
  const dbLines = await queryDbLines(logIds);
  const toWrite = pendingRefreshes.filter(
    (s) => dbLines[Number(s.logId)] !== s.srcLine,
  );
  dbChangedCount = toWrite.length;
  if (toWrite.length === 0) return;

  if (!useSsh) {
    try {
      await postJson("/api/unilog/refresh-sites", toWrite);
      console.log(`[run-reconcile] wrote ${toWrite.length} via API`); // no-unilog
      return;
    } catch {
      useSsh = true;
      ensureSrvrStopped();
    }
  }
  const statements = toWrite.map(
    (s) =>
      `UPDATE log_sites SET src_file = ${q(s.srcFile)}, src_line = ${s.srcLine ?? "NULL"}, project = COALESCE(${q(s.project ?? null)}, project) WHERE log_id = ${Number(s.logId)};`,
  );
  const script = "BEGIN;\n" + statements.join("\n") + "\nCOMMIT;";
  const r = spawnSync("ssh", [SSH_HOST, `sqlite3 ${REMOTE_DB}`], {
    input: script,
    encoding: "utf8",
  });
  if (r.status !== 0)
    throw new Error((r.stderr || "batch refresh failed").trim());
  console.log(`[run-reconcile] wrote ${toWrite.length} via SSH`); // no-unilog
}

// ---- file hash + site-location cache (skip unchanged files / lines) ----

const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const CACHE_FILE = new URL("./reconcile-cache.json", import.meta.url).pathname;

// Cache shape (v2): { version: 2, [relPath]: { hash, sites: { [srcLine]: logId } } }
// v1 was keyed { [logId]: srcLine } per file — auto-migrated on load so a file
// with two lines sharing one id is representable (line keys are always unique).
let hashCache = {};
try {
  hashCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
} catch {
  /* first run or missing */
}
hashCache = normalizeCache(hashCache);

function normalizeCache(c) {
  if (c.version === 2) return c;
  const out = { version: 2 };
  for (const [rel, entry] of Object.entries(c)) {
    if (rel === "version" || !entry || typeof entry !== "object") continue;
    const sites = {};
    for (const [logId, line] of Object.entries(entry.sites ?? {}))
      sites[String(line)] = Number(logId); // id->line  =>  line->id
    out[rel] = { hash: entry.hash, sites };
  }
  return out;
}

// Memoized reverse lookup (logId -> cached line) over the inverted cache.
const reverseCache = new Map();
function cachedLineFor(srcFile, logId) {
  let m = reverseCache.get(srcFile);
  if (!m) {
    m = new Map();
    for (const [line, id] of Object.entries(hashCache[srcFile]?.sites ?? {}))
      m.set(Number(id), Number(line));
    reverseCache.set(srcFile, m);
  }
  return m.has(Number(logId)) ? m.get(Number(logId)) : null;
}

function fileHash(absPath) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(absPath))
    .digest("hex");
}

// ---- file list -----------------------------------------------------------

const projectList = project === "all" ? Object.keys(PROJECT_DIRS) : [project];
const allFiles = [
  ...new Set(projectList.flatMap((p) => findProjectFiles(p, REPO_ROOT))),
];

const files = forceAll
  ? allFiles
  : allFiles.filter((f) => {
      const rel = path.relative(REPO_ROOT, f);
      return fileHash(f) !== hashCache[rel]?.hash;
    });

console.log(
  `[run-reconcile] ${project}: ${files.length}/${allFiles.length} files to process`,
); // no-unilog

// ---- reconcile -----------------------------------------------------------

// pendingRefreshes: sites to write to DB (all in --force, changed-only otherwise).
// actuallyChangedByFile: sites whose line number differs from cache (for reporting).
const pendingRefreshes = [];
const actuallyChangedByFile = {};
const currentSitesByFile = {};
function refreshSiteFn({ logId, srcFile, srcLine, project }) {
  if (!currentSitesByFile[srcFile]) currentSitesByFile[srcFile] = {};
  currentSitesByFile[srcFile][String(srcLine)] = logId; // inverted: line -> id
  const changed = cachedLineFor(srcFile, logId) !== srcLine;
  if (changed) {
    actuallyChangedByFile[srcFile] = (actuallyChangedByFile[srcFile] ?? 0) + 1;
  }
  if (forceAll || changed)
    pendingRefreshes.push({ logId, srcFile, srcLine, project });
}

// ---- duplicate log_id repair (runs BEFORE the main pass) ------------------
// Collect every active site across the whole codebase: a fresh source scan for
// the files we're about to process (with id byte offsets for rewriting) plus the
// cached {line: id} entries for unchanged files. Any id appearing more than once
// is a duplicate; all-but-one occurrence in a CHANGED file gets a fresh id
// (createDuplicateSiteFn) and its `unilog(<id>` is rewritten in place. After this
// every id is unique, so the main pass emits clean, non-oscillating refreshes.
async function repairDuplicates() {
  const changedSet = new Set(files.map((f) => path.relative(REPO_ROOT, f)));
  const sites = [];
  const hitIndex = new Map(); // `${rel}#${line}` -> { abs, idStart, idEnd }
  for (const abs of files) {
    const rel = path.relative(REPO_ROOT, abs);
    const text = fs.readFileSync(abs, "utf8");
    for (const h of findLogCalls(text, { vue: abs.endsWith(".vue") })) {
      if (h.kind !== "active") continue;
      sites.push({ rel, line: h.line, logId: h.logId, changed: true });
      hitIndex.set(`${rel}#${h.line}`, {
        abs,
        idStart: h.idStart,
        idEnd: h.idEnd,
      });
    }
  }
  for (const [rel, entry] of Object.entries(hashCache)) {
    if (rel === "version" || changedSet.has(rel)) continue;
    for (const [line, logId] of Object.entries(entry.sites ?? {}))
      sites.push({
        rel,
        line: Number(line),
        logId: Number(logId),
        changed: false,
      });
  }

  const { groups, reassign } = findDuplicateIds(sites);
  if (reassign.length === 0) {
    if (groups)
      console.log(
        `[run-reconcile] ${groups} duplicate id group(s) — no rewritable occurrence`,
      ); // no-unilog
    return;
  }

  const byAbs = new Map(); // abs -> [{ logId, line, idStart, idEnd }]
  for (const o of reassign) {
    const hit = hitIndex.get(`${o.rel}#${o.line}`);
    if (!hit) continue; // occurrence lives in an unchanged file — never rewritten
    if (!byAbs.has(hit.abs)) byAbs.set(hit.abs, []);
    byAbs.get(hit.abs).push({ logId: o.logId, line: o.line, ...hit });
  }

  let total = 0;
  for (const [abs, list] of byAbs) {
    const rel = path.relative(REPO_ROOT, abs);
    const proj = projectOf(rel);
    let text = fs.readFileSync(abs, "utf8");
    list.sort((a, b) => b.idStart - a.idStart); // end-to-start: keep offsets valid
    for (const r of list) {
      const newId = await createDuplicateSiteFn({
        oldLogId: r.logId,
        project: proj,
        srcFile: rel,
        srcLine: r.line,
      });
      text = text.slice(0, r.idStart) + String(newId) + text.slice(r.idEnd);
      console.log(
        `[run-reconcile] duplicate id ${r.logId} -> ${newId}  ${rel}:${r.line}`,
      ); // no-unilog
      total++;
    }
    fs.writeFileSync(abs, text, "utf8");
  }
  console.log(
    `[run-reconcile] repaired ${total} duplicate id(s) in ${byAbs.size} file(s)`,
  ); // no-unilog
}

await repairDuplicates();

const summary = await reconcileFilesWithDb(files, {
  createSiteFn,
  refreshSiteFn,
  repoRoot: REPO_ROOT,
});

// dbChangedCount is set inside flushRefreshes after comparing against DB.
let dbChangedCount = 0;

// ---- inject unilog import BEFORE flushing --------------------------------
// Injection adds a line at the top, shifting every subsequent line by 1.
// Must happen before flushRefreshes so the DB gets the final line numbers.

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

// Re-scan all processed files to capture post-injection line numbers.
// This replaces the pre-injection positions buffered by refreshSiteFn and
// rebuilds currentSitesByFile (inverted line -> id) for the cache write below.
pendingRefreshes.length = 0;
for (const f of files) {
  const rel = path.relative(REPO_ROOT, f);
  const proj = projectOf(rel);
  const text = fs.readFileSync(f, "utf8");
  const { refreshes } = scanText(text, rel, { vue: f.endsWith(".vue") });
  currentSitesByFile[rel] = {};
  for (const r of refreshes) {
    currentSitesByFile[rel][String(r.srcLine)] = r.logId;
    pendingRefreshes.push({
      logId: r.logId,
      srcFile: rel,
      srcLine: r.srcLine,
      project: proj,
    });
  }
}

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

// ---- report --------------------------------------------------------------

const totalChecked = Object.values(currentSitesByFile).reduce(
  (n, s) => n + Object.keys(s).length,
  0,
);
const totalCacheMisses = Object.values(actuallyChangedByFile).reduce(
  (n, c) => n + c,
  0,
);

let totalCreated = 0;
for (const s of summary) {
  const rel = path.relative(REPO_ROOT, s.file).replace(/\\/g, "/");
  const changed = actuallyChangedByFile[rel] ?? 0;
  if (s.created || changed)
    console.log(
      `  ${rel.replace(/^.*apps\//, "apps/")}  +${s.created} sites, ${changed} lines moved`,
    ); // no-unilog
  totalCreated += s.created || 0;
}
console.log(
  `[run-reconcile] files processed: ${files.length}/${allFiles.length}`,
); // no-unilog
console.log(`[run-reconcile] sites checked:   ${totalChecked}`); // no-unilog
console.log(`[run-reconcile] cache misses:    ${totalCacheMisses}`); // no-unilog
console.log(`[run-reconcile] written to db:   ${dbChangedCount}`); // no-unilog
console.log(`[run-reconcile] new sites:       ${totalCreated}`); // no-unilog

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
