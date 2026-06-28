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
  // Use the LAST `apps/<name>` match so absolute paths like
  // `/root/apps/tv/apps/srvr/index.js` resolve to "srvr", not "tv".
  const appMatches = [...file.matchAll(/apps\/([A-Za-z0-9_-]+)\//g)];
  if (appMatches.length > 0) return appMatches[appMatches.length - 1][1];
  const m = /packages\/([A-Za-z0-9_-]+)\//.exec(file);
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

// DB-backed driver. `createSiteFn(siteData)` must return a Promise<logId>.
// When running ON the remote, pass a wrapper around unilogDb.createSite.
// When running locally, pass a function that POSTs to the srvr HTTPS endpoint.
export async function reconcileFilesWithDb(
  files,
  { dryRun = false, createSiteFn = null, groupIds = [], repoRoot = null } = {},
) {
  const fs = await import("node:fs");
  const pathMod = await import("node:path");

  if (!dryRun && !createSiteFn) {
    const unilogDb = await import("../apps/srvr/src/unilogDb.js");
    createSiteFn = (s) => Promise.resolve(unilogDb.createSite(s));
  }

  const summary = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    const { creates, refreshes } = scanLines(lines, file);
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
          groupIds,
        });
        realIds.push(id);
      }
    }

    let k = 0;
    const r = reconcileText(text, file, () => realIds[k++]);
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
