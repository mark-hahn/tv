// Pure Flexget helpers: PST timestamp formatting and next-season detection.
// Which candidate is better is compareRelease's job (@tv/share). No shared
// state.

import { episodeFields } from "@tv/share";

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

// The season after the latest one holding a file or a watched episode, or 1
// when no season holds either.
export function getFlexgetNextSeason(ed) {
  if (!Array.isArray(ed)) return 1;
  for (let s = ed.length - 1; s >= 0; s--) {
    const season = ed[s];
    if (!Array.isArray(season)) continue;
    const used = season.some((ep) => {
      const f = episodeFields(ep);
      return !!f && ((typeof f.file === "string" && f.file) || f.watched);
    });
    if (used) return s + 1;
  }
  return 1;
}
