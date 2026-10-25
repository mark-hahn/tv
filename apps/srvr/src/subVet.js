// Subtitle vetting (subs-final-plan.md): an episode's subtitle files judged
// against the words of its video's audio (subJudge.js) and kept, fixed,
// filled or deleted. Vetting is at one of two levels:
//   full   a complete word-timed ASR of the English audio (asr.js, queued by
//          subsQueue.js, stored in subs.db), then every subtitle file judged:
//          good ones fixed by their line and kept, bad ones deleted. With none
//          good, OpenSubtitles candidates are downloaded and judged one at a
//          time, up to 5. With still none good, the first file whose only
//          fault is missing stretches is filled from the transcript and kept,
//          and the others with missing stretches are deleted. With none of
//          those either, the `+` file is the episode's subtitle.
//   cheap  no ASR and nothing judged: every file cleaned with its glued words
//          split, and one OpenSubtitles download when the video has no
//          embedded copy and no download. A video with an old `+` file (no
//          stored transcript) has its files judged against that file's
//          caption starts: good ones fixed with a ✓, ones with only missing
//          stretches filled from it, bad ones kept without a ✓. Nothing is
//          deleted.
// A video with no English audio keeps the older path at full level: T and H
// presumed good, the others by audio matching (subPrepare.vetByAudio).
//
// Vetting runs only from the tvdb update task's per-show step and at the end
// of a watch (episodesToVet), in tv-srvr's sub queue (subsQueue.js). Each
// vetting writes the episode's five subtitle-vetting fields: subsVetted (the
// version), subsVetLevel, subsVettedAt, subsVettedFile and subsVettedResult.
// An episode counts as vetted v1 while subsVetted is 1 and subsVettedFile is
// its file.
//
// Sync and hand timings use the transcript too where the video has one; the
// rest are subPrepare.js's.

import fsp from "fs/promises";
import * as path from "node:path";
import * as epd from "@tv/share";
import { logHere, unilog} from "@tv/share"
import * as tvdb from "./tvdb.js";
import * as util from "./util.js";
import * as subs from "./subs.js";
import { VET_METHOD, VET_CHEAP_METHOD, VET_AUDIO_METHOD } from "./subs.js";
import * as sc from "./subSpotCheck.js";
import * as sp from "./subPrepare.js";
import { sidecarVideo } from "./subSync.js";
import { nextUpAfter } from "./derived.js";
import { showFolderFor, showNameFromFilePath } from "./showPaths.js";
import {
  VET_VERSION,
  judge,
  heardFromWords,
  heardFromPlus,
  fixedText,
  filledText,
  captionsOf,
  pyRound,
} from "./subJudge.js";

export { VET_VERSION };

const TV_DIR = "/mnt/media/tv";
// A file fits its video as it is when its fix line moves none of its captions
// further than this: a hand timing that does keeps its ✓, and the remotes'
// Sync gives it one.
const FITS_AS_IS_MS = 250;
// The remotes' Sync sets one offset: a line whose stretch moves the file's
// first and last captions further apart than this can't be set by one.
const ONE_OFFSET_MS = 250;
// The order files are judged and filled in: embedded copies and arrived
// files, then downloads.
const JUDGE_ORDER = "THSV";

// Called with the show's name once an episode's vetting fields change.
let onVetted = () => {};
export function init(deps) {
  if (deps?.onVetted) onVetted = deps.onVetted;
}

const epCode = (season, episode) =>
  `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;

// ---- which episodes are vetted ----

// Whether the episode's subtitles are vetted under this version for its
// current video, at level when it is given.
export function isVetted(ep, level = null) {
  return (
    !!ep?.file &&
    ep.subsVetted === VET_VERSION &&
    ep.subsVettedFile === ep.file &&
    (!level || ep.subsVetLevel === level)
  );
}

// Whether a file's check is a full vetting's for a file it keeps. A file a
// full vetting judged bad or missing, or unusable by its sound, is deleted;
// one still on disk with such a check was being deleted when tv-srvr
// stopped, and is judged and deleted again.
function keptByFull(check) {
  if (check?.method === VET_METHOD) return subs.isVetGood(check);
  return check?.method === VET_AUDIO_METHOD && check.verdict !== "unusable";
}

// Whether the video has a subtitle file other than its `+` file that a full
// vetting has not judged as it is now (by its words, or by its sound for a
// video with no English audio): one that arrived later.
function hasUnjudged(videoPath) {
  const dir = path.dirname(videoPath);
  let sides;
  try {
    sides = subs.listSidecars(videoPath);
  } catch (e) {
    unilog(3045, `${showNameFromFilePath(videoPath)}: no sidecars read for ${path.basename(videoPath)}: ${e.message}`);
    return false;
  }
  return sides.some((s) => s.type !== "+" && !keptByFull(subs.freshCheck(path.join(dir, s.file))));
}

// The episodes of the show to vet now, [{videoPath, level, season, episode}],
// the next two first. Watched episodes are never vetted. The next two
// (next-up, the first unwatched episode with a video in story order, and the
// first unwatched one with a video after it) get full vetting unless they
// have had it for their current video. With nextTwoOnly (the end of a watch)
// that is all. Otherwise a fully vetted episode with a file that arrived
// since is vetted in full again, which judges that file against its stored
// transcript, and every other unwatched episode with a video gets cheap
// vetting when it is not vetted at either level, or had it and was left with
// no subtitle file at all.
export function episodesToVet(showName, rec, { nextTwoOnly = false } = {}) {
  if (!rec?.inLibrary || !Array.isArray(rec.episodeData)) return [];
  const ed = rec.episodeData;
  const first = nextUpAfter(ed);
  const second = first ? nextUpAfter(ed, first) : null;
  const next = [first, second].filter(Boolean);
  const isNext = (s, e) => next.some((x) => x.season === s && x.episode === e);
  const folder = showFolderFor(showName, rec);
  const nextOut = [];
  const restOut = [];
  epd.forEachEpisode(ed, (season, episode, ep) => {
    if (!ep?.file || ep.watched) return;
    const videoPath = epd.getFullPath(ed, folder, season, episode, TV_DIR);
    if (!videoPath) return;
    const item = (level) => ({ videoPath, level, season, episode });
    const full = isVetted(ep, "full");
    if (isNext(season, episode)) {
      if (!full) nextOut.push(item("full"));
      else if (!nextTwoOnly && hasUnjudged(videoPath)) nextOut.push(item("full"));
      return;
    }
    if (nextTwoOnly) return;
    if (full) {
      if (hasUnjudged(videoPath)) restOut.push(item("full"));
      return;
    }
    if (!isVetted(ep) || (ep.subsVetLevel === "cheap" && ep.subsVettedResult === "none"))
      restOut.push(item("cheap"));
  });
  return [...nextOut, ...restOut];
}

// ---- the episode's fields ----

// The episode of the show's record whose video is videoPath: {season,
// episode, ep}, or null.
function episodeOf(showName, rec, videoPath) {
  const folder = showFolderFor(showName, rec);
  let found = null;
  epd.forEachEpisode(rec.episodeData, (season, episode, ep) => {
    if (found || !ep?.file) return;
    if (epd.getFullPath(rec.episodeData, folder, season, episode, TV_DIR) === videoPath)
      found = { season, episode, ep };
  });
  return found;
}

// The five vetting fields written to the episode of videoPath, unless its
// video changed while it was vetted.
async function recordVetting(showName, videoPath, level, result) {
  const rec = tvdb.getAllTvdbSync()?.[showName];
  const found = rec && episodeOf(showName, rec, videoPath);
  if (!found) {
    unilog(3046, `${showName}: no episode has ${path.basename(videoPath)} now, its vetting is not recorded`);
    return;
  }
  epd.setEpisode(rec.episodeData, found.season, found.episode, {
    subsVetted: VET_VERSION,
    subsVetLevel: level,
    subsVettedAt: util.toPstDateTimeMs(new Date()),
    subsVettedFile: found.ep.file,
    subsVettedResult: result,
  });
  await tvdb.saveTvdbSync();
  onVetted(showName);
}

// What the episode was left with: own (an embedded copy or a file that
// arrived with the video), download, filled, asr (only the `+` file) or none.
// ticks are the files with a ✓, [{type, verdict}]; sides the other files.
function resultOf(ticks, sides) {
  if (ticks.some((t) => t.verdict === "good" && t.type !== "V")) return "own";
  if (ticks.some((t) => t.verdict === "good")) return "download";
  if (ticks.some((t) => t.verdict === "filled")) return "filled";
  if (sides.some((s) => "THS".includes(s.type))) return "own";
  if (sides.some((s) => s.type === "V")) return "download";
  if (sides.some((s) => s.type === "+")) return "asr";
  return "none";
}

// ---- vetting ----

// The video's subtitle files other than its `+` file, in JUDGE_ORDER:
// [{file, full, type, suffix, text}].
async function readFiles(videoPath) {
  const dir = path.dirname(videoPath);
  const out = [];
  for (const s of subs.listSidecars(videoPath)) {
    if (s.type === "+") continue;
    const full = path.join(dir, s.file);
    out.push({ ...s, full, text: await fsp.readFile(full, "utf8") });
  }
  return out.sort((a, b) => JUDGE_ORDER.indexOf(a.type) - JUDGE_ORDER.indexOf(b.type));
}

const asrFileOf = (videoPath) =>
  subs.listSidecars(videoPath).find((s) => s.type === "+");

const lineNote = ({ a, b }) =>
  `${a >= 0 ? "+" : ""}${Math.round(a)} ms${Math.abs(b - 1) >= 1e-5 ? ` ×${b.toFixed(5)}` : ""}`;

// How far the line moves the file's captions, first to last: [atFirst,
// atLast] in ms.
function shiftsOf(text, { a, b }) {
  const caps = captionsOf(text);
  if (caps.length === 0) return [a, a];
  const at = (t) => a + (b - 1) * t;
  return [at(caps[0].start), at(Math.max(...caps.map((c) => c.end)))];
}

// The shift at the middle of the file, the one offset nearest the line.
function middleShift(text, line) {
  const [first, last] = shiftsOf(text, line);
  return Math.round((first + last) / 2);
}

// One judged file dealt with by its verdict r: a good one fixed by its line
// and kept with a ✓; with deleteBad a bad one deleted (a download marked
// unfit for the video), else kept without one; a missing one held in held,
// with the lyrics it was judged with, for the fill. Returns the verdict.
async function act(o, f, r, lyrics, held) {
  const { videoPath, dryRun, notes, method } = o;
  if (r.verdict === "good") {
    notes.push(`${f.suffix} good, fixed ${lineNote(r.line)}`);
    o.ticks.push({ type: f.type, verdict: "good" });
    if (dryRun) return "good";
    await fsp.writeFile(f.full, fixedText(f.text, r.line), "utf8");
    await sp.noteRewrite(f.full);
    subs.saveCheck({
      file: f.full,
      video: videoPath,
      verdict: "good",
      offsetMs: middleShift(f.text, r.line),
      method,
      detail: `fixed ${lineNote(r.line)}, ${r.densePairs} pairs`,
      lyrics: r.lyrics,
    });
    return "good";
  }
  if (r.verdict === "missing") {
    notes.push(`${f.suffix} missing (${r.why})`);
    held.push({ f, r, lyrics });
    return "missing";
  }
  if (!o.deleteBad) {
    notes.push(`${f.suffix} bad, kept (${r.why})`);
    if (!dryRun)
      subs.saveCheck({ file: f.full, video: videoPath, verdict: "bad", method, detail: r.why, lyrics: r.lyrics });
    return "bad";
  }
  await drop(o, f, "bad", r.why, r.lyrics);
  return "bad";
}

// A file a full vetting does not keep, deleted: its check stays as the memory
// of why (subs.misfitRemembered), with its lyrics for the other files' judging,
// and a download is marked so it is not downloaded for the video again.
async function drop(o, f, verdict, why, lyrics) {
  o.notes.push(`${f.suffix} deleted (${why})`);
  if (o.dryRun) return;
  subs.saveCheck({ file: f.full, video: o.videoPath, verdict, method: VET_METHOD, detail: why, lyrics });
  if (f.type === "V") subs.markUnfit(o.videoPath, f.suffix);
  await fsp.unlink(f.full);
  unilog(3047, `${o.showName} ${o.code}: ${f.file} deleted, ${why}`);
}

// The held file filled from the heard words and kept with a ✓.
async function fill(o, heard, { f, r, lyrics }) {
  const { text, fills } = filledText(f.text, heard, o.durMs, lyrics, r.line);
  const at = [...new Set(r.windows.map(([w0]) => `${(w0 / 60000).toFixed(1)}`))].slice(0, 5).join(", ");
  const why = `${fills.length} captions filled, fixed ${lineNote(r.line)}, missing at ${at} min`;
  o.notes.push(`${f.suffix} ${why}`);
  o.ticks.push({ type: f.type, verdict: "filled" });
  if (o.dryRun) return;
  await fsp.writeFile(f.full, text, "utf8");
  await sp.noteRewrite(f.full);
  subs.saveCheck({
    file: f.full,
    video: o.videoPath,
    verdict: "filled",
    offsetMs: middleShift(f.text, r.line),
    method: o.method,
    detail: why,
    lyrics: r.lyrics,
  });
}

// Judges the video's files not yet judged by o.method as they are now: each
// file's own ♪ captions placed first, so each is judged with all the others'
// (and those of the video's files judged before, deleted or not). The
// missing ones go in held. Returns the placed ♪ captions known after it.
async function judgeFiles(o, heard, held) {
  const { videoPath } = o;
  const files = await readFiles(videoPath);
  const isJudged = (f) => {
    const check = subs.freshCheck(f.full);
    if (o.method === VET_METHOD) return check?.method === VET_METHOD && keptByFull(check);
    return check?.method === VET_CHEAP_METHOD || check?.method === VET_METHOD;
  };
  for (const f of files) {
    if (!isJudged(f)) continue;
    const check = subs.freshCheck(f.full);
    if (subs.isVetGood(check)) o.ticks.push({ type: f.type, verdict: check.verdict });
  }
  const todo = files.filter((f) => !isJudged(f));
  const stored = subs.vetLyrics(videoPath, o.method, new Set(todo.map((f) => f.full)));
  for (const f of todo) f.lyrics = judge({ srtText: f.text, heard, durMs: o.durMs }).lyrics;
  for (const f of todo) {
    const lyrics = [...stored, ...todo.filter((g) => g !== f).flatMap((g) => g.lyrics)];
    const r = judge({ srtText: f.text, heard, durMs: o.durMs, lyrics });
    await act(o, f, r, lyrics, held);
  }
  return [...stored, ...todo.flatMap((f) => f.lyrics)];
}

// Full vetting with the video's transcript, holding the video. Returns the
// result.
async function vetFull(o, transcript) {
  const heard = heardFromWords(transcript.words, o.durMs);
  const held = [];
  o.setStage("judging subtitles");
  let lyricsNow = await judgeFiles(o, heard, held);
  const good = () => o.ticks.some((t) => t.verdict === "good");
  if (!good() && o.canDownload) {
    if (o.dryRun) o.notes.push("would download from OpenSubtitles");
    else {
      o.setStage("downloading subtitles");
      await subs.downloadUntilFit(o.rec, o.season, o.episode, o.videoPath, async (file) => {
        // the add-to-disk step a file that arrives gets
        await sp.glueSidecars(o.videoPath, { only: file });
        const s = subs.listSidecars(o.videoPath).find((x) => path.join(path.dirname(o.videoPath), x.file) === file);
        if (!s) return "gone";
        const f = { ...s, full: file, text: await fsp.readFile(file, "utf8") };
        const r = judge({ srtText: f.text, heard, durMs: o.durMs, lyrics: lyricsNow });
        const verdict = await act(o, f, r, lyricsNow, held);
        lyricsNow = [...lyricsNow, ...r.lyrics];
        return verdict;
      });
    }
  }
  // a file filled before, from when the episode had no complete file
  const filledBefore = (await readFiles(o.videoPath)).filter(
    (f) => subs.freshCheck(f.full)?.method === VET_METHOD && subs.freshCheck(f.full)?.verdict === "filled",
  );
  if (good()) {
    for (const h of held) await drop(o, h.f, "missing", `${h.r.why}, and a complete file was found`, h.r.lyrics);
    for (const f of filledBefore) {
      await drop(o, f, "missing", "filled before, and a complete file was found", JSON.parse(subs.freshCheck(f.full)?.lyrics ?? "[]"));
      o.ticks = o.ticks.filter((t) => !(t.verdict === "filled" && t.type === f.type));
    }
  } else if (held.length && filledBefore.length === 0) {
    const [first, ...rest] = held;
    await fill(o, heard, first);
    for (const h of rest) await drop(o, h.f, "missing", `${h.r.why}, ${first.f.suffix} was filled instead`, h.r.lyrics);
  } else
    for (const h of held) await drop(o, h.f, "missing", `${h.r.why}, a file was filled before`, h.r.lyrics);
  const plus = asrFileOf(o.videoPath);
  return resultOf(o.ticks, plus ? [plus] : []);
}

// Cheap vetting, with the add-to-disk steps done. Returns the result, or null
// when the download it wants is put off for the day's reserve.
async function vetCheap(o) {
  const { videoPath, dryRun, notes } = o;
  if (!dryRun) {
    o.setStage("cleaning subtitle files");
    const cleaned = await sp.reflowSidecars(videoPath);
    if (cleaned) notes.push(`${cleaned} cleaned`);
    await sp.fixGluedSidecars(videoPath);
  }
  let sides = subs.listSidecars(videoPath);
  const embedded = sides.some((s) => s.type === "T" || s.type === "H");
  const downloaded = sides.some((s) => s.type === "V");
  if (!embedded && !downloaded && o.canDownload) {
    const quota = await subs.cheapDownloadQuota();
    if (!quota.ok) {
      unilog(3060, `${o.showName} ${o.code}: cheap vetting put off, OpenSubtitles has ${quota.remaining} downloads left until ${new Date(quota.resetAt).toISOString()}`);
      return null;
    }
    if (dryRun) notes.push("would download one from OpenSubtitles");
    else {
      o.setStage("downloading a subtitle");
      const file = await subs.downloadFirst(o.rec, o.season, o.episode, videoPath);
      notes.push(file ? `downloaded ${path.basename(file)}` : "no download");
      if (file) await sp.fixGluedSidecars(videoPath, { only: file });
      sides = subs.listSidecars(videoPath);
    }
  }
  const plus = asrFileOf(videoPath);
  if (plus && o.track >= 0) {
    // an old `+` file: no word times, only its caption starts
    const plusText = await fsp.readFile(path.join(path.dirname(videoPath), plus.file), "utf8");
    const heard = heardFromPlus(plusText, o.durMs);
    await sp.withVideo(videoPath, async () => {
      o.setStage("judging subtitles against the + file");
      const held = [];
      await judgeFiles(o, heard, held);
      for (const h of held) await fill(o, heard, h);
    });
  }
  return resultOf(o.ticks, sides);
}

// Vets the subtitles of videoPath, the video of the show's episode, at level
// ("full" or "cheap"), its add-to-disk steps done. rec, season and episode
// are its show's record and episode, for downloads. setStage says what it is
// doing, for the Queues pane. With dryRun nothing is written, deleted or
// downloaded. Returns {needsAsr, track, durS, result, notes}: needsAsr when
// a full vetting waits for a complete ASR of audio track track, which the
// caller queues; result null when it was put off.
export async function vetVideo({
  videoPath,
  level,
  showName,
  rec,
  season,
  episode,
  setStage = () => {},
  dryRun = false,
}) {
  // An episode watched since it was queued is not vetted.
  const live = tvdb.getAllTvdbSync()?.[showName];
  if (!dryRun && live && episodeOf(showName, live, videoPath)?.ep.watched) {
    unilog(3058, `${showName}: ${path.basename(videoPath)} is watched, not vetted`);
    return { needsAsr: false, track: null, durS: null, result: null, notes: [] };
  }
  const { durS, audioLangs } = await sc.videoInfo(videoPath);
  const track = sc.englishTrack(audioLangs);
  const o = {
    videoPath,
    showName,
    code: Number.isInteger(season) && Number.isInteger(episode) ? epCode(season, episode) : path.basename(videoPath),
    rec,
    season,
    episode,
    durS,
    durMs: pyRound(durS * 1000),
    track,
    canDownload: !!rec?.imdbId && Number.isInteger(season) && Number.isInteger(episode),
    setStage,
    dryRun,
    notes: [],
    ticks: [],
    method: level === "full" ? VET_METHOD : VET_CHEAP_METHOD,
    deleteBad: level === "full",
  };
  let result;
  if (level === "full" && track >= 0) {
    const transcript = subs.getTranscript(videoPath, track);
    if (!transcript) {
      unilog(3049, `${showName} ${o.code}: full vetting waits for a complete ASR of ${path.basename(videoPath)}`);
      return { needsAsr: true, track, durS, result: null, notes: o.notes };
    }
    result = await sp.withVideo(videoPath, () => vetFull(o, transcript));
  } else if (level === "full") {
    await sp.withVideo(videoPath, () => sp.vetByAudio(videoPath, durS, o));
    const sides = subs.listSidecars(videoPath);
    const dir = path.dirname(videoPath);
    const ticks = sides
      .filter((s) => subs.isVetGood(subs.freshCheck(path.join(dir, s.file))))
      .map((s) => ({ type: s.type, verdict: "good" }));
    result = resultOf(ticks, sides);
  } else result = await vetCheap(o);
  if (result === null) return { needsAsr: false, track, durS, result, notes: o.notes };
  unilog(3050, `${showName} ${o.code} ${level} vetting${dryRun ? " (dry)" : ""}: ${result}; ${o.notes.join(", ") || "nothing changed"}`);
  if (!dryRun) await recordVetting(showName, videoPath, level, result);
  return { needsAsr: false, track, durS, result, notes: o.notes };
}

// ---- Sync and hand timings, by the transcript ----

// The file judged against the transcript of its video: {text, r, durMs}, or
// null when the video has none.
async function judgedByTranscript(videoPath, file) {
  const { durS, audioLangs } = await sc.videoInfo(videoPath);
  const track = sc.englishTrack(audioLangs);
  const transcript = track >= 0 ? subs.getTranscript(videoPath, track) : null;
  if (!transcript) return null;
  const durMs = pyRound(durS * 1000);
  const text = await fsp.readFile(file, "utf8");
  const lyrics = subs.vetLyrics(videoPath, VET_METHOD, new Set([file]));
  return { text, durMs, r: judge({ srtText: text, heard: heardFromWords(transcript.words, durMs), durMs, lyrics }) };
}

const isAsrFile = (videoPath, file) =>
  subs.listSidecars(videoPath).find((s) => path.join(path.dirname(videoPath), s.file) === file)?.type === "+";

// Whether getPlayUrl's subsChecked holds: every file a play offers but the `+`
// file has vetting's ✓. The remotes' Sync is for an episode where it does
// not.
export function subsChecked(videoPath) {
  const dir = path.dirname(videoPath);
  return subs
    .listSidecars(videoPath)
    .every((s) => s.type === "+" || subs.isVetGood(subs.freshCheck(path.join(dir, s.file))));
}

// A sidecar timed by hand (a panel's Apply, an edit) is judged against its
// video's transcript, and keeps a ✓ only when it is good and fits as it is;
// nothing shifts it. One that does not is unchecked. With no transcript it is
// subPrepare's. A file already judged as it is, is left alone.
export async function judgeHandTimed(file) {
  if (subs.freshCheck(file)) return;
  let videoPath;
  try {
    videoPath = await sidecarVideo(file);
  } catch {
    return;
  }
  if (isAsrFile(videoPath, file)) return;
  const j = await judgedByTranscript(videoPath, file);
  if (!j) {
    await sp.judgeHandTimed(file);
    return;
  }
  subs.forgetCheck(file);
  const shifts = j.r.line ? shiftsOf(j.text, j.r.line) : null;
  const fits = j.r.verdict === "good" && Math.max(...shifts.map(Math.abs)) <= FITS_AS_IS_MS;
  if (fits)
    subs.saveCheck({
      file,
      video: videoPath,
      verdict: "good",
      offsetMs: middleShift(j.text, j.r.line),
      method: VET_METHOD,
      detail: "timed by hand",
      lyrics: j.r.lyrics,
    });
  unilog(3051, `${showNameFromFilePath(videoPath)}: ${path.basename(file)} timed by hand: ${j.r.verdict}${fits ? ", fits" : j.r.why ? ` (${j.r.why})` : ""}`);
}

// A sidecar changed on disk (the file watcher): unless vetting, the glue fix
// or the re-layout wrote it, it was timed by hand.
export async function sidecarChanged(file) {
  if (await sp.rewroteHere(file)) return;
  await judgeHandTimed(file);
}

// What the remotes' Sync makes of a judged file: {verdict, offsetMs, why}.
function measured({ text, r }) {
  if (r.kind === "unusable") return { verdict: "unusable", offsetMs: null, why: `it can't be checked, ${r.why}` };
  if (r.kind === "too few pairs")
    return { verdict: "can't tell", offsetMs: null, why: "too few of its lines match the video's words" };
  if (r.kind) return { verdict: "wrong cut", offsetMs: null, why: `from another cut (${r.why}), no one shift fits it` };
  const [first, last] = shiftsOf(text, r.line);
  if (Math.abs(last - first) > ONE_OFFSET_MS)
    return { verdict: "other rate", offsetMs: null, why: "it runs at another rate, no one shift fits it" };
  const fits = Math.max(Math.abs(first), Math.abs(last)) <= FITS_AS_IS_MS;
  return { verdict: fits && r.verdict === "good" ? "good" : "fixable", offsetMs: middleShift(text, r.line) };
}

// The remotes' Sync: how far the sidecar srtFile of videoPath is off, by the
// video's transcript, else as subPrepare measures it. Nothing is changed but
// the file's ✓ when it is good and fits as it is: the remote's Apply makes
// the shift. Returns {verdict, offsetMs, why, label, subsChecked}: offsetMs
// the shift that makes the file fit; null, with why, when no one shift fits
// or none can be told. label and subsChecked are the file's label in a
// play's list and getPlayUrl's subsChecked, as they are now.
export async function measureSidecar({ videoPath, srtFile }) {
  const video = path.resolve(String(videoPath || ""));
  if (!video.startsWith(TV_DIR + "/")) throw new Error(`not under ${TV_DIR}: ${videoPath}`);
  const name = path.basename(String(srtFile || ""));
  const file = path.join(path.dirname(video), name);
  if (!subs.listSidecars(video).some((s) => s.file === name))
    throw new Error(`${name} is no subtitle file of ${path.basename(video)}`);
  const j = isAsrFile(video, file) ? null : await judgedByTranscript(video, file);
  let out;
  if (j) {
    out = measured(j);
    if (out.verdict === "good")
      subs.saveCheck({
        file,
        video,
        verdict: "good",
        offsetMs: out.offsetMs,
        method: VET_METHOD,
        detail: "measured for Sync",
        lyrics: j.r.lyrics,
      });
    unilog(3052, `${showNameFromFilePath(video)}: ${name} measured for Sync by its transcript: ${out.verdict}, ${out.offsetMs == null ? out.why : `${out.offsetMs} ms`}`);
  } else out = await sp.measureSidecar({ videoPath: video, srtFile: name });
  return { ...out, label: await subs.playLabel(video, name), subsChecked: subsChecked(video) };
}

// The local pane's Sync: the file moved by its fix line to fit its video's
// transcript, its ✓ given when it is judged good; with no transcript it is
// subPrepare's. Returns {offsetMs, matches}: the shift at its middle and the
// pairs it was fitted through.
export async function syncSidecar({ path: relPath }) {
  const file = path.resolve(TV_DIR, String(relPath || ""));
  if (!file.startsWith(TV_DIR + "/") || !file.endsWith(".srt")) throw new Error(`not a tv .srt: ${relPath}`);
  const videoPath = await sidecarVideo(file);
  const j = isAsrFile(videoPath, file) ? null : await judgedByTranscript(videoPath, file);
  if (!j) return sp.syncSidecar({ path: relPath });
  const name = path.basename(file);
  const { r, text } = j;
  if (r.kind === "unusable") throw new Error(`${name} is unusable: ${r.why}`);
  if (r.kind === "too few pairs") throw new Error(`only ${r.cleanPairs} phrases of ${name} match its video`);
  if (r.kind) throw new Error(`${name} is from another cut: ${r.why}`);
  return sp.withVideo(videoPath, async () => {
    await fsp.writeFile(file, fixedText(text, r.line), "utf8");
    await sp.noteRewrite(file);
    if (r.verdict === "good")
      subs.saveCheck({
        file,
        video: videoPath,
        verdict: "good",
        offsetMs: middleShift(text, r.line),
        method: VET_METHOD,
        detail: `Sync ${lineNote(r.line)}`,
        lyrics: r.lyrics,
      });
    else subs.forgetCheck(file);
    unilog(3053, `${showNameFromFilePath(videoPath)}: ${name} synced to its transcript, ${lineNote(r.line)} from ${r.densePairs} pairs, ${r.verdict}`);
    return { offsetMs: middleShift(text, r.line), matches: r.densePairs };
  });
}
