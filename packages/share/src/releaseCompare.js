// The one judgement of which of two releases of an episode is better
// (better-plan.md). compareRelease knows nothing of where its answer is used:
// each caller hands over only the factors it wants judged, and decides what
// "equal" means for itself.

import { getResolution, isHevc } from "./index.js";

// Within this ratio two sizes count as equal.
const SIZE_MARGIN = 1.2;

// Source tiers, best first. "WEB" alone is the scene tag for an untouched
// web stream, so it counts as WEB-DL; WEBRip is tested before it because
// "WEB-Rip" would also match a bare WEB.
const SOURCES = [
  [/\bremux\b/i, 6],
  [/\b(blu-?ray|bdrip|brrip|bd)\b/i, 5],
  [/\bweb-?rip\b/i, 3],
  [/\b(web-?dl|web)\b/i, 4],
  [/\b(hdtv|pdtv|sdtv|dsr|tvrip)\b/i, 2],
  [/\b(dvd|dvdrip|dvd-?r|dvd5|dvd9)\b/i, 1],
];

const higher = (a, b) => Math.sign(a - b);
const isTrue = (a, b) => Number(!!a) - Number(!!b);
const isFalse = (a, b) => Number(!!b) - Number(!!a);
const larger = (a, b) => (a > b * SIZE_MARGIN ? 1 : b > a * SIZE_MARGIN ? -1 : 0);

// The fixed order. Each entry: factor key, its name in log lines, and how
// two values compare (positive: the first is better).
const FACTORS = [
  ["res", "resolution", higher],
  ["proper", "proper/repack", isTrue],
  ["source", "source", higher],
  ["hevc", "hevc/av1", isFalse],
  ["depth", "bit depth", higher],
  ["size", "size", larger],
  ["seeds", "seeds", higher],
  ["badGroup", "bad group", isFalse],
  ["tracker", "tracker", higher],
];

// a and b are factor records: { res, proper, source, hevc, depth, size,
// seeds, badGroup, tracker }, any of them left out. tracker is a rank, higher
// better (flexget: torrentleech, then iptorrents, then eztv; the tor pane's
// true for torrentleech counts as 1). A factor is judged only
// when both have it. cmp is 1 when a is better, -1 when b is, 0 when equal;
// factor names the factor that decided ("" when equal).
export function compareRelease(a, b) {
  for (const [key, name, cmpFn] of FACTORS) {
    if (a[key] == null || b[key] == null) continue;
    const cmp = cmpFn(a[key], b[key]);
    if (cmp) return { cmp, factor: name };
  }
  return { cmp: 0, factor: "" };
}

// The factors a release name tells: resolution (no tag is 480), PROPER or
// REPACK, source tier (null when the name has none), hevc and bit depth.
// AV1 counts as hevc: the browser player transcodes both, and at 1080p and
// below both are mostly shrunk re-encodes.
// tagText, when given, is read for the tags instead of name (flexget's
// quality line). Callers add badGroup, size, seeds and tracker.
export function releaseFactors(name, tagText = name) {
  const text = String(tagText || "");
  const source = SOURCES.find(([re]) => re.test(text));
  return {
    res: getResolution(text) ?? 480,
    proper: /\b(proper|repack\d?)\b/i.test(text),
    source: source ? source[1] : null,
    hevc: isHevc(text) || /\bav1\b/i.test(text),
    depth: /10.?bit|hdr/i.test(text) ? 10 : 8,
  };
}

// Bytes from a size as trackers list it ("1.44 GB", "700 MiB") or a number.
// null when it can't be read.
export function sizeToBytes(size) {
  if (typeof size === "number") return size > 0 ? size : null;
  const m = String(size || "").match(/^\s*([\d.]+)\s*([KMGT]?)i?B?\s*$/i);
  if (!m) return null;
  const pow = { "": 0, K: 1, M: 2, G: 3, T: 4 }[m[2].toUpperCase()];
  const bytes = Number(m[1]) * 1024 ** pow;
  return bytes > 0 ? bytes : null;
}
