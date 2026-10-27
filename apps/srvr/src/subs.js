// subs — a video's subtitle files and the OpenSubtitles side of them: every
// search result ever returned, which of them were downloaded, the download a
// video waits on before it plays, and which subtitle each episode last showed.
// It also keeps what subtitle vetting learns (subVet.js): each video's
// complete word-timed transcript and each sidecar's verdict; and the clip
// transcripts of the older checks
// (subPrepare.js), no longer made.
//
// Every subtitle is a sidecar .srt beside its video; embedded tracks are
// copied out to sidecars (subsQueue.js) and never shown themselves. Downloads
// from OpenSubtitles happen just before a video plays, and in the background
// for a video with no subtitle that fits it (downloadUntilFit).

import fs from "fs";
import * as path from "node:path";
import zlib from "zlib";
import Database from "better-sqlite3";
import fetch from "node-fetch";
import { logHere, cleanSrt, unilog} from "@tv/share"
import { SRVR_DATA_DIR } from "./srvrPaths.js";
import { notifyClients } from "./messaging.js";
import {
  getSubsToken,
  loadSubsLogin,
  normalizeImdbId,
  openSubtitlesDownloadWithRetry,
  subsDownloadQuota,
  subsSearch,
  subsShowImdbIds,
} from "./opensubtitles.js";
import {
  sameOrigin,
  sidecarLabel,
  sidecarType,
  srtContent,
} from "./subOrigin.js";
import { resFindEpisodeVideos, resIsSampleName } from "./videoFiles.js";
import { VET_VERSION } from "./subJudge.js";

const SUBS_DB_PATH = path.join(SRVR_DATA_DIR, "subs.db");
// Downloads an episode gets, and how long a video waits for them: a search
// and three downloads at once took 4.1 s on 10-04 (1.5 s on 10-02).
const SUBS_PER_EPISODE = 3;
const PLAY_WAIT_MS = 5000;
// The order a video's subtitles are listed in, and the first one is started
// on when nothing has been chosen yet.
const TYPE_ORDER = "THVS+";
const TAG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
// Background downloads an episode with no fitting subtitle gets in one go.
const MAX_FIT_DOWNLOADS = 5;
// What a play's subtitle list marks a file vetting judged good with.
const VERIFIED_MARK = "✓";
// The check methods of subtitle vetting (subVet.js): a full vetting, a cheap
// one judging against an old `+` file, and a video with no English audio
// matched by its sound. Only their good and filled verdicts get the mark.
export const VET_METHOD = "vet";
export const VET_CHEAP_METHOD = "vet-cheap";
export const VET_AUDIO_METHOD = "vet-audio";
const VET_METHODS = [VET_METHOD, VET_CHEAP_METHOD, VET_AUDIO_METHOD];
// The methods whose verdicts come from vetting's judge (subJudge.js): each
// holds only under the VET_VERSION it was made under. Audio matching's do
// not depend on the judge's rules.
const VET_JUDGE_METHODS = [VET_METHOD, VET_CHEAP_METHOD];
// tv-srvr started with vetting version 2 at 10-25 02:42:26 PDT. The judge's
// checks and unfit marks from before versions were stored are version 1's
// when older than this, else version 2's.
const VET_V2_SINCE_MS = 1792921346177;
// Cheap vetting downloads nothing while OpenSubtitles says fewer than this
// are left for the day, so plays keep theirs.
const CHEAP_DOWNLOAD_RESERVE = 200;
// The download quota OpenSubtitles last gave is asked for again after this
// long, or at once when its count has started afresh.
const QUOTA_FRESH_MS = 10 * 60 * 1000;
// The OpenSubtitles hash reads this much from each end of the video.
const HASH_CHUNK = 65536;

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
// clips: the ASR clip transcripts of a checked video (subPrepare.js), with the
// audio track they came from; track -1 marks a video with no English audio,
// checked by audio matching instead. checks: each sidecar's verdict, which
// holds while the file keeps the size and mtime it had.
db.exec(`
  CREATE TABLE IF NOT EXISTS clips (
    video TEXT PRIMARY KEY, track INTEGER NOT NULL, json TEXT NOT NULL,
    ts INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS checks (
    file TEXT PRIMARY KEY, video TEXT NOT NULL, size INTEGER NOT NULL,
    mtimeMs INTEGER NOT NULL, verdict TEXT NOT NULL, offsetMs INTEGER,
    method TEXT, detail TEXT, ts INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS checksVideo ON checks (video);
`);
// retimes: when a video's retime pass (subPrepare.js) last ran and the file
// it fitted to the .asr.srt, null when none did; the queue does not run a
// pass again by itself for a video that has a row.
db.exec(`
  CREATE TABLE IF NOT EXISTS retimes (
    video TEXT PRIMARY KEY, file TEXT, ts INTEGER NOT NULL
  );
`);
// transcripts: a video's complete word-timed ASR (asr.js) of audio track
// `track`, words [[text, startMs, endMs]] as gzipped JSON, text as the `+`
// file shows it.
db.exec(`
  CREATE TABLE IF NOT EXISTS transcripts (
    video TEXT PRIMARY KEY, track INTEGER NOT NULL, words BLOB NOT NULL,
    ts INTEGER NOT NULL
  );
`);
// checks.lyrics: a vetted file's ♪ captions placed in video time by its own
// line, [[fromMs, toMs]] as JSON, kept after the file is deleted: the other
// files of its video are judged with them (subJudge.js).
const checksCols = new Set(
  db.prepare(`PRAGMA table_info(checks)`).all().map((c) => c.name),
);
if (!checksCols.has("lyrics")) db.exec(`ALTER TABLE checks ADD COLUMN lyrics TEXT`);
// checks.version: the VET_VERSION a judge's check (VET_JUDGE_METHODS) was
// made under, null for any other check.
if (!checksCols.has("version")) {
  db.exec(`ALTER TABLE checks ADD COLUMN version INTEGER`);
  db.prepare(
    `UPDATE checks SET version = CASE WHEN ts >= ? THEN 2 ELSE 1 END
      WHERE method IN (${VET_JUDGE_METHODS.map((m) => `'${m}'`).join(", ")})`,
  ).run(VET_V2_SINCE_MS);
}
// subs.unfitFor: the video this file was found not to fit (another cut or
// rate); it is never downloaded for that video again. subs.hashFor: the video
// whose OpenSubtitles hash a search said this file was made for.
const subsCols = new Set(
  db.prepare(`PRAGMA table_info(subs)`).all().map((c) => c.name),
);
if (!subsCols.has("unfitFor")) db.exec(`ALTER TABLE subs ADD COLUMN unfitFor TEXT`);
if (!subsCols.has("hashFor")) db.exec(`ALTER TABLE subs ADD COLUMN hashFor TEXT`);
// subs.unfitVer: the VET_VERSION a full vetting found the file unfit under;
// the mark holds only under that version. Null for a mark of the older checks
// or of audio matching, which holds under every version. A vetting's mark
// from before the column takes the version of the deleted file's check.
if (!subsCols.has("unfitVer")) {
  db.exec(`ALTER TABLE subs ADD COLUMN unfitVer INTEGER`);
  const marked = db
    .prepare(`SELECT rowid, fileId, unfitFor FROM subs WHERE unfitFor IS NOT NULL`)
    .all();
  const markCheck = db.prepare(`SELECT method, version FROM checks WHERE file = ?`);
  const setVer = db.prepare(`UPDATE subs SET unfitVer = ? WHERE rowid = ?`);
  db.transaction(() => {
    for (const r of marked) {
      const check = markCheck.get(opnPath(r.unfitFor, r.fileId));
      if (check?.method === VET_METHOD) setVer.run(check.version, r.rowid);
    }
  })();
}

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
const deleteProcessed = db.prepare(`DELETE FROM processed WHERE path = ?`);
const setUnfitFor = db.prepare(
  `UPDATE subs SET unfitFor = ?, unfitVer = ? WHERE fileId = ?`,
);
const setHashFor = db.prepare(
  `UPDATE subs SET hashFor = ? WHERE showId = ? AND season = ? AND episode = ? AND fileId = ?`,
);
const clipsRow = db.prepare(`SELECT * FROM clips WHERE video = ?`);
const upsertClips = db.prepare(`
  INSERT INTO clips (video, track, json, ts) VALUES (?, ?, ?, ?)
  ON CONFLICT(video) DO UPDATE SET track = excluded.track, json = excluded.json,
    ts = excluded.ts
`);
const deleteClipsRow = db.prepare(`DELETE FROM clips WHERE video = ?`);
const fileCheck = db.prepare(`SELECT * FROM checks WHERE file = ?`);
const upsertCheck = db.prepare(`
  INSERT INTO checks (file, video, size, mtimeMs, verdict, offsetMs, method,
    detail, lyrics, version, ts)
  VALUES (@file, @video, @size, @mtimeMs, @verdict, @offsetMs, @method,
    @detail, @lyrics, @version, @ts)
  ON CONFLICT(file) DO UPDATE SET video = excluded.video, size = excluded.size,
    mtimeMs = excluded.mtimeMs, verdict = excluded.verdict,
    offsetMs = excluded.offsetMs, method = excluded.method,
    detail = excluded.detail, lyrics = excluded.lyrics,
    version = excluded.version, ts = excluded.ts
`);
const deleteCheckRow = db.prepare(`DELETE FROM checks WHERE file = ?`);
// A deleted file's check stays when it says the file was unusable or from
// another cut, or when vetting made it.
const deleteMisfitlessCheck = db.prepare(
  `DELETE FROM checks WHERE file = ? AND verdict NOT IN ('unusable', 'wrong cut')
    AND (method IS NULL OR method NOT IN (${VET_METHODS.map((m) => `'${m}'`).join(", ")}))`,
);
const deleteVideoChecks = db.prepare(`DELETE FROM checks WHERE video = ?`);
const videoMethodChecks = db.prepare(
  `SELECT file, lyrics FROM checks WHERE video = ? AND method = ?`,
);
const videoStaleChecks = db.prepare(
  `SELECT * FROM checks WHERE video = ?
    AND method IN (${VET_JUDGE_METHODS.map((m) => `'${m}'`).join(", ")})
    AND (version IS NULL OR version != ?)`,
);
const transcriptRow = db.prepare(`SELECT * FROM transcripts WHERE video = ?`);
const upsertTranscript = db.prepare(`
  INSERT INTO transcripts (video, track, words, ts) VALUES (?, ?, ?, ?)
  ON CONFLICT(video) DO UPDATE SET track = excluded.track,
    words = excluded.words, ts = excluded.ts
`);
const deleteTranscript = db.prepare(`DELETE FROM transcripts WHERE video = ?`);
const retimeRow = db.prepare(`SELECT * FROM retimes WHERE video = ?`);
const upsertRetime = db.prepare(`
  INSERT INTO retimes (video, file, ts) VALUES (?, ?, ?)
  ON CONFLICT(video) DO UPDATE SET file = excluded.file, ts = excluded.ts
`);
const deleteRetime = db.prepare(`DELETE FROM retimes WHERE video = ?`);

const fmtCode = (season, episode) =>
  `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;

// ---- sidecar files ----

export function videoStem(videoPath) {
  return path.basename(videoPath).replace(/\.[^.]+$/, "");
}

// The tag an OpenSubtitles file_id has in a ".opn<TAG>.srt" name: 5 chars,
// more for an id of 32^5 or over.
function fileIdTag(fileId) {
  let n = Math.floor(Number(fileId));
  let out = "";
  do {
    out = TAG_ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  } while (n > 0);
  return out.padStart(5, "A");
}

export function tagFileId(suffix) {
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

// The video's subtitle files, [{file, suffix, type}], in TYPE_ORDER.
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
      };
    })
    .sort(
      (a, b) =>
        TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
        a.file.localeCompare(b.file, undefined, { numeric: true }),
    );
}

// The sidecar with its content letters (srtContent), read from the file, and
// its label. ASR's files are not read: they hold neither.
async function labelled(dir, s) {
  const content =
    s.type === "+"
      ? ""
      : srtContent(await fs.promises.readFile(path.join(dir, s.file), "utf8"));
  return { ...s, content, label: sidecarLabel(s.suffix, content) };
}

// listSidecars, each one labelled.
export function labelSidecars(videoPath) {
  const dir = path.dirname(videoPath);
  return Promise.all(listSidecars(videoPath).map((s) => labelled(dir, s)));
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

// The index in labelled sidecars to start on, -1 with none: the one this
// episode last showed, else one of the type the show last showed (for a
// download, the one from the same origin as a chosen one), else the first.
// Past the episode's own pick, files without sound descriptions win: with any
// that are not ASR's, the choice is among them.
export function pickSidecar(showId, season, episode, sidecars, dir = null) {
  if (sidecars.length === 0) return -1;
  // A good ASR file is the start only when nothing of another type is good:
  // the others have a real subtitle's wording. So the episode's own last pick
  // is passed over when it is the ASR file and another file has been checked
  // good since, and the show's last type is passed over when it is ASR.
  const others = sidecars.some((s) => s.type !== "+");
  const own = episodePick.get(showId, season, episode);
  if (own) {
    const i = sidecars.findIndex((s) => s.suffix === own.suffix);
    const otherGoodSince =
      own.type === "+" &&
      dir &&
      sidecars.some(
        (s) =>
          s.type !== "+" &&
          (freshCheck(path.join(dir, s.file))?.ts ?? 0) > own.ts,
      );
    if (i !== -1 && !otherGoodSince) return i;
  }
  const quiet = sidecars.some((s) => s.type !== "+" && !s.content.includes("S"));
  const first = (want) =>
    sidecars.findIndex(
      (s) => (!quiet || (s.type !== "+" && !s.content.includes("S"))) && want(s),
    );
  const last = lastShowPick.get(showId);
  if (!last || (last.type === "+" && others)) return first(() => true);
  if (last.type === "V") {
    const chosen = chosenSubs.all(showId);
    const rows = episodeSubs.all(showId, season, episode);
    const i = first((s) => {
      if (s.type !== "V") return false;
      const row = rows.find((r) => r.fileId === tagFileId(s.suffix));
      return !!row && chosen.some((c) => sameOrigin(row, c));
    });
    if (i !== -1) return i;
  }
  const i = first((s) => s.type === last.type);
  return i !== -1 ? i : first(() => true);
}

// What a play offers: the video's sidecars and the index of the one to start
// on, -1 with none. Files vetting judged good (subVet.js) come first, marked
// VERIFIED_MARK, then T and H files judged otherwise, which came out of the
// video, then everything unjudged, then files cheap vetting found cut to
// their captions' first lines; files the older checks found from another
// cut, and signs tracks, are left out. The older checks' good verdicts get no
// mark: those files count as unjudged. The start is pickSidecar's choice
// among the first of those groups that has any. With no checks this is just
// labelSidecars and pickSidecar.
export async function playList(showId, season, episode, videoPath) {
  const dir = path.dirname(videoPath);
  const groups = [[], [], [], []];
  for (const s of await labelSidecars(videoPath)) {
    const check = freshCheck(path.join(dir, s.file));
    const verdict = check?.verdict;
    if (verdict === "wrong cut" || verdict === "unusable") continue;
    if (verdict === "truncated") groups[3].push(s);
    else if (isVetGood(check))
      groups[0].push({ ...s, label: `${s.label} ${VERIFIED_MARK}` });
    else if (verdict && "TH".includes(s.type)) groups[1].push(s);
    else groups[2].push(s);
  }
  let pick = -1;
  let before = 0;
  for (const group of groups) {
    if (group.length > 0) {
      pick = before + pickSidecar(showId, season, episode, group, dir);
      break;
    }
    before += group.length;
  }
  return { sidecars: groups.flat(), pick };
}

// The label a play's list gives the video's sidecar file (see playList), or
// null when there is no such file.
export async function playLabel(videoPath, file) {
  const dir = path.dirname(videoPath);
  const found = listSidecars(videoPath).find((x) => x.file === file);
  if (!found) return null;
  const s = await labelled(dir, found);
  return isVetGood(freshCheck(path.join(dir, file))) ? `${s.label} ${VERIFIED_MARK}` : s.label;
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
// when its file sits beside the video. OpenSubtitles can keep a show under
// another IMDb id than ours, so a search that finds nothing is tried again
// under the show's TMDB id, then under each IMDb id OpenSubtitles has for a
// show of its name.
export async function searchEpisode(rec, season, episode, videoPath) {
  const showId = String(rec.id);
  const code = fmtCode(season, episode);
  const moviehash = await videoHash(videoPath);
  const search = async (ids) => {
    const found = await subsSearch({ ...ids, season, episode, moviehash });
    return found?.data?.length ? found : null;
  };
  let data = await search({ imdb_id: rec.imdbId });
  const tmdbId = rec.remote_ids?.find((r) => r.type === 12)?.id;
  if (!data && tmdbId) {
    data = await search({ tmdb_id: tmdbId });
    if (data)
      unilog(2963, `${rec.name} ${code}: no subtitles under imdb ${rec.imdbId}, found under tmdb ${tmdbId}`);
  }
  if (!data) {
    const ids = await subsShowImdbIds(rec.name, rec.firstAired?.slice(0, 4));
    for (const imdbId of ids) {
      if (imdbId === normalizeImdbId(rec.imdbId)) continue;
      data = await search({ imdb_id: imdbId });
      if (!data) continue;
      unilog(2964, `${rec.name} ${code}: no subtitles under imdb ${rec.imdbId} or tmdb ${tmdbId}, found under imdb ${imdbId} by name`);
      break;
    }
  }
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
    if (a.moviehash_match) setHashFor.run(videoPath, showId, season, episode, fileId);
  }
  syncDownloaded(showId, season, episode, path.dirname(videoPath));
}

// The video's OpenSubtitles hash: its size plus every 8-byte little-endian
// word of its first and last HASH_CHUNK bytes, mod 2^64, as 16 hex digits.
async function videoHash(videoPath) {
  const fh = await fs.promises.open(videoPath, "r");
  try {
    const { size } = await fh.stat();
    let sum = BigInt(size);
    for (const at of [0, Math.max(0, size - HASH_CHUNK)]) {
      const buf = Buffer.alloc(HASH_CHUNK);
      await fh.read(buf, 0, HASH_CHUNK, at);
      for (let i = 0; i < HASH_CHUNK; i += 8)
        sum = (sum + buf.readBigUInt64LE(i)) & 0xffffffffffffffffn;
    }
    return sum.toString(16).padStart(16, "0");
  } finally {
    await fh.close();
  }
}

// The release group at the end of a video or release name ("...-NTb"),
// lowercase, or null.
function releaseGroup(name) {
  return /-([a-z0-9]{2,})$/i.exec(name)?.[1].toLowerCase() ?? null;
}

// The next file to download for the episode's video, or null, leaving out
// files found not to fit it (by a full vetting, only under this version):
// one made for the video by its hash, else one from the video's release
// group, else one from the same origin as a chosen file of the show, else the
// first that is not foreign-parts-only.
function nextCandidate(showId, season, episode, failed, videoPath) {
  const rows = episodeSubs
    .all(showId, season, episode)
    .filter(
      (r) =>
        !r.downloaded &&
        !failed.has(r.fileId) &&
        !(r.unfitFor === videoPath && (r.unfitVer == null || r.unfitVer === VET_VERSION)),
    );
  const group = releaseGroup(videoStem(videoPath));
  const chosen = chosenSubs.all(showId);
  return (
    rows.find((r) => r.hashFor === videoPath) ??
    (group && rows.find((r) => releaseGroup(r.release ?? "") === group)) ??
    rows.find((r) => chosen.some((c) => sameOrigin(r, c))) ??
    rows.find((r) => !r.foreignPartsOnly) ??
    null
  );
}

// The day's downloads as OpenSubtitles counts them, {remaining, ts}, with
// allowed and used once its /infos/user has been asked: from that, and kept
// current by each download's answer, which adds resetAt. null until known.
let quota = null;

// The download quota, asked of OpenSubtitles when it is not known, older
// than QUOTA_FRESH_MS, or from before the count started afresh.
export async function downloadQuota() {
  const now = Date.now();
  if (!quota || now >= quota.resetAt || now - quota.ts > QUOTA_FRESH_MS)
    quota = { ...(await subsDownloadQuota()), ts: now };
  return quota;
}

// Whether cheap vetting may download now: OpenSubtitles says at least
// CHEAP_DOWNLOAD_RESERVE of the day's downloads are left. The quota, with ok.
export async function cheapDownloadQuota() {
  const q = await downloadQuota();
  return { ...q, ok: q.remaining >= CHEAP_DOWNLOAD_RESERVE };
}

// Returns how long the API took to hand out the link, in ms.
async function downloadSub(row, videoPath) {
  const login = loadSubsLogin();
  const startedAt = Date.now();
  const dl = await openSubtitlesDownloadWithRetry({
    apiKey: login.apiKey,
    token: getSubsToken(),
    fileId: row.fileId,
  });
  const apiMs = Date.now() - startedAt;
  if (!dl.resp.ok) {
    // 406: the day's downloads are used up, so nothing more lands today;
    // the quota is asked for again when next wanted.
    const e = new Error(`OpenSubtitles download HTTP ${dl.resp.status}`);
    if (dl.resp.status === 406) {
      quota = null;
      e.quota = true;
    }
    throw e;
  }
  const link = typeof dl.body?.link === "string" ? dl.body.link.trim() : "";
  const resetAt = Date.parse(dl.body?.reset_time_utc ?? "");
  if (Number.isInteger(dl.body?.remaining) && Number.isFinite(resetAt))
    quota = {
      ...quota,
      used: quota?.allowed == null ? quota?.used : quota.allowed - dl.body.remaining,
      remaining: dl.body.remaining,
      resetAt,
      ts: Date.now(),
    };
  if (!link) throw new Error("OpenSubtitles download gave no link");
  const resp = await fetch(link, { headers: { Accept: "*/*" } });
  if (!resp.ok) throw new Error(`subtitle file HTTP ${resp.status}`);
  await fs.promises.writeFile(
    opnPath(videoPath, row.fileId),
    cleanSrt(await resp.text()),
    "utf8",
  );
  markDownloaded.run(row.showId, row.season, row.episode, row.fileId);
  return apiMs;
}

// Search, then download until the episode has SUBS_PER_EPISODE or no candidate
// is left: all the ones it still needs at once, then replacements for any
// that failed. Never throws: returns what went wrong, one line each.
async function fetchSubs(rec, season, episode, videoPath) {
  const showId = String(rec.id);
  const code = fmtCode(season, episode);
  const startedAt = Date.now();
  try {
    await searchEpisode(rec, season, episode, videoPath);
  } catch (e) {
    unilog(2674, `${rec.name} ${code} search failed: ${e.message}`);
    return [`search failed: ${e.message}`];
  }
  const searchMs = Date.now() - startedAt;
  // How long each download took, failed ones too.
  const downloadTimes = [];
  const errors = [];
  const failed = new Set();
  // Every file tried, so none is downloaded twice in one go.
  const tried = new Set();
  while (failed.size < SUBS_PER_EPISODE) {
    const need =
      SUBS_PER_EPISODE - countDownloaded.get(showId, season, episode).n;
    const batch = [];
    while (batch.length < need) {
      const row = nextCandidate(showId, season, episode, tried, videoPath);
      if (!row) break;
      batch.push(row);
      tried.add(row.fileId);
    }
    if (batch.length === 0) break;
    await Promise.all(
      batch.map(async (row) => {
        const downloadAt = Date.now();
        try {
          const apiMs = await downloadSub(row, videoPath);
          downloadTimes.push(`${Date.now() - downloadAt}ms (api ${apiMs}ms)`);
          unilog(2675, `${rec.name} ${code} downloaded opn${fileIdTag(row.fileId)}: ${row.release}`);
        } catch (e) {
          failed.add(row.fileId);
          errors.push(`download failed: ${e.message}`);
          unilog(2676, `${rec.name} ${code} download of opn${fileIdTag(row.fileId)} failed: ${e.message}`);
          downloadTimes.push(`${Date.now() - downloadAt}ms failed`);
        }
      }),
    );
  }
  unilog(2723, `${rec.name} ${code} search ${searchMs}ms, downloads ${downloadTimes.join(", ") || "none"}, all ${Date.now() - startedAt}ms`);
  return errors;
}

const fetching = new Map();

// The episode's fetchSubs: the one already running, else a new one.
function fetchJob(rec, season, episode, videoPath) {
  const key = `${rec.id} ${fmtCode(season, episode)}`;
  let job = fetching.get(key);
  if (!job) {
    job = fetchSubs(rec, season, episode, videoPath).finally(() =>
      fetching.delete(key),
    );
    fetching.set(key, job);
  }
  return job;
}

// Whether the video has a file other than ASR's that vetting judged good:
// then it needs no more downloads.
function hasGoodSub(videoPath) {
  const dir = path.dirname(videoPath);
  return listSidecars(videoPath).some(
    (s) => s.type !== "+" && isVetGood(freshCheck(path.join(dir, s.file))),
  );
}

// The downloads for an episode about to be played, made ahead of its play so
// it has them at once. Nothing waits on them.
export function prefetchSubs(rec, season, episode, videoPath) {
  if (!rec.imdbId) return;
  if (countDownloaded.get(String(rec.id), season, episode).n >= SUBS_PER_EPISODE)
    return;
  if (hasGoodSub(videoPath)) return;
  unilog(2727, `${rec.name} ${fmtCode(season, episode)} subtitles fetched ahead of its play`);
  fetchJob(rec, season, episode, videoPath);
}

// Background downloads for a video with no subtitle that fits it: search,
// then download candidates one at a time, best first, each judged by judge
// (subVet.js), which returns "good" for a file that fits, as it is or once
// fixed. Stops at the first good one, or after MAX_FIT_DOWNLOADS tries.
// Returns that file's path, or null.
export async function downloadUntilFit(rec, season, episode, videoPath, judge) {
  const showId = String(rec.id);
  const code = fmtCode(season, episode);
  await searchEpisode(rec, season, episode, videoPath);
  const tried = new Set();
  for (let n = 0; n < MAX_FIT_DOWNLOADS; n++) {
    const row = nextCandidate(showId, season, episode, tried, videoPath);
    if (!row) return null;
    tried.add(row.fileId);
    try {
      await downloadSub(row, videoPath);
    } catch (e) {
      // With the day's downloads used up, no verdict on the video is
      // possible: the caller's run fails and is tried again another day.
      if (e.quota) throw e;
      unilog(2794, `${rec.name} ${code} download of opn${fileIdTag(row.fileId)} failed: ${e.message}`);
      continue;
    }
    const file = opnPath(videoPath, row.fileId);
    const verdict = await judge(file);
    unilog(2795, `${rec.name} ${code} downloaded opn${fileIdTag(row.fileId)} (${row.release}): ${verdict}`);
    if (verdict === "good") return file;
  }
  return null;
}

// Cheap vetting's one download (subVet.js): search, then the first candidate
// that downloads, trying at most MAX_FIT_DOWNLOADS. Returns its path, or null
// with no candidate or none that downloaded. Throws with the day's downloads
// used up.
export async function downloadFirst(rec, season, episode, videoPath) {
  const showId = String(rec.id);
  const code = fmtCode(season, episode);
  await searchEpisode(rec, season, episode, videoPath);
  const tried = new Set();
  for (let n = 0; n < MAX_FIT_DOWNLOADS; n++) {
    const row = nextCandidate(showId, season, episode, tried, videoPath);
    if (!row) return null;
    tried.add(row.fileId);
    try {
      await downloadSub(row, videoPath);
      return opnPath(videoPath, row.fileId);
    } catch (e) {
      if (e.quota) throw e;
      unilog(3054, `${rec.name} ${code} download of opn${fileIdTag(row.fileId)} failed: ${e.message}`);
    }
  }
  return null;
}

// Before a video plays: its downloads, then whether it has any subtitle at
// all. Slow, failed or with none, the video plays anyway and the remotes put
// up a pop-up. Returns { late }: the downloads still running when the wait
// ran out, else null. In an object, since an async function returning a
// promise would wait for it.
export async function subsBeforePlay(rec, season, episode, videoPath) {
  const problems = [await downloadBeforePlay(rec, season, episode, videoPath)];
  if (listSidecars(videoPath).length === 0) problems.push("no subtitles");
  const text = problems.filter(Boolean).join("; ");
  if (text)
    notifyClients("subError", {
      text: `${rec.name} ${fmtCode(season, episode)}: ${text}`,
    });
  return { late: fetching.get(`${rec.id} ${fmtCode(season, episode)}`) ?? null };
}

// Bring the episode up to SUBS_PER_EPISODE downloads, unless it has a file
// checked good, waiting at most PLAY_WAIT_MS. Returns what went wrong, or null.
async function downloadBeforePlay(rec, season, episode, videoPath) {
  const showId = String(rec.id);
  const code = fmtCode(season, episode);
  if (countDownloaded.get(showId, season, episode).n >= SUBS_PER_EPISODE)
    return null;
  if (hasGoodSub(videoPath)) return null;
  if (!rec.imdbId) {
    unilog(2677, `${rec.name} has no imdb id, ${code} was not searched`);
    return null;
  }
  const job = fetchJob(rec, season, episode, videoPath);
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

// The video is another file now, under the same name: it has not been
// through the steps, so a run that fails leaves it for the sweep.
export function unmarkProcessed(videoPath) {
  deleteProcessed.run(videoPath);
}

// ---- what subPrepare.js learns ----

export function getClips(video) {
  const row = clipsRow.get(video);
  return row ? { track: row.track, ...JSON.parse(row.json) } : null;
}

export function saveClips(video, track, data) {
  upsertClips.run(video, track, JSON.stringify(data), Date.now());
}

// The file's check, or null when it has none or the file has changed since.
export function freshCheck(file) {
  const check = fileCheck.get(file);
  if (!check) return null;
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  return st.size === check.size && Math.round(st.mtimeMs) === check.mtimeMs
    ? check
    : null;
}

// lyrics: a vetted file's ♪ captions in video time, [[fromMs, toMs]]. A
// judge's check is made under this version.
export function saveCheck({ file, video, verdict, offsetMs = null, method = null, detail = null, lyrics = null }) {
  const st = fs.statSync(file);
  upsertCheck.run({
    file,
    video,
    size: st.size,
    mtimeMs: Math.round(st.mtimeMs),
    verdict,
    offsetMs,
    method,
    detail,
    lyrics: lyrics ? JSON.stringify(lyrics) : null,
    version: VET_JUDGE_METHODS.includes(method) ? VET_VERSION : null,
    ts: Date.now(),
  });
}

// Whether a check is one of the judge's (VET_JUDGE_METHODS) made under this
// version. One made under an older version no longer holds: its file is
// judged again.
export function isCurrentVet(check) {
  return !!check && VET_JUDGE_METHODS.includes(check.method) && check.version === VET_VERSION;
}

// The judge's checks of the video's files, on disk or deleted, made under an
// older version.
export function staleVetChecks(video) {
  return videoStaleChecks.all(video, VET_VERSION);
}

// Whether a check (freshCheck) is vetting's good or filled: the file gets the
// mark.
export function isVetGood(check) {
  return (
    !!check &&
    VET_METHODS.includes(check.method) &&
    (check.verdict === "good" || check.verdict === "filled")
  );
}

// The placed ♪ captions of every file of the video judged by method, on disk
// or deleted, but those of the files in except: [[fromMs, toMs]].
export function vetLyrics(video, method, except = new Set()) {
  return videoMethodChecks
    .all(video, method)
    .filter((c) => !except.has(c.file) && c.lyrics)
    .flatMap((c) => JSON.parse(c.lyrics));
}

// The file was rewritten without moving its timing (a new line layout): its
// check, if it has one, stays, made current for the file as it is now.
export function restatCheck(file) {
  const check = fileCheck.get(file);
  if (!check) return;
  const st = fs.statSync(file);
  upsertCheck.run({ ...check, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
}

export function forgetCheck(file) {
  deleteCheckRow.run(file);
}

// A deleted file's check goes, unless it says the file was unusable or from
// another cut: that is kept, as the memory of why the file is gone.
export function forgetCheckUnlessMisfit(file) {
  deleteMisfitlessCheck.run(file);
}

// Whether the file is remembered as unusable or from another cut, or as
// deleted by a full vetting under this version, on disk or not: one deleted
// for that is not made again.
export function misfitRemembered(file) {
  const check = fileCheck.get(file);
  const verdict = check?.verdict;
  return (
    verdict === "unusable" ||
    verdict === "wrong cut" ||
    (check?.method === VET_METHOD &&
      isCurrentVet(check) &&
      (verdict === "bad" || verdict === "missing"))
  );
}

// The video is gone: so is what was learned about it.
export function forgetVideo(video) {
  deleteVideoChecks.run(video);
  deleteClipsRow.run(video);
  deleteRetime.run(video);
  deleteTranscript.run(video);
}

// ---- complete transcripts (subVet.js) ----

// The video's transcript from audio track track: {track, words}, or null.
export function getTranscript(video, track) {
  const row = transcriptRow.get(video);
  if (!row || row.track !== track) return null;
  return { track, words: JSON.parse(zlib.gunzipSync(row.words).toString("utf8")) };
}

export function saveTranscript(video, track, words) {
  upsertTranscript.run(video, track, zlib.gzipSync(JSON.stringify(words)), Date.now());
}

// ---- the retime pass (subPrepare.js) ----

export function getRetime(video) {
  return retimeRow.get(video) ?? null;
}

export function saveRetime(video, file) {
  upsertRetime.run(video, file, Date.now());
}

// The opn file with this suffix does not fit this video: under vetting
// version version, or under every version when it is null.
export function markUnfit(videoPath, suffix, version = null) {
  setUnfitFor.run(videoPath, version, tagFileId(suffix));
}

