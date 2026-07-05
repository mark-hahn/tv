// Pure video/resolution filename helpers: the known video extensions and the
// logic for detecting resolution, ".alt" copies, and locating an episode's
// video files (incl. active 2160 and kept-aside 1080 ".old"). No logging, no
// shared state.

import fs from "fs";
import * as path from "node:path";
import { parseFileSeasonEpisode } from "@tv/share";

export const videoFileExtensions = [
  "mp4",
  "mkv",
  "avi",
  "mov",
  "wmv",
  "flv",
  "mpeg",
  "3gp",
  "m4v",
  "ts",
  "rm",
  "vob",
  "ogv",
  "divx",
];

export function resHasAlt(name) {
  return name.toLowerCase().endsWith(".alt");
}

export function resStripAlt(name) {
  return resHasAlt(name) ? name.slice(0, -4) : name;
}

// Resolution implied by a filename substring (0 = unknown).
export function resOfName(name) {
  if (/2160p/i.test(name)) return 2160;
  if (/1080p/i.test(name)) return 1080;
  return 0;
}

// True when name (after stripping a trailing .alt) is a real video file.
export function resIsVideoName(name) {
  const ext = resStripAlt(name).split(".").pop().toLowerCase();
  return videoFileExtensions.includes(ext);
}

// All episode video files in a season dir (includes hidden .alt copies).
export function resFindEpisodeVideos(seasonDir, season, episode) {
  let files;
  try {
    files = fs.readdirSync(seasonDir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of files) {
    if (name.startsWith(".")) continue; // skip dotfiles (.restmp-* etc)
    if (!resIsVideoName(name)) continue;
    const parsed = parseFileSeasonEpisode(
      resStripAlt(name),
      path.basename(seasonDir),
    );
    if (parsed?.season !== season || parsed?.episode !== episode) continue;
    out.push({ name, res: resOfName(name), alt: resHasAlt(name) });
  }
  return out;
}

// Active (non-.alt) 2160 file name for an episode, if any. Never returns a
// hidden .alt copy — the re-encoder must only process a real active 2160 video
// file (an .alt source would produce a broken temp filename and fail).
export function res2160FileName(seasonDir, season, episode) {
  const vids = resFindEpisodeVideos(seasonDir, season, episode);
  const f = vids.find((v) => v.res === 2160 && !v.alt);
  return f ? f.name : null;
}

// A kept-aside 1080 ".old" file for an episode (preferred fallback source).
export function res1080OldFileName(seasonDir, season, episode) {
  let files;
  try {
    files = fs.readdirSync(seasonDir);
  } catch {
    return null;
  }
  for (const name of files) {
    if (!/\.old$/i.test(name)) continue;
    if (!/1080p/i.test(name)) continue;
    const base = name.replace(/\.old$/i, "");
    if (!resIsVideoName(base)) continue;
    const parsed = parseFileSeasonEpisode(base, path.basename(seasonDir));
    if (parsed?.season === season && parsed?.episode === episode) return name;
  }
  return null;
}
