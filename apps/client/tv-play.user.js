// ==UserScript==
// @name         TV Play
// @namespace    https://hahnca.com/
// @version      1.0
// @description  Skip button and intro jump for the tv client's Play tab
// @author       hahnca
// @match        https://hahnca.com/tv-srvr/api/stream*
// @match        https://hahnca.com/tv/*
// @grant        none
// ==/UserScript==

// The Play button of the info and map panes opens tv-srvr's /api/stream in a
// tab of its own (srvr.js playInTab), shown by the browser's own player. The
// hash carries the season's intro in ms: trim, where the episode starts past
// the intro, and skip, how far Skip jumps. tv-srvr's stream already starts at
// trim (its start param) and can't seek, so Skip reopens it further on. An
// h264/aac mp4 is redirected to the plain file on nginx instead (the hash comes
// along), which seeks but starts at 0, so it is jumped to trim here.

(function () {
  "use strict";

  const hash = new URLSearchParams(location.hash.slice(1));
  if (!hash.has("skip")) return;
  const vid = document.querySelector("video");
  if (!vid) return;
  const trimSec = Number(hash.get("trim")) / 1000;
  const skipSec = Number(hash.get("skip")) / 1000;
  const isStream = location.pathname.endsWith("/api/stream");

  if (!isStream && trimSec > 0 && vid.currentTime === 0)
    vid.currentTime = trimSec;
  if (!(skipSec > 0)) return;

  const btn = document.createElement("div");
  btn.textContent = "Skip";
  btn.style.cssText =
    "position: fixed; top: 10px; right: 14px; z-index: 2147483647;" +
    "color: white; font: 13px sans-serif; padding: 2px 8px;" +
    "border-radius: 4px; border: 1px solid #666; cursor: pointer;" +
    "user-select: none; background: rgba(0, 0, 0, 0.5);";
  btn.addEventListener("click", () => {
    if (!isStream) {
      vid.currentTime += skipSec;
      return;
    }
    const q = new URLSearchParams(location.search);
    const start = Number(q.get("start") || 0) + vid.currentTime + skipSec;
    q.set("start", String(Math.floor(start)));
    location.replace(`${location.pathname}?${q}${location.hash}`);
  });
  document.body.appendChild(btn);
})();
