// Subtitle preparation for playing (srt-fix.md). Every sidecar of a video is
// checked against the words of the video's own audio (subSpotCheck.js) and
// dealt with by its verdict, and a video left with nothing that fits gets an
// OpenSubtitles download that does, else a complete ASR, which is left to the
// caller. It all runs in the background: after the add-to-disk steps of a video
// that lands (subsQueue.js), and for a sidecar that arrives or changes later
// (the file watcher), judged from the clip transcripts stored for its video.
//
// A good file is kept and offered first. A fixable one is shifted, or
// stretched when it runs at another rate, and judged again. One from another
// cut, or a signs track, is never offered; an opn file of either kind is
// deleted and marked so it is not downloaded for the video again, and so is
// an ASR file from another cut, since ASR is never redone for a video that has
// one. A file that cannot be judged is kept: a T or H one is presumed good,
// having come out of the video, and the rest are offered after it.
//
// A video with no English audio track has no words to match: its T and H
// files are presumed good, the others checked by whole-file audio matching
// (syncSubToAudio), and it is never sent for ASR.

import fsp from "fs/promises";
import * as path from "node:path";
import { logHere, unilog} from "@tv/share"
import * as subs from "./subs.js";
import * as sc from "./subSpotCheck.js";
import { syncSubToAudio, syncSubToAsr, sidecarVideo } from "./subSync.js";

const TV_DIR = "/mnt/media/tv";

// Videos whose sidecars are being dealt with here now; the watcher leaves
// their files to that.
const busy = new Set();

const fmtOfs = (ms) => `${ms > 0 ? "+" : ""}${ms} ms`;
const suffixOf = (videoPath, file) =>
  file.slice(subs.videoStem(videoPath).length + 1, -".srt".length);
const sidecarOf = (videoPath, files, file) =>
  files.find((f) => path.join(path.dirname(videoPath), f.file) === file);

// The stored clips of the video as subSpotCheck uses them, or null.
function storedSet(videoPath) {
  const stored = subs.getClips(videoPath);
  if (!stored || stored.track < 0) return null;
  return { track: stored.track, ...sc.clipsFromJson(stored) };
}

// An opn file that cannot be used is deleted and marked so it is not
// downloaded for the video again; any other is kept, never offered.
async function dropOrHide(videoPath, f, verdict, why, method, dryRun, notes) {
  const file = path.join(path.dirname(videoPath), f.file);
  const suffix = suffixOf(videoPath, f.file);
  const gone = f.type === "V" || (f.type === "+" && verdict === "wrong cut");
  notes.push(`${suffix} ${gone ? "deleted" : verdict} (${why})`);
  if (dryRun) return;
  if (gone) {
    if (f.type === "V") subs.markUnfit(videoPath, suffix);
    await fsp.unlink(file);
    subs.forgetCheck(file);
  } else
    subs.saveCheck({ file, video: videoPath, verdict, method, detail: why });
}

// Deals with one sidecar by its verdict r (sc.judge; none for an unusable
// file) and returns its verdict now: "good" once a fix made it fit. notes
// collects what was done, for the log, and fixed the shift each fixed file
// got, by file name.
async function act(videoPath, f, r, set, dryRun, notes, fixed = {}) {
  if (f.unusable) {
    await dropOrHide(videoPath, f, "unusable", f.why, "asr", dryRun, notes);
    return "unusable";
  }
  const file = path.join(path.dirname(videoPath), f.file);
  const suffix = suffixOf(videoPath, f.file);
  const save = (verdict, offsetMs, detail) =>
    subs.saveCheck({ file, video: videoPath, verdict, offsetMs, method: "asr", detail });
  const pairs = r.clips
    .map((c) => (c.ms == null ? "-" : `${fmtOfs(c.ms)} (${c.pairs})`))
    .join(" | ");
  if (r.verdict === "good") {
    notes.push(`${suffix} good ${fmtOfs(r.offsetMs)}`);
    if (!dryRun) save("good", r.offsetMs, pairs);
    return "good";
  }
  if (r.verdict === "fixable") {
    const how = r.fix.drift
      ? `stretched ${fmtOfs(r.fix.drift[0][1])} to ${fmtOfs(r.fix.drift[1][1])}`
      : `shifted ${fmtOfs(r.offsetMs)}`;
    if (dryRun) {
      notes.push(`${suffix} would be ${how}`);
      return "fixable";
    }
    const text = sc.fixedText(await fsp.readFile(file, "utf8"), r.fix);
    await fsp.writeFile(file, text, "utf8");
    fixed[f.file] = r.offsetMs;
    const again = sc.judge(sc.cuesOf(text), set);
    notes.push(`${suffix} ${how}, now ${again.verdict}`);
    save(again.verdict, again.offsetMs ?? null, how);
    return again.verdict;
  }
  if (r.verdict === "wrong cut") {
    await dropOrHide(videoPath, f, "wrong cut", r.why ?? `another cut: ${pairs}`, "asr", dryRun, notes);
    return "wrong cut";
  }
  notes.push(`${suffix} can't tell (${pairs})`);
  if (!dryRun) save("can't tell", null, pairs);
  return "can't tell";
}

// One sidecar of a video with no English audio: a T or H file is presumed
// good, and any other is checked by audio matching, which shifts a file it
// passes. Returns its verdict; notes and fixed as for act.
async function actByAudio(videoPath, f, dryRun, notes, fixed = {}) {
  if (f.unusable) {
    await dropOrHide(videoPath, f, "unusable", f.why, "audio", dryRun, notes);
    return "unusable";
  }
  const file = path.join(path.dirname(videoPath), f.file);
  const suffix = suffixOf(videoPath, f.file);
  const save = (verdict, detail) =>
    subs.saveCheck({ file, video: videoPath, verdict, method: "audio", detail });
  if ("TH".includes(f.type)) {
    notes.push(`${suffix} presumed good`);
    if (!dryRun) save("can't tell", "presumed good: from the video");
    return "can't tell";
  }
  try {
    const { offsetMs } = await syncSubToAudio({
      path: path.relative(TV_DIR, file),
      dryRun,
    });
    notes.push(`${suffix} ${dryRun ? "would be " : ""}shifted ${fmtOfs(offsetMs)} by audio`);
    if (!dryRun) {
      fixed[f.file] = offsetMs;
      save("good", `shifted ${fmtOfs(offsetMs)} by audio`);
    }
    return "good";
  } catch (e) {
    notes.push(`${suffix} can't tell by audio`);
    if (!dryRun) save("can't tell", e.message);
    return "can't tell";
  }
}

async function prepareByAsr(videoPath, durS, track, o) {
  o.setStage("checking subtitles");
  const timing = { cutMs: 0, asrMs: 0 };
  const files = await sc.readSidecars(videoPath, durS);
  const usable = files.filter((f) => !f.unusable);
  let set = storedSet(videoPath);
  if (set?.track !== track) set = null;
  const keep = () => subs.saveClips(videoPath, track, sc.clipsToJson(set));
  if (!set && usable.length > 0) {
    set = { track, ...(await sc.hearClips(videoPath, track, usable, timing)) };
    keep();
  }
  const judged = new Map(usable.map((f) => [f, sc.judgeFile(f, set)]));
  if (!set?.middle && [...judged.values()].some((r) => r.needsMiddle)) {
    set.middle = await sc.hearMiddle(videoPath, track, usable, set, timing);
    if (set.middle) {
      keep();
      for (const f of usable) judged.set(f, sc.judgeFile(f, set));
    }
  }
  let fit = false;
  for (const f of files) {
    const verdict = await act(videoPath, f, judged.get(f), set, o.dryRun, o.notes, o.fixed);
    if (verdict === "good" || (o.dryRun && verdict === "fixable")) fit = true;
  }
  if (fit || !o.canDownload) return fit;
  if (o.dryRun) {
    o.notes.push("would download from OpenSubtitles");
    return false;
  }
  o.setStage("downloading subtitles");
  const got = await subs.downloadUntilFit(o.rec, o.season, o.episode, videoPath, async (file) => {
    const f = sidecarOf(videoPath, await sc.readSidecars(videoPath, durS), file);
    if (!f) return "gone";
    if (f.unusable) return act(videoPath, f, null, set, false, o.notes, o.fixed);
    // With no sidecar before it, the first download places the clips.
    if (!set) {
      set = { track, ...(await sc.hearClips(videoPath, track, [f], timing)) };
      keep();
    }
    let r = sc.judgeFile(f, set);
    if (r.needsMiddle) {
      set.middle = await sc.hearMiddle(videoPath, track, [f], set, timing);
      if (set.middle) {
        keep();
        r = sc.judgeFile(f, set);
      }
    }
    return act(videoPath, f, r, set, false, o.notes, o.fixed);
  });
  return !!got;
}

async function prepareByAudio(videoPath, durS, o) {
  o.setStage("checking subtitles by audio");
  if (!o.dryRun) subs.saveClips(videoPath, -1, {});
  const files = await sc.readSidecars(videoPath, durS);
  let fit = false;
  for (const f of files) {
    const verdict = await actByAudio(videoPath, f, o.dryRun, o.notes, o.fixed);
    if (verdict === "good" || (!f.unusable && "TH".includes(f.type))) fit = true;
  }
  if (fit || !o.canDownload) return fit;
  if (o.dryRun) {
    o.notes.push("would download from OpenSubtitles");
    return false;
  }
  o.setStage("downloading subtitles");
  const got = await subs.downloadUntilFit(o.rec, o.season, o.episode, videoPath, async (file) => {
    const f = sidecarOf(videoPath, await sc.readSidecars(videoPath, durS), file);
    return f ? actByAudio(videoPath, f, false, o.notes, o.fixed) : "gone";
  });
  return !!got;
}

// Prepares the subtitles of the video at videoPath, as above. rec, season and
// episode are its show's record and its episode, for downloads; a video that
// is no episode of a show with an imdb id gets none. setStage says what it is
// doing, for the Queues pane. With dryRun nothing is written, deleted or
// downloaded, though clip transcripts are made and kept. Returns {durS,
// needsAsr, notes, fixed}: needsAsr when the video still has nothing that fits
// and a complete ASR is the last thing to try, fixed the shift each fixed
// file got, by file name. Throws when the video is being prepared already.
export async function prepareVideoSubs({
  videoPath,
  rec,
  season,
  episode,
  setStage = () => {},
  dryRun = false,
}) {
  if (busy.has(videoPath))
    throw new Error(`${path.basename(videoPath)} is being prepared already`);
  busy.add(videoPath);
  const notes = [];
  const fixed = {};
  try {
    const { durS, audioLangs } = await sc.videoInfo(videoPath);
    const track = sc.englishTrack(audioLangs);
    const o = {
      rec,
      season,
      episode,
      canDownload:
        !!rec?.imdbId && Number.isInteger(season) && Number.isInteger(episode),
      setStage,
      dryRun,
      notes,
      fixed,
    };
    const fit =
      track < 0
        ? await prepareByAudio(videoPath, durS, o)
        : await prepareByAsr(videoPath, durS, track, o);
    const needsAsr = !fit && track >= 0;
    unilog(2791, `${path.basename(videoPath)} subtitles${dryRun ? " (dry)" : ""}: ${notes.join(", ") || "none"}${fit ? "" : needsAsr ? "; nothing fits, needs ASR" : "; nothing fits"}`);
    return { durS, needsAsr, notes, fixed };
  } finally {
    busy.delete(videoPath);
  }
}

// A sidecar came, changed or went (the file watcher). One that came is dealt
// with like the video's others, from the clip transcripts stored for its
// video. One that changed, most often by the remote's Apply, is only judged
// again, so a timing the viewer chose stays. Videos never checked, videos
// being dealt with now, and files already judged as they are, are left alone.
export async function subFileEvent(file, kind) {
  if (kind === "unlink") {
    subs.forgetCheck(file);
    return;
  }
  let videoPath;
  try {
    videoPath = await sidecarVideo(file);
  } catch {
    return;
  }
  const stored = subs.getClips(videoPath);
  if (!stored || busy.has(videoPath) || subs.freshCheck(file)) return;
  busy.add(videoPath);
  const notes = [];
  try {
    const { durS } = await sc.videoInfo(videoPath);
    const f = sidecarOf(videoPath, await sc.readSidecars(videoPath, durS), file);
    if (!f) return;
    if (stored.track < 0) {
      if (kind === "add") await actByAudio(videoPath, f, false, notes);
      return;
    }
    const set = storedSet(videoPath);
    const r = f.unusable ? null : sc.judgeFile(f, set);
    if (kind === "add") {
      await act(videoPath, f, r, set, false, notes);
      return;
    }
    const verdict = r?.verdict ?? "unusable";
    subs.saveCheck({
      file,
      video: videoPath,
      verdict,
      offsetMs: r?.offsetMs ?? null,
      method: "asr",
      detail: f.why ?? "judged after it changed",
    });
    notes.push(`${suffixOf(videoPath, f.file)} changed, ${verdict}`);
  } finally {
    busy.delete(videoPath);
    if (notes.length > 0)
      unilog(2792, `${path.basename(videoPath)} subtitles: ${notes.join(", ")}`);
  }
}

// The video is gone, and so is what was learned about it.
export function forgetVideo(videoPath) {
  subs.forgetVideo(videoPath);
}

// Whether the video's subtitle files have never been checked and dealt with:
// a dry run leaves clip transcripts but no verdicts.
export function needsCheck(videoPath) {
  return !subs.getClips(videoPath) || !subs.hasChecks(videoPath);
}

// The Sync of the local pane and the remotes' subtitle panel: the file moved
// to fit the words of its video, by the clip transcripts stored for the video
// when it has them, else by its .asr.srt (syncSubToAsr). Returns {offsetMs,
// matches}.
export async function syncSidecar({ path: relPath, asrPath }) {
  const file = path.resolve(TV_DIR, String(relPath || ""));
  if (!file.startsWith(TV_DIR + "/") || !file.endsWith(".srt"))
    throw new Error(`not a tv .srt: ${relPath}`);
  const videoPath = await sidecarVideo(file);
  const set = storedSet(videoPath);
  if (!set) return syncSubToAsr({ path: relPath, asrPath });
  const text = await fsp.readFile(file, "utf8");
  const r = sc.judge(sc.cuesOf(text), set);
  const matches = r.clips.reduce((n, c) => n + c.pairs, 0);
  if (r.verdict === "wrong cut")
    throw new Error(`${path.basename(file)} is from another cut`);
  if (r.verdict === "can't tell")
    throw new Error(`only ${matches} phrases of ${path.basename(file)} match its video`);
  busy.add(videoPath);
  try {
    const fixed = sc.fixedText(text, r.fix);
    await fsp.writeFile(file, fixed, "utf8");
    const again = sc.judge(sc.cuesOf(fixed), set);
    subs.saveCheck({
      file,
      video: videoPath,
      verdict: again.verdict,
      offsetMs: again.offsetMs ?? null,
      method: "asr",
      detail: `Sync ${fmtOfs(r.offsetMs)}`,
    });
  } finally {
    busy.delete(videoPath);
  }
  unilog(2793, `${path.basename(file)} synced to its clips: ${fmtOfs(r.offsetMs)} from ${matches} phrases`);
  return { offsetMs: r.offsetMs, matches };
}
