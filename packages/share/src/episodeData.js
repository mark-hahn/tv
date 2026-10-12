// Shared access / update helpers for the consolidated `episodeData` property.
//
// Shape: episodeData[season][episode-1] = one episode, a record of named
// fields, any of them left out when empty, false or zero:
//     aired       "YYYY-MM-DD" string
//     watched     true
//     file        file name, or "<folder>//<file name>" when the show folder
//                 differs from the record key (marker is the "//")
//     res         integer resolution (e.g. 1080)
//     pos         resume position in ms
//     tvdbId      the episode's TVDB id
//     title       its English title
//     lastPlayed  PST "YYYY/MM/DD HH:mm:ss.mmm" a play of it last ran to
//                 the end
//     playCount   plays watched through to the end
//     airsBeforeSeason, airsBeforeEpisode, airsAfterSeason
//                 TVDB's placement of a season 0 special
//     runtime     minutes, season 0 only
//     category, critical
//                 TVDB's Special Category tag and whether it calls the
//                 special critical to the story, season 0 only
//     tagged      TVDB's lastUpdated for the episode when its tags were read
// Season 0 holds only the specials that count as episodes; TVDB's other
// season 0 entries are tv-srvr's extras, kept elsewhere (season0.js).
//
// Season index is 0-based (episodeData[0] = season 0). Episode index is 1-based
// (episodeData[s][0] = episode 1). Helpers take a 1-based `e`.
//
// Derived (never stored): hasFile = file present; unaired = aired in the future
// AND no file on disk (a file overrides unaired).

const TV_DIR = "/mnt/media/tv";

// Whether a stored slot holds an episode.
export function isEpisode(ep) {
  return ep !== null && typeof ep === "object";
}

// A stored episode's named fields, or null for an empty slot.
export function episodeFields(ep) {
  return isEpisode(ep) ? ep : null;
}

// The episode's named fields, or null when the show has no such episode.
export function getEp(ed, s, e) {
  if (!Array.isArray(ed)) return null;
  const season = ed[s];
  if (!Array.isArray(season)) return null;
  return episodeFields(season[e - 1]);
}

export function getAired(ed, s, e) {
  const a = getEp(ed, s, e)?.aired;
  return typeof a === "string" && a ? a : null;
}

export function isWatched(ed, s, e) {
  return !!getEp(ed, s, e)?.watched;
}

// Raw file value ("<file>" or "<folder>//<file>"), or null when absent.
function rawFile(ed, s, e) {
  const f = getEp(ed, s, e)?.file;
  return typeof f === "string" && f ? f : null;
}

export function getFileName(ed, s, e) {
  const raw = rawFile(ed, s, e);
  if (!raw) return null;
  const idx = raw.indexOf("//");
  return idx >= 0 ? raw.slice(idx + 2) : raw;
}

// Explicit folder override stored in the file field ("<folder>//<file>"), or null.
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
  const r = getEp(ed, s, e)?.res;
  return typeof r === "number" && r ? r : null;
}

// Resume position in ms, or 0 when none/absent.
export function getPos(ed, s, e) {
  const p = getEp(ed, s, e)?.pos;
  return typeof p === "number" && p > 0 ? p : 0;
}

// True when any episode has a stored playback position (> 0).
export function hasAnyPosition(ed) {
  let found = false;
  forEachEpisode(ed, (s, e, ep) => {
    if (typeof ep.pos === "number" && ep.pos > 0) found = true;
  });
  return found;
}

// Unaired = no file on disk, and an air date in the future or none at all yet.
// A file present always means the episode is treated as aired.
export function isUnaired(ed, s, e, today) {
  if (hasFile(ed, s, e)) return false;
  const a = getAired(ed, s, e);
  if (!a) return true;
  return a > today;
}

// Reconstruct the absolute path for an episode's file, or null when no file.
// `folder` is the show's folder name (last segment of rec.path) used when the
// file field has no explicit "<folder>//" override.
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

// Iterate present episodes. cb(season, episode/* 1-based */, fields), where
// fields is the episode's named fields (see episodeFields) -- read them only.
export function forEachEpisode(ed, cb) {
  if (!Array.isArray(ed)) return;
  for (let s = 0; s < ed.length; s++) {
    const season = ed[s];
    if (!Array.isArray(season)) continue;
    for (let i = 0; i < season.length; i++) {
      if (isEpisode(season[i])) cb(s, i + 1, episodeFields(season[i]));
    }
  }
}

// Seasons that contain any episode data.
export function seasonsPresent(ed) {
  const out = [];
  if (!Array.isArray(ed)) return out;
  for (let s = 0; s < ed.length; s++) {
    if (Array.isArray(ed[s]) && ed[s].some(isEpisode)) out.push(s);
  }
  return out;
}

// Seasons that have at least one episode with a file on disk.
export function seasonsWithFile(ed) {
  const out = [];
  if (!Array.isArray(ed)) return out;
  for (let s = 0; s < ed.length; s++) {
    const season = ed[s];
    if (!Array.isArray(season)) continue;
    const anyFile = season.some((ep) => {
      const file = episodeFields(ep)?.file;
      return typeof file === "string" && file;
    });
    if (anyFile) out.push(s);
  }
  return out;
}

// Most common resolution, ties resolved toward the higher resolution.
export function computeQuality(ed) {
  const counts = {};
  forEachEpisode(ed, (s, e, ep) => {
    const r = ep.res;
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
    if (ep.watched) n++;
  });
  return n;
}

// The order an episode's fields are written in, so the same episode always
// serializes the same way: a save that changed nothing is then seen as
// unchanged, and so is a record a client compares against what it had. A
// field not listed here goes after these.
const RECORD_FIELDS = [
  "aired",
  "watched",
  "file",
  "res",
  "pos",
  "tvdbId",
  "title",
  "lastPlayed",
  "playCount",
  "airsBeforeSeason",
  "airsBeforeEpisode",
  "airsAfterSeason",
  "runtime",
  "category",
  "critical",
  "tagged",
];

// The fields worth storing, in RECORD_FIELDS order: anything empty, false or
// zero is left out.
function encodeRecord(fields) {
  const out = {};
  const names = [
    ...RECORD_FIELDS,
    ...Object.keys(fields).filter((name) => !RECORD_FIELDS.includes(name)),
  ];
  for (const name of names) {
    const value = fields[name];
    if (value === null || value === undefined) continue;
    if (value === false || value === 0 || value === "") continue;
    out[name] = value;
  }
  return out;
}

// A field's value as stored: watched is true or absent, the text fields a
// non-empty string, the numbers positive.
function normalizeField(name, value) {
  switch (name) {
    case "watched":
    case "critical":
      return !!value;
    case "aired":
    case "file":
    case "title":
    case "lastPlayed":
    case "category":
    case "tagged":
      return typeof value === "string" && value ? value : null;
    case "res":
    case "pos":
    case "tvdbId":
    case "playCount":
    case "airsBeforeSeason":
    case "airsBeforeEpisode":
    case "airsAfterSeason":
    case "runtime":
      return typeof value === "number" && value > 0 ? value : null;
    default:
      return value;
  }
}

export function ensureSeason(ed, s) {
  if (!Array.isArray(ed[s])) ed[s] = [];
  return ed[s];
}

// Merge the provided fields over an episode's existing ones. `fields` may hold
// any of the episode's fields; omitted keys keep their existing value, and a
// null, false, 0 or empty value clears one.
export function setEpisode(ed, s, e, fields) {
  const season = ensureSeason(ed, s);
  const i = e - 1;
  const merged = { ...(episodeFields(season[i]) || {}) };
  for (const [name, value] of Object.entries(fields)) {
    merged[name] = normalizeField(name, value);
  }
  season[i] = encodeRecord(merged);
}

export function clearFile(ed, s, e) {
  setEpisode(ed, s, e, { file: null, res: null });
}

// Remove an episode slot entirely, trimming trailing empties so a season (and
// the whole array) shrinks back when its last episodes go away.
export function deleteEpisode(ed, s, e) {
  const season = Array.isArray(ed) ? ed[s] : null;
  if (!Array.isArray(season)) return;
  const i = e - 1;
  if (i < 0 || i >= season.length) return;
  season[i] = null;
  while (season.length > 0 && !isEpisode(season[season.length - 1]))
    season.length--;
  if (season.length === 0) {
    ed[s] = null;
    while (ed.length > 0 && !Array.isArray(ed[ed.length - 1])) ed.length--;
  }
}

// Remove ghost episodes — slots no source vouches for any more. `seen` is a Set
// of "<season>.<episode>" keys collected from the sources that were refreshed.
// A watched mark is never a ghost: the record is the only place it is kept,
// and no source will ever report it.
// Returns the removed episodes as [{ season, episode }, ...].
export function pruneGhosts(ed, seen) {
  const ghosts = [];
  // Collect first — deleting inside the walk would skip entries.
  forEachEpisode(ed, (s, e, ep) => {
    if (seen.has(`${s}.${e}`)) return;
    if (ep.watched) return;
    ghosts.push({ season: s, episode: e });
  });
  for (const { season, episode } of ghosts) deleteEpisode(ed, season, episode);
  return ghosts;
}

// Drop what came from the disk or the players' resume -- file, res and pos --
// from every episode, keeping everything else (used when a show leaves the
// library).
export function stripFileFacts(ed) {
  forEachEpisode(ed, (s, e) => {
    setEpisode(ed, s, e, { file: null, res: null, pos: 0 });
  });
}

// Build the legacy seriesMap wire shape from episodeData:
//   [[season, [[episode, { error, played, avail, noFile, unaired, deleted,
//                          path, quality, aired, pos }]], ...], ...]
export function toSeriesMap(ed, folder, today, tvDir = TV_DIR) {
  const out = [];
  if (!Array.isArray(ed)) return out;
  for (let s = 0; s < ed.length; s++) {
    const season = ed[s];
    if (!Array.isArray(season)) continue;
    const eps = [];
    for (let i = 0; i < season.length; i++) {
      if (!isEpisode(season[i])) continue;
      const e = i + 1;
      const file = hasFile(ed, s, e);
      eps.push([
        e,
        {
          error: false,
          played: isWatched(ed, s, e),
          avail: file,
          noFile: !file,
          unaired: isUnaired(ed, s, e, today),
          deleted: false,
          path: file ? getFullPath(ed, folder, s, e, tvDir) : null,
          quality: getRes(ed, s, e),
          aired: getAired(ed, s, e),
          pos: getPos(ed, s, e),
        },
      ]);
    }
    if (eps.length) out.push([s, eps]);
  }
  return out;
}

// The gap-check flags that point at one episode, by field-name prefix. Each
// has a matching `<prefix>Season` / `<prefix>Episode` on the show record.
const GAP_MARK_PREFIXES = [
  "watchGap",
  "fileGap",
  "fileEndError",
  "seasonWatchedThenNofile",
  "resDrop",
];

// Flag the seriesMap cells the gap check landed on so the map paints them.
export function markGapErrors(seriesMap, rec) {
  if (!Array.isArray(seriesMap) || !rec) return seriesMap;
  for (const prefix of GAP_MARK_PREFIXES) {
    if (!rec[prefix]) continue;
    const s = rec[`${prefix}Season`];
    const e = rec[`${prefix}Episode`];
    if (s == null || e == null) continue;
    const season = seriesMap.find(([num]) => num === s);
    const ep = season?.[1]?.find(([num]) => num === e);
    if (ep) ep[1].error = true;
  }
  return seriesMap;
}

// Pick the episode intro marking should open for a show: the first unwatched
// episode with a file, else the first episode with a file, never a season 0
// one (a special's opening may not match the show's intro). Intro marking
// plays through /api/stream, so an episode needs only a file.
// This is the pick when nothing is mirrored yet — it is what tv-srvr pre-builds
// the mp4 mirror for. The episode actually opened comes from /api/introFile,
// which upgrades to any episode whose mirror is already finished.
// Returns { path, season, episode } or { error }.
export function selectIntroFile(show) {
  const ed = show?.episodeData;
  if (!ed) return { error: "No episode data" };
  const folder = show.path?.split("/").pop() || show.name;

  // First unwatched with a file, else first file
  let fallbackPath = null;
  let fallbackSeason = null;
  let fallbackEpisode = null;
  let foundUnwatched = false;
  forEachEpisode(ed, (s, e) => {
    if (foundUnwatched || s === 0) return;
    if (!hasFile(ed, s, e)) return;
    if (!fallbackPath) {
      fallbackPath = getFullPath(ed, folder, s, e);
      fallbackSeason = s;
      fallbackEpisode = e;
    }
    if (!isWatched(ed, s, e)) {
      const filePath = getFullPath(ed, folder, s, e);
      if (filePath) {
        foundUnwatched = true;
        fallbackPath = filePath;
        fallbackSeason = s;
        fallbackEpisode = e;
      }
    }
  });

  if (fallbackPath) {
    return {
      path: fallbackPath,
      season: fallbackSeason,
      episode: fallbackEpisode,
    };
  }
  return { error: "No playable episode found" };
}
