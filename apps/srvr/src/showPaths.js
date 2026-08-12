// Show name <-> media folder conversions, in one place.
//
// The folder a show lives in belongs to Emby; the tvdb record is keyed by the
// show's name. The two are frequently not the same string -- "Guilt (2019)"
// lives in /mnt/media/tv/Guilt -- so a path can only be walked back to its
// record through `rec.path`, never by assuming the first path segment is the
// show name. Getting that wrong is silent: the record lookup simply misses and
// every tvdb-gated step downstream (sub queue, episodeData refresh, gap check)
// is skipped without a trace.
//
// A show whose name contains "/" ("Good Cop/Bad Cop") owns a folder of that
// exact name, so those names are carried through unsplit in both directions.

import * as tvdb from "./tvdb.js";

const TV_DIR = "/mnt/media/tv";

// Record -> the folder it lives in. `rec` may be omitted when the caller has
// only a name; it is then looked up.
export function showFolderFor(showName, rec) {
  const name = String(showName || rec?.name || "");
  if (name.includes("/")) return name;
  const record = rec || (tvdb.getAllTvdbSync() || {})[name];
  return String(record?.path || record?.emby?.path || name)
    .split("/")
    .pop();
}

// Folder -> { key, rec } for every show tvdb knows about. Callers that resolve
// many folders in a loop should hoist this rather than calling the singles
// below once per folder.
export function folderToRecord() {
  const index = new Map();
  for (const [key, rec] of Object.entries(tvdb.getAllTvdbSync() || {})) {
    const folder = showFolderFor(key, rec);
    if (folder) index.set(folder, { key, rec });
  }
  return index;
}

function entryForFolder(folder) {
  if (!folder) return null;
  const all = tvdb.getAllTvdbSync() || {};
  // Nearly every show's folder is its name; only the renamed ones need the
  // full index built.
  if (all[folder]) return { key: folder, rec: all[folder] };
  return folderToRecord().get(folder) || null;
}

export function recordForFolder(folder) {
  return entryForFolder(folder)?.rec || null;
}

// Folder -> the tvdb key that claims it, or the folder itself when no record
// does (a show that is on disk but not yet in tvdb).
export function showNameForFolder(folder) {
  return entryForFolder(folder)?.key || folder;
}

// Absolute video path under TV_DIR -> the tvdb key it belongs to.
export function showNameFromFilePath(filePath) {
  const rel = String(filePath || "").replace(TV_DIR + "/", "");
  const parts = rel.split("/");
  if (parts.length >= 2) {
    const twoSeg = parts[0] + "/" + parts[1];
    if ((tvdb.getAllTvdbSync() || {})[twoSeg]) return twoSeg;
  }
  return showNameForFolder(parts[0]);
}
