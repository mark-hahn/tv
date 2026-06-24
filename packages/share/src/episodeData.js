// Shared access / update helpers for the consolidated `episodeData` property.
//
// On-disk / in-memory shape (see episodeData-plan.md):
//   episodeData[season][episode-1] = tuple
//   tuple = [aired, watched, id, file, res, bif]   (trailing absent slots dropped)
//     [0] aired   "YYYY-MM-DD" string (or 0 when unknown)
//     [1] watched 1 / 0
//     [2] id      Emby item id integer (0 = none)
//     [3] file    file name, or "<folder>//<file name>" when the show folder
//                 differs from the record key (marker is the "//")
//     [4] res     integer resolution (e.g. 1080); 0 = unknown
//     [5] bif     1 when a .bif sidecar exists (absent = none, never 0). When
//                 bif is 1 the res slot is always present (0 if unknown).
//
// Season index is 0-based (episodeData[0] = season 0). Episode index is 1-based
// (episodeData[s][0] = episode 1). Helpers take a 1-based `e`.
//
// Derived (never stored): hasFile = file present; unaired = aired in the future
// AND no file on disk (a file overrides unaired).

const TV_DIR = "/mnt/media/tv";

// Tuple slot indices
const A = 0; // aired
const W = 1; // watched
const ID = 2; // emby id
const F = 3; // file name (possibly "<folder>//<file>")
const R = 4; // resolution
const B = 5; // bif sidecar present (1, or absent)

export function getEp(ed, s, e) {
  if (!Array.isArray(ed)) return null;
  const season = ed[s];
  if (!Array.isArray(season)) return null;
  const ep = season[e - 1];
  return Array.isArray(ep) ? ep : null;
}

export function getAired(ed, s, e) {
  const a = getEp(ed, s, e)?.[A];
  return typeof a === "string" && a ? a : null;
}

export function isWatched(ed, s, e) {
  return getEp(ed, s, e)?.[W] === 1;
}

export function getEmbyId(ed, s, e) {
  const id = getEp(ed, s, e)?.[ID];
  return id ? id : null;
}

// Raw file slot value ("<file>" or "<folder>//<file>"), or null when absent.
function rawFile(ed, s, e) {
  const f = getEp(ed, s, e)?.[F];
  return typeof f === "string" && f ? f : null;
}

export function getFileName(ed, s, e) {
  const raw = rawFile(ed, s, e);
  if (!raw) return null;
  const idx = raw.indexOf("//");
  return idx >= 0 ? raw.slice(idx + 2) : raw;
}

// Explicit folder override stored in the file slot ("<folder>//<file>"), or null.
export function getFolderOverride(ed, s, e) {
  const raw = rawFile(ed, s, e);
  if (!raw) return null;
  const idx = raw.indexOf("//");
  return idx >= 0 ? raw.slice(0, idx) : null;
}

export function hasFile(ed, s, e) {
  return rawFile(ed, s, e) !== null;
}

export function getRes(ed, s, e) {
  const r = getEp(ed, s, e)?.[R];
  return typeof r === "number" && r ? r : null;
}

// True when the episode has a .bif sidecar file on disk.
export function hasBif(ed, s, e) {
  return getEp(ed, s, e)?.[B] === 1;
}

// First episode number in season `s` that has a .bif sidecar, or null if none.
export function getBifEpisode(ed, s) {
  const season = Array.isArray(ed) ? ed[s] : null;
  if (!Array.isArray(season)) return null;
  for (let i = 0; i < season.length; i++) {
    if (Array.isArray(season[i]) && season[i][B] === 1) return i + 1;
  }
  return null;
}

// Unaired = aired date is in the future AND there is no file on disk.
// A file present always means the episode is treated as aired.
export function isUnaired(ed, s, e, today) {
  if (hasFile(ed, s, e)) return false;
  const a = getAired(ed, s, e);
  if (!a) return false;
  return a > today;
}

// Reconstruct the absolute path for an episode's file, or null when no file.
// `folder` is the show's folder name (last segment of rec.path) used when the
// file slot has no explicit "<folder>//" override.
export function getFullPath(ed, folder, s, e, tvDir = TV_DIR) {
  const raw = rawFile(ed, s, e);
  if (!raw) return null;
  const idx = raw.indexOf("//");
  let folderName = folder;
  let fileName = raw;
  if (idx >= 0) {
    folderName = raw.slice(0, idx);
    fileName = raw.slice(idx + 2);
  }
  return `${tvDir}/${folderName}/Season ${s}/${fileName}`;
}

// Iterate present episodes. cb(season, episode/* 1-based */, tuple).
export function forEachEpisode(ed, cb) {
  if (!Array.isArray(ed)) return;
  for (let s = 0; s < ed.length; s++) {
    const season = ed[s];
    if (!Array.isArray(season)) continue;
    for (let i = 0; i < season.length; i++) {
      if (Array.isArray(season[i])) cb(s, i + 1, season[i]);
    }
  }
}

// Seasons that contain any episode data.
export function seasonsPresent(ed) {
  const out = [];
  if (!Array.isArray(ed)) return out;
  for (let s = 0; s < ed.length; s++) {
    if (Array.isArray(ed[s]) && ed[s].some((ep) => Array.isArray(ep))) {
      out.push(s);
    }
  }
  return out;
}

// Seasons that have at least one episode with a file on disk.
export function seasonsWithFile(ed) {
  const out = [];
  if (!Array.isArray(ed)) return out;
  for (let s = 0; s < ed.length; s++) {
    const season = ed[s];
    if (
      Array.isArray(season) &&
      season.some(
        (ep) => Array.isArray(ep) && typeof ep[F] === "string" && ep[F],
      )
    ) {
      out.push(s);
    }
  }
  return out;
}

// Most common resolution, ties resolved toward the higher resolution.
export function computeQuality(ed) {
  const counts = {};
  forEachEpisode(ed, (s, e, ep) => {
    const r = ep[R];
    if (typeof r === "number" && r) counts[r] = (counts[r] ?? 0) + 1;
  });
  if (Object.keys(counts).length === 0) return null;
  let best = null;
  let bestCount = 0;
  for (const [res, cnt] of Object.entries(counts)) {
    const r = Number(res);
    if (cnt > bestCount || (cnt === bestCount && r > best)) {
      best = r;
      bestCount = cnt;
    }
  }
  return best;
}

export function countWatched(ed) {
  let n = 0;
  forEachEpisode(ed, (s, e, ep) => {
    if (ep[W] === 1) n++;
  });
  return n;
}

// Encode named fields into a trimmed positional tuple.
function encodeTuple(aired, watched, id, file, res, bif) {
  const arr = [
    aired || 0,
    watched ? 1 : 0,
    id || 0,
    file || 0,
    typeof res === "number" && res ? res : 0,
    bif ? 1 : 0,
  ];
  let len = arr.length;
  while (len > 1 && !arr[len - 1]) len--;
  return arr.slice(0, len);
}

export function ensureSeason(ed, s) {
  if (!Array.isArray(ed[s])) ed[s] = [];
  return ed[s];
}

// Merge the provided fields over an episode's existing tuple, then re-trim.
// `fields` may contain any of: aired, watched, id, file, res, bif. Omitted keys
// keep their existing value. Pass file:null / res:null / bif:0 to clear.
export function setEpisode(ed, s, e, fields) {
  const season = ensureSeason(ed, s);
  const i = e - 1;
  const existing = Array.isArray(season[i]) ? season[i] : [];
  let aired = typeof existing[A] === "string" && existing[A] ? existing[A] : 0;
  let watched = existing[W] === 1 ? 1 : 0;
  let id = typeof existing[ID] === "number" && existing[ID] ? existing[ID] : 0;
  let file =
    typeof existing[F] === "string" && existing[F] ? existing[F] : null;
  let res = typeof existing[R] === "number" && existing[R] ? existing[R] : null;
  let bif = existing[B] === 1 ? 1 : 0;

  if ("aired" in fields) aired = fields.aired || 0;
  if ("watched" in fields) watched = fields.watched ? 1 : 0;
  if ("id" in fields) id = fields.id || 0;
  if ("file" in fields) file = fields.file || null;
  if ("res" in fields)
    res = typeof fields.res === "number" && fields.res ? fields.res : null;
  if ("bif" in fields) bif = fields.bif ? 1 : 0;

  season[i] = encodeTuple(aired, watched, id, file, res, bif);
}

export function clearFile(ed, s, e) {
  setEpisode(ed, s, e, { file: null, res: null, bif: 0 });
}

// Drop id/file/res/bif for every episode (used when a show leaves Emby).
export function stripToAiredWatched(ed) {
  forEachEpisode(ed, (s, e) => {
    setEpisode(ed, s, e, { id: 0, file: null, res: null, bif: 0 });
  });
}

// Derive the legacy watchedEpis array [[season, ep, ep, ...], ...] used by the
// /api/getSeriesMapFromTvdb request contract.
export function episodeDataToWatchedEpis(ed) {
  const out = [];
  if (!Array.isArray(ed)) return out;
  for (let s = 0; s < ed.length; s++) {
    const season = ed[s];
    if (!Array.isArray(season)) continue;
    const eps = [];
    for (let i = 0; i < season.length; i++) {
      if (Array.isArray(season[i]) && season[i][W] === 1) eps.push(i + 1);
    }
    if (eps.length) out.push([s, ...eps]);
  }
  return out;
}

// Build the legacy seriesMap wire shape from episodeData:
//   [[season, [[episode, { error, played, avail, noFile, unaired, deleted,
//                          path, id, quality, aired }]], ...], ...]
export function toSeriesMap(ed, folder, today, tvDir = TV_DIR) {
  const out = [];
  if (!Array.isArray(ed)) return out;
  for (let s = 0; s < ed.length; s++) {
    const season = ed[s];
    if (!Array.isArray(season)) continue;
    const eps = [];
    for (let i = 0; i < season.length; i++) {
      if (!Array.isArray(season[i])) continue;
      const e = i + 1;
      const file = hasFile(ed, s, e);
      eps.push([
        e,
        {
          error: false,
          played: season[i][W] === 1,
          avail: file,
          noFile: !file,
          unaired: isUnaired(ed, s, e, today),
          deleted: false,
          path: file ? getFullPath(ed, folder, s, e, tvDir) : null,
          id: getEmbyId(ed, s, e),
          quality: getRes(ed, s, e),
          aired: getAired(ed, s, e),
        },
      ]);
    }
    if (eps.length) out.push([s, eps]);
  }
  return out;
}
