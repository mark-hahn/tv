import fs from "fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import { parse as parseTorrentTitle } from "parse-torrent-title";
import {
  getFileName,
  getFullPath,
  getPos,
  hasBif,
  isWatched,
  parseFileSeasonEpisode,
  parseTitleFromFilename,
  smartTitleMatch,
} from "@tv/share";
import { SRVR_DATA_DIR, SRVR_ROOT_DIR } from "./srvrPaths.js";
import * as flexget from "./flexget.js";
import * as tvdb from "./tvdb.js";
import * as unilogDb from "./unilogDb.js";
import * as view from "./lastViewed.js";

const TV_ROOT = "/mnt/media/tv";
const MOVIE_ROOT = "/mnt/media/movies";
const APPS_DIR = path.dirname(SRVR_ROOT_DIR);
const DOWN_DB_PATH = path.join(APPS_DIR, "down", "data", "tv.sqlite");
const API_DATA_DIR = path.join(APPS_DIR, "api", "data");
const ASR_DATA_DIR = path.join(APPS_DIR, "asr", "data");
const CHKSRT_HISTORY_PATH = path.join(SRVR_DATA_DIR, "chksrt-history.json");
const CHKSRT_SNOOZED_PATH = path.join(SRVR_DATA_DIR, "chksrt-snoozed.json");
const OPN_CHECK_HISTORY_PATH = path.join(
  SRVR_DATA_DIR,
  "opn-check-history.json",
);
const SUB_QUEUE_PATH = path.join(ASR_DATA_DIR, "subQueue.json");
const SUB_QUEUE_CHKSRT_PATH = path.join(ASR_DATA_DIR, "subQueueChkSrt.json");
const ASR_QUEUE_PATH = path.join(ASR_DATA_DIR, "asrQueue.json");
const BROWSE_CARDS_PATH = path.join(API_DATA_DIR, "browse-cards.json");
const VIDEO_RE = /\.(mkv|mp4|avi|m4v|mov|wmv|mpg|mpeg|ts|m2ts|webm)$/i;
const LA_TIME_ZONE = "America/Los_Angeles";

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function resolveMediaPath(relPath, movieMode) {
  const rel = String(relPath || "").trim();
  if (
    !rel ||
    path.isAbsolute(rel) ||
    rel.includes("\0") ||
    rel.split(/[\\/]+/).includes("..")
  ) {
    throw new Error("Invalid path");
  }
  const root = movieMode ? MOVIE_ROOT : TV_ROOT;
  const rootPath = path.resolve(root);
  const fullPath = path.resolve(rootPath, rel);
  if (!(fullPath === rootPath || fullPath.startsWith(rootPath + path.sep))) {
    throw new Error("Invalid path");
  }
  return { root, relPath: rel, fullPath };
}

function normalizeTitle(s) {
  let out = String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(\d{4}\)/g, " ")
    .replace(/&/g, " and ");
  out = out.replace(/\b([a-z])\./g, "$1").replace(/\./g, " ");
  return out
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRe(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function laOffsetMinutes(utcMs) {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TIME_ZONE,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === "timeZoneName")?.value;
  const m = String(part || "").match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return -8 * 60;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
}

function parseLaDateTime(
  year,
  month,
  day,
  hour = "00",
  minute = "00",
  second = "00",
) {
  const localUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  let offset = laOffsetMinutes(localUtc);
  let ms = localUtc - offset * 60 * 1000;
  const offset2 = laOffsetMinutes(ms);
  if (offset2 !== offset) ms = localUtc - offset2 * 60 * 1000;
  return ms;
}

function parseAnyTimestamp(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 100000000000 ? value * 1000 : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return parseAnyTimestamp(Number(raw));

  let m = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})[- T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) return parseLaDateTime(m[1], m[2], m[3], m[4], m[5], m[6]);

  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (m) return parseLaDateTime(m[1], m[2], m[3], m[4], m[5], m[6]);

  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return parseLaDateTime(m[1], m[2], m[3]);

  m = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})-(\d{2}):(\d{2}):(\d{2})$/);
  if (m) return parseLaDateTime(m[1], m[2], m[3], m[4], m[5], m[6]);

  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function fmtTs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const p = {};
  for (const part of parts) p[part.type] = part.value;
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.month}/${p.day} ${hour}:${p.minute}:${p.second}`;
}

function eventKey(event) {
  return `${Math.trunc(event.ms || 0)}\0${event.source || ""}\0${event.text || ""}`;
}

function makeCollector() {
  const events = [];
  const seen = new Set();
  return {
    add(msLike, source, text) {
      const ms = parseAnyTimestamp(msLike);
      if (!ms || !text) return;
      const event = {
        ms,
        source,
        text: String(text).replace(/\s+/g, " ").trim(),
      };
      const key = eventKey(event);
      if (seen.has(key)) return;
      seen.add(key);
      events.push(event);
    },
    events,
  };
}

function outputLines(events) {
  return events
    .filter((e) => Number.isFinite(e.ms) && e.ms > 0 && e.text)
    .sort((a, b) => a.ms - b.ms || a.text.localeCompare(b.text))
    .map((e) => `${fmtTs(e.ms)} ${e.text}`);
}

function showFolderFromRec(showName, rec) {
  return String(rec?.path || rec?.emby?.path || showName || "")
    .split("/")
    .pop();
}

function findShow(relPath, parsed, movieMode) {
  if (movieMode) return { showName: "", rec: null, folderName: "" };
  const folderName = relPath.split("/")[0] || "";
  const all = tvdb.getAllTvdbSync() || {};
  if (all[folderName])
    return { showName: folderName, rec: all[folderName], folderName };

  const records = Object.values(all).filter((r) => r && typeof r === "object");
  const match = smartTitleMatch(folderName, records, null, false);
  if (match?.name)
    return { showName: match.name, rec: all[match.name] || match, folderName };

  const parsedTitle = parsed?.title ? String(parsed.title) : "";
  if (parsedTitle) {
    const parsedMatch = smartTitleMatch(
      parsedTitle,
      records,
      parsed?.year,
      false,
    );
    if (parsedMatch?.name)
      return {
        showName: parsedMatch.name,
        rec: all[parsedMatch.name] || parsedMatch,
        folderName,
      };
  }

  return { showName: folderName, rec: all[folderName] || null, folderName };
}

function parseSelection(relPath, movieMode) {
  const fileName = path.basename(relPath);
  const parentName = path.basename(path.dirname(relPath));
  let parsedTitle = null;
  let parsedFolder = null;
  try {
    parsedTitle = parseTorrentTitle(fileName.replace(/\.[a-z0-9]+$/i, ""));
  } catch {}
  try {
    parsedFolder = parseTorrentTitle(parentName.replace(/\.[a-z0-9]+$/i, ""));
  } catch {}
  const se =
    parseFileSeasonEpisode(fileName, parentName, parsedTitle, parsedFolder) ||
    {};
  const title = parseTitleFromFilename(fileName, parentName, parsedTitle) || "";
  const show = findShow(relPath, { ...parsedTitle, title }, movieMode);
  return {
    fileName,
    parentName,
    season: Number.isInteger(se.season) ? se.season : null,
    episode: Number.isInteger(se.episode) ? se.episode : null,
    parsedTitle,
    title,
    ...show,
  };
}

function episodeLabel(season, episode) {
  if (!Number.isInteger(season) || !Number.isInteger(episode)) return "";
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function addTvdbEvents(add, ctx) {
  const rec = ctx.rec;
  if (!rec) return;
  const showName = ctx.showName || rec.name || "show";
  add(rec.dateCreated, "tvdb", `${showName} added to Emby`);
  add(rec["last-downloaded"], "tvdb", `${showName} last downloaded`);
  add(rec.lastPlayedDate, "tvdb", `${showName} last played in Emby`);
  const lastViewed = view.getLastViewedSync()?.[showName];
  add(lastViewed, "lastViewed", `${showName} last viewed`);

  if (Number.isInteger(ctx.season) && Number.isInteger(ctx.episode)) {
    const ed = rec.episodeData;
    const fileName = getFileName(ed, ctx.season, ctx.episode);
    if (fileName)
      add(
        rec["last-downloaded"],
        "tvdb",
        `${showName} ${episodeLabel(ctx.season, ctx.episode)} file known to TVDB: ${fileName}`,
      );
    if (isWatched(ed, ctx.season, ctx.episode))
      add(
        rec.lastPlayedDate || lastViewed,
        "tvdb",
        `${showName} ${episodeLabel(ctx.season, ctx.episode)} watched`,
      );
    if (hasBif(ed, ctx.season, ctx.episode))
      add(
        rec["last-downloaded"],
        "tvdb",
        `${showName} ${episodeLabel(ctx.season, ctx.episode)} has BIF sidecar`,
      );
    const pos = getPos(ed, ctx.season, ctx.episode);
    if (pos > 0)
      add(
        rec.lastPlayedDate || lastViewed,
        "tvdb",
        `${showName} ${episodeLabel(ctx.season, ctx.episode)} has playback position`,
      );

    const folder = showFolderFromRec(showName, rec);
    const full = getFullPath(ed, folder, ctx.season, ctx.episode);
    if (full && full !== ctx.fullPath) {
      add(
        rec["last-downloaded"],
        "tvdb",
        `${showName} ${episodeLabel(ctx.season, ctx.episode)} TVDB path: ${full}`,
      );
    }
  }
}

function flexProvider(entry) {
  if (entry.provider) return entry.provider;
  const url = String(entry.url || "");
  if (url.includes("iptorrents.com")) return "ipt";
  if (url.includes("torrentleech.org")) return "tl";
  return "unknown provider";
}

function addFlexgetEvents(add, ctx) {
  const showNorm = normalizeTitle(ctx.showName);
  for (const row of flexget.getSentHistoryRows()) {
    if (showNorm && normalizeTitle(row.showName) !== showNorm) continue;
    const se = [row.seasonKey, row.episodeKey].filter(Boolean).join("");
    add(
      row.addedAt,
      "flexget",
      `Flexget selected ${se} candidate from ${flexProvider(row)}: ${row.title}`,
    );
    add(
      row.sent,
      "flexget",
      `Flexget sent torrent to qBittorrent from ${flexProvider(row)}: ${row.title}`,
    );
  }
}

function downRowsFor(ctx) {
  if (!fs.existsSync(DOWN_DB_PATH)) return [];
  let db;
  try {
    db = new Database(DOWN_DB_PATH, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
    const clauses = [];
    const params = [];
    const titles = [
      ctx.fileName,
      path.basename(ctx.fullPath),
      ctx.relPath,
    ].filter(Boolean);
    if (titles.length) {
      clauses.push(
        `(${titles.map(() => "title = ? OR destTitle = ?").join(" OR ")})`,
      );
      for (const title of titles) params.push(title, title);
    }
    if (ctx.showName) {
      clauses.push("seriesName = ?");
      params.push(ctx.showName);
    }
    if (ctx.fullPath) {
      clauses.push("localPath LIKE ?");
      params.push(`%${path.dirname(ctx.fullPath)}%`);
    }
    if (ctx.root === TV_ROOT && ctx.folderName) {
      clauses.push("localPath LIKE ?");
      params.push(
        `${path.join(TV_ROOT, ctx.folderName).replace(/\/+$/, "")}/%`,
      );
    }
    if (ctx.season != null && ctx.episode != null) {
      clauses.push("(season = ? AND episode = ?)");
      params.push(ctx.season, ctx.episode);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" OR ")}` : "";
    return db
      .prepare(
        `SELECT title, procId, usbPath, localPath, status, season, episode,
                dateAdded, dateStarted, dateEnded, seriesName, destTitle, fromFlex,
                error, reason
           FROM tv_entries ${where}
          ORDER BY COALESCE(dateAdded, dateStarted, dateEnded, 0) ASC
          LIMIT 200`,
      )
      .all(...params);
  } catch {
    return [];
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

function rowMatchesContext(row, ctx) {
  const rowShow = normalizeTitle(row.seriesName);
  const ctxShow = normalizeTitle(ctx.showName);
  const title = String(row.destTitle || row.title || "");
  const titleMatchesFile =
    title === ctx.fileName ||
    title.includes(ctx.fileName) ||
    ctx.fileName.includes(title);
  const seMatches =
    ctx.season == null ||
    ctx.episode == null ||
    (Number(row.season) === ctx.season &&
      Number(row.episode) === ctx.episode) ||
    new RegExp(escapeRe(episodeLabel(ctx.season, ctx.episode)), "i").test(
      title,
    );
  if (titleMatchesFile) return true;
  if (ctxShow && rowShow === ctxShow) return true;
  if (
    ctx.fullPath &&
    String(row.localPath || "") &&
    ctx.fullPath.startsWith(String(row.localPath).replace(/\/+$/, "") + "/")
  )
    return true;
  if (
    ctx.root === TV_ROOT &&
    ctx.folderName &&
    String(row.localPath || "").startsWith(
      `${path.join(TV_ROOT, ctx.folderName).replace(/\/+$/, "")}/`,
    )
  )
    return true;
  if (ctxShow && rowShow === ctxShow && seMatches) return true;
  return false;
}

function addDownEvents(add, ctx) {
  for (const row of downRowsFor(ctx)) {
    if (!rowMatchesContext(row, ctx)) continue;
    const title = row.destTitle || row.title || ctx.fileName;
    const origin = row.fromFlex ? "Flexget" : "Tor/API";
    add(row.dateAdded, "down", `${origin} queued down download: ${title}`);
    add(row.dateStarted, "down", `down download started: ${title}`);
    if (row.status === "finished" && !row.error)
      add(row.dateEnded, "down", `down download finished: ${title}`);
    else if (row.dateEnded)
      add(
        row.dateEnded,
        "down",
        `down download ended (${row.status || row.reason || "unknown"}): ${title}`,
      );
  }
}

function addJsonQueueEvents(add, ctx) {
  const full = ctx.fullPath;
  for (const entry of readJson(ASR_QUEUE_PATH, [])) {
    if (entry?.videoPath === full)
      add(entry.addedAt, "asr", `ASR queued: ${ctx.fileName}`);
  }
  for (const entry of readJson(SUB_QUEUE_PATH, [])) {
    if (entry?.videoFilePath === full)
      add(entry.addedAt, "subs", `subtitle extraction queued: ${ctx.fileName}`);
  }
  for (const entry of readJson(SUB_QUEUE_CHKSRT_PATH, [])) {
    if (entry?.videoFilePath === full)
      add(entry.addedAt, "chksrt", `ChkSrt queued: ${ctx.fileName}`);
  }

  const snoozed = readJson(CHKSRT_SNOOZED_PATH, {});
  const showEntries = Array.isArray(snoozed?.[ctx.showName])
    ? snoozed[ctx.showName]
    : [];
  for (const entry of showEntries) {
    if (entry?.videoFilePath === full)
      add(entry.snoozedAt, "chksrt", `ChkSrt snoozed: ${ctx.fileName}`);
  }
}

function addChksrtHistoryEvents(add, ctx) {
  const hist = readJson(CHKSRT_HISTORY_PATH, []);
  const fileNorm = normalizeTitle(ctx.fileName);
  for (const entry of Array.isArray(hist) ? hist : []) {
    if (
      ctx.showName &&
      normalizeTitle(entry?.showName) !== normalizeTitle(ctx.showName)
    )
      continue;
    if (
      entry?.videoFilename &&
      normalizeTitle(entry.videoFilename) !== fileNorm
    )
      continue;
    const choice = entry.choice ? ` (${entry.choice})` : "";
    add(
      entry.ts || entry.timestamp || entry.date || entry.addedAt,
      "chksrt",
      `ChkSrt finished${choice}: ${entry.videoFilename || ctx.fileName}`,
    );
  }
}

function addOpnCheckEvents(add, ctx) {
  const hist = readJson(OPN_CHECK_HISTORY_PATH, {});
  const entries = [];
  if (hist?.[ctx.fullPath]) entries.push(hist[ctx.fullPath]);
  if (ctx.showName && hist?.[ctx.showName]) entries.push(hist[ctx.showName]);
  for (const entry of entries) {
    if (Array.isArray(entry)) {
      for (const item of entry)
        add(
          item?.ts || item?.at || item?.checkedAt,
          "opensubs",
          `OpenSubtitles checked: ${ctx.fileName}`,
        );
    } else if (entry && typeof entry === "object") {
      add(
        entry.ts || entry.at || entry.checkedAt || entry.lastChecked,
        "opensubs",
        `OpenSubtitles checked: ${ctx.fileName}`,
      );
    }
  }
}

function addBrowseEvents(add, ctx) {
  if (!ctx.showName) return;
  const cards = readJson(BROWSE_CARDS_PATH, []);
  const showNorm = normalizeTitle(ctx.showName);
  for (const raw of Array.isArray(cards) ? cards : []) {
    let card = null;
    if (typeof raw === "string" && raw.trim().startsWith("{")) {
      try {
        card = JSON.parse(raw);
      } catch {}
    }
    if (!card || normalizeTitle(card.title) !== showNorm) continue;
    add(
      card.ts || card.at || card.addedAt || card.date,
      "browse",
      `Browse card recorded: ${card.title}`,
    );
  }
}

function addSidecarEvents(add, ctx) {
  const base = ctx.fullPath.replace(/\.[^.]+$/, "");
  const candidates = [
    {
      file: `${base}.asr.srt`,
      text: `ASR subtitle generated: ${path.basename(base)}.asr.srt`,
    },
    {
      file: `${base}.mb.chosen`,
      text: `subtitle choice marker written: ${path.basename(base)}.mb.chosen`,
    },
  ];
  const parsed = path.parse(ctx.fullPath);
  candidates.push({
    file: path.join(parsed.dir, `${parsed.name}-320-10.bif`),
    text: `BIF file generated: ${parsed.name}-320-10.bif`,
  });

  const mp4Rel = ctx.fullPath.startsWith(TV_ROOT + "/")
    ? ctx.fullPath.slice(TV_ROOT.length + 1)
    : "";
  if (mp4Rel) {
    candidates.push({
      file: path.join("/mnt/media/mpfour", mp4Rel.replace(/\.[^.]+$/, ".mp4")),
      text: `mp4 file generated: ${path.basename(mp4Rel).replace(/\.[^.]+$/, ".mp4")}`,
    });
  }

  try {
    const dir = path.dirname(ctx.fullPath);
    const prefix = path.basename(base);
    for (const name of fs.readdirSync(dir)) {
      if (
        name.startsWith(prefix) &&
        /\.opn[A-Z2-7]{5}\.srt$/i.test(name.slice(prefix.length))
      ) {
        candidates.push({
          file: path.join(dir, name),
          text: `OpenSubtitles file downloaded: ${name}`,
        });
        continue;
      }
      if (
        name.startsWith(prefix) &&
        /\.srt$/i.test(name) &&
        !name.endsWith(".asr.srt")
      ) {
        candidates.push({
          file: path.join(dir, name),
          text: `subtitle file present: ${name}`,
        });
      }
    }
  } catch {}

  for (const candidate of candidates) {
    try {
      const st = fs.statSync(candidate.file);
      add(st.mtimeMs, "file", candidate.text);
    } catch {}
  }

  try {
    const st = fs.statSync(ctx.fullPath);
    add(
      st.birthtimeMs || st.ctimeMs || st.mtimeMs,
      "file",
      `video file created on disk: ${ctx.fileName}`,
    );
    add(st.mtimeMs, "file", `video file modified on disk: ${ctx.fileName}`);
  } catch {}
}

function addUnilogEvents(add, ctx) {
  const showNorm = normalizeTitle(ctx.showName);
  const titleNorm = normalizeTitle(ctx.title);
  const fileStemNorm = normalizeTitle(ctx.fileName.replace(/\.[^.]+$/, ""));
  const se = episodeLabel(ctx.season, ctx.episode);
  const terms = new Set([
    ctx.fileName,
    path.basename(ctx.fullPath),
    ctx.showName,
    ctx.title,
  ]);
  for (const term0 of [...terms]) {
    const term = String(term0 || "").trim();
    if (term.length < 3) continue;
    let rows = [];
    try {
      rows = unilogDb.queryEvents({ msg: term, limit: 1000 }) || [];
    } catch {
      rows = [];
    }
    for (const row of rows) {
      const msg = String(row.message || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!msg) continue;
      const lower = msg.toLowerCase();
      const msgNorm = normalizeTitle(msg);
      const hasFile =
        (ctx.fileName && msg.includes(ctx.fileName)) ||
        (fileStemNorm && msgNorm.includes(fileStemNorm));
      const hasShow = showNorm && msgNorm.includes(showNorm);
      const hasParsedTitle = titleNorm && msgNorm.includes(titleNorm);
      const hasSelectedIdentity = hasFile || hasShow || hasParsedTitle;
      if (!hasSelectedIdentity) continue;
      if (
        !hasShow &&
        !hasFile &&
        se &&
        !new RegExp(escapeRe(se), "i").test(msg)
      )
        continue;
      const important =
        lower.includes("sent") ||
        lower.includes("qbt") ||
        lower.includes("download") ||
        lower.includes("down") ||
        lower.includes("opensubs") ||
        lower.includes("asr") ||
        lower.includes("chksrt") ||
        lower.includes("bif") ||
        lower.includes("mp4") ||
        lower.includes("intro") ||
        lower.includes("created tvdb") ||
        lower.includes("added") ||
        lower.includes("finished") ||
        lower.includes("done") ||
        lower.includes("view");
      if (!important) continue;
      add(row.ts, "unilog", `${row.pid || "log"}: ${msg}`);
    }
  }
}

export function getLocalHistory(params = {}) {
  const { relPath, movieMode } = params || {};
  const media = resolveMediaPath(
    relPath,
    movieMode === true || movieMode === "true",
  );
  if (!VIDEO_RE.test(media.fullPath))
    throw new Error("Selected file is not a video");

  const parsed = parseSelection(media.relPath, media.root === MOVIE_ROOT);
  const ctx = { ...media, ...parsed };
  const collector = makeCollector();
  const add = collector.add.bind(collector);

  addTvdbEvents(add, ctx);
  addFlexgetEvents(add, ctx);
  addDownEvents(add, ctx);
  addJsonQueueEvents(add, ctx);
  addChksrtHistoryEvents(add, ctx);
  addOpnCheckEvents(add, ctx);
  addBrowseEvents(add, ctx);
  addSidecarEvents(add, ctx);
  addUnilogEvents(add, ctx);

  const lines = outputLines(collector.events);
  const header =
    `${ctx.showName || "<no show>"} ${episodeLabel(ctx.season, ctx.episode)} ${ctx.fileName}`
      .replace(/\s+/g, " ")
      .trim();
  return {
    ok: true,
    showName: ctx.showName,
    season: ctx.season,
    episode: ctx.episode,
    path: ctx.fullPath,
    events: collector.events.sort((a, b) => a.ms - b.ms),
    text: lines.length
      ? lines.join("\n")
      : `${header}\nNo timestamped history found.`,
  };
}
