// ==UserScript==
// @name         Emby Intro UI Overlay
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Intro editing overlay for the Emby web player (thin client; all logic on tv-srvr)
// @author       You
// @match        http://hahnca.com:8920/*
// @match        https://hahnca.com:8920/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  const WS_URL = "wss://hahnca.com/tv-srvr";

  // Only activate the intro overlay when the page was opened with tvui=intro.
  const uiId = new URLSearchParams(location.search).get("tvui");
  if (uiId !== "intro") return;

  // The Emby item id lives in the hash route: #!/item?id=<id>&serverId=...
  function getEmbyItemId() {
    const hash = location.hash || "";
    const q = hash.indexOf("?");
    if (q < 0) return null;
    return new URLSearchParams(hash.slice(q + 1)).get("id");
  }

  // Device name, matching how Emby labels this client's session.
  function getDeviceName() {
    const storedDeviceName =
      localStorage.getItem("_deviceName") ||
      sessionStorage.getItem("_deviceName");
    if (storedDeviceName) return storedDeviceName;
    const browserName = navigator.userAgent.includes("Firefox")
      ? "Firefox"
      : navigator.userAgent.includes("Chrome")
        ? "Chrome"
        : navigator.userAgent.includes("Safari")
          ? "Safari"
          : "Browser";
    const os = navigator.userAgent.includes("Windows")
      ? "Windows"
      : navigator.userAgent.includes("Mac")
        ? "Mac"
        : navigator.userAgent.includes("Linux")
          ? "Linux"
          : "";
    return os ? `${browserName} ${os}` : browserName;
  }

  let ws = null;
  const slots = {}; // textId -> element

  function send(fname, param) {
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({ fname, param }));
    } catch (e) {
      console.error("[embyUi] send error:", e);
    }
  }

  function press(btnId) {
    send("embyPress", { btnId, pressedAt: Date.now() });
  }

  // ---- Build the overlay ----------------------------------------------------
  let overlay = null;

  function makeBtn(label, btnId, opts = {}) {
    const el = document.createElement("div");
    el.textContent = label;
    if (opts.slot) slots[opts.slot] = el;
    el.style.cssText = `
      color: white;
      font-size: 13px;
      padding: 4px 8px;
      border-radius: 4px;
      border: 1px solid #666;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      flex-shrink: 0;
      text-align: center;
      background: ${opts.bg || "rgba(0,0,0,0.5)"};
      ${opts.width ? `width:${opts.width}px;min-width:${opts.width}px;` : ""}
      margin-right: ${opts.gap != null ? opts.gap : 6}px;
    `;
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      press(btnId);
    });
    return el;
  }

  function makeText(slot, opts = {}) {
    const el = document.createElement("div");
    if (slot) slots[slot] = el;
    el.style.cssText = `
      color: ${opts.color || "white"};
      font-size: 13px;
      user-select: none;
      white-space: nowrap;
      flex-shrink: 0;
      ${opts.minWidth ? `min-width:${opts.minWidth}px;text-align:right;` : ""}
      margin-right: ${opts.gap != null ? opts.gap : 8}px;
    `;
    return el;
  }

  function buildOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "emby-intro-overlay";
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 120px;
      width: calc(100vw - 120px);
      height: 55px;
      z-index: 99999;
      background: rgba(0, 0, 0, 1);
      display: flex;
      align-items: center;
      padding: 0 12px;
      box-sizing: border-box;
      overflow: hidden;
    `;

    // Title (flex-grows, ellipsis)
    const title = makeText("title", { gap: 12 });
    title.style.flex = "1";
    title.style.minWidth = "0";
    title.style.overflow = "hidden";
    title.style.textOverflow = "ellipsis";
    title.style.textShadow = "0 0 3px #000";
    title.style.fontSize = "16px";
    overlay.appendChild(title);

    // Live current time (read locally from the page <video>)
    const cur = makeText("curTime", { minWidth: 52, gap: 14 });
    cur.style.textShadow = "0 0 3px #000";
    overlay.appendChild(cur);

    // Navigation
    overlay.appendChild(makeBtn("0", "zero", { width: 40 }));
    overlay.appendChild(makeBtn("\u00ab", "back30"));
    overlay.appendChild(makeBtn("\u2039", "back10"));
    overlay.appendChild(makeBtn("\u203a", "fwd10"));
    overlay.appendChild(makeBtn("\u00bb", "fwd30", { gap: 20 }));

    // Trim (absolute)
    overlay.appendChild(
      makeBtn("\u00a0", "trimSet", {
        slot: "trim",
        bg: "rgba(0,80,0,0.6)",
        width: 74,
      }),
    );
    overlay.appendChild(
      makeBtn("Trim", "trimJump", { bg: "rgba(0,0,100,0.6)" }),
    );
    overlay.appendChild(
      makeBtn("Clr", "trimClr", { bg: "rgba(100,40,0,0.7)", gap: 20 }),
    );

    // Pre + start mark
    overlay.appendChild(makeBtn("Pre", "pre"));
    overlay.appendChild(
      makeBtn("\u00a0", "startMark", {
        slot: "startMark",
        bg: "rgba(0,80,0,0.6)",
        width: 74,
      }),
    );

    // Skip (relative to start mark)
    overlay.appendChild(
      makeBtn("\u00a0", "skipSet", {
        slot: "skip",
        bg: "rgba(80,0,0,0.6)",
        width: 74,
      }),
    );
    overlay.appendChild(
      makeBtn("Skip", "skipTest", { bg: "rgba(0,0,100,0.6)" }),
    );
    overlay.appendChild(
      makeBtn("Clr", "skipClr", { bg: "rgba(100,40,0,0.7)", gap: 20 }),
    );

    // Anticipating toggle
    overlay.appendChild(makeBtn("Ant", "ant", { slot: "ant", gap: 0 }));

    document.body.appendChild(overlay);
  }

  // ---- Server text pushes ---------------------------------------------------
  function applyText(textId, text) {
    const el = slots[textId];
    if (!el) return;
    el.textContent = text === "" ? "\u00a0" : text;
    if (textId === "ant") {
      el.style.background =
        text === "ANT" ? "rgba(180,50,50,0.9)" : "rgba(0,0,0,0.5)";
    }
  }

  // ---- Live current-time display (local <video>, display only) --------------
  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function tickCurrentTime() {
    const video = document.querySelector("video");
    const el = slots.curTime;
    if (video && el && !isNaN(video.currentTime)) {
      el.textContent = fmtTime(video.currentTime);
    }
    requestAnimationFrame(tickCurrentTime);
  }

  // ---- WebSocket ------------------------------------------------------------
  function hello() {
    send("embyHello", {
      uiId: "intro",
      deviceName: getDeviceName(),
      embyItemId: getEmbyItemId(),
    });
  }

  function connect() {
    ws = new WebSocket(WS_URL);
    ws.addEventListener("open", hello);
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg?.notification === "embyText" && msg.data) {
        applyText(msg.data.textId, msg.data.text);
      }
    });
    ws.addEventListener("close", () => {
      setTimeout(connect, 2000);
    });
    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {}
    });
  }

  function init() {
    if (!document.body) {
      setTimeout(init, 200);
      return;
    }
    buildOverlay();
    requestAnimationFrame(tickCurrentTime);
    connect();

    // Re-send hello when hash changes (user navigates to different item in same tab)
    let lastItemId = getEmbyItemId();
    window.addEventListener("hashchange", () => {
      const newItemId = getEmbyItemId();
      if (newItemId !== lastItemId) {
        lastItemId = newItemId;
        hello();
      }
    });
  }

  init();
})();
