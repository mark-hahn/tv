#!/usr/bin/env node
// unilog/reseed.js — repopulate log_sites by scanning source files for
// existing `unilog(N, ...)` active calls. Use this after clearing the DB
// while the source files still contain instrumented calls.
//
// Usage: node unilog/reseed.js [srvr] [client] [all]
//   Defaults to "all" when no args given.
//
// Level cannot be recovered from the call site; everything defaults to "info".
// Tag is extracted from a leading [tag] prefix in the first string/template arg.
// (unilog plumbing — console with `// no-unilog`.)

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findLogCalls } from "./parse.js";
import { projectOf } from "./reconcile.js";
import { extractLeadingTag } from "./unilog-lib.js";

const SRVR_HTTPS_URL = "https://hahnca.com/tv-srvr";
const SSH_HOST = "hahnca.com";
const REMOTE_DB = "/root/dev/apps/tv/unilog/unilog.sqlite";
const REPO_ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// ---- file map (same as run-reconcile.js) ----------------------------------

const ALL_FILES = {
  srvr: [
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
  client: [
    "apps/client/src/emby.js",
    "apps/client/src/srvr.js",
    "apps/client/src/tvdb.js",
    "apps/client/src/main.js",
    "apps/client/src/mapUtil.js",
    "apps/client/src/util.js",
    "apps/client/src/globalMessages.js",
    "apps/client/src/paneHelp.js",
    "apps/client/src/components/actors.vue",
    "apps/client/src/components/down.vue",
    "apps/client/src/components/list.vue",
    "apps/client/src/components/local.vue",
    "apps/client/src/components/meta.vue",
    "apps/client/src/components/qbt.vue",
    "apps/client/src/components/usb.vue",
  ],
};

const targets = process.argv.slice(2).filter((a) => a !== "all");
const projects =
  targets.length === 0
    ? Object.keys(ALL_FILES)
    : targets.filter((p) => ALL_FILES[p]);
if (projects.length === 0) {
  console.error("usage: node unilog/reseed.js [srvr] [client] [all]"); // no-unilog
  process.exit(1);
}

// ---- collect active sites from source ------------------------------------

const sites = [];
for (const proj of projects) {
  for (const rel of ALL_FILES[proj]) {
    const abs = path.join(REPO_ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf8");
    const vue = rel.endsWith(".vue");
    const calls = findLogCalls(text, { vue });
    for (const c of calls) {
      if (c.kind !== "active") continue;
      // Extract tag from first string/template arg.
      let tag = null;
      if (c.argsText?.length > 0) {
        const a = c.argsText[0];
        const q = a[0];
        if (q === "`" || q === '"' || q === "'") {
          tag = extractLeadingTag(a.slice(1, -1)).tag;
        }
      }
      const srcFile = path.relative(REPO_ROOT, abs);
      sites.push({
        log_id: c.logId,
        level: "info",
        tag,
        description: null,
        srcFile,
        srcLine: c.line,
        project: projectOf(srcFile),
      });
    }
  }
}

sites.sort((a, b) => a.log_id - b.log_id);
console.log(
  `[reseed] found ${sites.length} active sites across ${projects.join(", ")}`,
); // no-unilog

// ---- write to DB: endpoint first, then ssh fallback ----------------------

async function postJson(p, body) {
  const r = await fetch(`${SRVR_HTTPS_URL}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${p} → ${r.status}: ${await r.text()}`);
  return r.json();
}

const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
function nowPst() {
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

let useSsh = false;
function sqlRun(sql) {
  const r = spawnSync(
    "ssh",
    [SSH_HOST, `sqlite3 ${REMOTE_DB} ${JSON.stringify(sql)}`],
    { encoding: "utf8" },
  );
  if (r.status !== 0)
    throw new Error((r.stderr || "ssh sqlite3 failed").trim());
  return (r.stdout || "").trim();
}

// Probe endpoint.
try {
  await fetch(`${SRVR_HTTPS_URL}/api/unilog/group`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).then((r) => {
    if (!r.ok && r.status !== 400) throw new Error(r.status);
  });
} catch {
  useSsh = true;
  console.log("[reseed] endpoint unreachable — using ssh"); // no-unilog
}

// Create a reseed group.
let groupId;
const ts = nowPst();
const desc = `reseed ${projects.join("+")} ${ts.slice(0, 10)}`;
if (!useSsh) {
  try {
    groupId = (
      await postJson("/api/unilog/group", {
        description: desc,
      })
    ).id;
  } catch {
    useSsh = true;
  }
}
if (useSsh) {
  sqlRun(
    `INSERT INTO log_groups (group_id, ts, description) VALUES ((SELECT COALESCE(MAX(group_id),0)+1 FROM log_groups),${q(ts)},${q(desc)});`,
  );
  groupId = Number(sqlRun("SELECT MAX(group_id) FROM log_groups;"));
}
console.log(`[reseed] group id=${groupId}`); // no-unilog

// Insert all sites in one batched ssh sqlite3 call (fast — one SSH connection).
let inserted = 0;
let skipped = 0;
const existing = new Set(
  sqlRun(`SELECT log_id FROM log_sites;`)
    .split("\n")
    .filter(Boolean)
    .map(Number),
);

const toInsert = sites.filter((s) => !existing.has(s.log_id));
skipped = sites.length - toInsert.length;

if (toInsert.length > 0) {
  const statements = toInsert.flatMap((s) => [
    `INSERT INTO log_sites (log_id, tag, description, level, src_file, src_line, project, created_at) ` +
      `VALUES (${s.log_id}, ${q(s.tag)}, NULL, ${q(s.level)}, ${q(s.srcFile)}, ${s.srcLine}, ${q(s.project)}, ${q(ts)});`,
    `INSERT OR IGNORE INTO site_groups (log_id, group_id) VALUES (${s.log_id}, ${groupId});`,
  ]);
  // Write SQL to a temp file piped over ssh to avoid shell quoting limits.
  const script = "BEGIN;\n" + statements.join("\n") + "\nCOMMIT;";
  const r = spawnSync("ssh", [SSH_HOST, `sqlite3 ${REMOTE_DB}`], {
    input: script,
    encoding: "utf8",
  });
  if (r.status !== 0)
    throw new Error((r.stderr || "batch insert failed").trim());
  inserted = toInsert.length;
}

console.log(
  `[reseed] inserted ${inserted}, skipped (already existed) ${skipped}`,
); // no-unilog
console.log(`[reseed] done.`); // no-unilog
