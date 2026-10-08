// Sync in the local pane and the remotes' subtitle panel: shifts a sidecar .srt
// so its timing matches the episode's ASR sidecar (<base>.asr.srt), which
// follows the audio. Short phrases that occur exactly once in each file are
// paired, and every cue moves by the median of their start-time differences.

import fsp from "fs/promises";
import * as path from "node:path";
import { unilog } from "@tv/share";
import {
  parseSrt,
  srtTimeToMs,
  msToSrtTime,
  cleanSrt,
  logHere,
} from "@tv/share";

const TV_DIR = "/mnt/media/tv";
const MAX_PHRASE_WORDS = 4;
const MIN_MATCHES = 10;

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

  if (offsetMs !== 0) {
    const timeLineRe =
      /^([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(\s*-->\s*)([0-9]{2}:[0-9]{2}:[0-9]{2},[0-9]{3})(.*)$/;
    const lines = subText.split(/\r?\n/).map((line) => {
      const m = timeLineRe.exec(line);
      if (!m) return line;
      const startMs = srtTimeToMs(m[1]) + offsetMs;
      const endMs = srtTimeToMs(m[3]) + offsetMs;
      return `${msToSrtTime(Math.max(0, startMs))}${m[2]}${msToSrtTime(Math.max(0, endMs))}${m[4]}`;
    });
    await fsp.writeFile(subFile, cleanSrt(lines.join("\n")), "utf8");
  }
  unilog(2778, `${path.basename(subFile)} synced to asr: ${offsetMs} ms from ${offsets.length} phrases`);
  return { offsetMs, matches: offsets.length };
}
