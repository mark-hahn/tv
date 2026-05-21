<template>
  <div
    id="tvPane"
    style="
      padding: 0;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      position: relative;
    "
  >
    <!-- Lock pane overlay -->
    <div
      v-if="locked"
      style="
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: white;
        z-index: 10;
        display: flex;
        flex-direction: column;
        border: 3px solid #000;
        box-sizing: border-box;
      "
    >
      <div
        style="
          padding: 8px 10px;
          font-size: 28px;
          font-weight: bold;
          flex-shrink: 0;
        "
      >
        Remote Collision
      </div>
      <div
        style="
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          text-align: center;
          font-size: 24px;
          font-weight: bold;
        "
      >
        A remote collision has been detected and the remote has been locked.
        Press and hold unlock button to continue.
      </div>
      <div
        @mousedown.prevent="startUnlockHold"
        @mouseup="stopUnlockHold"
        @mouseleave="stopUnlockHold"
        @touchstart.prevent="startUnlockHold"
        @touchend="stopUnlockHold"
        style="
          background: lightgreen;
          border-top: 3px solid #000;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 26px;
          font-weight: bold;
          cursor: pointer;
          flex-shrink: 0;
          height: 20%;
          user-select: none;
        "
      >
        Unlock
      </div>
    </div>
    <!-- Streamers pane -->
    <div
      v-else-if="showStreamers"
      style="
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #111;
      "
    >
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 2px solid #333;
        "
      >
        <span style="color: #fff; font-size: 20px; font-weight: bold"
          >Streaming Services</span
        >
        <button
          @mousedown.prevent="showStreamers = false"
          @touchstart.prevent="showStreamers = false"
          :style="{
            '--btn-bg': '#111',
            border: 'none',
            color: '#fff',
            fontSize: '28px',
            cursor: 'pointer',
            padding: '4px 8px',
            lineHeight: '1',
          }"
        >
          ✕
        </button>
      </div>
      <div style="overflow-y: auto; flex: 1; padding: 8px">
        <div style="display: flex; gap: 8px; margin-bottom: 8px">
          <button
            v-for="svc in services
              .filter((s) =>
                ['Netflix', 'Prime Video', 'HBO Max'].includes(s.name),
              )
              .sort(
                (a, b) =>
                  ['Netflix', 'Prime Video', 'HBO Max'].indexOf(a.name) -
                  ['Netflix', 'Prime Video', 'HBO Max'].indexOf(b.name),
              )"
            :key="'pin-' + svc.name"
            @pointerdown="flashSvcName('pin-' + svc.name)"
            @click="openApp(svc)"
            :style="{
              '--btn-bg':
                flashSvc === 'pin-' + svc.name ? 'lightblue' : 'white',
              flex: '1',
              boxSizing: 'border-box',
              padding: '10px 8px',
              border: '1px solid #ccc',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
            }"
          >
            <img
              :src="'logos/' + svc.logo"
              :alt="svc.name"
              style="
                width: 72px;
                height: 72px;
                object-fit: contain;
                border-radius: 6px;
              "
            />
            <span
              style="
                color: #000;
                font-size: 21px;
                text-align: center;
                word-break: break-word;
              "
              >{{ svc.name }}</span
            >
          </button>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px">
          <button
            v-for="svc in services"
            :key="svc.name"
            @pointerdown="flashSvcName(svc.name)"
            @click="openApp(svc)"
            :style="{
              '--btn-bg': flashSvc === svc.name ? 'lightblue' : 'white',
              width: 'calc(33.333% - 6px)',
              boxSizing: 'border-box',
              padding: '10px 8px',
              border: '1px solid #ccc',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
            }"
          >
            <img
              :src="'logos/' + svc.logo"
              :alt="svc.name"
              style="
                width: 72px;
                height: 72px;
                object-fit: contain;
                border-radius: 6px;
              "
            />
            <span
              style="
                color: #000;
                font-size: 21px;
                text-align: center;
                word-break: break-word;
              "
              >{{ svc.name }}</span
            >
          </button>
        </div>
      </div>
    </div>
    <!-- SubCtrl pane -->
    <div
      v-else-if="showSubCtrl"
      style="
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #fff;
      "
    >
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 2px solid #ccc;
        "
      >
        <span
          style="
            font-size: 18px;
            font-weight: bold;
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;
          "
          @mousedown.prevent="subCyclePlayer"
          @touchstart.prevent="subCyclePlayer"
          >{{ subCurrentLabel }}</span
        >
      </div>
      <div style="overflow-y: auto; flex: 1">
        <div
          v-if="!subCurrentPlayer"
          style="padding: 16px; color: #666"
        >
          No video playing
        </div>
        <template v-else-if="subCurrentPlayer.deviceName !== 'Living Room TV'">
          <div style="padding: 16px; color: #666">
            Only the Living Room TV is supported
          </div>
        </template>
        <template v-else>
          <div
            @mousedown.prevent="subSelectTrack(-1)"
            @touchstart.prevent="subSelectTrack(-1)"
            :style="{
              padding: '10px 14px',
              borderBottom: '1px solid #eee',
              cursor: 'pointer',
              fontSize: '17px',
              fontWeight:
                subCurrentPlayer.subtitleStreamIndex === -1 ? 'bold' : 'normal',
              backgroundColor:
                subCurrentPlayer.subtitleStreamIndex === -1
                  ? '#d0e8ff'
                  : '#fff',
            }"
          >
            None
          </div>
          <div
            v-for="sub in subCurrentPlayer.subtitles"
            :key="sub.index"
            @mousedown.prevent="subSelectTrack(sub.index)"
            @touchstart.prevent="subSelectTrack(sub.index)"
            :style="{
              padding: '10px 14px',
              borderBottom: '1px solid #eee',
              cursor: 'pointer',
              fontSize: '17px',
              fontWeight:
                subCurrentPlayer.subtitleStreamIndex === sub.index
                  ? 'bold'
                  : 'normal',
              backgroundColor:
                subCurrentPlayer.subtitleStreamIndex === sub.index
                  ? '#d0e8ff'
                  : '#fff',
            }"
          >
            {{ sub.label }}
          </div>
        </template>
      </div>
      <div
        @mousedown.prevent="subClose"
        @touchstart.prevent="subClose"
        style="
          background: lightgreen;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 26px;
          font-weight: bold;
          cursor: pointer;
          flex-shrink: 0;
          height: 20%;
          user-select: none;
        "
      >
        Close
      </div>
    </div>
    <!-- Picture settings pane -->
    <div
      v-else-if="showPicCtrl"
      style="
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #fff;
      "
    >
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 2px solid #ccc;
          flex-shrink: 0;
        "
      >
        <span style="font-size: 20px; font-weight: bold">Picture Settings</span>
        <button
          @mousedown.prevent="closePicCtrl"
          @touchstart.prevent="closePicCtrl"
          :style="{
            '--btn-bg': '#fff',
            border: 'none',
            fontSize: '28px',
            cursor: 'pointer',
            padding: '4px 8px',
            lineHeight: '1',
          }"
        >
          ✕
        </button>
      </div>
      <div style="overflow-y: auto; flex: 1">
        <div
          v-for="s in picSettings"
          :key="s.target"
          style="
            display: flex;
            align-items: center;
            padding: 10px 16px;
            border-bottom: 1px solid #eee;
            gap: 8px;
          "
        >
          <div style="flex: 1; display: flex; flex-direction: column; gap: 2px">
            <span style="font-size: 18px; font-weight: bold">{{
              s.label
            }}</span>
            <span
              v-if="s.type === 'range'"
              style="font-size: 16px; color: #000"
              >{{ s.min }}–{{ s.max }}</span
            >
          </div>
          <button
            @mousedown.prevent="picAdjust(s, -1)"
            @touchstart.prevent="picAdjust(s, -1)"
            :style="{
              '--btn-bg': 'whitesmoke',
              fontSize: '20px',
              padding: '6px 14px',
              border: '1px solid #bbb',
              cursor: 'pointer',
            }"
          >
            ▼
          </button>
          <input
            v-if="s.type === 'range'"
            :value="picInputVal(s)"
            @keydown="picKeydown($event, s)"
            @blur="picBlur($event, s)"
            style="
              width: 72px;
              text-align: center;
              font-size: 18px;
              font-weight: bold;
              border: 1px solid #bbb;
              padding: 4px 2px;
              background: #fff;
            "
          />
          <span
            v-else
            style="
              min-width: 72px;
              text-align: center;
              font-size: 18px;
              font-weight: bold;
            "
            >{{ s.value }}</span
          >
          <button
            @mousedown.prevent="picAdjust(s, +1)"
            @touchstart.prevent="picAdjust(s, +1)"
            :style="{
              '--btn-bg': 'whitesmoke',
              fontSize: '20px',
              padding: '6px 14px',
              border: '1px solid #bbb',
              cursor: 'pointer',
            }"
          >
            ▲
          </button>
        </div>
      </div>
    </div>
    <div
      v-else
      style="
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        grid-template-rows: repeat(5, 1fr);
        border-top: 3px solid #000;
        border-left: 3px solid #000;
        height: 100%;
      "
    >
      <!-- Row 1: back, up, home -->
      <div
        :style="cellStyle('white', 'back')"
        @mousedown="startBackHold"
        @mouseup="stopBackHold"
        @mouseleave="stopBackHold"
        @touchstart.prevent="startBackHold"
        @touchend="stopBackHold"
      >
        ↩
      </div>
      <div
        :style="cellStyle('#f5e642', 'up')"
        @mousedown="startRepeat('up')"
        @mouseup="stopRepeat"
        @mouseleave="stopRepeat"
        @touchstart.prevent="startRepeat('up')"
        @touchend="stopRepeat"
      >
        ▲
      </div>
      <div
        :style="cellStyle('white', 'home')"
        @mousedown="startHomeHold"
        @mouseup="stopHomeHold"
        @mouseleave="stopHomeHold"
        @touchstart.prevent="startHomeHold"
        @touchend="stopHomeHold"
      >
        <svg
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
        </svg>
      </div>
      <!-- Row 2: left, ok, right -->
      <div
        :style="cellStyle('#f5e642', 'left')"
        @mousedown="startRepeat('left')"
        @mouseup="stopRepeat"
        @mouseleave="stopRepeat"
        @touchstart.prevent="startRepeat('left')"
        @touchend="stopRepeat"
      >
        ◀
      </div>
      <div
        :style="cellStyle('lightgreen', 'ok')"
        @mousedown="startOkHold"
        @mouseup="stopOkHold"
        @mouseleave="stopOkHold"
        @touchstart.prevent="startOkHold"
        @touchend="stopOkHold"
      >
        OK
      </div>
      <div
        :style="cellStyle('#f5e642', 'right')"
        @mousedown="startRepeat('right')"
        @mouseup="stopRepeat"
        @mouseleave="stopRepeat"
        @touchstart.prevent="startRepeat('right')"
        @touchend="stopRepeat"
      >
        ▶
      </div>
      <!-- Row 3: emby, down, skip -->
      <div
        :style="cellStyle('white', 'emby')"
        @mousedown="startEmbyHold"
        @mouseup="stopEmbyHold"
        @mouseleave="stopEmbyHold"
        @touchstart.prevent="startEmbyHold"
        @touchend="stopEmbyHold"
      >
        Emby
      </div>
      <div
        :style="cellStyle('#f5e642', 'down')"
        @mousedown="startRepeat('down')"
        @mouseup="stopRepeat"
        @mouseleave="stopRepeat"
        @touchstart.prevent="startRepeat('down')"
        @touchend="stopRepeat"
      >
        ▼
      </div>
      <div
        :style="cellStyle('white', 'skip')"
        @mousedown="startSkipHold"
        @mouseup="stopSkipHold"
        @mouseleave="stopSkipHold"
        @touchstart.prevent="startSkipHold"
        @touchend="stopSkipHold"
      >
        Skip
      </div>
      <!-- Row 4: vol-, vol+, mute -->
      <div
        :style="cellStyle('lightgreen', 'vold')"
        @mousedown="startVolDownHold"
        @mouseup="stopVolDownHold"
        @mouseleave="stopVolDownHold"
        @touchstart.prevent="startVolDownHold"
        @touchend="stopVolDownHold"
      >
        Vol-
      </div>
      <div
        :style="cellStyle('lightgreen', 'volu')"
        @mousedown="startVolUpHold"
        @mouseup="stopVolUpHold"
        @mouseleave="stopVolUpHold"
        @touchstart.prevent="startVolUpHold"
        @touchend="stopVolUpHold"
      >
        Vol+
      </div>
      <div
        :style="muteCellStyle"
        @mousedown="startMuteHold"
        @mouseup="stopMuteHold"
        @mouseleave="stopMuteHold"
        @touchstart.prevent="startMuteHold"
        @touchend="stopMuteHold"
      >
        Mute
      </div>
      <!-- Row 5: subs, apps, google -->
      <div
        :style="cellStyle('white', 'subs')"
        @mousedown="startSubsHold"
        @mouseup="stopSubsHold"
        @mouseleave="stopSubsHold"
        @touchstart.prevent="startSubsHold"
        @touchend="stopSubsHold"
      >
        Subs
      </div>
      <div
        :style="cellStyle('white', 'stream')"
        @mousedown="startAppsHold"
        @mouseup="stopAppsHold"
        @mouseleave="stopAppsHold"
        @touchstart.prevent="startAppsHold"
        @touchend="stopAppsHold"
      >
        Apps
      </div>
      <div
        :style="modeBtnStyle('google')"
        @mousedown="startGoogleHold"
        @mouseup="stopGoogleHold"
        @mouseleave="stopGoogleHold"
        @touchstart.prevent="startGoogleHold"
        @touchend="stopGoogleHold"
      >
        Google
      </div>
    </div>
  </div>
</template>

<script>
import { config } from "../config.js";
import evtBus from "../evtBus.js";
import { wsSend } from "../srvr.js";
import allServices from "../../../tv/services.json";

const SCRUB_INTERVAL_FWD = 0.5; // seconds — interval for forward scrub
const SCRUB_INTERVAL_BWD = 1.0; // seconds — interval for backward scrub
const SCRUB_DIST = 10; // seconds — jump distance per seek
const TVPANE_VERSION = 2;

const CELL_BASE = {
  borderRight: "3px solid #000",
  borderBottom: "3px solid #000",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  fontSize: "42px",
  fontWeight: "bold",
  userSelect: "none",
};

export default {
  name: "TvPane",

  data() {
    return {
      muted: false,
      flashBtn: null,
      haState: null,
      mediaTitle: null,
      showStreamers: false,
      flashSvc: null,
      showSubCtrl: false,
      subPlayers: [],
      subDeviceName: null,
      avoidingCollisions: false,
      locked: false,
      showPicCtrl: false,
      picSettings: [],
      picInputs: {}, // target -> { typing: bool, raw: string }
    };
  },

  computed: {
    subCurrentPlayer() {
      return (
        this.subPlayers.find(
          (p) => (p.deviceName || p.sessionId) === this.subDeviceName,
        ) ?? null
      );
    },
    subCurrentLabel() {
      const p = this.subCurrentPlayer;
      if (!p) return this.subDeviceName ? "---" : "No video playing";
      let base = p.episodeCode ? `${p.showName} ${p.episodeCode}` : p.showName;
      if (p.deviceName) base += ` (${p.deviceName})`;
      return base;
    },
    muteCellStyle() {
      const bg =
        this.flashBtn === "mute"
          ? "orange"
          : !this.isOff && this.muted
            ? "#ffb3b3"
            : "lightgreen";
      return { ...CELL_BASE, backgroundColor: bg };
    },
    mode() {
      const on =
        this.haState &&
        this.haState !== "off" &&
        this.haState !== "unavailable" &&
        this.haState !== "unknown";
      if (!on) return "off";
      if (this.mediaTitle === "Smart TV") return "google";
      if (this.mediaTitle === "TV") return "tv";
      if (this.mediaTitle === "Fire TV Stick" || this.mediaTitle === "HDMI 2")
        return "fire";
      return "other";
    },
    services() {
      return allServices[this.mode] ?? [];
    },
    isOff() {
      return this.mode === "off";
    },
    isOther() {
      return this.mode === "other";
    },
    offBtnStyle() {
      const bg =
        this.flashBtn === "off" ? "orange" : this.isOff ? "lightblue" : "white";
      return { ...CELL_BASE, backgroundColor: bg };
    },
  },

  mounted() {
    console.log(`[tvpane] version ${TVPANE_VERSION}`);
    this.pollMute();
    evtBus.on("tvMuteState", this._onTvMuteState);
    evtBus.on("paneChanged", this._onPaneChanged);
    evtBus.on("tvRemoteAction", this._onTvRemoteAction);
    evtBus.on("tvRemoteLock", this._onTvRemoteLock);
    evtBus.on("tvRemoteUnlock", this._onTvRemoteUnlock);
  },

  beforeUnmount() {
    evtBus.off("tvMuteState", this._onTvMuteState);
    evtBus.off("paneChanged", this._onPaneChanged);
    evtBus.off("tvRemoteAction", this._onTvRemoteAction);
    evtBus.off("tvRemoteLock", this._onTvRemoteLock);
    evtBus.off("tvRemoteUnlock", this._onTvRemoteUnlock);
    this.stopRepeat();
    this.stopHold();
    clearTimeout(this._lpDebounceTimer);
    clearTimeout(this._lpLongTimer);
    this._lp = null;
    clearTimeout(this._dbTimer);
    this._db = null;
    clearTimeout(this._googleTimer);
    clearInterval(this._subPollTimer);
    clearTimeout(this._avoidTimer);
    clearTimeout(this._unlockHoldTimer);
  },

  methods: {
    notifyAction(fromSubCtrl = false) {
      console.log(
        `[collision] notifyAction sending tvRemoteAction fromSubCtrl=${fromSubCtrl}`,
      );
      wsSend({ fname: "tvRemoteAction", param: { fromSubCtrl } });
    },

    checkBlocked() {
      console.log(
        `[collision] checkBlocked locked=${this.locked} avoiding=${this.avoidingCollisions}`,
      );
      if (this.locked) return true;
      if (this.avoidingCollisions) {
        console.log(
          `[collision] checkBlocked -> BLOCKED (avoidingCollisions), sending tvRemoteCollision`,
        );
        wsSend({ fname: "tvRemoteCollision" });
        return true;
      }
      return false;
    },

    _onTvRemoteAction(data) {
      console.log(
        `[collision] _onTvRemoteAction received, entering avoidance 5s`,
        data,
      );
      const fromSubCtrl = data?.fromSubCtrl ?? false;
      this.avoidingCollisions = true;
      clearTimeout(this._avoidTimer);
      this._avoidTimer = setTimeout(
        () => {
          this.avoidingCollisions = false;
        },
        fromSubCtrl ? 5000 : 1500,
      );
    },

    _onTvRemoteLock() {
      console.log(`[collision] _onTvRemoteLock received, setting locked=true`);
      this.locked = true;
    },

    _onTvRemoteUnlock() {
      console.log(
        `[collision] _onTvRemoteUnlock received, setting locked=false`,
      );
      this.locked = false;
    },

    startUnlockHold() {
      this._unlockHoldTimer = setTimeout(() => {
        this.locked = false;
        wsSend({ fname: "tvRemoteUnlock" });
      }, 500);
    },

    stopUnlockHold() {
      clearTimeout(this._unlockHoldTimer);
    },

    startRepeat(key) {
      console.log(
        `[scrub] startRepeat key=${key} isOff=${this.isOff} isOther=${this.isOther}`,
      );
      if (this.isOff || this.isOther) return;
      if (this.checkBlocked()) return;
      if (!this._debounce()) return;
      this.flash(key);
      this.notifyAction();
      this._repeatActive = true;
      this._pendingLRKey = null;
      const isLR = key === "left" || key === "right";
      (async () => {
        if (!isLR) {
          await fetch(`${config.tvTvUrl}/tv/key/${key}`).catch(() => {});
          if (!this._repeatActive) {
            console.log(`[scrub] stopped after initial key`);
            return;
          }
        } else {
          this._pendingLRKey = key;
        }
        console.log(`[scrub] isLR=${isLR}, waiting 400ms`);
        await new Promise((r) => {
          this._repeatTimer = setTimeout(r, 400);
        });
        if (!this._repeatActive) {
          console.log(`[scrub] stopped after 400ms wait`);
          return;
        }
        if (isLR) {
          this._pendingLRKey = null; // long press — key will not be sent on release
          const distTicks =
            (key === "right" ? 1 : -1) * SCRUB_DIST * 10_000_000;
          const intervalMs =
            (key === "right" ? SCRUB_INTERVAL_FWD : SCRUB_INTERVAL_BWD) * 1000;
          console.log(
            `[scrub] calling scrub/start distTicks=${distTicks} intervalMs=${intervalMs}`,
          );
          const startRes = await fetch(
            `${config.tvTvUrl}/tv/emby/scrub/start`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ intervalMs, distTicks }),
            },
          )
            .then((r) => r.json())
            .catch((e) => {
              console.log(`[scrub] scrub/start fetch error: ${e.message}`);
              return { ok: false };
            });
          console.log(
            `[scrub] scrub/start result: ${JSON.stringify(startRes)}`,
          );
          if (startRes.ok) {
            this._scrubbing = true;
            this._scrubPingTimer = setInterval(() => {
              fetch(`${config.tvTvUrl}/tv/emby/scrub/ping`, {
                method: "POST",
              }).catch(() => {});
            }, 500);
            return;
          }
          // Emby not playing — fall through to normal key repeat
          console.log(`[scrub] not playing, falling through to key repeat`);
        }
        let count = 0;
        while (this._repeatActive) {
          const isFast = count >= 2;
          const n =
            this.mode === "fire" && key === "left"
              ? isFast
                ? 9
                : 1
              : isFast && this.mode === "fire"
                ? 3
                : 1;
          const url =
            n > 1
              ? `${config.tvTvUrl}/tv/key/${key}?n=${n}`
              : `${config.tvTvUrl}/tv/key/${key}`;
          await fetch(url).catch(() => {});
          if (!this._repeatActive) break;
          const FAST_REPEAT_MS = 100;
          const delay =
            this.mode === "fire"
              ? (count++, 0)
              : count++ < 2
                ? 500
                : FAST_REPEAT_MS;
          await new Promise((r) => {
            this._repeatTimer = setTimeout(r, delay);
          });
        }
      })();
    },

    startRepeatCmd(flashKey, cmd) {
      if (this._repeatActive) return;
      this.flash(flashKey);
      this._repeatActive = true;
      (async () => {
        while (this._repeatActive) {
          await fetch(`${config.tvTvUrl}/tv/${cmd}`).catch(() => {});
        }
      })();
    },

    stopRepeat() {
      console.log(`[scrub] stopRepeat _scrubbing=${this._scrubbing}`);
      this._repeatActive = false;
      clearTimeout(this._repeatTimer);
      if (this._scrubbing) {
        this._scrubbing = false;
        clearInterval(this._scrubPingTimer);
        this._scrubPingTimer = null;
        fetch(`${config.tvTvUrl}/tv/emby/scrub/stop`, { method: "POST" }).catch(
          () => {},
        );
      } else if (this._pendingLRKey) {
        // Short press on left/right — send key on release
        fetch(`${config.tvTvUrl}/tv/key/${this._pendingLRKey}`).catch(() => {});
      }
      this._pendingLRKey = null;
    },

    startHold(action) {
      this._holdTimer = setTimeout(action, 400);
    },

    stopHold() {
      clearTimeout(this._holdTimer);
    },

    // Shared long-press helper: 70ms debounce then short, 400ms then long
    _lpStart(shortAction, longAction) {
      clearTimeout(this._lpDebounceTimer);
      clearTimeout(this._lpLongTimer);
      this._lp = { shortAction, longAction, phase: 0 };
      this._lpDebounceTimer = setTimeout(() => {
        if (this._lp) this._lp.phase = 1;
      }, 70);
      this._lpLongTimer = setTimeout(() => {
        if (!this._lp) return;
        const lp = this._lp;
        this._lp = null;
        lp.longAction?.();
      }, 400);
    },

    _lpStop() {
      if (!this._lp) return;
      const lp = this._lp;
      clearTimeout(this._lpDebounceTimer);
      clearTimeout(this._lpLongTimer);
      this._lp = null;
      if (lp.phase === 0) return;
      if (lp.phase === 1) lp.shortAction?.();
    },

    // Shared simple debounce helper: 70ms then action, no long-press
    _dbStart(action) {
      clearTimeout(this._dbTimer);
      this._db = { action };
      this._dbTimer = setTimeout(() => {
        if (!this._db) return;
        const a = this._db.action;
        this._db = null;
        a?.();
      }, 70);
    },

    _dbStop() {
      if (!this._db) return;
      clearTimeout(this._dbTimer);
      this._db = null;
    },

    startBackHold() {
      this._dbStart(() => this.tvKey("back"));
    },
    stopBackHold() {
      this._dbStop();
    },

    startHomeHold() {
      this._dbStart(() => this.tvKey("home"));
    },
    stopHomeHold() {
      this._dbStop();
    },

    startOkHold() {
      this.stopRepeat();
      this._dbStart(() => this.tvKey("ok"));
    },
    stopOkHold() {
      this._dbStop();
    },

    startEmbyHold() {
      this._lpStart(
        () => this.tvCmd("emby"),
        () => {
          this.flash("emby");
          this.showStreamers = true;
        },
      );
    },
    stopEmbyHold() {
      this._lpStop();
    },

    startMuteHold() {
      this._dbStart(() => this.tvCmd("mute"));
    },
    stopMuteHold() {
      this._dbStop();
    },

    startSubsHold() {
      this._dbStart(() => this.openSubCtrl());
    },
    stopSubsHold() {
      this._dbStop();
    },

    startGoogleHold() {
      this._googleTimer = setTimeout(() => this.googleBtn(), 400);
    },
    stopGoogleHold() {
      clearTimeout(this._googleTimer);
    },

    startVolDownHold() {
      this._lpStart(
        () => this.tvVolCmd("down"),
        () => {
          this.flash("vold");
          this.openPicCtrl();
        },
      );
    },

    stopVolDownHold() {
      this._lpStop();
    },

    startVolUpHold() {
      this._lpStart(
        () => this.tvVolCmd("up"),
        () => {
          this.flash("volu");
          this.openSubCtrl();
        },
      );
    },

    stopVolUpHold() {
      this._lpStop();
    },

    openPicCtrl() {
      this.showPicCtrl = true;
      this.fetchPicSettings();
      this._picPollTimer = setInterval(() => this.fetchPicSettings(), 3000);
    },

    closePicCtrl() {
      clearInterval(this._picPollTimer);
      this.showPicCtrl = false;
    },

    async fetchPicSettings() {
      try {
        const data = await fetch(`${config.tvTvUrl}/tv/picture`).then((r) =>
          r.json(),
        );
        if (data.ok) {
          this.picSettings = data.settings;
          // clear typing state for any setting that was updated
          for (const s of data.settings) {
            const inp = this.picInputs[s.target];
            if (inp && inp.typing) continue; // don't override while user is typing
            this.picInputs[s.target] = { typing: false, raw: s.value };
          }
        }
      } catch (_) {}
    },

    picInputVal(s) {
      return this.picInputs[s.target]?.raw ?? s.value;
    },

    picKeydown(e, s) {
      const inp = this.picInputs[s.target] ?? { typing: false, raw: s.value };
      const key = e.key;

      if (key === "Enter") {
        e.preventDefault();
        this._commitPicInput(s).then(() => e.target.blur());
        return;
      }
      if (key === "Escape") {
        this.picInputs = {
          ...this.picInputs,
          [s.target]: { typing: false, raw: s.value },
        };
        e.target.blur();
        return;
      }
      if (key === "Backspace") {
        const next = inp.typing ? inp.raw.slice(0, -1) || "0" : "0";
        this.picInputs = {
          ...this.picInputs,
          [s.target]: { typing: true, raw: next },
        };
        this._schedulePicCommit(s);
        e.preventDefault();
        return;
      }
      if (!/^[0-9\-]$/.test(key)) {
        e.preventDefault();
        return;
      }

      let next;
      if (!inp.typing) {
        // first digit replaces current value
        next = key === "-" ? "-" : key;
      } else {
        next = inp.raw + key;
      }
      this.picInputs = {
        ...this.picInputs,
        [s.target]: { typing: true, raw: next },
      };
      this._schedulePicCommit(s);
      e.preventDefault();
    },

    picBlur(e, s) {
      this._commitPicInput(s);
    },

    _schedulePicCommit(s) {
      clearTimeout(this._picCommitTimers?.[s.target]);
      if (!this._picCommitTimers) this._picCommitTimers = {};
      this._picCommitTimers[s.target] = setTimeout(
        () => this._commitPicInput(s),
        750,
      );
    },

    async _commitPicInput(s) {
      clearTimeout(this._picCommitTimers?.[s.target]);
      const inp = this.picInputs[s.target];
      if (!inp || !inp.typing) return;
      const num = Number(inp.raw);
      if (isNaN(num) || num < s.min || num > s.max) {
        // invalid — revert
        this.picInputs = {
          ...this.picInputs,
          [s.target]: { typing: false, raw: s.value },
        };
        return;
      }
      const newVal = String(Math.round(num));
      this.picInputs = {
        ...this.picInputs,
        [s.target]: { typing: false, raw: newVal },
      };
      try {
        await fetch(`${config.tvTvUrl}/tv/picture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: s.target, value: newVal }),
        });
      } catch (_) {}
      await this.fetchPicSettings();
    },

    async picAdjust(setting, dir) {
      const newVal = this.picNextValue(setting, dir);
      if (newVal === null) return;
      this.picInputs = {
        ...this.picInputs,
        [setting.target]: { typing: false, raw: newVal },
      };
      try {
        await fetch(`${config.tvTvUrl}/tv/picture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: setting.target, value: newVal }),
        });
      } catch (_) {}
      await this.fetchPicSettings();
    },

    picNextValue(setting, dir) {
      if (setting.type === "range") {
        const v = Number(setting.value) + dir * setting.step;
        if (v < setting.min || v > setting.max) return null;
        return String(v);
      } else {
        const idx = setting.options.indexOf(setting.value);
        if (idx < 0)
          return dir > 0
            ? setting.options[0]
            : setting.options[setting.options.length - 1];
        const next = idx + dir;
        if (next < 0 || next >= setting.options.length) return null;
        return setting.options[next];
      }
    },

    startAppsHold() {
      this._lpStart(
        () => {
          this.flash("stream");
          this.showStreamers = true;
        },
        () => {
          this.flash("stream");
          this.fireBtn();
        },
      );
    },

    stopAppsHold() {
      this._lpStop();
    },

    startSkipHold() {
      const pressedAt = Date.now();
      this._dbStart(() => {
        this.flash("skip");
        fetch(`${config.tvSrvrUrl}/api/skipIntro`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pressedAt }),
        }).catch(() => {});
      });
    },

    stopSkipHold() {
      this._dbStop();
    },

    async fetchSubPlayers() {
      try {
        const data = await fetch(`${config.tvTvUrl}/tv/emby/playing`).then(
          (r) => r.json(),
        );
        if (data.ok) {
          this.subPlayers = data.playing;
          if (
            !this.subDeviceName ||
            !data.playing.find(
              (p) => (p.deviceName || p.sessionId) === this.subDeviceName,
            )
          ) {
            const lrtv = data.playing.find(
              (p) => p.deviceName === "Living Room TV",
            );
            this.subDeviceName = lrtv
              ? lrtv.deviceName
              : (data.playing[0]?.deviceName ??
                data.playing[0]?.sessionId ??
                null);
          }
        }
      } catch (_) {}
    },

    async openSubCtrl() {
      this.showSubCtrl = true;
      await this.fetchSubPlayers();
      this._subPollTimer = setInterval(() => this.fetchSubPlayers(), 3000);
    },

    subClose() {
      clearInterval(this._subPollTimer);
      this.showSubCtrl = false;
    },

    subCyclePlayer() {
      if (this.subPlayers.length === 0) return;
      const cur = this.subPlayers.findIndex(
        (p) => (p.deviceName || p.sessionId) === this.subDeviceName,
      );
      const next = (cur + 1) % this.subPlayers.length;
      this.subDeviceName =
        this.subPlayers[next].deviceName || this.subPlayers[next].sessionId;
    },

    async subSelectTrack(index) {
      const player = this.subPlayers.find(
        (p) => (p.deviceName || p.sessionId) === this.subDeviceName,
      );
      if (!player) return;
      if (this.checkBlocked()) return;
      this.notifyAction(true);
      // optimistic update
      this.subPlayers = this.subPlayers.map((p) =>
        (p.deviceName || p.sessionId) === this.subDeviceName
          ? { ...p, subtitleStreamIndex: index }
          : p,
      );
      clearInterval(this._subPollTimer);
      let waitMs = 5000;
      try {
        const res = await fetch(`${config.tvTvUrl}/tv/emby/subtitle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: player.sessionId, index }),
        });
        const data = await res.json();
        if (data.waitMs) waitMs = data.waitMs;
      } catch (_) {}
      await new Promise((r) => setTimeout(r, waitMs));
      await this.fetchSubPlayers();
      this._subPollTimer = setInterval(() => this.fetchSubPlayers(), 3000);
    },

    modeBtnStyle(m) {
      let bg;
      if (this.flashBtn === m) bg = "orange";
      else if (this.mode === m) bg = "lightblue";
      else if (m === "google" && this.mode === "tv") bg = "#ffb3c1";
      else bg = "white";
      return { ...CELL_BASE, backgroundColor: bg };
    },

    cellStyle(bg, key = null) {
      const flashActive = key && this.flashBtn === key;
      return { ...CELL_BASE, backgroundColor: flashActive ? "orange" : bg };
    },

    flash(btn) {
      this.flashBtn = btn;
      setTimeout(() => {
        this.flashBtn = null;
      }, 300);
    },

    async googleBtn() {
      if (this.checkBlocked()) return;
      if (this.mode === "google") {
        this.tvCmd("off");
      } else {
        this.flash("google");
        this.notifyAction();
        fetch(`${config.tvTvUrl}/tv/googlebtn`).catch(() => {});
      }
    },

    async fireBtn() {
      if (this.checkBlocked()) return;
      if (this.mode === "fire") {
        this.tvCmd("off");
      } else {
        this.flash("fire");
        this.notifyAction();
        fetch(`${config.tvTvUrl}/tv/firebtn`).catch(() => {});
      }
    },

    _onPaneChanged(pane) {
      if (pane !== "tv") {
        this.subClose();
      }
    },

    _onTvMuteState(data) {
      if (!data) return;
      if (data.muted !== null) this.muted = data.muted;
      if (data.state !== undefined) this.haState = data.state;
      if (data.mediaTitle !== undefined) this.mediaTitle = data.mediaTitle;
    },

    async pollMute() {
      try {
        const data = await fetch(`${config.tvTvUrl}/tv/mutestate`).then((r) =>
          r.json(),
        );
        if (data.ok) {
          if (data.muted !== null) this.muted = data.muted;
        }
      } catch (_) {}
    },

    async openApp(svc) {
      if (this.isOff) return;
      if (this.checkBlocked()) return;
      this.notifyAction();
      setTimeout(() => {
        this.showStreamers = false;
      }, 1000);
      try {
        await fetch(
          `${config.tvTvUrl}/tv/openapp?uri=${encodeURIComponent(svc.uri)}`,
        );
      } catch (_) {}
    },

    flashSvcName(name) {
      this.flashSvc = name;
      setTimeout(() => {
        this.flashSvc = null;
      }, 500);
    },

    _debounce() {
      const now = Date.now();
      const ok = now - (this._lastCmd || 0) >= 250;
      this._lastCmd = now;
      return ok;
    },

    async tvCmd(cmd) {
      if (this.isOff || this.isOther) return;
      if (this.checkBlocked()) return;
      this.flash(cmd);
      if (!this._debounce()) return;
      this.notifyAction();
      const res = await fetch(`${config.tvTvUrl}/tv/${cmd}`);
      const data = await res.json();
      if (cmd === "mute" && data.ok) this.muted = data.muted;
      console.log(`[TV] ${cmd} response:`, data);
    },

    async tvVolCmd(dir) {
      if (this.isOff || this.isOther) return;
      if (this.checkBlocked()) return;
      this.flash(dir === "down" ? "vold" : "volu");
      this.notifyAction();
      fetch(`${config.tvTvUrl}/tv/vol/${dir}`).catch(() => {});
    },

    async _tvKeyRaw(key) {
      const res = await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      const data = await res.json();
      console.log(`[TV] key ${key} response:`, data);
    },

    async tvKey(key) {
      if (this.isOff || this.isOther) return;
      if (this.checkBlocked()) return;
      if (!this._debounce()) return;
      this.flash(key);
      this.notifyAction();
      const res = await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      const data = await res.json();
      console.log(`[TV] key ${key} response:`, data);
    },
  },
};
</script>
