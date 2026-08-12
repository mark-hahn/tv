// Pure video/resolution filename helpers: the known video extensions and the
// logic for detecting resolution, ".alt" copies left over on disk, and locating
// an episode's video files. No logging, no shared state.

import fs from "fs";
import * as path from "node:path";
import {
  parseFileSeasonEpisode,
  vidHasAlt,
  vidStripAlt,
  vidIsVideoName,
  vidIsSampleName,
} from "@tv/share";

// The list and the name tests live in @tv/share so down shares them; these
// re-exports keep every existing srvr call site working unchanged.
export { videoFileExtensions, vidDemoteToOld } from "@tv/share";

export const resHasAlt = vidHasAlt;
export const resStripAlt = vidStripAlt;
export const resIsSampleName = vidIsSampleName;

// Resolution implied by a filename substring (0 = unknown).
export function resOfName(name) {
  if (/2160p/i.test(name)) return 2160;
  if (/1080p/i.test(name)) return 1080;
  return 0;
}

export const resIsVideoName = vidIsVideoName;

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
