// The pieces of subtitle handling around subtitle vetting (subVet.js): the
// lock that keeps one thing at a time at a video's sidecars, glued words split
// and line layouts redone, a video with no English audio vetted by matching
// its sound, and the remotes' and local pane's Sync and hand timings for an
// episode with no complete transcript, from the clip transcripts the older
// checks stored or from its .asr.srt. Those clip checks (srt-fix.md) no
// longer run, and no clips are heard: what they stored is only read.
//
// A video with no English audio track has no words to match: its T and H
// files are presumed good, the others checked by whole-file audio matching
// (syncSubToAudio), and it is never sent for ASR.

import fsp from "fs/promises";
import * as path from "node:path";
import { logHere, unilog, cleanSrt } from "@tv/share"
import * as subs from "./subs.js";
import { VET_AUDIO_METHOD } from "./subs.js";
import * as sc from "./subSpotCheck.js";
import { syncSubToAudio, asrOffset, shiftedSrt, sidecarVideo } from "./subSync.js";
import { fixGlued } from "./subGlue.js";
import { showNameFromFilePath } from "./showPaths.js";

const TV_DIR = "/mnt/media/tv";

// How often the watcher looks whether a video it waits for is free.
const BUSY_WAIT_MS = 1000;

// Videos whose sidecars are being dealt with here or by vetting now; the
// watcher waits until that is done.
const busy = new Set();

// Resolves once nothing here is dealing with the video.
async function notBusy(videoPath) {
  while (busy.has(videoPath))
    await new Promise((resolve) => {
      setTimeout(resolve, BUSY_WAIT_MS);
    });
}

// fn() run once nothing else is dealing with the video's sidecars, holding
// them until it is done.
export async function withVideo(videoPath, fn) {
  // checked again with nothing in between before it is taken
  while (busy.has(videoPath)) await notBusy(videoPath);
  busy.add(videoPath);
  try {
    return await fn();
  } finally {
    busy.delete(videoPath);
  }
}

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

// ---- retiming against the .asr.srt ----
//
// An .asr.srt has the video's timing but ASR's wording; the other files have
// a real subtitle's wording but often another release's timing. A video whose
// only good file is its .asr.srt gets one other file shifted by one offset to
// fit it (asrOffset), so one file is right on both counts.

// The video's .asr.srt, as a path, or null.
function asrFileOf(videoPath) {
  const s = subs.listSidecars(videoPath).find((x) => x.type === "+");
  return s ? path.join(path.dirname(videoPath), s.file) : null;
}

// The sidecar f shifted to fit the video's .asr.srt, its verdict stored as
// good (no mark: only vetting's verdicts get one). Returns true when it fits,
// else false, with why in notes. dryRun writes nothing.
async function retimeFile(videoPath, f, dryRun, notes) {
  const asrFile = asrFileOf(videoPath);
  if (!asrFile || f.type === "+") return false;
  const file = path.join(path.dirname(videoPath), f.file);
  const suffix = suffixOf(videoPath, f.file);
  const text = await fsp.readFile(file, "utf8");
  let r;
  try {
    r = asrOffset(text, await fsp.readFile(asrFile, "utf8"), path.basename(asrFile));
  } catch (e) {
    notes.push(`${suffix} not retimed: ${e.message}`);
    return false;
  }
  const how = `retimed ${fmtOfs(r.offsetMs)} (${r.matches} phrases)`;
  if (dryRun) {
    notes.push(`${suffix} would be ${how}`);
    return true;
  }
  if (r.offsetMs !== 0) await fsp.writeFile(file, shiftedSrt(text, r.offsetMs), "utf8");
  subs.saveCheck({
    file,
    video: videoPath,
    verdict: "good",
    offsetMs: r.offsetMs,
    method: "retime",
    detail: `${r.matches} phrases`,
  });
  notes.push(`${suffix} ${how}`);
  return true;
}

// A file that is unusable or from another cut is deleted: its verdict is
// kept as the memory of why, so it is not made again (the queue's copying
// out of embedded tracks), and an opn file is marked unfit so it is not
// downloaded for the video again. An unusable .asr.srt stays, so ASR does
// not run again for the video.
async function dropOrHide(videoPath, f, verdict, why, method, dryRun, notes) {
  const file = path.join(path.dirname(videoPath), f.file);
  const suffix = suffixOf(videoPath, f.file);
  const gone = f.type !== "+" || verdict === "wrong cut";
  notes.push(`${suffix} ${gone ? "deleted" : verdict} (${why})`);
  if (dryRun) return;
  subs.saveCheck({ file, video: videoPath, verdict, method, detail: why });
  if (!gone) return;
  if (f.type === "V") subs.markUnfit(videoPath, suffix);
  await fsp.unlink(file);
}

// One sidecar of a video with no English audio: a T or H file is presumed
// good, and any other is checked by audio matching, which shifts a file it
// passes. Returns its verdict; notes collects what was done, for the log.
async function actByAudio(videoPath, f, dryRun, notes) {
  if (f.unusable) {
    await dropOrHide(videoPath, f, "unusable", f.why, VET_AUDIO_METHOD, dryRun, notes);
    return "unusable";
  }
  const file = path.join(path.dirname(videoPath), f.file);
  const suffix = suffixOf(videoPath, f.file);
  const save = (verdict, detail) =>
    subs.saveCheck({ file, video: videoPath, verdict, method: VET_AUDIO_METHOD, detail });
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
    if (!dryRun) save("good", `shifted ${fmtOfs(offsetMs)} by audio`);
    return "good";
  } catch (e) {
    notes.push(`${suffix} can't tell by audio`);
    if (!dryRun) save("can't tell", e.message);
    return "can't tell";
  }
}

// Full vetting of a video with no English audio track (subVet.js): its files
// not yet judged this way (each T or H one presumed good, every other by
// audio matching, which shifts one it passes) and, with none of them fitting,
// OpenSubtitles downloads judged the same way until one does. o: {rec,
// season, episode, canDownload, setStage, dryRun, notes}. The caller holds
// the video (withVideo). Returns whether it has a file that fits.
export async function vetByAudio(videoPath, durS, o) {
  o.setStage("checking subtitles by audio");
  const dir = path.dirname(videoPath);
  let fit = false;
  for (const f of await sc.readSidecars(videoPath, durS)) {
    if (f.type === "+") continue;
    // an unusable file still on disk was being deleted when tv-srvr stopped
    const check = subs.freshCheck(path.join(dir, f.file));
    const verdict =
      check?.method === VET_AUDIO_METHOD && check.verdict !== "unusable"
        ? check.verdict
        : await actByAudio(videoPath, f, o.dryRun, o.notes);
    if (verdict === "good" || (!f.unusable && "TH".includes(f.type))) fit = true;
  }
  if (fit || !o.canDownload) return fit;
  if (o.dryRun) {
    o.notes.push("would download from OpenSubtitles");
    return false;
  }
  o.setStage("downloading subtitles");
  const got = await subs.downloadUntilFit(o.rec, o.season, o.episode, videoPath, async (file) => {
    await glueSidecars(videoPath, { only: file });
    const f = sidecarOf(videoPath, await sc.readSidecars(videoPath, durS), file);
    return f ? actByAudio(videoPath, f, false, o.notes) : "gone";
  });
  return !!got;
}

// A sidecar came or went (the file watcher). One tv-srvr named (named) that
// came has its glued words split, once whatever is dealing with its video now
// is done; nothing is judged: vetting judges later arrivals at the show's
// next update (subVet.js). One that went loses its check, unless the check
// is the memory of why it is gone.
export async function subFileEvent(file, kind, named = false) {
  if (kind === "unlink") {
    subs.forgetCheckUnlessMisfit(file);
    return;
  }
  if (!named) return;
  let videoPath;
  try {
    videoPath = await sidecarVideo(file);
  } catch {
    return;
  }
  await fixGluedSidecars(videoPath, { only: file });
}

// A sidecar timed by hand (a panel's Apply, an edit), of a video with no
// complete transcript (subVet.judgeHandTimed has the rest), is judged from
// the clip transcripts the older checks stored for its video, and keeps a
// verdict only when it fits; nothing shifts it. One that does not fit, or
// cannot be judged, is unchecked. A file already judged as it is, is left
// alone.
export async function judgeHandTimed(file) {
  if (subs.freshCheck(file)) return;
  subs.forgetCheck(file);
  let videoPath;
  try {
    videoPath = await sidecarVideo(file);
  } catch {
    return;
  }
  const set = storedSet(videoPath);
  if (!set) return;
  const { durS } = await sc.videoInfo(videoPath);
  const f = sidecarOf(videoPath, await sc.readSidecars(videoPath, durS), file);
  if (!f || f.unusable) return;
  const r = sc.judgeFile(f, set);
  if (r.verdict === "good")
    subs.saveCheck({
      file,
      video: videoPath,
      verdict: "good",
      offsetMs: r.offsetMs,
      method: "asr",
      detail: "timed by hand",
    });
  unilog(2807, `${path.basename(file)} timed by hand: ${r.verdict}${r.offsetMs == null ? "" : ` ${fmtOfs(r.offsetMs)}`}`);
}

// The video's sidecars laid out again by cleanSrt, after a change to its line
// layout. No timing moves, so each file keeps its check, made current for the
// rewritten file, and the watcher leaves it alone. Returns how many changed.
export async function reflowSidecars(videoPath) {
  return withVideo(videoPath, async () => {
    let rewritten = 0;
    for (const { file } of subs.listSidecars(videoPath)) {
      const full = path.join(path.dirname(videoPath), file);
      const raw = await fsp.readFile(full, "utf8");
      const clean = cleanSrt(raw);
      if (clean === raw) continue;
      await fsp.writeFile(full, clean, "utf8");
      subs.restatCheck(full);
      await noteRewrite(full);
      rewritten++;
    }
    return rewritten;
  });
}

// ---- glued words ----

// The files the glue fix, the re-layout and vetting rewrote, with the size
// and mtime each was left at, until the watcher's change event for the
// rewrite.
const ownRewrites = new Map();

export async function noteRewrite(file) {
  const st = await fsp.stat(file);
  ownRewrites.set(file, `${st.size} ${Math.round(st.mtimeMs)}`);
}

// Whether file is as the glue fix, the re-layout or vetting left it; its
// record goes either way.
export async function rewroteHere(file) {
  const left = ownRewrites.get(file);
  if (!left) return false;
  ownRewrites.delete(file);
  const st = await fsp.stat(file).catch(() => null);
  return !!st && `${st.size} ${Math.round(st.mtimeMs)}` === left;
}

// The video's sidecars with their glued words split (subGlue.js), each read
// beside the others, again until none changes, since a file split can show
// where another's words go apart; only the file only, when given. ASR's are
// never glued. No timing moves, so a file keeps its check, made current for
// the rewritten file. With dryRun nothing is written. Returns [{file, fixes}]
// for each file with glued words.
export async function fixGluedSidecars(videoPath, opts = {}) {
  return withVideo(videoPath, () => glueSidecars(videoPath, opts));
}

// fixGluedSidecars for a caller already holding the video (withVideo).
export async function glueSidecars(videoPath, { only = null, dryRun = false } = {}) {
  const dir = path.dirname(videoPath);
  const files = [];
  for (const s of subs.listSidecars(videoPath)) {
    const full = path.join(dir, s.file);
    files.push({ ...s, full, text: await fsp.readFile(full, "utf8") });
  }
  const out = new Map();
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of files) {
      if (f.type === "+" || (only && f.full !== only)) continue;
      const siblings = files
        .filter((g) => g !== f)
        .map((g) => ({ text: g.text, outside: g.type === "V" || g.type === "+" }));
      const r = await fixGlued(videoPath, f.text, siblings);
      if (!r) continue;
      changed = true;
      out.set(f.file, [...(out.get(f.file) ?? []), ...r.fixes]);
      f.text = r.text;
      if (dryRun) continue;
      await fsp.writeFile(f.full, r.text, "utf8");
      subs.restatCheck(f.full);
      await noteRewrite(f.full);
      unilog(3023, `${showNameFromFilePath(videoPath)}: glued words split in ${f.file}: ${r.fixes.map((x) => `${x.from} → ${x.to}`).join(", ")}`);
    }
  }
  return [...out].map(([file, fixes]) => ({ file, fixes }));
}

// The video is gone, and so is what was learned about it.
export function forgetVideo(videoPath) {
  subs.forgetVideo(videoPath);
}

// The remotes' Sync for a video with no complete transcript (subVet.js has
// the rest): how far the sidecar srtFile of videoPath is off, by the clip
// transcripts the older checks stored for the video, else by its .asr.srt;
// no clips are heard. Nothing is changed but the file's verdict when it fits
// as it is: the remote's Apply makes the shift. Returns {verdict, offsetMs,
// why}: offsetMs the shift that makes the file fit; null, with why, when no
// one shift fits (a file from another cut, or at another rate) or none can be
// told.
export async function measureSidecar({ videoPath, srtFile }) {
  const video = path.resolve(String(videoPath || ""));
  if (!video.startsWith(TV_DIR + "/"))
    throw new Error(`not under ${TV_DIR}: ${videoPath}`);
  const name = path.basename(String(srtFile || ""));
  if (busy.has(video))
    throw new Error(`${path.basename(video)} is being checked now`);
  busy.add(video);
  try {
    const { durS, audioLangs } = await sc.videoInfo(video);
    const track = sc.englishTrack(audioLangs);
    const files = await sc.readSidecars(video, durS);
    const f = files.find((x) => x.file === name);
    if (!f) throw new Error(`${name} is no subtitle file of ${path.basename(video)}`);
    const out = f.unusable
      ? { verdict: "unusable", offsetMs: null, why: `it can't be checked, ${f.why}` }
      : track < 0
        ? await measureByAudio(video, name)
        : await measureByAsr(video, track, f);
    unilog(2803, `${name} measured for Sync: ${out.verdict}, ${out.offsetMs == null ? out.why : fmtOfs(out.offsetMs)}`);
    return out;
  } finally {
    busy.delete(video);
  }
}

async function measureByAsr(videoPath, track, f) {
  const set = storedSet(videoPath);
  if (set?.track !== track) return measureByAsrFile(videoPath, f);
  const r = sc.judgeFile(f, set);
  if (r.fix?.drift)
    return { verdict: "other rate", offsetMs: null, why: "it runs at another rate, no one shift fits it" };
  if (r.verdict === "good")
    subs.saveCheck({
      file: path.join(path.dirname(videoPath), f.file),
      video: videoPath,
      verdict: "good",
      offsetMs: r.offsetMs,
      method: "asr",
      detail: "measured for Sync",
    });
  if (r.verdict === "good" || r.verdict === "fixable")
    return { verdict: r.verdict, offsetMs: r.offsetMs };
  const why =
    r.verdict === "wrong cut"
      ? `from another cut${r.why ? ` (${r.why})` : ""}, no one shift fits it`
      : "too few of its lines match the video's words";
  return { verdict: r.verdict, offsetMs: null, why };
}

// With no stored clips: the one shift that fits the file to the video's
// .asr.srt (asrOffset).
async function measureByAsrFile(videoPath, f) {
  const asrFile = asrFileOf(videoPath);
  if (!asrFile || f.type === "+")
    return { verdict: "can't tell", offsetMs: null, why: "the video has no transcript to measure it by" };
  const dir = path.dirname(videoPath);
  try {
    const { offsetMs } = asrOffset(
      await fsp.readFile(path.join(dir, f.file), "utf8"),
      await fsp.readFile(asrFile, "utf8"),
      path.basename(asrFile),
    );
    return { verdict: "by asr", offsetMs };
  } catch (e) {
    return { verdict: "can't tell", offsetMs: null, why: e.message };
  }
}

// A video with no English audio: the whole file's offset by audio matching.
async function measureByAudio(videoPath, name) {
  try {
    const { offsetMs } = await syncSubToAudio({
      path: path.relative(TV_DIR, path.join(path.dirname(videoPath), name)),
      dryRun: true,
    });
    return { verdict: "by audio", offsetMs };
  } catch (e) {
    return { verdict: "can't tell", offsetMs: null, why: e.message };
  }
}

// The Sync of the local pane for a video with no complete transcript
// (subVet.js has the rest): the file moved to fit the words of its video, by
// the clip transcripts the older checks stored for the video when it has
// them, else by its .asr.srt (the retime, by hand). Returns {offsetMs,
// matches}.
export async function syncSidecar({ path: relPath }) {
  const file = path.resolve(TV_DIR, String(relPath || ""));
  if (!file.startsWith(TV_DIR + "/") || !file.endsWith(".srt"))
    throw new Error(`not a tv .srt: ${relPath}`);
  const videoPath = await sidecarVideo(file);
  const set = storedSet(videoPath);
  if (!set) {
    await notBusy(videoPath);
    const { durS } = await sc.videoInfo(videoPath);
    const f = sidecarOf(videoPath, await sc.readSidecars(videoPath, durS), file);
    if (!f) throw new Error(`${path.basename(file)} is not a sidecar of ${path.basename(videoPath)}`);
    if (f.unusable) throw new Error(`${path.basename(file)} is unusable: ${f.why}`);
    const notes = [];
    busy.add(videoPath);
    try {
      if (!(await retimeFile(videoPath, f, false, notes))) throw new Error(notes[0]);
    } finally {
      busy.delete(videoPath);
    }
    const check = subs.freshCheck(file);
    return { offsetMs: check.offsetMs, matches: Number(/(\d+) phrases/.exec(check.detail)?.[1]) };
  }
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
