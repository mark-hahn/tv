// unilog/delete.js — remove `unilog(<id>, ...)` call sites from the local
// source tree. Used only by the local Vite dev middleware behind the log
// viewer's "Delete Sites" action.
//
// The local workspace is the source of truth; the reconciler runs locally at
// `./srvr` deploy, so a deleted call disappears from the cache on the next
// deploy. (unilog plumbing — uses console with `// no-unilog`.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findLogCalls } from "./parse.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, ".."); // /root/apps/tv
const CACHE_PATH = path.join(HERE, "reconcile-cache.json");
const NO_UNILOG = /\/\/\s*no-unilog\s*$/;

// Build { id -> srcFile } from reconcile-cache.json — the authoritative
// id -> file map maintained by the reconciler.
export function siteFileMap(cachePath = CACHE_PATH) {
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const map = new Map();
  for (const [file, entry] of Object.entries(cache)) {
    if (file === "version" || !entry || !entry.sites) continue;
    for (const logId of Object.values(entry.sites))
      map.set(Number(logId), file);
  }
  return map;
}

// logId -> { start, end } (1-based line span) for every active unilog() call.
function activeSpans(text, vue) {
  const spans = new Map();
  for (const c of findLogCalls(text, { vue })) {
    if (c.kind !== "active") continue;
    const endLine = text.slice(0, c.end).split(/\r?\n/).length;
    spans.set(c.logId, { start: c.line, end: endLine });
  }
  return spans;
}

function newlineOf(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

// Delete the given site ids from `text`. Completely removes the lines.
// Returns { text, deleted: number[] }.
export function deleteInText(text, ids, vue = false) {
  const nl = newlineOf(text);
  const lines = text.split(/\r?\n/);
  const spans = activeSpans(text, vue);
  const deleted = [];
  // Collect all line indices to delete, then delete in reverse order
  const toDelete = [];
  for (const id of ids) {
    const span = spans.get(id);
    if (!span) continue; // not an active call (already gone)
    if (NO_UNILOG.test(lines[span.start - 1] || "")) continue; // opt-out
    for (let ln = span.start; ln <= span.end; ln++) {
      toDelete.push(ln - 1); // convert to 0-based index
    }
    deleted.push(id);
  }
  // Sort and deduplicate line indices, then delete in reverse order
  const uniqueIndices = [...new Set(toDelete)].sort((a, b) => b - a);
  for (const idx of uniqueIndices) {
    lines.splice(idx, 1);
  }
  return { text: lines.join(nl), deleted };
}

function groupByFile(sites, map) {
  const byFile = new Map();
  for (const s of sites) {
    const id = Number(typeof s === "object" ? s.id : s);
    if (!Number.isFinite(id)) continue;
    // Prefer the current cache location; fall back to the srcFile the client
    // carried from the log row.
    const file = map.get(id) || (typeof s === "object" ? s.srcFile : null);
    if (!file) continue;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(id);
  }
  return byFile;
}

// Delete sites from real files on disk. `sites` is an array of ids or
// `{ id, srcFile }` objects. Returns { changed: number[] } — the ids actually
// removed.
export function deleteSites(
  sites,
  { root = REPO_ROOT, cachePath = CACHE_PATH } = {},
) {
  const map = siteFileMap(cachePath);
  const byFile = groupByFile(sites, map);
  const changed = [];
  for (const [file, fileIds] of byFile) {
    const abs = path.join(root, file);
    const text = fs.readFileSync(abs, "utf8");
    const vue = file.endsWith(".vue");
    const res = deleteInText(text, fileIds, vue);
    if (res.deleted.length && res.text !== text) fs.writeFileSync(abs, res.text);
    changed.push(...res.deleted);
  }
  return { changed };
}
