// Video filename facts shared by every app: what counts as a video, what
// counts as a scene sample, and how a replaced video is deleted together with
// the sidecars that belong to it.
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

// True when name is a real video file.
export function vidIsVideoName(name) {
  const ext = String(name || "")
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
 * Delete a replaced or losing video together with its sidecars.
 *
 * Its `.srt` / `.nfo` / `-thumb.jpg` files name the deleted release, so left
 * behind they would belong to nothing while looking current.
 *
 * Only the named video goes; any other video sharing the prefix is left
 * alone, so a "<name>.PROPER.mkv" next door is never dragged along.
 *
 * Returns the names deleted, the video first. Throws if the video itself
 * could not be deleted.
 */
export function vidDeleteWithSidecars(videoPath) {
  const dir = path.dirname(videoPath);
  const videoName = path.basename(videoPath);
  const base = videoName.replace(/\.[^.]+$/, "");

  fs.unlinkSync(videoPath);
  const deleted = [videoName];
  const names = fs.readdirSync(dir);
  const owns = (stem, name) =>
    name.startsWith(stem + ".") || name.startsWith(stem + "-");
  // A video that merely shares the prefix keeps its own sidecars.
  const others = names
    .filter((n) => vidIsVideoName(n))
    .map((n) => n.replace(/\.[^.]+$/, ""))
    .filter((s) => s.length > base.length && owns(base, s));
  for (const name of names) {
    if (!owns(base, name) || vidIsVideoName(name)) continue;
    if (others.some((s) => name === s || owns(s, name))) continue;
    fs.unlinkSync(path.join(dir, name));
    deleted.push(name);
  }
  return deleted;
}
