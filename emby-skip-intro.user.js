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

  const TV_SRVR_URL = "https://hahnca.com/tv-srvr";
  let skipButton = null;
  let currentDeviceName = null;
  let autoSkipItemId = null; // Track which item was auto-skipped
  let lastCheckedItemId = null;
  let currentIntroDur = null;
  let currentStartMark = null;

  // Format milliseconds to mm:ss.t or mm:ss
  function formatTime(ms, showTenths = true) {
    const totalSec = ms / 1000;
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const secStr = showTenths ? sec.toFixed(1) : Math.floor(sec).toString();
    return `${min}:${secStr.padStart(showTenths ? 4 : 2, "0")}`;
  }

  // Update button text with current info
  function updateButtonText(startMark, introDur) {
    if (!skipButton) return;
    const durStr = introDur == null ? "--" : (introDur / 1000).toFixed(1);
    skipButton.textContent = `Intro:${durStr}`;
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
    skipButton.textContent = "Intro:0.0";
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
            result.reason === "noIntroDur"
              ? "No Intro"
              : result.reason === "notPlaying"
                ? "Not Playing"
                : result.reason
                  ? result.reason
                  : "Error";
          skipButton.textContent = errorText;
          skipButton.style.background = "rgba(100, 0, 0, 0.8)";
          setTimeout(() => {
            skipButton.style.background = "rgba(0, 0, 0, 0.8)";
            updateButtonText(currentStartMark, currentIntroDur);
          }, 2000);
        }
      } catch (error) {
        console.error("[Skip Intro] Fetch error:", error);
        skipButton.textContent = "Fetch Error";
        skipButton.style.background = "rgba(100, 0, 0, 0.8)";
        setTimeout(() => {
          skipButton.style.background = "rgba(0, 0, 0, 0.8)";
          updateButtonText(currentStartMark, currentIntroDur);
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

  // Get introDur and startMark for current show
  async function getIntroInfo(showName, showId) {
    try {
      const response = await fetch(
        `${TV_SRVR_URL}/api/introDur?showName=${encodeURIComponent(showName)}&showId=${encodeURIComponent(showId)}`,
      );
      if (!response.ok) return { introDur: null, startMark: null };
      const result = await response.json();
      return { introDur: result.introDur, startMark: result.startMark };
    } catch (error) {
      console.error("[Auto Skip] Error getting intro info:", error);
      return { introDur: null, startMark: null };
    }
  }

  // Check if auto-skip should trigger
  async function checkAutoSkip(video) {
    const playingInfo = await getCurrentPlayingInfo();
    if (!playingInfo) return;

    // Reset auto-skip tracking when item changes
    if (playingInfo.itemId !== lastCheckedItemId) {
      lastCheckedItemId = playingInfo.itemId;
      autoSkipItemId = null;
      currentIntroDur = null;
      currentStartMark = null;

      // Fetch intro info for new item
      const introInfo = await getIntroInfo(
        playingInfo.showName,
        playingInfo.showId,
      );
      currentIntroDur = introInfo.introDur;
      currentStartMark = introInfo.startMark;
    }

    // Update button text with intro start and end times
    updateButtonText(currentStartMark, currentIntroDur);

    // Only auto-skip if introDur is negative and we haven't skipped this item yet
    if (
      currentIntroDur != null &&
      currentIntroDur < 0 &&
      autoSkipItemId !== playingInfo.itemId
    ) {
      const positionMs = playingInfo.positionTicks / 10000;
      const introDurAbs = Math.abs(currentIntroDur);

      // Auto-skip when we're within 5 seconds of start and before the intro end
      if (positionMs < 5000 && positionMs < introDurAbs) {
        autoSkipItemId = playingInfo.itemId;

        // Trigger skip
        const pressedAt = Date.now();
        try {
          const response = await fetch(`${TV_SRVR_URL}/api/skipIntro`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              pressedAt,
              deviceName: currentDeviceName || getDeviceName(),
            }),
          });

          const result = await response.json();
        } catch (error) {
          console.error("[Auto Skip] Error:", error);
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
