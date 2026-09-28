import { readFile } from "fs/promises";
import { smartTitleMatch, logHere, unilog} from "@tv/share"
import { getTvmazeIdByTvdbId } from "../../api/src/tvmaze.js";
import { getToken, clearToken } from "./tvdbToken.js";

/*
 * Every image the apps show -- a show's poster and card image, an episode's
 * still, a cast, guest or crew member's photo -- is chosen here, and the same
 * way for every kind:
 *
 *  - providers in the order fanart.tv, TVDB, TMDB, TVmaze; the first one that
 *    has an image wins;
 *  - where a provider has a list to choose from, its own score picks;
 *  - a show's and an episode's lookups go by the show's tvdb, tmdb, imdb and
 *    tvmaze ids, and a search by name only runs once every id-based source has
 *    come up empty;
 *  - a person goes by name alone: the same name gets the same photo whatever
 *    show it is asked for from.
 *
 * Every answer, misses included, and the provider data behind it are kept for
 * the life of the process.
 */

const FANART_KEY_FILE = "/root/dev/apps/tv/fanart.key";
const FANART_KEY = (await readFile(FANART_KEY_FILE, "utf8")).trim();
const TMDB_KEY = "327192a334da700f65b882c7a69cb927";
const TVDB_API = "https://api4.thetvdb.com/v4";
const TVDB_ARTWORK_HOST = "https://artworks.thetvdb.com";
const TMDB_API = "https://api.themoviedb.org/3";
const TVMAZE_API = "https://api.tvmaze.com";
const FANART_API = "https://webservice.fanart.tv/v3/tv";
const TMDB_IMG = "https://image.tmdb.org/t/p/";
// One TMDB size per kind of image, whichever app draws it.
const TMDB_POSTER_SIZE = "w500";
const TMDB_BACKDROP_SIZE = "w780";
const TMDB_STILL_SIZE = "w300";
const TMDB_PROFILE_SIZE = "w185";
const TVDB_POSTER_TYPE = 2;
const TVDB_BACKGROUND_TYPE = 3;
// TVDB hands this placeholder out in place of a missing image.
const TVDB_MISSING = "/images/missing/";
// Remote-id types in a tvdb record's remote_ids.
const IMDB_REMOTE_TYPE = 2;
const TMDB_REMOTE_TYPE = 12;
// TVmaze allows 20 calls in 10 s and answers 429 past that.
const RATE_LIMIT_RETRY_MS = 2000;
const RATE_LIMIT_TRIES = 3;

// Languages in the order wanted. Posters and card thumbs carry the show's name,
// so English first; a plain background is best with no text at all.
const TITLED = ["en", ""];
const TEXTLESS = ["", "en"];

////////////////////////  cache and fetch  ////////////////////////

const cache = new Map();

// Kept for the life of the process, misses included. A lookup that throws is
// not kept, so the next ask tries again.
function remember(key, fn) {
  if (!cache.has(key)) {
    cache.set(
      key,
      fn().catch((e) => {
        cache.delete(key);
        throw e;
      }),
    );
  }
  return cache.get(key);
}

// An answer for a caller, "" when there is none. It is remembered only when
// every provider asked on the way answered: one that failed -- a 502, a
// timeout -- may have had the image, so the answer stands for this ask alone
// and the next ask tries them all again. fn gets the trace firstOf marks.
function answer(key, label, fn) {
  if (!cache.has(key)) {
    const trace = { label, failed: false };
    cache.set(
      key,
      fn(trace).then(
        (url) => {
          if (trace.failed) cache.delete(key);
          return url;
        },
        (e) => {
          cache.delete(key);
          unilog(2608, `image lookup failed for ${label}: ${e.message}`);
          return "";
        },
      ),
    );
  }
  return cache.get(key);
}

// null for a 404: the provider has no such thing.
async function getJson(url, init) {
  for (let tries = 1; ; tries++) {
    const res = await fetch(url, init);
    if (res.status === 429 && tries < RATE_LIMIT_TRIES) {
      await new Promise((resolve) => {
        setTimeout(resolve, RATE_LIMIT_RETRY_MS);
      });
      continue;
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      // The query is left off: fanart.tv and TMDB carry their keys in it.
      const err = new Error(`${res.status} from ${url.split("?")[0]}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }
}

// A token TVDB turns down before it was due to expire is replaced, and the
// call made again, once.
async function tvdbGet(path) {
  for (let tries = 1; ; tries++) {
    const token = await getToken();
    try {
      return await getJson(TVDB_API + path, { headers: { Authorization: "Bearer " + token } });
    } catch (e) {
      if (e.status !== 401 || tries > 1) throw e;
      clearToken();
    }
  }
}

function tmdbGet(path) {
  return getJson(`${TMDB_API}${path}${path.includes("?") ? "&" : "?"}api_key=${TMDB_KEY}`);
}

function mazeGet(path) {
  return getJson(TVMAZE_API + path);
}

////////////////////////  choosing  ////////////////////////

function lang(code) {
  if (!code || code === "00") return "";
  return code === "eng" ? "en" : code;
}

// A TVDB image url made whole, or "" for none -- TVDB's placeholder included.
function tvdbUrl(url) {
  if (!url || url.includes(TVDB_MISSING)) return "";
  return url.startsWith("/") ? TVDB_ARTWORK_HOST + url : url;
}

// The best of one provider's list, each item {url, lang, score}: the first
// language in langs that is there at all, else any language, and the highest
// score within it.
function pickBest(items, langs) {
  const rank = (item) => {
    const i = langs.indexOf(item.lang);
    return i < 0 ? langs.length : i;
  };
  let best = null;
  for (const item of items ?? []) {
    if (!item.url) continue;
    if (
      !best ||
      rank(item) < rank(best) ||
      (rank(item) === rank(best) && item.score > best.score)
    ) {
      best = item;
    }
  }
  return best?.url || "";
}

// Names as they compare across providers: accents, case, punctuation and runs
// of whitespace all differ between them.
export function normName(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// The first source with an image. Each source is one provider; one that fails
// is logged, marked on the trace, and passed over.
async function firstOf(sources, trace, ...args) {
  for (const source of sources) {
    try {
      const url = await source(...args);
      if (url) return url;
    } catch (e) {
      unilog(2609, `image provider failed for ${trace.label}: ${e.message}`);
      trace.failed = true;
    }
  }
  return "";
}

// The sources with every id the show's own ids lead to; only if none of them
// has an image, again with the ids a search for the show's name turns up; and
// last the searches by name.
async function firstById(sources, searches, ids, showName, trace, ...args) {
  const byId = await idsById(ids);
  let url = await firstOf(sources, trace, byId, ...args);
  if (url) return url;
  const byName = showName ? await idsByName(byId, showName) : byId;
  if (showName) url = await firstOf(sources, trace, byName, ...args);
  return url || firstOf(searches, trace, byName, showName, ...args);
}

////////////////////////  show ids  ////////////////////////

// A trailing (YYYY) is this library's way of telling two shows of the same
// name apart; the providers take the year separately.
const TITLE_YEAR_RE = /^(.*?)\s*\((\d{4})\)\s*$/;

export function splitTitleYear(showName) {
  const match = TITLE_YEAR_RE.exec(String(showName ?? ""));
  return match ? { title: match[1], year: match[2] } : { title: showName, year: null };
}

function candidateYear(show) {
  return String(show?.first_air_date ?? "").slice(0, 4);
}

// The TMDB search result smartTitleMatch's title names -- several shows can
// share it, which is why the library name carried a year, so the year picks.
export function pickNamed(results, title, year) {
  const named = results.filter((s) => s.name === title || s.original_name === title);
  return (year && named.find((s) => candidateYear(s) === String(year))) || named[0];
}

// A tvdb record's ids, as far as the record itself knows them.
export function recordIds(rec) {
  const remote = (type) =>
    String((rec?.remote_ids ?? []).find((r) => r.type === type)?.id ?? "");
  return {
    tvdbId: String(rec?.id || rec?.tvdbId || ""),
    tmdbId: String(rec?.tmdbId || remote(TMDB_REMOTE_TYPE)),
    imdbId: String(rec?.imdbId || remote(IMDB_REMOTE_TYPE)),
    tvmazeId: String(rec?.tvmazeId || ""),
  };
}

function tmdbFind(externalId, source) {
  return remember(`tmdbFind|${source}|${externalId}`, async () => {
    const res = await tmdbGet(`/find/${encodeURIComponent(externalId)}?external_source=${source}`);
    return String(res?.tv_results?.[0]?.id ?? "");
  });
}

function tmdbShowExternalIds(tmdbId) {
  return remember(`tmdbShowExt|${tmdbId}`, async () => (await tmdbGet(`/tv/${tmdbId}/external_ids`)) ?? {});
}

function mazeLookup(key, id) {
  return remember(`mazeLookup|${key}|${id}`, async () => {
    const show = await mazeGet(`/lookup/shows?${key}=${encodeURIComponent(id)}`);
    return String(show?.id ?? "");
  });
}

// Every id that can be reached from the ids already known.
function idsById(ids) {
  const known = {
    tvdbId: String(ids?.tvdbId || ""),
    tmdbId: String(ids?.tmdbId || ""),
    imdbId: String(ids?.imdbId || ""),
    tvmazeId: String(ids?.tvmazeId || ""),
  };
  const key = `ids|${known.tvdbId}|${known.tmdbId}|${known.imdbId}|${known.tvmazeId}`;
  return remember(key, async () => {
    const out = { ...known };
    if (!out.tmdbId && out.tvdbId) out.tmdbId = await tmdbFind(out.tvdbId, "tvdb_id");
    if (!out.tmdbId && out.imdbId) out.tmdbId = await tmdbFind(out.imdbId, "imdb_id");
    if (out.tmdbId && (!out.tvdbId || !out.imdbId)) {
      const ext = await tmdbShowExternalIds(out.tmdbId);
      out.tvdbId ||= String(ext.tvdb_id ?? "");
      out.imdbId ||= String(ext.imdb_id ?? "");
    }
    if (!out.tvmazeId && out.tvdbId) {
      out.tvmazeId =
        String(getTvmazeIdByTvdbId(out.tvdbId) ?? "") || (await mazeLookup("thetvdb", out.tvdbId));
    }
    if (!out.tvmazeId && out.imdbId) out.tvmazeId = await mazeLookup("imdb", out.imdbId);
    return out;
  });
}

function tvdbSearchSeries(title, year) {
  return remember(`tvdbSearchSeries|${title}|${year}`, async () => {
    const res = await tvdbGet(`/search?type=series&query=${encodeURIComponent(title)}`);
    const hit = (res?.data ?? []).find(
      (d) => normName(d.name) === normName(title) && (!year || String(d.year) === String(year)),
    );
    return String(hit?.tvdb_id ?? "");
  });
}

function tmdbSearchSeries(title, year) {
  return remember(`tmdbSearchSeries|${title}|${year}`, async () => {
    const results = (await tmdbGet(`/search/tv?query=${encodeURIComponent(title)}`))?.results ?? [];
    let matchTitle = smartTitleMatch(title, results, year, false);
    if (!matchTitle && year) matchTitle = smartTitleMatch(title, results, null, false);
    const match = matchTitle ? pickNamed(results, matchTitle, year) : null;
    return String(match?.id ?? "");
  });
}

function mazeSearchSeries(title, year) {
  return remember(`mazeSearchSeries|${title}|${year}`, async () => {
    const hits = ((await mazeGet(`/search/shows?q=${encodeURIComponent(title)}`)) ?? []).filter(
      (h) =>
        normName(h.show?.name) === normName(title) &&
        (!year || String(h.show?.premiered ?? "").startsWith(year)),
    );
    hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return String(hits[0]?.show?.id ?? "");
  });
}

// The ids still missing, from a search of each provider for the show's name,
// and then whatever those lead to.
function idsByName(ids, showName) {
  return remember(`idsByName|${ids.tvdbId}|${ids.tmdbId}|${ids.tvmazeId}|${showName}`, async () => {
    const { title, year } = splitTitleYear(showName);
    const out = { ...ids };
    if (!out.tvdbId) out.tvdbId = await tvdbSearchSeries(title, year);
    if (!out.tmdbId) out.tmdbId = await tmdbSearchSeries(title, year);
    if (!out.tvmazeId) out.tvmazeId = await mazeSearchSeries(title, year);
    return idsById(out);
  });
}

/**
 * The show's TMDB id: from its own ids first, a TMDB search for its name last.
 * Empty when there is none.
 */
export async function tmdbShowId(ids, showName) {
  const byId = await idsById(ids);
  if (byId.tmdbId || !showName) return byId.tmdbId;
  return (await idsByName(byId, showName)).tmdbId;
}

////////////////////////  provider lists  ////////////////////////

function fanartShow(tvdbId) {
  return remember(`fanart|${tvdbId}`, async () => {
    const res = (await getJson(`${FANART_API}/${tvdbId}?api_key=${FANART_KEY}`)) ?? {};
    const list = (key) =>
      (res[key] ?? []).map((a) => ({ url: a.url, lang: lang(a.lang), score: Number(a.likes) || 0 }));
    return { tvposter: list("tvposter"), tvthumb: list("tvthumb"), showbackground: list("showbackground") };
  });
}

function tvdbArtworks(tvdbId) {
  return remember(`tvdbArt|${tvdbId}`, async () => {
    const data = (await tvdbGet(`/series/${tvdbId}/artworks`))?.data;
    return {
      image: tvdbUrl(data?.image),
      list: (data?.artworks ?? []).map((a) => ({
        type: a.type,
        url: tvdbUrl(a.image),
        lang: lang(a.language),
        score: a.score || 0,
      })),
    };
  });
}

function tmdbImages(tmdbId) {
  return remember(`tmdbImages|${tmdbId}`, async () => {
    const res = (await tmdbGet(`/tv/${tmdbId}/images`)) ?? {};
    const list = (items, size) =>
      (items ?? []).map((i) => ({
        url: TMDB_IMG + size + i.file_path,
        lang: lang(i.iso_639_1),
        score: i.vote_average || 0,
      }));
    return {
      posters: list(res.posters, TMDB_POSTER_SIZE),
      backdrops: list(res.backdrops, TMDB_BACKDROP_SIZE),
    };
  });
}

// TVmaze has no language or score on its images; its main one scores highest.
function mazeImages(tvmazeId) {
  return remember(`mazeImages|${tvmazeId}`, async () =>
    ((await mazeGet(`/shows/${tvmazeId}/images`)) ?? []).map((i) => ({
      type: i.type,
      url: i.resolutions?.original?.url,
      lang: "",
      score: i.main ? 1 : 0,
    })),
  );
}

const episodeKey = (season, episode) => `${Number(season)}x${Number(episode)}`;

// Every episode of the series by "SxE": its TVDB id and image.
function tvdbEpisodes(tvdbId) {
  return remember(`tvdbEps|${tvdbId}`, async () => {
    const byKey = new Map();
    for (let page = 0; ; page++) {
      const res = await tvdbGet(`/series/${tvdbId}/episodes/default?page=${page}`);
      for (const e of res?.data?.episodes ?? []) {
        byKey.set(episodeKey(e.seasonNumber, e.number), { id: e.id, image: tvdbUrl(e.image) });
      }
      if (!res?.links?.next) break;
    }
    return byKey;
  });
}

function tmdbStills(tmdbId, season, episode) {
  return remember(`tmdbStills|${tmdbId}|${episodeKey(season, episode)}`, async () => {
    const res = await tmdbGet(`/tv/${tmdbId}/season/${season}/episode/${episode}/images`);
    return (res?.stills ?? []).map((i) => ({
      url: TMDB_IMG + TMDB_STILL_SIZE + i.file_path,
      lang: lang(i.iso_639_1),
      score: i.vote_average || 0,
    }));
  });
}

// Every episode of the series by "SxE": its TVmaze id and image.
function mazeEpisodes(tvmazeId) {
  return remember(`mazeEps|${tvmazeId}`, async () => {
    const byKey = new Map();
    for (const e of (await mazeGet(`/shows/${tvmazeId}/episodes?specials=1`)) ?? []) {
      if (e.number == null) continue;
      byKey.set(episodeKey(e.season, e.number), { id: e.id, image: e.image?.medium || "" });
    }
    return byKey;
  });
}

////////////////////////  show images  ////////////////////////

const SHOW_SOURCES = {
  // The portrait poster.
  poster: [
    async ({ tvdbId }) => (tvdbId ? pickBest((await fanartShow(tvdbId)).tvposter, TITLED) : ""),
    async ({ tvdbId }) => {
      if (!tvdbId) return "";
      const art = await tvdbArtworks(tvdbId);
      return pickBest(art.list.filter((a) => a.type === TVDB_POSTER_TYPE), TITLED) || pickBest([{ url: art.image, lang: "", score: 0 }], TITLED);
    },
    async ({ tmdbId }) => (tmdbId ? pickBest((await tmdbImages(tmdbId)).posters, TITLED) : ""),
    async ({ tvmazeId }) =>
      tvmazeId ? pickBest((await mazeImages(tvmazeId)).filter((i) => i.type === "poster"), TITLED) : "",
  ],
  // The landscape image of a tvapp show card: fanart.tv's title card, else wide
  // art with nothing on it.
  thumb: [
    async ({ tvdbId }) => {
      if (!tvdbId) return "";
      const fanart = await fanartShow(tvdbId);
      return pickBest(fanart.tvthumb, TITLED) || pickBest(fanart.showbackground, TEXTLESS);
    },
    async ({ tvdbId }) =>
      tvdbId
        ? pickBest((await tvdbArtworks(tvdbId)).list.filter((a) => a.type === TVDB_BACKGROUND_TYPE), TEXTLESS)
        : "",
    async ({ tmdbId }) => (tmdbId ? pickBest((await tmdbImages(tmdbId)).backdrops, TEXTLESS) : ""),
    async ({ tvmazeId }) =>
      tvmazeId ? pickBest((await mazeImages(tvmazeId)).filter((i) => i.type === "background"), TEXTLESS) : "",
  ],
};

// The searches by the show's own name, the last resort. TVDB's search index
// carries a poster for some upcoming shows that have no artwork yet.
const SHOW_SEARCHES = {
  poster: [
    ({ tvdbId }, showName) =>
      remember(`tvdbSearchPoster|${tvdbId}|${showName}`, async () => {
        if (!tvdbId) return "";
        const { title } = splitTitleYear(showName);
        const res = await tvdbGet(`/search?type=series&query=${encodeURIComponent(title)}`);
        const hit = (res?.data ?? []).find((d) => String(d.tvdb_id) === String(tvdbId));
        return pickBest(
          [
            { url: tvdbUrl(hit?.image_url), lang: "", score: 1 },
            { url: tvdbUrl(hit?.thumbnail), lang: "", score: 0 },
          ],
          TITLED,
        );
      }),
  ],
  thumb: [],
};

/**
 * A show's image of one kind, "poster" or "thumb". ids is what the caller
 * knows of {tvdbId, tmdbId, imdbId, tvmazeId}; showName is only searched for
 * once those have led nowhere. Empty when no provider has one. Never throws.
 */
export function showImage(kind, ids, showName) {
  const key = `show|${kind}|${ids?.tvdbId || ""}|${ids?.tmdbId || ""}|${showName || ""}`;
  const label = showName || ids?.tvdbId;
  return answer(key, label, (trace) =>
    firstById(SHOW_SOURCES[kind], SHOW_SEARCHES[kind], ids, showName, trace),
  );
}

////////////////////////  episode images  ////////////////////////

// fanart.tv has no episode images.
const EPISODE_SOURCES = [
  async ({ tvdbId }, season, episode) =>
    tvdbId ? (await tvdbEpisodes(tvdbId)).get(episodeKey(season, episode))?.image || "" : "",
  async ({ tmdbId }, season, episode) =>
    tmdbId ? pickBest(await tmdbStills(tmdbId, season, episode), TEXTLESS) : "",
  async ({ tvmazeId }, season, episode) =>
    tvmazeId ? (await mazeEpisodes(tvmazeId)).get(episodeKey(season, episode))?.image || "" : "",
];

/** An episode's still. Empty when no provider has one. Never throws. */
export function episodeImage(ids, showName, season, episode) {
  const key = `episode|${ids?.tvdbId || ""}|${showName || ""}|${episodeKey(season, episode)}`;
  const label = `${showName} ${episodeKey(season, episode)}`;
  return answer(key, label, (trace) =>
    firstById(EPISODE_SOURCES, [], ids, showName, trace, season, episode),
  );
}

////////////////////////  people  ////////////////////////

// A person's name is who they are, so a photo is found by searching for it and
// is the same for every show. fanart.tv has no photos of people; the rest in
// provider order, an exact name match with a photo, the provider's best scored.
const PERSON_SEARCHES = [
  (p) =>
    remember(`tvdbSearchPerson|${p.key}`, async () => {
      // TVDB's people search carries no score; its own order stands in for one.
      const res = await tvdbGet(`/search?type=people&query=${encodeURIComponent(p.name)}`);
      const hit = (res?.data ?? []).find((d) => normName(d.name) === p.key && d.image_url);
      return tvdbUrl(hit?.image_url);
    }),
  (p) =>
    remember(`tmdbSearchPerson|${p.key}`, async () => {
      const results = (await tmdbGet(`/search/person?query=${encodeURIComponent(p.name)}`))?.results ?? [];
      const hits = results.filter((r) => normName(r.name) === p.key && r.profile_path);
      hits.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
      return hits[0] ? TMDB_IMG + TMDB_PROFILE_SIZE + hits[0].profile_path : "";
    }),
  (p) =>
    remember(`mazeSearchPerson|${p.key}`, async () => {
      const hits = ((await mazeGet(`/search/people?q=${encodeURIComponent(p.name)}`)) ?? []).filter(
        (h) => normName(h.person?.name) === p.key && h.person?.image?.medium,
      );
      hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      return hits[0]?.person.image.medium || "";
    }),
];

/**
 * A photo of a cast, guest or crew member, by name alone. Empty when no
 * provider has one. Never throws.
 */
export function personImage(name) {
  const p = { name, key: normName(name) };
  if (!p.key) return Promise.resolve("");
  return answer(`person|${p.key}`, name, (trace) => firstOf(PERSON_SEARCHES, trace, p));
}
