// Weekly cleanup of files that can never be needed again. Under the tv show
// folders: Emby trickplay indexes (`.bif` / `.bifx`, plus any `.old` copies),
// and orphaned sidecars -- subtitle, metadata, artwork and marker files whose
// video file is no longer on disk. Outside them, two trees that only ever grow:
// the mpfour mp4 mirrors and the originals recode.js moves aside, both expired
// a month after they were written.
//
// Only files carrying a known sidecar extension are ever considered, so a video
// with an odd or missing extension is never at risk. Every delete is appended to
// a flat log file; the scan as a whole emits a single unilog event with totals.
//
// Run it by hand with `node apps/srvr/src/oldFiles.js` to get the report without
// touching anything (add `--verbose` for the full per-file list); `--delete`
// performs the deletes.

import fs from "fs";
import * as path from "node:path";
import { logHere, unilog} from "@tv/share"
import { SRVR_DATA_DIR } from "./srvrPaths.js";
import { videoFileExtensions } from "./videoFiles.js";

const TV_DIR = "/mnt/media/tv";
// Repeated from mpfour.js and recode.js rather than imported: this file is also
// a standalone report runner (`node apps/srvr/src/oldFiles.js`), and mpfour.js
// pulls in tvdb.js, whose save machinery keeps the process alive forever.
const MPFOUR_DIR = "/mnt/media/mpfour";
const MPFOUR_SIDECAR_SUFFIX = ".src.json";
const RECODE_ORIGINALS_DIR = "/mnt/media/tv-recode-originals";
const RECODE_SIDECAR_SUFFIX = ".recode.json";
const DELETE_LOG_PATH = path.join(SRVR_DATA_DIR, "auto-deleted-files.log");
const CLEANUP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
// How long a mirror or a moved-aside original is kept. Long enough that a show
// watched today can still be re-checked in chksrt or rolled back to its original
// file weeks later, short enough that neither tree grows without bound.
const PURGE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// The only extensions this cleanup will ever delete. A file is a deletion
// candidate solely because it is one of these and its video is gone -- nothing
// is judged by its extension being unexpected, so a mislabeled video survives.
const SIDECAR_SUFFIXES = new Set([
  "srt",
  "ass",
  "ssa",
  "asa",
  "sub",
  "idx",
  "nfo",
  "jpg",
  "jpeg",
  "png",
  "chosen",
  "sfv",
  "srr",
]);

// Emby trickplay indexes. Emby rebuilds them on demand, so they are dropped
// whether or not their video is still there -- including any `.bif.old` copies
// left behind by an earlier rename.
const TRICKPLAY_SUFFIXES = new Set(["bif", "bifx"]);

const RULE_ORPHAN = "orphan-sidecar";
const RULE_BIF = "trickplay-index";
const RULE_MPFOUR = "mpfour-expired";
const RULE_RECODE_ORIGINAL = "recode-original-expired";

// Emby library artwork/metadata belongs to the show or the season, not to any
// one video, so it must never count as orphaned.
const EMBY_META_NAMES = new Set([
  ".embyname",
  "tvshow.nfo",
  "season.nfo",
  "poster.jpg",
  "poster.png",
  "fanart.jpg",
  "fanart.png",
  "banner.jpg",
  "banner.png",
  "landscape.jpg",
  "landscape.png",
  "thumb.jpg",
  "thumb.png",
  "folder.jpg",
  "folder.png",
  "logo.png",
  "clearlogo.png",
  "clearart.png",
  "disc.png",
  "backdrop.jpg",
  "backdrop.png",
]);

const EMBY_META_PATTERNS = [
  /^season\d+-(poster|banner|landscape|fanart)\.(jpg|png)$/i,
  /^season-specials-(poster|banner)\.(jpg|png)$/i,
  /^(backdrop|fanart|extrafanart)\d+\.(jpg|png)$/i,
];

const VIDEO_EXTS = new Set(videoFileExtensions.map((e) => e.toLowerCase()));

const pstStamp = (date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const f = {};
  for (const { type, value } of parts) f[type] = value;
  const hour = f.hour === "24" ? "00" : f.hour;
  return `${f.month}-${f.day} ${hour}:${f.minute}`;
};

const extOf = (name) => {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
};

// Drop the trailing run of `.old` / `.alt` markers so a superseded copy still
// counts as the video its sidecars belong to.
const stripChain = (name) => {
  let rest = name;
  for (;;) {
    const m = /\.(old|alt)$/i.exec(rest);
    if (!m) return rest;
    rest = rest.slice(0, -m[0].length);
  }
};

const isEmbyMeta = (name) => {
  const lower = name.toLowerCase();
  if (EMBY_META_NAMES.has(lower)) return true;
  return EMBY_META_PATTERNS.some((re) => re.test(lower));
};

// Every file under root, grouped by the directory that holds it.
function collectDirs(root) {
  const byDir = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      unilog(2068, `old file cleanup cannot read ${dir}: ${e.message}`);
      return;
    }
    const files = [];
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        size = 0;
      }
      files.push({ name: ent.name, path: full, size });
    }
    if (files.length) byDir.set(dir, files);
  };
  walk(root);
  return byDir;
}

// Deletable files in one directory: every trickplay index, plus sidecars whose
// video file is gone.
function planDir(dir, files) {
  // Video base names in this directory, lowercased, chain markers stripped.
  const stems = [];
  for (const f of files) {
    const bare = stripChain(f.name);
    const ext = extOf(bare);
    if (!VIDEO_EXTS.has(ext)) continue;
    stems.push(bare.slice(0, -(ext.length + 1)).toLowerCase());
  }

  const deletes = [];
  for (const f of files) {
    const ext = extOf(stripChain(f.name));
    if (TRICKPLAY_SUFFIXES.has(ext)) {
      deletes.push({ ...f, dir, rule: RULE_BIF });
      continue;
    }
    if (!SIDECAR_SUFFIXES.has(ext)) continue;
    if (isEmbyMeta(f.name)) continue;
    const lower = f.name.toLowerCase();
    if (stems.some((s) => s && lower.startsWith(s))) continue;
    deletes.push({ ...f, dir, rule: RULE_ORPHAN });
  }
  return deletes;
}

// Every file under a tree, flat. Used for the two purge trees, which are small
// and have no per-directory rules -- unlike the show folders, where planDir
// needs each directory's video stems.
function collectFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      unilog(2252, `cannot read ${dir}: ${e.message}`);
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        size = 0;
      }
      out.push({ name: ent.name, path: full, size });
    }
  };
  walk(root);
  return out;
}

// mpfour mirrors older than PURGE_AGE_MS, each with its .src.json. The mirror
// is written when the encode finishes, so its own mtime is the age -- no
// sidecar read needed, and a mirror rebuilt for a replaced release restarts
// the clock on its own.
function planMpfour(files) {
  const cutoff = Date.now() - PURGE_AGE_MS;
  const deletes = [];
  for (const f of files) {
    if (!f.name.endsWith(".mp4")) continue;
    let mtimeMs;
    try {
      mtimeMs = fs.statSync(f.path).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs >= cutoff) continue;
    deletes.push({ ...f, dir: path.dirname(f.path), rule: RULE_MPFOUR });
    const sidecar = f.path + MPFOUR_SIDECAR_SUFFIX;
    const sidecarEntry = files.find((x) => x.path === sidecar);
    if (sidecarEntry)
      deletes.push({
        ...sidecarEntry,
        dir: path.dirname(sidecar),
        rule: RULE_MPFOUR,
      });
  }
  return deletes;
}

// Originals recode.js moved aside, older than PURGE_AGE_MS, each with its
// .recode.json. The age comes from the sidecar rather than the file, whose
// mtime is still the original download's. An original whose sidecar is missing
// or unreadable has no establishable age and is left alone -- it is the only
// copy of that file, so guessing is not an option.
function planRecodeOriginals(files) {
  const cutoff = Date.now() - PURGE_AGE_MS;
  const deletes = [];
  for (const f of files) {
    if (f.name.endsWith(RECODE_SIDECAR_SUFFIX)) continue;
    const sidecarPath = f.path + RECODE_SIDECAR_SUFFIX;
    let recodedAt;
    try {
      recodedAt = JSON.parse(fs.readFileSync(sidecarPath, "utf8")).recodedAt;
    } catch (e) {
      unilog(2253, `keeping ${f.name}: no readable recode sidecar (${e.message})`);
      continue;
    }
    if (!(recodedAt < cutoff)) continue;
    deletes.push({ ...f, dir: path.dirname(f.path), rule: RULE_RECODE_ORIGINAL });
    const sidecarEntry = files.find((x) => x.path === sidecarPath);
    if (sidecarEntry)
      deletes.push({
        ...sidecarEntry,
        dir: path.dirname(sidecarPath),
        rule: RULE_RECODE_ORIGINAL,
      });
  }
  return deletes;
}

function buildPlan() {
  let showDirs;
  try {
    showDirs = fs
      .readdirSync(TV_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(TV_DIR, d.name));
  } catch (e) {
    unilog(2069, `old file cleanup cannot read ${TV_DIR}: ${e.message}`);
    return null;
  }

  const deletes = [];
  let scanned = 0;
  for (const showDir of showDirs) {
    for (const [dir, files] of collectDirs(showDir)) {
      scanned += files.length;
      deletes.push(...planDir(dir, files));
    }
  }

  const mpfourFiles = collectFiles(MPFOUR_DIR);
  scanned += mpfourFiles.length;
  deletes.push(...planMpfour(mpfourFiles));

  const originalFiles = collectFiles(RECODE_ORIGINALS_DIR);
  scanned += originalFiles.length;
  deletes.push(...planRecodeOriginals(originalFiles));

  return { showCount: showDirs.length, scanned, deletes };
}

function appendDeleteLog(entries) {
  if (!entries.length) return;
  const stamp = pstStamp(new Date());
  const lines = entries.map(
    (e) => `${stamp}\t${e.rule}\t${e.size}\t${path.relative(TV_DIR, e.path)}`,
  );
  fs.appendFileSync(DELETE_LOG_PATH, lines.join("\n") + "\n", "utf8");
}

// Scan the show folders and (unless dryRun) delete every trickplay index and
// every orphaned sidecar.
export function runOldFileCleanup({ dryRun = false } = {}) {
  const started = Date.now();
  const plan = buildPlan();
  if (!plan) return null;

  const done = [];
  let bytes = 0;
  let failed = 0;

  for (const entry of plan.deletes) {
    if (!dryRun) {
      try {
        fs.unlinkSync(entry.path);
      } catch (e) {
        failed++;
        unilog(2070, `old file cleanup delete failed for ${entry.path}: ${e.message}`);
        continue;
      }
    }
    done.push(entry);
    bytes += entry.size;
  }

  if (!dryRun) appendDeleteLog(done);

  const byRule = {};
  for (const e of done) byRule[e.rule] = (byRule[e.rule] || 0) + 1;
  const ruleStr = Object.entries(byRule)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const gb = (bytes / 1e9).toFixed(2);
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  unilog(2073, `old file cleanup${dryRun ? " (dry run)" : ""}: ${plan.showCount} shows, ` +
      `${plan.scanned} files scanned, ${done.length} deleted (${gb} GB), ` +
      `${failed} failed, ${ruleStr} in ${secs}s`);

  return { ...plan, deleted: done, bytes, failed, dryRun };
}

export function startOldFileCleanup() {
  runOldFileCleanup();
  setInterval(() => runOldFileCleanup(), CLEANUP_INTERVAL_MS);
}

// --- report, printed only when this file is run directly -------------------

function report(result, verbose) {
  const out = [];
  const p = (s) => out.push(s);
  const gb = (n) => (n / 1e9).toFixed(2) + " GB";

  p(`scanned ${result.scanned} files in ${result.showCount} show folders`);
  p(
    `${result.dryRun ? "would delete" : "deleted"} ${result.deleted.length} ` +
      `files, ${gb(result.bytes)} (${result.failed} failed)`,
  );
  p("");

  const byRule = new Map();
  for (const e of result.deleted) {
    const r = byRule.get(e.rule) || { n: 0, bytes: 0 };
    r.n++;
    r.bytes += e.size;
    byRule.set(e.rule, r);
  }
  p("by rule:");
  for (const [rule, r] of [...byRule].sort((a, b) => b[1].n - a[1].n)) {
    p(`  ${String(r.n).padStart(6)}  ${gb(r.bytes).padStart(10)}  ${rule}`);
  }
  p("");

  const bySuffix = new Map();
  for (const e of result.deleted) {
    const ext = extOf(stripChain(e.name)) || "<none>";
    const r = bySuffix.get(ext) || { n: 0, bytes: 0 };
    r.n++;
    r.bytes += e.size;
    bySuffix.set(ext, r);
  }
  p("unique suffixes:");
  for (const [ext, r] of [...bySuffix].sort((a, b) => b[1].n - a[1].n)) {
    p(`  ${String(r.n).padStart(6)}  ${gb(r.bytes).padStart(10)}  .${ext}`);
  }
  p("");

  p("largest 25:");
  for (const e of [...result.deleted]
    .sort((a, b) => b.size - a.size)
    .slice(0, 25)) {
    p(`  ${gb(e.size).padStart(10)}  ${e.rule}  ${path.relative(TV_DIR, e.path)}`);
  }
  p("");

  if (verbose) {
    p("all files:");
    for (const e of result.deleted) {
      p(`  ${e.rule}\t${e.size}\t${path.relative(TV_DIR, e.path)}`);
    }
  }

  return out.join("\n") + "\n";
}

if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  const dryRun = !process.argv.includes("--delete");
  const verbose = process.argv.includes("--verbose");
  const result = runOldFileCleanup({ dryRun });
  if (result) process.stdout.write(report(result, verbose));
}
