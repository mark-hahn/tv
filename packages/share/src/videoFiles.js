// Video filename facts shared by every app: what counts as a video, what
// counts as a scene sample, and how a video is stepped aside to `.old`
// together with the sidecars that belong to it.
//
// srvr's own videoFiles.js re-exports the list and the name test so its
// existing call sites keep working; down imports them from here directly.

import fs from "fs";
import * as path from "node:path";

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

const VIDEO_EXT_SET = new Set(videoFileExtensions);

export function vidHasAlt(name) {
  return name.toLowerCase().endsWith(".alt");
}

export function vidStripAlt(name) {
  return vidHasAlt(name) ? name.slice(0, -4) : name;
}

// True when name (after stripping a trailing .alt) is a real video file.
export function vidIsVideoName(name) {
  const ext = vidStripAlt(String(name || ""))
    .split(".")
    .pop()
    .toLowerCase();
  return VIDEO_EXT_SET.has(ext);
}

// A scene "sample" clip sits next to the episode it was cut from and parses to
// the same season/episode, so counting one inflates a folder's episode count
// and makes the episode look like it is already there twice.
export function vidIsSampleName(name) {
  return /(^|[.\-_ ])sample([.\-_ ]|$)/i.test(
    String(name || "").replace(/\.[^.]+$/, ""),
  );
}

/**
 * Step a video aside to `.old`, taking its sidecars with it.
 *
 * A replaced episode used to leave its `.en.srt` / `.asr.srt` / `.nfo` /
 * `-thumb.jpg` behind under the old basename, where they belong to nothing:
 * the replacement carries a different release name, so it starts with no
 * subtitles at all while the stale ones sit next to it looking current.
 *
 * Only the named video moves; any other video sharing the prefix is left
 * alone, so a "<name>.PROPER.mkv" next door is never dragged along. `.old` is
 * appended until the name is free, so nothing is overwritten.
 *
 * Returns the video's new path, or null if it could not be renamed.
 */
export function vidDemoteToOld(videoPath) {
  const dir = path.dirname(videoPath);
  const videoName = path.basename(videoPath);
  const base = videoName.replace(/\.[^.]+$/, "");

  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    names = [videoName];
  }

  let videoDst = null;
  for (const name of names) {
    if (!name.startsWith(base)) continue;
    if (name.endsWith(".old")) continue;
    // Another video that merely shares the prefix is a different file.
    if (name !== videoName && vidIsVideoName(name)) continue;
    const src = path.join(dir, name);
    let dst = src + ".old";
    while (fs.existsSync(dst)) dst += ".old";
    try {
      fs.renameSync(src, dst);
    } catch {
      continue;
    }
    if (name === videoName) videoDst = dst;
  }
  return videoDst;
}
