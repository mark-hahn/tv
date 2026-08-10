// Pure video/resolution filename helpers: the known video extensions and the
// logic for detecting resolution, ".alt" copies left over on disk, and locating
// an episode's video files. No logging, no shared state.

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
    if (name.startsWith(".")) continue; // skip dotfiles
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
