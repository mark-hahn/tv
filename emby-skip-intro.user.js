// ==UserScript==
// @name         Emby Skip Intro Button
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Add skip intro button to Emby web player
// @author       You
// @match        http://hahnca.com:8920/*
// @match        https://hahnca.com:8920/*
// @match        http://192.168.1.*:8920/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // When opened with the intro UI (tvui=intro), the emby-ui.user.js overlay
  // owns the page — don't add the skip button on top of it.
  if (new URLSearchParams(location.search).get("tvui") === "intro") return;

  const TV_SRVR_URL = "https://hahnca.com/tv-srvr";
  let skipButton = null;
  let currentDeviceName = null;
  let autoSkipItemId = null; // Track which item was auto-trimmed
  let lastCheckedItemId = null;
  let currentTrimPos = null;
  let currentSkipDur = null;

  // Format a ms time position/duration as mmm:ss.t
  // - minutes (no hours) only shown when value >= 60s
  // - leading zero of seconds suppressed when value < 10s
  // - tenths always shown; 0 -> "--"; null/undefined -> ""
  function fmtPos(ms) {
    if (ms == null) return "";
    if (ms === 0) return "--";
    const totalSec = ms / 1000;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec - min * 60;
    const tenth = Math.floor((sec % 1) * 10);
    const wholeSec = Math.floor(sec);
    if (min > 0) {
      return `${min}:${String(wholeSec).padStart(2, "0")}.${tenth}`;
    }
    return `${wholeSec}.${tenth}`;
  }

  // Update button text with current info
  function updateButtonText(trimPos, skipDur) {
    if (!skipButton) return;
    skipButton.textContent = `${fmtPos(trimPos)} | ${fmtPos(skipDur)}`;
  }

  // Get the device name from Emby's API
  function getDeviceName() {
    // Try to get it from localStorage/sessionStorage where Emby stores client info
    const deviceId =
      localStorage.getItem("_deviceId") || sessionStorage.getItem("_deviceId");

    // Emby stores device name in various places, try to find it
    const storedDeviceName =
      localStorage.getItem("_deviceName") ||
      sessionStorage.getItem("_deviceName");

    if (storedDeviceName) {
      return storedDeviceName;
    }

    // Fallback: Emby uses format like "Firefox Windows", "Chrome Windows", etc.
    const browserName = navigator.userAgent.includes("Firefox")
      ? "Firefox"
      : navigator.userAgent.includes("Chrome")
        ? "Chrome"
        : navigator.userAgent.includes("Safari")
          ? "Safari"
          : "Browser";

    // Detect OS
    const os = navigator.userAgent.includes("Windows")
      ? "Windows"
      : navigator.userAgent.includes("Mac")
        ? "Mac"
        : navigator.userAgent.includes("Linux")
          ? "Linux"
          : "";

    return os ? `${browserName} ${os}` : browserName;
  }

  // Create the skip intro button
  function createSkipButton() {
    if (skipButton) return;

    skipButton = document.createElement("button");
    skipButton.id = "skip-intro-btn";
    skipButton.textContent = "-- | --";
    skipButton.style.cssText = `
            position: fixed;
            top: 5px;
            right: 60px;
            z-index: 99999;
            padding: 9px 18px;
            font-size: 12px;
            font-weight: bold;
            color: white;
            background: rgba(0, 0, 0, 0.8);
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 3px;
            cursor: pointer;
            display: none;
            box-shadow: 0 3px 5px rgba(0, 0, 0, 0.3);
            transition: all 0.2s;
        `;

    skipButton.addEventListener("mouseenter", () => {
      skipButton.style.background = "rgba(30, 30, 30, 0.9)";
      skipButton.style.borderColor = "rgba(255, 255, 255, 0.6)";
    });

    skipButton.addEventListener("mouseleave", () => {
      skipButton.style.background = "rgba(0, 0, 0, 0.8)";
      skipButton.style.borderColor = "rgba(255, 255, 255, 0.3)";
    });

    skipButton.addEventListener("click", async () => {
      const pressedAt = Date.now();
      currentDeviceName = getDeviceName();

      try {
        const response = await fetch(`${TV_SRVR_URL}/api/skipIntro`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pressedAt,
            deviceName: currentDeviceName,
          }),
        });

        const result = await response.json();

        if (result.ok) {
          skipButton.style.background = "rgba(0, 100, 0, 0.8)";
          setTimeout(() => {
            skipButton.style.background = "rgba(0, 0, 0, 0.8)";
          }, 2000);
        } else {
          const errorText =
            result.reason === "noSkipDur"
              ? "No Skip"
              : result.reason === "notPlaying"
                ? "Not Playing"
                : result.reason
                  ? result.reason
                  : "Error";
          skipButton.textContent = errorText;
          skipButton.style.background = "rgba(100, 0, 0, 0.8)";
          setTimeout(() => {
            skipButton.style.background = "rgba(0, 0, 0, 0.8)";
            updateButtonText(currentTrimPos, currentSkipDur);
          }, 2000);
        }
      } catch (error) {
        console.error("[Skip Intro] Fetch error:", error);
        skipButton.textContent = "Fetch Error";
        skipButton.style.background = "rgba(100, 0, 0, 0.8)";
        setTimeout(() => {
          skipButton.style.background = "rgba(0, 0, 0, 0.8)";
          updateButtonText(currentTrimPos, currentSkipDur);
        }, 2000);
      }
    });

    document.body.appendChild(skipButton);
  }

  // Check if video is playing
  function checkVideoPlaying() {
    const video = document.querySelector("video");
    const videoContainer = document.querySelector(".videoPlayerContainer");

    if (video && videoContainer && !video.paused) {
      createSkipButton();
      skipButton.style.display = "block";
      checkAutoSkip(video);
    } else if (skipButton) {
      skipButton.style.display = "none";
    }
  }

  // Get current playing item info from Emby API
  async function getCurrentPlayingInfo() {
    try {
      // Try multiple possible locations for the API key
      let apiKey = null;

      // Try Emby's global ApiClient object (most reliable)
      if (
        window.ApiClient &&
        typeof window.ApiClient.accessToken === "function"
      ) {
        try {
          apiKey = window.ApiClient.accessToken();
        } catch (e) {}
      }

      // Try ConnectionManager
      if (!apiKey && window.ConnectionManager) {
        try {
          const credentials = window.ConnectionManager.credentials();
          if (credentials?.Servers?.[0]?.AccessToken) {
            apiKey = credentials.Servers[0].AccessToken;
          }
        } catch (e) {}
      }

      // Try jellyfin_credentials
      if (!apiKey) {
        const jellyfinCreds = localStorage.getItem("jellyfin_credentials");
        if (jellyfinCreds) {
          try {
            apiKey = JSON.parse(jellyfinCreds)?.Servers?.[0]?.AccessToken;
          } catch (e) {}
        }
      }

      // Try emby_credentials
      if (!apiKey) {
        const embyCreds = localStorage.getItem("emby_credentials");
        if (embyCreds) {
          try {
            apiKey = JSON.parse(embyCreds)?.Servers?.[0]?.AccessToken;
          } catch (e) {}
        }
      }

      if (!apiKey) {
        return null;
      }

      const response = await fetch(
        `${window.location.origin}/emby/Sessions?api_key=${apiKey}`,
      );
      if (!response.ok) return null;

      const sessions = await response.json();
      currentDeviceName = getDeviceName();
      const session = sessions.find((s) => s.DeviceName === currentDeviceName);

      if (!session?.NowPlayingItem) return null;

      return {
        itemId: session.NowPlayingItem.Id,
        showName:
          session.NowPlayingItem.SeriesName || session.NowPlayingItem.Name,
        showId: session.NowPlayingItem.SeriesId || session.NowPlayingItem.Id,
        positionTicks: session.PlayState?.PositionTicks || 0,
      };
    } catch (error) {
      console.error("[Auto Skip] Error getting playing info:", error);
      return null;
    }
  }

  // Get trimPos and skipDur for current show
  async function getIntroInfo(showName, showId) {
    try {
      const response = await fetch(
        `${TV_SRVR_URL}/api/introDur?showName=${encodeURIComponent(showName)}&showId=${encodeURIComponent(showId)}`,
      );
      if (!response.ok) return { trimPos: null, skipDur: null };
      const result = await response.json();
      return { trimPos: result.trimPos, skipDur: result.skipDur };
    } catch (error) {
      console.error("[Auto Skip] Error getting intro info:", error);
      return { trimPos: null, skipDur: null };
    }
  }

  // Check if auto-trim should trigger
  async function checkAutoSkip(video) {
    const playingInfo = await getCurrentPlayingInfo();
    if (!playingInfo) return;

    // Reset auto-trim tracking when item changes
    if (playingInfo.itemId !== lastCheckedItemId) {
      lastCheckedItemId = playingInfo.itemId;
      autoSkipItemId = null;
      currentTrimPos = null;
      currentSkipDur = null;

      // Fetch intro info for new item
      const introInfo = await getIntroInfo(
        playingInfo.showName,
        playingInfo.showId,
      );
      currentTrimPos = introInfo.trimPos;
      currentSkipDur = introInfo.skipDur;
    }

    // Update button text with trimPos | skipDur
    updateButtonText(currentTrimPos, currentSkipDur);

    // Only auto-trim if trimPos > 0 and we haven't trimmed this item yet
    if (
      currentTrimPos != null &&
      currentTrimPos > 0 &&
      autoSkipItemId !== playingInfo.itemId
    ) {
      const positionMs = playingInfo.positionTicks / 10000;

      // Auto-trim when we're within 5 seconds of start and before trimPos
      if (positionMs < 5000 && positionMs < currentTrimPos) {
        autoSkipItemId = playingInfo.itemId;

        // Trigger trim (absolute seek to trimPos)
        try {
          await fetch(`${TV_SRVR_URL}/api/trimIntro`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              deviceName: currentDeviceName || getDeviceName(),
            }),
          });
        } catch (error) {
          console.error("[Auto Trim] Error:", error);
        }
      }
    }
  }

  // Monitor for video playback
  function monitorVideoPlayback() {
    setInterval(checkVideoPlaying, 1000);

    // Also listen for video events
    document.addEventListener("play", checkVideoPlaying, true);
    document.addEventListener("pause", checkVideoPlaying, true);
    document.addEventListener("ended", checkVideoPlaying, true);
  }

  // Initialize when page loads
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", monitorVideoPlayback);
  } else {
    monitorVideoPlayback();
  }

  console.log("[Emby Skip Intro] Userscript loaded");
})();
