// unilog/hide.js — comment out / restore `unilog(<id>, ...)` call sites in the
// local source tree. Used only by the local Vite dev middleware behind the log
// viewer's "Hide Sites" / "Unhide Sites" actions.
//
// The local workspace is the source of truth; the reconciler runs locally at
// `./srvr` deploy. A hidden site is a `unilog(...)` call with `// hidden `
// prepended to every line of the call, turning it into a comment. Because it is
// a comment, the AST-based reconciler (parse.js) no longer sees it, so the
// deploy conversion naturally ignores hidden sites — no reconciler change
// needed. Unhiding strips the `// hidden ` prefix, restoring the live call.
// (unilog plumbing — uses console with `// no-unilog`.)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findLogCalls } from "./parse.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, ".."); // /root/apps/tv
const CACHE_PATH = path.join(HERE, "reconcile-cache.json");
const PREFIX = "// hidden ";
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

// Comment out the given site ids in `text`. Returns { text, hidden: number[] }.
export function hideInText(text, ids, vue = false) {
  const nl = newlineOf(text);
  const lines = text.split(/\r?\n/);
  const spans = activeSpans(text, vue);
  const hidden = [];
  for (const id of ids) {
    const span = spans.get(id);
    if (!span) continue; // not an active call (already hidden / gone)
    if (NO_UNILOG.test(lines[span.start - 1] || "")) continue; // opt-out
    for (let ln = span.start; ln <= span.end; ln++) {
      const idx = ln - 1;
      if (!lines[idx].startsWith(PREFIX)) lines[idx] = PREFIX + lines[idx];
    }
    hidden.push(id);
  }
  return { text: lines.join(nl), hidden };
}

// Restore (uncomment) the given site ids in `text`.
// Returns { text, unhidden: number[] }.
export function unhideInText(text, ids, vue = false) {
  const nl = newlineOf(text);
  let lines = text.split(/\r?\n/);
  const unhidden = [];
  for (const id of ids) {
    // Locate the start of the hidden block containing unilog(<id>,...).
    // Handles single-line: `// hidden   unilog(<id>, ...)`
    // and multi-line:      `// hidden   unilog(\n// hidden     <id>,\n...`
    const inlineRe = new RegExp(`^unilog\\(\\s*${id}\\s*,`);
    const idArgRe = new RegExp(`^${id}\\s*,`);
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith(PREFIX)) continue;
      const content = lines[i].slice(PREFIX.length).trimStart();
      if (inlineRe.test(content)) {
        startIdx = i;
        break;
      }
      if (idArgRe.test(content)) {
        // id is on its own line; walk backward within the // hidden block
        // to find the unilog( opening line.
        for (let j = i - 1; j >= 0; j--) {
          if (!lines[j].startsWith(PREFIX)) break;
          if (/^unilog\(/.test(lines[j].slice(PREFIX.length).trimStart())) {
            startIdx = j;
            break;
          }
        }
        break;
      }
    }
    if (startIdx === -1) continue;
    // Maximal contiguous run of `// hidden ` lines from the start. A run is a
    // sequence of complete (once-live) unilog statements, so stripping it is
    // valid JS and the AST can then report the exact span for this id.
    let runEnd = startIdx;
    while (runEnd + 1 < lines.length && lines[runEnd + 1].startsWith(PREFIX))
      runEnd++;
    const trial = lines.slice();
    for (let i = startIdx; i <= runEnd; i++)
      trial[i] = trial[i].slice(PREFIX.length);
    const span = activeSpans(trial.join(nl), vue).get(id);
    if (!span) continue; // could not reconstruct — leave untouched
    for (let ln = span.start; ln <= span.end; ln++) {
      const idx = ln - 1;
      if (lines[idx].startsWith(PREFIX))
        lines[idx] = lines[idx].slice(PREFIX.length);
    }
    unhidden.push(id);
  }
  return { text: lines.join(nl), unhidden };
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
    if (!span) continue; // not an active call (already hidden / gone)
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
    // carried from the log row (the cache prunes hidden sites at deploy, so
    // unhide-after-deploy relies on this fallback).
    const file = map.get(id) || (typeof s === "object" ? s.srcFile : null);
    if (!file) continue;
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(id);
  }
  return byFile;
}

// Apply hide/unhide/delete to real files on disk. `mode` is "hide" | "unhide" | "delete".
// `sites` is an array of ids or `{ id, srcFile }` objects.
// Returns { changed: number[] } — the ids actually modified.
export function applySites(
  sites,
  mode,
  { root = REPO_ROOT, cachePath = CACHE_PATH } = {},
) {
  const map = siteFileMap(cachePath);
  const byFile = groupByFile(sites, map);
  const changed = [];
  for (const [file, fileIds] of byFile) {
    const abs = path.join(root, file);
    const text = fs.readFileSync(abs, "utf8");
    const vue = file.endsWith(".vue");
    const res =
      mode === "hide"
        ? hideInText(text, fileIds, vue)
        : mode === "unhide"
          ? unhideInText(text, fileIds, vue)
          : deleteInText(text, fileIds, vue);
    const done =
      mode === "hide"
        ? res.hidden
        : mode === "unhide"
          ? res.unhidden
          : res.deleted;
    if (done.length && res.text !== text) fs.writeFileSync(abs, res.text);
    changed.push(...done);
  }
  return { changed };
}
