// unilog reconciler — runs at DEPLOY ONLY (never on process start) on changed
// files. It activates `// unilog-stub` lines, auto-upgrades leftover old-style
// single-literal logs, refreshes src_file/src_line for existing `// log-id:`
// sites, and reports the site rows to upsert via the single DB owner (tv-srvr).
//
// The pure core (reconcileLines / reconcileText) takes an id allocator callback
// so it can be unit-tested without a DB. The DB-backed driver is separate.
// (unilog plumbing — uses console with `// no-unilog`.)

import crypto from "node:crypto";
import {
  parseStub,
  activateStub,
  upgradeLine,
  parseLogId,
} from "./unilog-lib.js";

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function projectOf(file) {
  const m =
    /apps\/([A-Za-z0-9_-]+)\//.exec(file) ||
    /packages\/([A-Za-z0-9_-]+)\//.exec(file);
  return m ? m[1] : null;
}

// Phase 1: read-only scan. Returns new sites to CREATE (top-to-bottom order)
// and existing sites to REFRESH — without modifying anything.
export function scanLines(lines, srcFile) {
  const creates = [];
  const refreshes = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const existingId = parseLogId(line);
    if (existingId != null) {
      refreshes.push({ logId: existingId, srcFile, srcLine: i + 1 });
      continue;
    }
    const stub = parseStub(line);
    if (stub) {
      creates.push({
        kind: "stub",
        level: stub.level,
        tag: stub.tag,
        argExpr: stub.argExpr,
        srcLine: i + 1,
      });
      continue;
    }
    const up = upgradeLine(line);
    if (up.upgradeable)
      creates.push({
        kind: "upgrade",
        level: up.level,
        tag: up.tag,
        argExpr: up.argExpr,
        srcLine: i + 1,
      });
  }
  return { creates, refreshes };
}

// Phase 2: rewrite pass. `nextId()` MUST return ids in the same top-to-bottom
// order as scanLines() produced `creates`, so ids line up with their sites.
export function reconcileLines(lines, srcFile, nextId) {
  const out = lines.slice();
  const refreshes = [];
  let changed = false;
  for (let i = 0; i < out.length; i++) {
    const line = out[i];
    const existingId = parseLogId(line);
    if (existingId != null) {
      refreshes.push({ logId: existingId, srcFile, srcLine: i + 1 });
      continue;
    }
    const stub = parseStub(line);
    if (stub) {
      out[i] = activateStub(line, nextId()).line;
      changed = true;
      continue;
    }
    const up = upgradeLine(line);
    if (up.upgradeable) {
      const indent = /^(\s*)/.exec(line)[1];
      const id = nextId();
      out[i] = `${indent}unilog(${id}, ${up.argExpr}); // log-id: ${id}`;
      changed = true;
    }
  }
  return { lines: out, refreshes, changed };
}

export function reconcileText(text, srcFile, nextId) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const r = reconcileLines(text.split(/\r?\n/), srcFile, nextId);
  return { ...r, text: r.lines.join(nl) };
}

// DB-backed driver (remote only — tv-srvr owns the DB). Lazily imports the DB
// module so the pure core above stays importable without opening the DB.
export async function reconcileFilesWithDb(files, { dryRun = false } = {}) {
  const fs = await import("node:fs");
  const unilogDb = dryRun ? null : await import("../apps/srvr/src/unilogDb.js");

  const summary = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    const { creates, refreshes } = scanLines(lines, file);
    if (creates.length === 0 && refreshes.length === 0) {
      summary.push({ file, changed: false, created: 0, refreshed: 0 });
      continue;
    }

    // Allocate real ids by creating the rows now (atomic alloc+insert),
    // in the same order scanLines produced them.
    const project = projectOf(file);
    const realIds = dryRun
      ? creates.map((_, i) => i + 1)
      : creates.map((c) =>
          unilogDb.createSite({
            level: c.level,
            tag: c.tag,
            description: null,
            srcFile: file,
            srcLine: c.srcLine,
            project,
            groupIds: [],
          }),
        );

    let k = 0;
    const r = reconcileText(text, file, () => realIds[k++]);
    if (!dryRun) {
      fs.writeFileSync(file, r.text, "utf8");
      for (const rf of r.refreshes)
        unilogDb.refreshSite({
          logId: rf.logId,
          srcFile: file,
          srcLine: rf.srcLine,
        });
    }
    summary.push({
      file,
      changed: r.changed,
      created: creates.length,
      refreshed: refreshes.length,
    });
  }
  return summary;
}
