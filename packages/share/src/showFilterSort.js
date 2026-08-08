// The show list's filter and sort semantics, shared so that every client
// orders the list identically. The web client runs these locally on its own
// in-memory dataset (instantly, on every keystroke); tv-srvr runs the very
// same functions to answer getSharedFilterShows for tvapp, which is Java and
// cannot import them.
//
// Only the sort *key* lives here, not the value each row displays: the
// display strings are built by the web client's own formatters and are its
// business alone.

import { hasAnyPosition } from "./episodeData.js";

// Every sort the header offers, in its order.
export const SORT_CHOICES = [
  "Alpha",
  "Viewed",
  "Down",
  "Added",
  "Ratings",
  "Size",
  "Safe start",
  "Ended",
  "Length",
  "Creator",
  "Quality",
];

// The sorts that read low-to-high; every other one puts the largest, or the
// most recent, first.
const ASCENDING = ["Alpha", "Length", "Creator", "Safe start"];

// Which crew credit stands in for a show's creator, best first.
const CREW_PREF = ["Creator", "Producer", "Executive Producer", "Writer"];

function getLaDateTimeParts(dateIn = new Date()) {
  const date = dateIn instanceof Date ? dateIn : new Date(dateIn);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part && part.type && part.value) map[part.type] = part.value;
  }
  if (
    !map.year ||
    !map.month ||
    !map.day ||
    !map.hour ||
    !map.minute ||
    !map.second
  ) {
    return null;
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === "24" ? "00" : map.hour,
    minute: map.minute,
    second: map.second,
    ms: String(date.getMilliseconds()).padStart(3, "0"),
  };
}

export function getPstDateTimeMs(dateIn = new Date()) {
  const parts = getLaDateTimeParts(dateIn);
  if (!parts) return "";
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${parts.ms}`;
}

export function fmtLaDateTime(dateIn = new Date()) {
  const parts = getLaDateTimeParts(dateIn);
  if (!parts) return "";
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

export function normalizeTimestamp(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 0 && value < 100000000000 ? value * 1000 : value;
    return getPstDateTimeMs(ms);
  }

  const raw = String(value).trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return normalizeTimestamp(Number(raw));

  let m = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (m) return `${m[1]}/${m[2]}/${m[3]} 00:00:00.000`;

  m = raw.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,}))?$/,
  );
  if (m) {
    const ms = (m[7] || "000").slice(0, 3).padEnd(3, "0");
    const hour = m[4] === "24" ? "00" : m[4];
    return `${m[1]}/${m[2]}/${m[3]} ${hour}:${m[5]}:${m[6]}.${ms}`;
  }

  return getPstDateTimeMs(raw);
}

export function normalizePlayedDate(value) {
  return normalizeTimestamp(value);
}

// Computed/default props applied to every tvdb show record. The filter and
// sort below read several of these rather than the raw record, so anything
// running them has to have applied this first.
export const applyComputedProps = (rec) => {
  if (!rec.name && rec.Name) rec.name = rec.Name;
  if (!rec.tvdbId && rec.TvdbId) rec.tvdbId = rec.TvdbId;
  if (!rec.id) rec.id = `noemby-${rec.tvdbId}`;
  if (rec.genres && !Array.isArray(rec.genres)) rec.genres = [];
  else if (rec.genres)
    rec.genres = rec.genres.map((g) => (typeof g === "string" ? g : g.name));
  if (rec.status === "Ended") rec.ended = true;
  if (!rec.ratings)
    rec.ratings =
      rec.imdbRatings ||
      rec.remotes?.find((r) => r.name?.startsWith("IMDB"))?.ratings ||
      null;
  if (rec.notReady === undefined) rec.notReady = rec.inEmby === false;
  rec.watchGap = rec.watchGap || false;
  rec.fileGap = rec.fileGap || rec.fileEndError || rec.seasonWatchedThenNofile;
  if (rec.inToTry === undefined) rec.inToTry = false;
  if (rec.inContinue === undefined) rec.inContinue = false;
  if (rec.inMark === undefined) rec.inMark = false;
  if (rec.inLinda === undefined) rec.inLinda = false;
  if (rec.anticipating === undefined) rec.anticipating = false;
  if (rec.sitcom === undefined) rec.sitcom = false;
  if (rec.played === undefined) rec.played = false;
  if (rec.playCount === undefined) rec.playCount = 0;
  if (rec.date === undefined) rec.date = "2017/12/05 00:00:00.000";
  if (rec.size === undefined) rec.size = 0;
  if (rec.noFiles === undefined) rec.noFiles = false;
  if (rec.episodeData === undefined) rec.episodeData = [];
  return rec;
};

// The filter-row toggles, by the name the saved settings store them under.
// Each is tri-state in use: +1 keep only matches, -1 keep only non-matches,
// 0 ignore. The web client pairs these with their own icon and colour.
export const COND_PREDS = {
  unplayed: (show) => show.notReady === false,
  waiting: (show) => !!show.waitStr?.length,
  needsIntro: (show) => !!show.needsIntro,
  gap: (show) => show.fileGap || show.watchGap,
  ended: (show) => show.ended,
  drama: (show) => !show.genres?.includes("Comedy"),
  sitcom: (show) => !!show.sitcom,
  foreign: (show) => show?.originalCountry?.toUpperCase() != "USA",
  totry: (show) => show.inToTry,
  anticipating: (show) => !!show.anticipating,
  continue: (show) => show.inContinue,
  mark: (show) => show.inMark,
  linda: (show) => show.inLinda,
  hasemby: (show) => show.inEmby !== false,
};

/**
 * What a show sorts by under one of the SORT_CHOICES. Comparable with the
 * same operator throughout: strings against strings, numbers against numbers.
 */
export function getSortKey(show, sortChoice, allTvdb = null) {
  switch (sortChoice) {
    case "Alpha":
      return show.name
        .replace(/^the\s*/i, "")
        .replace(/[^a-z0-9\s]/gi, "")
        .toLowerCase();
    case "Added": {
      const a = show.dateCreated || "";
      return a.length > 10 ? a : a + " 00:00:00.000";
    }
    case "Ended":
      return show.lastAired || "";
    case "Length":
      return show.averageRuntime || 0;
    case "Size":
      return show.size;
    case "Safe start": {
      // waitStr is "{m-d}" or "{y-m-d}" in braces; no wait at all sorts last.
      const ws = show.waitStr || "";
      if (!ws) return "9999-99-99";
      const inner = ws.slice(1, -1);
      const parts = inner.split("-");
      const yr =
        parts.length === 3 ? `20${parts[0]}` : String(new Date().getFullYear());
      const mo = (parts.length === 3 ? parts[1] : parts[0]).padStart(2, "0");
      const dy = parts.length === 3 ? parts[2] : parts[1];
      return `${yr}-${mo}-${dy}`;
    }
    case "Ratings": {
      const ratings = show?.ratings;
      return ratings !== undefined && ratings !== null && ratings !== 0
        ? +ratings
        : 0;
    }
    case "Creator": {
      const crewArr = Array.isArray(allTvdb?.[show.name]?.crew)
        ? allTvdb[show.name].crew
        : [];
      let best = null;
      for (const type of CREW_PREF) {
        best = crewArr.find((c) => c.type === type);
        if (best) break;
      }
      return (best ? best.name : "").toLowerCase();
    }
    case "Viewed": {
      // Sorts by the date Emby currently holds, so a hidden show sinks here
      // exactly as it does in Emby's own rows. That date is fakeLastPlayed
      // whenever hiding or unhiding stamped one; lastPlayedDate is the real
      // viewing, kept untouched for display.
      const rec = allTvdb?.[show.name];
      const stamped = show.fakeLastPlayed || rec?.fakeLastPlayed || "";
      const played = show.lastPlayedDate || rec?.lastPlayedDate || "";
      return normalizePlayedDate(stamped || played) || "";
    }
    case "Down": {
      const lastDownloaded = allTvdb?.[show.name]?.["last-downloaded"] || "";
      return lastDownloaded ? normalizeTimestamp(lastDownloaded) : "";
    }
    case "Quality": {
      const q = show.quality ?? null;
      return q !== null ? q : -1;
    }
  }
  return "";
}

/**
 * Orders two shows by one of the SORT_CHOICES, breaking ties by first-aired
 * with the most recent first.
 */
export function compareShows(a, b, sortChoice, allTvdb = null, reversed = false) {
  const va = getSortKey(a, sortChoice, allTvdb);
  const vb = getSortKey(b, sortChoice, allTvdb);
  if (va !== vb) {
    let result;
    if (ASCENDING.includes(sortChoice)) {
      // A show with no creator at all goes last rather than first.
      if (sortChoice === "Creator") {
        if (va === "" && vb !== "") return 1;
        if (vb === "" && va !== "") return -1;
      }
      result = va > vb ? +1 : -1;
    } else {
      result = va > vb ? -1 : +1;
    }
    return reversed ? -result : result;
  }
  const fa = a.firstAired || "";
  const fb = b.firstAired || "";
  if (fa === "" && fb === "") return 0;
  if (fa === "") return 1;
  if (fb === "") return -1;
  return fa > fb ? -1 : fa < fb ? 1 : 0;
}

/** A sorted copy; the input array is left alone. */
export function sortShowList(shows, sortChoice, allTvdb = null, reversed = false) {
  return [...shows].sort((a, b) =>
    compareShows(a, b, sortChoice, allTvdb, reversed),
  );
}

/**
 * The show list under one set of filter settings — the same settings the
 * web client's Send button shares and its Custom button restores.
 *
 * `playingNames` is a Set the caller has to supply for the Playing choice,
 * since what is playing is not something a show record knows.
 */
export function filterShowList(shows, settings = {}, allTvdb = null) {
  const {
    fltrChoice = "All",
    filterStr = "",
    descrSearchStr = "",
    condFilters = {},
    playingNames = null,
  } = settings;

  if (fltrChoice === "Playing") {
    const playing = playingNames || new Set();
    return shows.filter((show) => playing.has(show.name));
  }

  if (fltrChoice === "Position") {
    return shows.filter((show) => hasAnyPosition(show.episodeData));
  }

  const srchStrLc =
    fltrChoice === "Finished" || !filterStr
      ? null
      : String(filterStr).toLowerCase();
  const descrSrchLc = descrSearchStr
    ? String(descrSearchStr).toLowerCase()
    : null;

  const out = [];
  fltrLoop: for (const show of shows) {
    if (fltrChoice === "Finished") {
      const tvdbData = allTvdb?.[show.name];
      if (!tvdbData) continue;
      const { status, episodeCount, watchedCount } = tvdbData;
      const watchedAll = episodeCount > 0 && watchedCount == episodeCount;
      if (status == "Ended" && watchedAll && show.inEmby !== false) {
        out.push(show);
      }
      continue;
    }
    if (srchStrLc && !show.name.toLowerCase().includes(srchStrLc)) continue;
    if (descrSrchLc) {
      const overview = String(allTvdb?.[show.name]?.overview ?? "").toLowerCase();
      if (!overview.includes(descrSrchLc)) continue;
    }
    for (const name in condFilters) {
      const filter = condFilters[name];
      if (!filter) continue;
      const pred = COND_PREDS[name];
      if (!pred) continue;
      if ((filter === +1) != !!pred(show)) continue fltrLoop;
    }
    out.push(show);
  }
  return out;
}
