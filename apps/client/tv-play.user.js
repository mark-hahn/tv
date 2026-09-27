// ==UserScript==
// @name         TV Play
// @namespace    https://hahnca.com/
// @version      1.1
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
// along), which seeks but starts at 0, so it is jumped to trim here. Skip is a
// popover so it can be put above a fullscreen video in the top layer.

(function () {
  "use strict";

  const hash = new URLSearchParams(location.hash.slice(1));
  if (!hash.has("skip")) return;
  const vid = document.querySelector("video");
  if (!vid) return;
  const trimSec = Number(hash.get("trim")) / 1000;
  const skipSec = Number(hash.get("skip")) / 1000;
  const isStream = location.pathname.endsWith("/api/stream");
  vid.volume = 0.1;

  if (!isStream && trimSec > 0 && vid.currentTime === 0)
    vid.currentTime = trimSec;
  if (!(skipSec > 0)) return;

  const btn = document.createElement("div");
  btn.popover = "manual";
  btn.textContent = "Skip";
  btn.style.cssText =
    "position: fixed; inset: 10px 14px auto auto; margin: 0; z-index: 2147483647;" +
    "color: white; font: 13px sans-serif; padding: 2px 8px;" +
    "border-radius: 4px; border: 1px solid #666; cursor: pointer;" +
    "user-select: none; background: rgba(0, 0, 0, 0.5);";
  // The stream is reopened on the same video element, not by reloading the
  // page, so fullscreen and the volume survive a Skip.
  const q = new URLSearchParams(location.search);
  let start = Number(q.get("start") || 0);
  // Clicks are taken by where they land, not off the button: a fullscreen
  // video makes the rest of the page inert (Firefox), so a click on Skip goes
  // to the video. Firefox's video controls swallow the downs, ups and clicks
  // on the video, only moves get through, so in fullscreen the controls are
  // off while the pointer is over Skip; the click then reaches the page and
  // doesn't pause the video.
  const onBtn = (e) => {
    const r = btn.getBoundingClientRect();
    return (
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom
    );
  };
  addEventListener(
    "pointermove",
    (e) => {
      const over = document.fullscreenElement === vid && onBtn(e);
      if (vid.controls === over) vid.controls = !over;
    },
    true,
  );
  addEventListener("click", (e) => {
    if (!onBtn(e)) return;
    e.stopPropagation();
    e.preventDefault();
    if (!isStream) {
      vid.currentTime += skipSec;
      return;
    }
    start = Math.floor(start + vid.currentTime + skipSec);
    q.set("start", String(start));
    vid.src = `${location.pathname}?${q}`;
  }, true);
  document.body.appendChild(btn);
  btn.showPopover();
  // A video going fullscreen lands on top of the top layer, over Skip.
  document.addEventListener("fullscreenchange", () => {
    btn.hidePopover();
    btn.showPopover();
  });
})();
