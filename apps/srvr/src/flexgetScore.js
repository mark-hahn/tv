// Pure Flexget candidate scoring & comparison helpers: PST timestamp
// formatting, bit-depth/resolution parsing, same-run and cross-run "is better"
// comparators, and first-season-gap detection. No shared state.

import { getResolution } from "@tv/share";
import { isBadGroup } from "./badGroups.js";

export function flexgetFmtSent() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value || "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}/${get("month")}/${get("day")}-${hour}:${get("minute")}:${get("second")}`;
}

export function flexgetBitDepth(title) {
  if (/10.?bit|hdr/i.test(String(title || ""))) return 10;
  return 8;
}

// Same-run dedup: resolution → bit depth → seeds → bad group
export function flexgetIsBetterSameRun(a, b) {
  const aRes = getResolution(a.quality || a.title || "") ?? 480;
  const bRes = getResolution(b.quality || b.title || "") ?? 480;
  if (aRes !== bRes) return aRes > bRes;

  const aDepth = flexgetBitDepth(a.title);
  const bDepth = flexgetBitDepth(b.title);
  if (aDepth !== bDepth) return aDepth > bDepth;

  const aSeeds = parseInt(String(a.torrent_seeds || "0"), 10) || 0;
  const bSeeds = parseInt(String(b.torrent_seeds || "0"), 10) || 0;
  if (aSeeds !== bSeeds) return aSeeds > bSeeds;

  const aBad = isBadGroup(a.title);
  const bBad = isBadGroup(b.title);
  if (aBad !== bBad) return bBad; // b is bad group → a is better
  return false;
}

// Cross-run comparison: resolution → bad group tiebreaker
export function flexgetIsBetterCrossRun(a, b) {
  const aRes = getResolution(a.quality || a.title || "") ?? 480;
  const bRes = getResolution(b.quality || b.title || "") ?? 480;
  if (aRes !== bRes) return aRes > bRes;
  const aBad = isBadGroup(a.title);
  const bBad = isBadGroup(b.title);
  if (aBad !== bBad) return bBad; // b is bad group → a is better
  return false;
}

export function parseResolutionStrict(title, quality) {
  const src = String(title || "") + " " + String(quality || "");
  if (/2160p/i.test(src)) return 2160;
  if (/1080p/i.test(src)) return 1080;
  if (/720p/i.test(src)) return 720;
  if (/576p/i.test(src)) return 576;
  if (/480p/i.test(src)) return 480;
  if (/384p/i.test(src)) return 384;
  return 0; // unknown — do not fall back
}

export function getFirstFilesOnDiskSeasonGap(diskSeasons, torrentSeason) {
  const seasons = [];

  if (Array.isArray(diskSeasons)) {
    seasons.push(...diskSeasons.filter((n) => Number.isInteger(n) && n >= 0));
  }

  if (Number.isInteger(torrentSeason) && torrentSeason >= 0) {
    seasons.push(torrentSeason);
  }

  if (seasons.length === 0) return null;

  seasons.sort((a, b) => a - b);

  const dedupedSeasons = seasons.filter(
    (seasonNum, index) => index === 0 || seasonNum !== seasons[index - 1],
  );

  let expectedSeason = dedupedSeasons[0];
  for (let i = 0; i < dedupedSeasons.length; i += 1) {
    const seasonNum = dedupedSeasons[i];
    if (seasonNum > expectedSeason) return expectedSeason;
    if (seasonNum === expectedSeason) expectedSeason += 1;
  }

  return null;
}
