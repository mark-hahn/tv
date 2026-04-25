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
    <!-- Keyboard pane -->
    <div
      v-if="showKeybd"
      style="
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 12px;
        box-sizing: border-box;
        gap: 10px;
      "
    >
      <div style="display: flex; gap: 8px; align-items: center">
        <input
          ref="keybdInput"
          v-model="keybdInput"
          type="text"
          style="
            flex: 1;
            padding: 8px;
            font-size: 16px;
            border: 1px solid #bbb;
            border-radius: 5px;
            box-sizing: border-box;
          "
          placeholder="Type here..."
          @keydown.enter="keybdSend"
        />
        <button
          @mousedown.prevent="showKeybd = false"
          @touchstart.prevent="showKeybd = false"
          :style="{
            '--btn-bg': '#111',
            border: 'none',
            color: '#fff',
            fontSize: '20px',
            cursor: 'pointer',
            padding: '8px 12px',
            borderRadius: '8px',
            lineHeight: '1',
          }"
        >
          ✕
        </button>
      </div>
      <div style="overflow-y: auto; flex: 1">
        <div
          v-for="(item, idx) in keybdHistory"
          :key="item"
          @click="keybdRecall(item)"
          :style="{
            padding: '6px 8px',
            borderBottom: '1px solid #eee',
            cursor: 'pointer',
            fontSize: '15px',
            userSelect: 'none',
            backgroundColor: idx % 2 === 0 ? '#fafafa' : '#fff',
          }"
        >
          {{ item }}
        </div>
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
        @mousedown="tvKey('back')"
        @touchstart.prevent="tvKey('back')"
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
        @mousedown="tvKey('home')"
        @touchstart.prevent="tvKey('home')"
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
        @mousedown="
          stopRepeat();
          tvKey('ok');
        "
        @touchstart.prevent="
          stopRepeat();
          tvKey('ok');
        "
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
      <!-- Row 3: emby, down, keyboard -->
      <div
        :style="cellStyle('white', 'emby')"
        @mousedown="tvCmd('emby')"
        @touchstart.prevent="tvCmd('emby')"
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
        :style="cellStyle('white', 'stream')"
        @mousedown="startAppsHold"
        @mouseup="stopAppsHold"
        @mouseleave="stopAppsHold"
        @touchstart.prevent="startAppsHold"
        @touchend="stopAppsHold"
      >
        Apps
      </div>
      <!-- Row 4: vol-, vol+, mute -->
      <div
        :style="cellStyle('lightgreen', 'vold')"
        @mousedown="tvVolCmd('down')"
        @touchstart.prevent="tvVolCmd('down')"
      >
        Vol-
      </div>
      <div
        :style="cellStyle('lightgreen', 'volu')"
        @mousedown="tvVolCmd('up')"
        @touchstart.prevent="tvVolCmd('up')"
      >
        Vol+
      </div>
      <div
        :style="muteCellStyle"
        @mousedown="tvCmd('mute')"
        @touchstart.prevent="tvCmd('mute')"
      >
        Mute
      </div>
      <!-- Row 5: subs, fire, google -->
      <div
        :style="cellStyle('white', 'subs')"
        @mousedown="openSubCtrl"
        @touchstart.prevent="openSubCtrl"
      >
        Subs
      </div>
      <div
        :style="modeBtnStyle('fire')"
        @mousedown="startHold(() => fireBtn())"
        @mouseup="stopHold"
        @mouseleave="stopHold"
        @touchstart.prevent="startHold(() => fireBtn())"
        @touchend="stopHold"
      >
        Fire
      </div>
      <div
        :style="modeBtnStyle('google')"
        @mousedown="startHold(() => googleBtn())"
        @mouseup="stopHold"
        @mouseleave="stopHold"
        @touchstart.prevent="startHold(() => googleBtn())"
        @touchend="stopHold"
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
      showKeybd: false,
      keybdInput: "",
      keybdHistory: [],
      showSubCtrl: false,
      subPlayers: [],
      subDeviceName: null,
      avoidingCollisions: false,
      locked: false,
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
    this.pollMute();
    evtBus.on("tvMuteState", this._onTvMuteState);
    evtBus.on("paneChanged", this._onPaneChanged);
    evtBus.on("tvCloseKeybd", this._onTvCloseKeybd);
    evtBus.on("tvRemoteAction", this._onTvRemoteAction);
    evtBus.on("tvRemoteLock", this._onTvRemoteLock);
    evtBus.on("tvRemoteUnlock", this._onTvRemoteUnlock);
  },

  beforeUnmount() {
    evtBus.off("tvMuteState", this._onTvMuteState);
    evtBus.off("paneChanged", this._onPaneChanged);
    evtBus.off("tvCloseKeybd", this._onTvCloseKeybd);
    evtBus.off("tvRemoteAction", this._onTvRemoteAction);
    evtBus.off("tvRemoteLock", this._onTvRemoteLock);
    evtBus.off("tvRemoteUnlock", this._onTvRemoteUnlock);
    this.stopRepeat();
    this.stopHold();
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
      if (this.isOff || this.isOther) return;
      if (this.checkBlocked()) return;
      if (!this._debounce()) return;
      this.flash(key);
      this.notifyAction();
      this._repeatActive = true;
      (async () => {
        await fetch(`${config.tvTvUrl}/tv/key/${key}`).catch(() => {});
        if (!this._repeatActive) return;
        await new Promise((r) => {
          this._repeatTimer = setTimeout(r, 400);
        });
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
      this._repeatActive = false;
      clearTimeout(this._repeatTimer);
    },

    startHold(action) {
      this._holdTimer = setTimeout(action, 500);
    },

    stopHold() {
      clearTimeout(this._holdTimer);
    },

    startAppsHold() {
      this._appsHoldFired = false;
      this._appsHoldTimer = setTimeout(() => {
        this._appsHoldFired = true;
        this.keybdBtn();
      }, 1000);
    },

    stopAppsHold() {
      clearTimeout(this._appsHoldTimer);
      if (!this._appsHoldFired) {
        if (this.mode === "google" || this.mode === "fire") {
          this.showStreamers = true;
        }
      }
      this._appsHoldFired = false;
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
      try {
        await fetch(`${config.tvTvUrl}/tv/emby/subtitle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: player.sessionId, index }),
        });
      } catch (_) {}
      await this.fetchSubPlayers();
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
      }, 150);
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

    keybdBtn() {
      this.flash("keybd");
      this.showKeybd = true;
      this.$nextTick(() => {
        if (this.$refs.keybdInput) this.$refs.keybdInput.focus();
      });
    },

    async keybdSend() {
      const text = this.keybdInput.trim();
      if (!text) return;
      for (let i = 0; i < 50; i++) {
        try {
          await fetch(config.tvTvUrl + "/tv/keyevent/KEYCODE_DEL");
        } catch (e) {}
      }
      try {
        await fetch(config.tvTvUrl + "/tv/text?t=" + encodeURIComponent(text));
      } catch (e) {}
      try {
        await fetch(config.tvTvUrl + "/tv/keyevent/KEYCODE_ENTER");
      } catch (e) {}
      this.keybdHistory = [
        text,
        ...this.keybdHistory.filter((i) => i !== text),
      ];
      this.keybdInput = "";
    },

    keybdRecall(item) {
      this.keybdInput = item;
      this.$nextTick(() => {
        if (this.$refs.keybdInput) this.$refs.keybdInput.focus();
      });
    },

    _onPaneChanged(pane) {
      if (pane !== "tv") {
        this.showKeybd = false;
        this.subClose();
      }
    },

    _onTvCloseKeybd() {
      this.showKeybd = false;
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
