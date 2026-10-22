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
  "mpg",
  "webm",
  "3gp",
  "m4v",
  "ts",
  "rm",
  "vob",
  "ogv",
  "divx",
];

// The videos tv-down downloads from usb: the types above that tvapp's player
// (Media3) can open and seek. Left out: wmv and rm (no Media3 reader), ogv
// (Theora, no decoder on the TV), flv (can't seek), 3gp, and vob (tv-down's
// DVD pass takes those).
export const downVideoExtensions = [
  "mkv",
  "webm",
  "mp4",
  "m4v",
  "mov",
  "avi",
  "divx",
  "ts",
  "mpeg",
  "mpg",
];

// Every file tv-down downloads from usb by itself: those videos, subtitles
// (.ass and .ssa ones converted to .srt as they land) and .nfo files. Any
// other file of a torrent stays on usb.
export const downFileExtensions = [
  ...downVideoExtensions,
  "srt",
  "ass",
  "ssa",
  "nfo",
];

// Files that come with releases and nobody wants downloaded: checksums,
// scene metadata, notes, images, image (VobSub) subtitles, and a rar's parts,
// which are unpacked on usb. tv-down skips them like any file not in
// downFileExtensions, but the questions about skipped files leave them out.
const RELEASE_EXTRA_EXTS = new Set([
  "nzb",
  "sfv",
  "srr",
  "md5",
  "txt",
  "url",
  "xml",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "idx",
  "sub",
]);

export function isReleaseExtra(name) {
  const ext = String(name || "")
    .split(".")
    .pop()
    .toLowerCase();
  return RELEASE_EXTRA_EXTS.has(ext) || /^(rar|r\d\d|\d{3})$/.test(ext);
}

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
