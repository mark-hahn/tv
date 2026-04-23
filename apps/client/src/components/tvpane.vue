<template>
  <div
    id="tvPane"
    style="padding: 0; box-sizing: border-box; width: 100%; height: 100%"
  >
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
    <!-- Sub ctrl pane -->
    <div
      v-else-if="showSubCtrl"
      style="
        display: flex;
        flex-direction: column;
        height: 100%;
        border: 3px solid #000;
        box-sizing: border-box;
      "
    >
      <!-- Header row 1: show name + offset + close -->
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px;
          border-bottom: 3px solid #000;
          flex-shrink: 0;
          gap: 8px;
        "
      >
        <button
          @mousedown.prevent="subCyclePlayer"
          @touchstart.prevent="subCyclePlayer"
          style="
            flex: 1;
            text-align: left;
            font-size: 15px;
            font-weight: bold;
            border: none;
            background: none;
            cursor: pointer;
            padding: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          "
        >
          {{ subHeaderLabel }}
        </button>
        <button
          @mousedown.prevent="subClose"
          @touchstart.prevent="subClose"
          style="
            font-size: 22px;
            border: none;
            background: none;
            cursor: pointer;
            padding: 4px 8px;
            flex-shrink: 0;
          "
        >
          ✕
        </button>
      </div>
      <!-- Scrollable subtitle list -->
      <div style="overflow-y: auto; flex: 1">
        <div
          v-if="!subCurrentPlayer"
          style="
            padding: 20px;
            text-align: center;
            color: #999;
            font-size: 16px;
          "
        >
          No video playing
        </div>
        <template v-else>
          <div
            :style="subCardStyle(-1)"
            @mousedown="subSelectTrack(-1)"
            @touchstart.prevent="subSelectTrack(-1)"
          >
            None
          </div>
          <div
            v-for="sub in subCurrentPlayer.subtitles"
            :key="sub.index"
            :style="subCardStyle(sub.index)"
            @mousedown="subSelectTrack(sub.index)"
            @touchstart.prevent="subSelectTrack(sub.index)"
          >
            {{ subTypeChar(sub.type) }}: {{ sub.label }}
          </div>
        </template>
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
        :style="cellStyle('white', 'stream')"
        @mousedown="
          (mode === 'google' || mode === 'fire') && (showStreamers = true)
        "
        @touchstart.prevent="
          (mode === 'google' || mode === 'fire') && (showStreamers = true)
        "
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
      <!-- Row 5: keybd, fire, google -->
      <div
        :style="cellStyle('white', 'keybd')"
        @mousedown="startHold(() => keybdBtn())"
        @mouseup="stopHold"
        @mouseleave="stopHold"
        @touchstart.prevent="startHold(() => keybdBtn())"
        @touchend="stopHold"
      >
        <svg
          width="1.5em"
          height="1.5em"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path
            d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 5H5v-2h2v2zm0-3H5v-2h2v2zm0-3H5V8h2v2zm9 6H8v-2h8v2zm0-3h-2v-2h2v2zm0-3h-2V8h2v2zm3 6h-2v-2h2v2zm0-3h-2v-2h2v2zm0-3h-2V8h2v2z"
          />
        </svg>
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
    };
  },

  computed: {
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
    subCurrentPlayer() {
      if (!this.subDeviceName) return null;
      return (
        this.subPlayers.find(
          (p) => (p.deviceName || p.sessionId) === this.subDeviceName,
        ) ?? null
      );
    },
    subHeaderLabel() {
      const player = this.subCurrentPlayer;
      if (!player) return this.subDeviceName ? "---" : "No video playing";
      let base = player.episodeCode
        ? `${player.showName} ${player.episodeCode}`
        : player.showName;
      if (player.deviceName)
        base += ` (${this.subShortDevice(player.deviceName)})`;
      const active = player.subtitles.find(
        (s) => s.index === player.subtitleStreamIndex,
      );
      return base;
    },
  },

  mounted() {
    this.pollMute();
    evtBus.on("tvMuteState", this._onTvMuteState);
    evtBus.on("paneChanged", this._onPaneChanged);
    evtBus.on("tvCloseKeybd", this._onTvCloseKeybd);
  },

  beforeUnmount() {
    evtBus.off("tvMuteState", this._onTvMuteState);
    evtBus.off("paneChanged", this._onPaneChanged);
    evtBus.off("tvCloseKeybd", this._onTvCloseKeybd);
    this.stopRepeat();
    this.stopHold();
    clearInterval(this._subPollTimer);
  },

  methods: {
    subTypeChar(type) {
      if (type === "pgs") return "*";
      if (type === "embedded") return "T";
      if (type === "asr") return "+";
      if (type === "mbs") return ">";
      if (type === "opn") return "V";
      if (type === "srt") return "S";
      return "S";
    },

    subShortDevice(name) {
      if (!name) return name;
      if (name === "Living Room TV") return "TV";
      if (name === "Firefox Browser") return "Firefox";
      if (name === "Firefox Windows") return "Firefox";
      if (name === "Google Chrome Windows") return "Chrome";
      if (name === "Galaxy Tab S8") return "Tablet";
      return name;
    },

    startEmbyHold() {
      this._embyHoldFired = false;
      this._embyHoldTimer = setTimeout(() => {
        this._embyHoldFired = true;
        this.openSubCtrl();
      }, 1000);
    },

    stopEmbyHold() {
      clearTimeout(this._embyHoldTimer);
      if (!this._embyHoldFired) {
        this.tvCmd("emby");
      }
      this._embyHoldFired = false;
    },

    async _fetchSubPlayers() {
      try {
        const data = await fetch(`${config.tvTvUrl}/tv/emby/playing`).then(
          (r) => r.json(),
        );
        if (data.ok) {
          const pending = this._subPending;
          let players = data.playing;
          if (pending) {
            players = players.map((p) => {
              if ((p.deviceName || p.sessionId) === pending.deviceName) {
                if (p.subtitleStreamIndex === pending.index) {
                  this._subPending = null; // Emby confirmed
                } else {
                  return { ...p, subtitleStreamIndex: pending.index }; // keep optimistic
                }
              }
              return p;
            });
          }
          this.subPlayers = players;
          if (!this.subDeviceName && this.subPlayers.length > 0) {
            this.subDeviceName =
              this.subPlayers[0].deviceName || this.subPlayers[0].sessionId;
          }
        }
      } catch (_) {}
    },

    async openSubCtrl() {
      this.flash("emby");
      this.showSubCtrl = true;
      this.subPlayerIdx = 0;
      await this._fetchSubPlayers();
      this._subPollTimer = setInterval(() => this._fetchSubPlayers(), 3000);
    },

    subCyclePlayer() {
      if (this.subPlayers.length === 0) return;
      const curIdx = this.subPlayers.findIndex(
        (p) => (p.deviceName || p.sessionId) === this.subDeviceName,
      );
      const nextIdx = (curIdx + 1) % this.subPlayers.length;
      this.subDeviceName =
        this.subPlayers[nextIdx].deviceName ||
        this.subPlayers[nextIdx].sessionId;
    },

    subClose() {
      clearInterval(this._subPollTimer);
      this.showSubCtrl = false;
    },

    async subSelectTrack(index) {
      const player = this.subCurrentPlayer;
      if (!player) return;
      this._subPending = { deviceName: this.subDeviceName, index };
      const idx = this.subPlayers.findIndex(
        (p) => (p.deviceName || p.sessionId) === this.subDeviceName,
      );
      if (idx >= 0)
        this.subPlayers[idx] = { ...player, subtitleStreamIndex: index };
      const resp = await fetch(`${config.tvTvUrl}/tv/emby/subtitle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: player.sessionId, index }),
      })
        .then((r) => r.json())
        .catch(() => ({}));
      const waitMs = resp.waitMs ?? 4000;
      const navMs = resp.navMs ?? waitMs;
      await new Promise((r) => setTimeout(r, navMs));
      clearInterval(this._subPollTimer);
      this._subPollTimer = setInterval(() => this._fetchSubPlayers(), 500);
      await new Promise((r) => setTimeout(r, waitMs - navMs));
      clearInterval(this._subPollTimer);
      this._subPending = null;
      this._subPollTimer = setInterval(() => this._fetchSubPlayers(), 3000);
      await this._fetchSubPlayers();
    },

    subCardStyle(index) {
      const isSelected = this.subCurrentPlayer?.subtitleStreamIndex === index;
      return {
        padding: "12px 16px",
        borderBottom: "1px solid #ddd",
        cursor: "pointer",
        fontSize: "18px",
        userSelect: "none",
        backgroundColor: isSelected ? "#d0e8ff" : "#fff",
        fontWeight: isSelected ? "bold" : "normal",
      };
    },

    startRepeat(key) {
      if (this.isOff || this.isOther) return;
      if (!this._debounce()) return;
      this.flash(key);
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
      if (this.mode === "google") {
        this.tvCmd("off");
      } else {
        this.flash("google");
        fetch(`${config.tvTvUrl}/tv/googlebtn`).catch(() => {});
      }
    },

    async fireBtn() {
      if (this.mode === "fire") {
        this.tvCmd("off");
      } else {
        this.flash("fire");
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
        if (this.showSubCtrl) this.subClose();
      } else if (this.showSubCtrl) {
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
      this.flash(cmd);
      if (!this._debounce()) return;
      const res = await fetch(`${config.tvTvUrl}/tv/${cmd}`);
      const data = await res.json();
      if (cmd === "mute" && data.ok) this.muted = data.muted;
      console.log(`[TV] ${cmd} response:`, data);
    },

    async tvVolCmd(dir) {
      if (this.isOff || this.isOther) return;
      this.flash(dir === "down" ? "vold" : "volu");
      fetch(`${config.tvTvUrl}/tv/vol/${dir}`).catch(() => {});
    },

    async _tvKeyRaw(key) {
      const res = await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      const data = await res.json();
      console.log(`[TV] key ${key} response:`, data);
    },

    async tvKey(key) {
      if (this.isOff || this.isOther) return;
      if (!this._debounce()) return;
      this.flash(key);
      const res = await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      const data = await res.json();
      console.log(`[TV] key ${key} response:`, data);
    },
  },
};
</script>
