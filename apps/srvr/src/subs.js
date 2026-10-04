// subs — a video's subtitle files and the OpenSubtitles side of them: every
// search result ever returned, which of them were downloaded, the download a
// video waits on before it plays, and which subtitle each episode last showed.
//
// Every subtitle is a sidecar .srt beside its video; embedded tracks are
// copied out to sidecars (subsQueue.js) and never shown themselves. Nothing is
// downloaded from OpenSubtitles except here, just before a video plays.

import fs from "fs";
import * as path from "node:path";
import Database from "better-sqlite3";
import fetch from "node-fetch";
import { logHere, cleanSrt, unilog} from "@tv/share"
import { SRVR_DATA_DIR } from "./srvrPaths.js";
import { notifyClients } from "./messaging.js";
import {
  getSubsToken,
  loadSubsLogin,
  openSubtitlesDownloadWithRetry,
  subsSearch,
} from "./opensubtitles.js";
import { sameOrigin, sidecarLabel, sidecarType } from "./subOrigin.js";
import { resFindEpisodeVideos, resIsSampleName } from "./videoFiles.js";

const SUBS_DB_PATH = path.join(SRVR_DATA_DIR, "subs.db");
// Downloads an episode gets, and how long a video waits for them: about twice
// what a search and three downloads at once took when measured (1.5 s on
// 10-02).
const SUBS_PER_EPISODE = 3;
const PLAY_WAIT_MS = 3000;
// The order a video's subtitles are listed in, and the first one is started
// on when nothing has been chosen yet.
const TYPE_ORDER = "THVS+";
const TAG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const db = new Database(SUBS_DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
// subs: one row per file an OpenSubtitles search ever returned, in the order
// the searches returned them. picks: the sidecar each episode last showed.
// processed: videos the add-to-disk steps have been through.
db.exec(`
  CREATE TABLE IF NOT EXISTS subs (
    showId TEXT NOT NULL, season INTEGER NOT NULL, episode INTEGER NOT NULL,
    fileId INTEGER NOT NULL,
    downloaded INTEGER NOT NULL DEFAULT 0, chosen INTEGER NOT NULL DEFAULT 0,
    hearingImpaired INTEGER, hd INTEGER, foreignPartsOnly INTEGER,
    aiTranslated INTEGER, machineTranslated INTEGER, fps REAL,
    uploaderId INTEGER, uploadDate TEXT, release TEXT, comments TEXT, title TEXT,
    PRIMARY KEY (showId, season, episode, fileId)
  );
  CREATE TABLE IF NOT EXISTS picks (
    showId TEXT NOT NULL, season INTEGER NOT NULL, episode INTEGER NOT NULL,
    suffix TEXT NOT NULL, type TEXT NOT NULL, ts INTEGER NOT NULL,
    PRIMARY KEY (showId, season, episode)
  );
  CREATE TABLE IF NOT EXISTS processed (path TEXT PRIMARY KEY);
`);

const insertSub = db.prepare(`
  INSERT OR IGNORE INTO subs (showId, season, episode, fileId, hearingImpaired,
    hd, foreignPartsOnly, aiTranslated, machineTranslated, fps, uploaderId,
    uploadDate, release, comments, title)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const episodeSubs = db.prepare(
  `SELECT * FROM subs WHERE showId = ? AND season = ? AND episode = ? ORDER BY rowid`,
);
const chosenSubs = db.prepare(
  `SELECT * FROM subs WHERE showId = ? AND chosen = 1`,
);
const countDownloaded = db.prepare(
  `SELECT COUNT(*) n FROM subs WHERE showId = ? AND season = ? AND episode = ? AND downloaded = 1`,
);
const markDownloaded = db.prepare(
  `UPDATE subs SET downloaded = 1 WHERE showId = ? AND season = ? AND episode = ? AND fileId = ?`,
);
// @ids is a JSON array of the file ids on disk; only rows that differ change.
const syncDownloads = db.prepare(`
  UPDATE subs SET downloaded = (fileId IN (SELECT value FROM json_each(@ids)))
  WHERE showId = @showId AND season = @season AND episode = @episode
    AND downloaded != (fileId IN (SELECT value FROM json_each(@ids)))
`);
const downloadedEpisodes = db.prepare(
  `SELECT DISTINCT showId, season, episode FROM subs WHERE downloaded = 1`,
);
const setChosen = db.prepare(
  `UPDATE subs SET chosen = (fileId = ?) WHERE showId = ? AND season = ? AND episode = ?`,
);
const episodePick = db.prepare(
  `SELECT * FROM picks WHERE showId = ? AND season = ? AND episode = ?`,
);
const lastShowPick = db.prepare(
  `SELECT * FROM picks WHERE showId = ? ORDER BY ts DESC LIMIT 1`,
);
const upsertPick = db.prepare(`
  INSERT INTO picks (showId, season, episode, suffix, type, ts)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(showId, season, episode)
  DO UPDATE SET suffix = excluded.suffix, type = excluded.type, ts = excluded.ts
`);
const processedRow = db.prepare(`SELECT 1 FROM processed WHERE path = ?`);
const insertProcessed = db.prepare(
  `INSERT OR IGNORE INTO processed (path) VALUES (?)`,
);

const fmtCode = (season, episode) =>
  `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;

// ---- sidecar files ----

export function videoStem(videoPath) {
  return path.basename(videoPath).replace(/\.[^.]+$/, "");
}

// The 5-char tag an OpenSubtitles file_id has in a ".opn<TAG>.srt" name.
function fileIdTag(fileId) {
  let n = Math.floor(Number(fileId));
  let out = "";
  do {
    out = TAG_ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  } while (n > 0);
  return out.padStart(5, "A");
}

function tagFileId(suffix) {
  let n = 0;
  for (const ch of suffix.slice(3).toUpperCase())
    n = n * 32 + TAG_ALPHABET.indexOf(ch);
  return n;
}

function opnPath(videoPath, fileId) {
  return path.join(
    path.dirname(videoPath),
    `${videoStem(videoPath)}.opn${fileIdTag(fileId)}.srt`,
  );
}

// The video's subtitle files, [{file, suffix, type, label}], in TYPE_ORDER.
// suffix is what sits between the video's name and ".srt".
export function listSidecars(videoPath) {
  const stem = videoStem(videoPath);
  return fs
    .readdirSync(path.dirname(videoPath))
    .filter(
      (f) =>
        f.endsWith(".srt") && (f === `${stem}.srt` || f.startsWith(`${stem}.`)),
    )
    .map((file) => {
      const suffix = file.slice(stem.length + 1, -".srt".length);
      return {
        file,
        suffix,
        type: sidecarType(suffix),
        label: sidecarLabel(suffix),
      };
    })
    .sort(
      (a, b) =>
        TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
        a.file.localeCompare(b.file, undefined, { numeric: true }),
    );
}

// The episode's downloaded marks, from the opn files beside its videos in dir:
// the disk is what counts. With no video, nothing is downloaded.
export function syncDownloaded(showId, season, episode, dir) {
  const ids = resFindEpisodeVideos(dir, season, episode)
    .filter((v) => !resIsSampleName(v.name))
    .flatMap((v) => listSidecars(path.join(dir, v.name)))
    .filter((s) => s.type === "V")
    .map((s) => tagFileId(s.suffix));
  syncDownloads.run({ ids: JSON.stringify(ids), showId, season, episode });
}

// episodes, as {showId, season, episode}, must be every episode with a video
// on disk: one marked downloaded that is not among them has nothing
// downloaded.
export function clearDownloadedWithout(episodes) {
  const seen = new Set(
    episodes.map((e) => `${e.showId} ${e.season} ${e.episode}`),
  );
  for (const e of downloadedEpisodes.all())
    if (!seen.has(`${e.showId} ${e.season} ${e.episode}`))
      syncDownloads.run({ ids: "[]", ...e });
}

// ---- which one a video starts on, and which one it stopped on ----

// The index in sidecars to start on, -1 with none: the one this episode last
// showed, else one of the type the show last showed (for a download, the one
// from the same origin as a chosen one), else the first.
export function pickSidecar(showId, season, episode, sidecars) {
  if (sidecars.length === 0) return -1;
  const own = episodePick.get(showId, season, episode);
  if (own) {
    const i = sidecars.findIndex((s) => s.suffix === own.suffix);
    if (i !== -1) return i;
  }
  const last = lastShowPick.get(showId);
  if (!last) return 0;
  if (last.type === "V") {
    const chosen = chosenSubs.all(showId);
    const rows = episodeSubs.all(showId, season, episode);
    const i = sidecars.findIndex((s) => {
      if (s.type !== "V") return false;
      const row = rows.find((r) => r.fileId === tagFileId(s.suffix));
      return !!row && chosen.some((c) => sameOrigin(row, c));
    });
    if (i !== -1) return i;
  }
  return Math.max(
    0,
    sidecars.findIndex((s) => s.type === last.type),
  );
}

// The video stopped with this subtitle file showing: it is the episode's
// chosen one now, and none of the episode's others are.
export function subStopped(showId, season, episode, videoPath, file) {
  const sidecar = listSidecars(videoPath).find((s) => s.file === file);
  if (!sidecar) return;
  upsertPick.run(
    showId,
    season,
    episode,
    sidecar.suffix,
    sidecar.type,
    Date.now(),
  );
  setChosen.run(
    sidecar.type === "V" ? tagFileId(sidecar.suffix) : -1,
    showId,
    season,
    episode,
  );
}

// ---- OpenSubtitles search results ----

// Search the episode and keep every result. A result counts as downloaded
// when its file sits beside the video.
export async function searchEpisode(rec, season, episode, videoPath) {
  const showId = String(rec.id);
  const data = await subsSearch({ imdb_id: rec.imdbId, season, episode });
  for (const item of Array.isArray(data?.data) ? data.data : []) {
    const a = item.attributes;
    const fileId = a?.files?.[0]?.file_id;
    if (!fileId) continue;
    insertSub.run(
      showId,
      season,
      episode,
      fileId,
      a.hearing_impaired ? 1 : 0,
      a.hd ? 1 : 0,
      a.foreign_parts_only ? 1 : 0,
      a.ai_translated ? 1 : 0,
      a.machine_translated ? 1 : 0,
      a.fps || 0,
      a.uploader?.uploader_id ?? null,
      a.upload_date ?? null,
      a.release ?? "",
      a.comments ?? "",
      a.feature_details?.title ?? "",
    );
  }
  syncDownloaded(showId, season, episode, path.dirname(videoPath));
}

// The next file to download for the episode, or null: the first result from
// the same origin as a chosen file of the show, else the first that is not
// foreign-parts-only.
function nextCandidate(showId, season, episode, failed) {
  const rows = episodeSubs
    .all(showId, season, episode)
    .filter((r) => !r.downloaded && !failed.has(r.fileId));
  const chosen = chosenSubs.all(showId);
  return (
    rows.find((r) => chosen.some((c) => sameOrigin(r, c))) ??
    rows.find((r) => !r.foreignPartsOnly) ??
    null
  );
}

// Whether the episode's search results hold a subtitle to use: one already
// downloaded or one that would be.
export function hasUsableSub(showId, season, episode) {
  return (
    countDownloaded.get(showId, season, episode).n > 0 ||
    !!nextCandidate(showId, season, episode, new Set())
  );
}

async function downloadSub(row, videoPath) {
  const login = loadSubsLogin();
  const dl = await openSubtitlesDownloadWithRetry({
    apiKey: login.apiKey,
    token: getSubsToken(),
    fileId: row.fileId,
  });
  if (!dl.resp.ok)
    throw new Error(`OpenSubtitles download HTTP ${dl.resp.status}`);
  const link = typeof dl.body?.link === "string" ? dl.body.link.trim() : "";
  if (!link) throw new Error("OpenSubtitles download gave no link");
  const resp = await fetch(link, { headers: { Accept: "*/*" } });
  if (!resp.ok) throw new Error(`subtitle file HTTP ${resp.status}`);
  await fs.promises.writeFile(
    opnPath(videoPath, row.fileId),
    cleanSrt(await resp.text()),
    "utf8",
  );
  markDownloaded.run(row.showId, row.season, row.episode, row.fileId);
}

// Search, then download until the episode has SUBS_PER_EPISODE or no candidate
// is left: all the ones it still needs at once, then replacements for any
// that failed. Never throws: returns what went wrong, one line each.
async function fetchSubs(rec, season, episode, videoPath) {
  const showId = String(rec.id);
  const code = fmtCode(season, episode);
  try {
    await searchEpisode(rec, season, episode, videoPath);
  } catch (e) {
    unilog(2674, `${rec.name} ${code} search failed: ${e.message}`);
    return [`search failed: ${e.message}`];
  }
  const errors = [];
  const failed = new Set();
  // Every file tried, so none is downloaded twice in one go.
  const tried = new Set();
  while (failed.size < SUBS_PER_EPISODE) {
    const need =
      SUBS_PER_EPISODE - countDownloaded.get(showId, season, episode).n;
    const batch = [];
    while (batch.length < need) {
      const row = nextCandidate(showId, season, episode, tried);
      if (!row) break;
      batch.push(row);
      tried.add(row.fileId);
    }
    if (batch.length === 0) break;
    await Promise.all(
      batch.map(async (row) => {
        try {
          await downloadSub(row, videoPath);
          unilog(2675, `${rec.name} ${code} downloaded opn${fileIdTag(row.fileId)}: ${row.release}`);
        } catch (e) {
          failed.add(row.fileId);
          errors.push(`download failed: ${e.message}`);
          unilog(2676, `${rec.name} ${code} download of opn${fileIdTag(row.fileId)} failed: ${e.message}`);
        }
      }),
    );
  }
  return errors;
}

const fetching = new Map();

// Before a video plays: its downloads, then whether it has any subtitle at
// all. Slow, failed or with none, the video plays anyway and the remotes put
// up a pop-up; what is still downloading is there next time.
export async function subsBeforePlay(rec, season, episode, videoPath) {
  const problems = [await downloadBeforePlay(rec, season, episode, videoPath)];
  if (listSidecars(videoPath).length === 0) problems.push("no subtitles");
  const text = problems.filter(Boolean).join("; ");
  if (text)
    notifyClients("subError", {
      text: `${rec.name} ${fmtCode(season, episode)}: ${text}`,
    });
}

// Bring the episode up to SUBS_PER_EPISODE downloads, waiting at most
// PLAY_WAIT_MS. Returns what went wrong, or null.
async function downloadBeforePlay(rec, season, episode, videoPath) {
  const showId = String(rec.id);
  const code = fmtCode(season, episode);
  if (countDownloaded.get(showId, season, episode).n >= SUBS_PER_EPISODE)
    return null;
  if (!rec.imdbId) {
    unilog(2677, `${rec.name} has no imdb id, ${code} was not searched`);
    return null;
  }
  const key = `${showId} ${code}`;
  let job = fetching.get(key);
  if (!job) {
    job = fetchSubs(rec, season, episode, videoPath).finally(() =>
      fetching.delete(key),
    );
    fetching.set(key, job);
  }
  let timer;
  const errors = await Promise.race([
    job,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), PLAY_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  if (errors === null) {
    unilog(2678, `${rec.name} ${code} played before its subtitle downloads finished`);
    return `subtitle download took more than ${PLAY_WAIT_MS / 1000} seconds`;
  }
  return errors.length > 0 ? `subtitle ${errors.join("; ")}` : null;
}

// ---- videos the add-to-disk steps have been through ----

export function isProcessed(videoPath) {
  return !!processedRow.get(videoPath);
}

export function markProcessed(videoPath) {
  insertProcessed.run(videoPath);
}
