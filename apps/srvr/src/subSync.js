// Sync in the local pane and the remotes' subtitle panel: shifts a sidecar .srt
// so its timing matches the episode's ASR sidecar (<base>.asr.srt), which
// follows the audio. Short phrases that occur exactly once in each file are
// paired, and every cue moves by the median of their start-time differences.
//
// syncSubToAudio does the same against the video's own audio, with no ASR:
// ffsubsync lines the cues up with the speech it hears in the whole video.
// It reads the whole file, minutes for a big one, so it is for the background.

import fsp from "fs/promises";
import os from "os";
import * as cp from "child_process";
import { promisify } from "util";
import * as path from "node:path";
import { unilog } from "@tv/share";
import {
  parseSrt,
  srtTimeToMs,
  msToSrtTime,
  cleanSrt,
  logHere,
  vidIsVideoName,
} from "@tv/share";
import { BATCH_SCHED } from "./batchQueue.js";
import { SRVR_ROOT_DIR } from "./srvrPaths.js";

const TV_DIR = "/mnt/media/tv";
const MAX_PHRASE_WORDS = 4;
const MIN_MATCHES = 10;
// ffsubsync, in its own venv (python3 -m venv /opt/ffsubsync, then
// /opt/ffsubsync/bin/pip install ffsubsync).
const FFSUBSYNC = "/opt/ffsubsync/bin/ffsubsync";
const FFSUBSYNC_PYTHON = "/opt/ffsubsync/bin/python";
const AUDIO_CHECK_PY = path.join(SRVR_ROOT_DIR, "src", "audioSyncCheck.py");
// The largest offset the audio sync looks for.
const AUDIO_MAX_OFFSET_S = 60;
// The whole file's offset and the best offsets of the first and the last third
// of the cues must agree this closely, or the file is from another cut or runs
// at another rate and no single shift fits it.
const AUDIO_AGREE_MS = 250;
const AUDIO_RATE = 16000;

const execFileP = promisify(cp.execFile);

function srtFullPath(relPath) {
  const fullPath = path.resolve(TV_DIR, String(relPath || ""));
  if (!fullPath.startsWith(TV_DIR + "/") || !fullPath.endsWith(".srt"))
    throw new Error(`not a tv .srt: ${relPath}`);
  return fullPath;
}

// Start ms of every cue of 1 to MAX_PHRASE_WORDS words whose text occurs
// once in the file, keyed by its words. Sound tags are left out.
function phraseStarts(srtText) {
  const counts = new Map();
  const starts = new Map();
  for (const { startMs, text } of parseSrt(srtText)) {
    if (/[[(♪]/.test(text)) continue;
    const words = text
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(Boolean);
    const key = words.join(" ");
    counts.set(key, (counts.get(key) || 0) + 1);
    if (words.length > 0 && words.length <= MAX_PHRASE_WORDS)
      starts.set(key, startMs);
  }
  for (const key of starts.keys()) if (counts.get(key) !== 1) starts.delete(key);
  return starts;
}

export async function syncSubToAsr({ path: relPath, asrPath }) {
  const subFile = srtFullPath(relPath);
  const asrFile = srtFullPath(asrPath);
  if (
    subFile.endsWith(".asr.srt") ||
    !asrFile.endsWith(".asr.srt") ||
    path.dirname(subFile) !== path.dirname(asrFile)
  )
    throw new Error(`not a sidecar and its asr: ${relPath}, ${asrPath}`);

  const subText = await fsp.readFile(subFile, "utf8");
  const asrStarts = phraseStarts(await fsp.readFile(asrFile, "utf8"));
  const offsets = [];
  for (const [key, startMs] of phraseStarts(subText))
    if (asrStarts.has(key)) offsets.push(asrStarts.get(key) - startMs);
  if (offsets.length < MIN_MATCHES)
    throw new Error(
      `only ${offsets.length} phrases match ${path.basename(asrFile)}`,
    );
  offsets.sort((a, b) => a - b);
  const offsetMs = offsets[Math.floor(offsets.length / 2)];

  if (offsetMs !== 0)
    await fsp.writeFile(subFile, shiftedSrt(subText, offsetMs), "utf8");
  unilog(2778, `${path.basename(subFile)} synced to asr: ${offsetMs} ms from ${offsets.length} phrases`);
  return { offsetMs, matches: offsets.length };
}

// srtText with every cue moved by offsetMs, never below 0, through cleanSrt.
function shiftedSrt(srtText, offsetMs) {
  const timeLineRe =
    /^([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(\s*-->\s*)([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(.*)$/;
  const lines = srtText.split(/\r?\n/).map((line) => {
    const m = timeLineRe.exec(line);
    if (!m) return line;
    const startMs = srtTimeToMs(m[1]) + offsetMs;
    const endMs = srtTimeToMs(m[3]) + offsetMs;
    return `${msToSrtTime(Math.max(0, startMs))}${m[2]}${msToSrtTime(Math.max(0, endMs))}${m[4]}`;
  });
  return cleanSrt(lines.join("\n"));
}

// The video beside subFile that it is a sidecar of: <stem>.srt or <stem>.*.srt.
async function sidecarVideo(subFile) {
  const name = path.basename(subFile);
  const video = (await fsp.readdir(path.dirname(subFile))).find((f) => {
    if (!vidIsVideoName(f)) return false;
    const stem = f.replace(/\.[^.]+$/, "");
    return name === `${stem}.srt` || name.startsWith(`${stem}.`);
  });
  if (!video) throw new Error(`no video for ${name}`);
  return path.join(path.dirname(subFile), video);
}

// Shifts the sidecar .srt at relPath to match its video's audio. The video's
// first audio track is decoded once; ffsubsync finds the whole file's offset
// from it and keeps the speech it heard, and audioSyncCheck.py finds the best
// offsets of the first and the last third of the cues against that speech.
// All three must agree within AUDIO_AGREE_MS and the file moves by the whole
// file's. Otherwise it throws and the file is left as it was. With dryRun it
// only measures and checks; nothing is written.
export async function syncSubToAudio({ path: relPath, dryRun = false }) {
  const subFile = srtFullPath(relPath);
  const name = path.basename(subFile);
  const videoFile = await sidecarVideo(subFile);
  const subText = await fsp.readFile(subFile, "utf8");
  const [sched, ...schedArgs] = BATCH_SCHED;
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "audio-sync-"));
  let offsetMs, startOfsMs, endOfsMs;
  try {
    const wav = path.join(tmpDir, "audio.wav");
    await execFileP(sched, [
      ...schedArgs,
      "ffmpeg",
      "-v",
      "error",
      "-nostdin",
      "-i",
      videoFile,
      "-map",
      "0:a:0",
      "-ac",
      "1",
      "-ar",
      String(AUDIO_RATE),
      wav,
    ]);
    // --vad webrtc: the speech in the audio. No framerate fix: only a shift is
    // applied. --serialize-speech leaves the speech in audio.npz beside the wav.
    const { stdout, stderr } = await execFileP(
      sched,
      [
        ...schedArgs,
        FFSUBSYNC,
        wav,
        "-i",
        subFile,
        "-o",
        path.join(tmpDir, "out.srt"),
        "--vad",
        "webrtc",
        "--no-fix-framerate",
        "--max-offset-seconds",
        String(AUDIO_MAX_OFFSET_S),
        "--serialize-speech",
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const m = /offset seconds: (-?[0-9.]+)/.exec(stderr + stdout);
    if (!m) throw new Error(`ffsubsync found no offset for ${name}`);
    offsetMs = Math.round(parseFloat(m[1]) * 1000);
    const check = await execFileP(sched, [
      ...schedArgs,
      FFSUBSYNC_PYTHON,
      AUDIO_CHECK_PY,
      path.join(tmpDir, "audio.npz"),
      subFile,
      String(AUDIO_MAX_OFFSET_S),
    ]);
    ({ startMs: startOfsMs, endMs: endOfsMs } = JSON.parse(check.stdout));
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
  const offsets = [offsetMs, startOfsMs, endOfsMs];
  if (Math.max(...offsets) - Math.min(...offsets) > AUDIO_AGREE_MS)
    throw new Error(
      `${name}: offset ${startOfsMs} ms in the first third, ${endOfsMs} ms in the last, ${offsetMs} ms overall`,
    );
  if (dryRun) return { offsetMs, startOfsMs, endOfsMs };
  if (offsetMs !== 0)
    await fsp.writeFile(subFile, shiftedSrt(subText, offsetMs), "utf8");
  unilog(2784, `${name} synced to audio: ${offsetMs} ms (first third ${startOfsMs}, last ${endOfsMs})`);
  return { offsetMs, startOfsMs, endOfsMs };
}
