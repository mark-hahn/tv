// unilog reconciler — runs at DEPLOY ONLY (never on process start) on changed
// files. It auto-upgrades old-style single-literal logs, refreshes src_file/src_line
// for existing active sites, and reports site rows to upsert via the single DB
// owner (tv-srvr).
//
// The pure core (reconcileLines / reconcileText) takes an id allocator callback
// so it can be unit-tested without a DB. The DB-backed driver is separate.
// (unilog plumbing — uses console with `// no-unilog`.)

import crypto from "node:crypto";
import { levelForCall, extractLeadingTag } from "./unilog-lib.js";
import { findLogCalls } from "./parse.js";

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function projectOf(file) {
  // Use the LAST `apps/<name>` match so absolute paths like
  // `/root/apps/tv/apps/srvr/index.js` resolve to "srvr", not "tv".
  const appMatches = [...file.matchAll(/apps\/([A-Za-z0-9_-]+)\//g)];
  if (appMatches.length > 0) return appMatches[appMatches.length - 1][1];
  const m = /packages\/([A-Za-z0-9_-]+)\//.exec(file);
  return m ? m[1] : null;
}

// Strip a leading [tag] from an AST literal and return { grpName, argExpr }.
// Build args expression: copy ALL args verbatim; strip a leading [tag] from
// the first literal arg. Returns { grpName, argExpr } where grpName is the
// extracted tag now used as a group name, or null.
function buildArgs(argsText, firstLiteral) {
  let grpName = null;
  const parts = argsText.slice();
  if (firstLiteral && parts.length) {
    const a = parts[0];
    const q = a[0];
    const ex = extractLeadingTag(a.slice(1, -1));
    grpName = ex.tag;
    parts[0] = `${q}${ex.content}${q}`;
  }
  return { grpName, argExpr: parts.join(", ") };
}

// From the AST: upgrades (old-style calls) and actives (existing unilog calls).
function astSites(text, vue) {
  const calls = findLogCalls(text, { vue });
  const lineArr = text.split(/\r?\n/);
  const upgrades = [];
  const actives = [];
  for (const c of calls) {
    if (c.kind === "active") {
      actives.push({
        logId: c.logId,
        startLine: c.line,
        endLine: text.slice(0, c.end).split(/\r?\n/).length,
      });
      continue;
    }
    if (/\/\/\s*no-unilog\s*$/.test(lineArr[c.line - 1] || "")) continue; // opt-out
    const endLine = text.slice(0, c.end).split(/\r?\n/).length;

    let level, tag, argExpr;
    let grpNames = [];
    let grpTyp = null;
    if (c.callee === "logHere") {
      // logHere carries its groups in the param object. Single message arg only.
      // Empty message arg becomes the "<missing>" sentinel.
      level = c.level;
      tag = null;
      grpNames = c.grpNames || [];
      grpTyp = c.grpTyp ?? null;
      argExpr = c.argsText.length ? c.argsText[0] : '"<missing>"';
    } else {
      // console.*, log(), loge(), logSubtitle(): strip a leading [tag] from the
      // first literal into a group; derive level from the method.
      const b = buildArgs(c.argsText, c.firstLiteral);
      tag = null;
      grpNames = b.grpName ? [b.grpName] : [];
      argExpr = b.argExpr;
      level = c.level ?? levelForCall(c.callee, c.method);
    }
    upgrades.push({
      start: c.start,
      end: c.end,
      startLine: c.line,
      endLine,
      level,
      tag,
      argExpr,
      grpNames,
      grpTyp,
    });
  }
  return { upgrades, actives };
}

// Phase 1: read-only scan. Returns new sites to CREATE (top-to-bottom order)
// and existing sites to REFRESH — without modifying anything.
export function scanText(text, srcFile, { vue = false } = {}) {
  const { upgrades, actives } = astSites(text, vue);
  const creates = upgrades.map((u) => ({
    kind: "upgrade",
    level: u.level,
    tag: u.tag,
    argExpr: u.argExpr,
    grpNames: u.grpNames,
    grpTyp: u.grpTyp,
    srcLine: u.startLine,
  }));
  const refreshes = actives.map((a) => ({
    logId: a.logId,
    srcFile,
    srcLine: a.startLine,
  }));
  creates.sort((a, b) => a.srcLine - b.srcLine);
  return { creates, refreshes };
}

// Phase 2: rewrite. `nextId()` returns ids in source order. Old-style calls are
// replaced by exact AST byte offsets (bullet-proof for calls inside any
// expression), applied end-to-start so offsets stay valid.
export function reconcileText(text, srcFile, nextId, { vue = false } = {}) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const { upgrades, actives } = astSites(text, vue);
  const refreshes = actives.map((a) => ({
    logId: a.logId,
    srcFile,
    srcLine: a.startLine,
  }));

  // Allocate ids in source order.
  const lines = text.split(/\r?\n/);

  const ordered = upgrades
    .map((u) => ({ kind: "u", line: u.startLine, u }))
    .sort((a, b) => a.line - b.line);
  const idFor = new Map();
  for (const item of ordered) idFor.set(item, nextId());

  let changed = false;
  let out = lines.join(nl);

  // Old-style by offsets, end-to-start.
  const ups = ordered
    .filter((o) => o.kind === "u")
    .map((o) => ({ ...o.u, id: idFor.get(o) }));
  ups.sort((a, b) => b.start - a.start);
  for (const u of ups) {
    out =
      out.slice(0, u.start) +
      `unilog(${u.id}, ${u.argExpr})` +
      out.slice(u.end);
    changed = true;
  }
  return { lines: out.split(nl), refreshes, changed, text: out };
}

// Given every active site across the codebase, decide which occurrences must be
// re-id'd so each log_id is unique. A duplicate group is any log_id with >1
// occurrence. Keeper rule: prefer an occurrence in an UNCHANGED file (its source
// is never rewritten); otherwise the first by (file, line). Only occurrences in
// CHANGED files are reassignable; unchanged source is never modified.
//   sites: [{ rel, line, logId, changed, ...extra }] (extra preserved on output)
//   returns: { groups, reassign } where reassign is the subset to re-id.
export function findDuplicateIds(sites) {
  const byId = new Map();
  for (const s of sites) {
    if (!byId.has(s.logId)) byId.set(s.logId, []);
    byId.get(s.logId).push(s);
  }
  const reassign = [];
  let groups = 0;
  for (const list of byId.values()) {
    if (list.length < 2) continue;
    groups++;
    const sorted = [...list].sort((a, b) =>
      a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : a.line - b.line,
    );
    let keeper = sorted.findIndex((o) => !o.changed);
    if (keeper < 0) keeper = 0;
    sorted.forEach((o, i) => {
      if (i === keeper) return;
      if (!o.changed) return; // never rewrite unchanged source
      reassign.push(o);
    });
  }
  return { groups, reassign };
}

// Back-compat wrappers (line-array based) used by older callers/tests.
export function scanLines(lines, srcFile, { vueFile = false } = {}) {
  return scanText(lines.join("\n"), srcFile, { vue: vueFile });
}
export function reconcileLines(
  lines,
  srcFile,
  nextId,
  { vueFile = false } = {},
) {
  const r = reconcileText(lines.join("\n"), srcFile, nextId, { vue: vueFile });
  return { lines: r.lines, refreshes: r.refreshes, changed: r.changed };
}

// DB-backed driver. `createSiteFn(siteData)` must return a Promise<logId>.
// When running ON the remote, pass a wrapper around unilogDb.createSite.
// When running locally, pass a function that POSTs to the srvr HTTPS endpoint.
export async function reconcileFilesWithDb(
  files,
  {
    dryRun = false,
    createSiteFn = null,
    refreshSiteFn = null,
    repoRoot = null,
  } = {},
) {
  const fs = await import("node:fs");
  const pathMod = await import("node:path");

  if (!dryRun && !createSiteFn) {
    const unilogDb = await import("../apps/srvr/src/unilogDb.js");
    // Resolve any declared group names to ids (find-or-create) before insert.
    createSiteFn = (s) => {
      const groupIds = (s.grpNames || []).map(
        (name) =>
          unilogDb.findOrCreateGroup({ description: name, groupType: s.grpTyp })
            .id,
      );
      return Promise.resolve(unilogDb.createSite({ ...s, groupIds }));
    };
    refreshSiteFn = (s) => Promise.resolve(unilogDb.refreshSite(s));
  }

  const summary = [];
  for (const file of files) {
    const vue = file.endsWith(".vue");
    const text = fs.readFileSync(file, "utf8");
    const { creates, refreshes } = scanText(text, file, { vue });
    if (creates.length === 0 && refreshes.length === 0) {
      summary.push({ file, changed: false, created: 0, refreshed: 0 });
      continue;
    }

    // src_file stored relative to repoRoot so DB entries are portable and
    // match the deployed remote path structure (e.g. "apps/srvr/index.js").
    const srcFile = repoRoot
      ? pathMod.relative(pathMod.resolve(repoRoot), pathMod.resolve(file))
      : file;
    const project = projectOf(srcFile);

    let realIds;
    if (dryRun) {
      realIds = creates.map((_, i) => i + 1);
    } else {
      realIds = [];
      for (const c of creates) {
        const id = await createSiteFn({
          level: c.level,
          tag: c.tag,
          description: null,
          srcFile,
          srcLine: c.srcLine,
          project,
          grpNames: c.grpNames || [],
          grpTyp: c.grpTyp ?? null,
        });
        realIds.push(id);
      }
      if (refreshSiteFn) {
        for (const r of refreshes) {
          await refreshSiteFn({
            logId: r.logId,
            srcFile,
            srcLine: r.srcLine,
            project,
          });
        }
      }
    }

    let k = 0;
    const r = reconcileText(text, file, () => realIds[k++], { vue });
    if (!dryRun) fs.writeFileSync(file, r.text, "utf8");
    summary.push({
      file,
      changed: r.changed,
      created: creates.length,
      refreshed: refreshes.length,
    });
  }
  return summary;
}
