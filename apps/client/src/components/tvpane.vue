<template>
  <div
    id="tvPane"
    style="padding: 0; box-sizing: border-box; width: 100%; height: 100%"
  >
    <div
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
        @mousedown="tvKey('ok')"
        @touchstart.prevent="tvKey('ok')"
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
      <div :style="cellStyle('white')">ABC</div>
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
      <!-- Row 5: google, roku, off -->
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
        :style="offBtnStyle"
        @mousedown="
          startHold(() => {
            flash('off');
            tvCmd('off');
          })
        "
        @mouseup="stopHold"
        @mouseleave="stopHold"
        @touchstart.prevent="
          startHold(() => {
            flash('off');
            tvCmd('off');
          })
        "
        @touchend="stopHold"
      >
        Off<span style="font-size: 18px; margin-left: 4px; opacity: 0.6">{{
          mediaTitle || "null"
        }}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { config } from "../config.js";
import evtBus from "../evtBus.js";

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
    };
  },

  computed: {
    muteCellStyle() {
      const bg =
        this.flashBtn === "mute"
          ? "orange"
          : this.muted
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
      if (this.mediaTitle === "Fire TV Stick" || this.mediaTitle === "HDMI 2")
        return "fire";
      return "other";
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
  },

  beforeUnmount() {
    evtBus.off("tvMuteState", this._onTvMuteState);
    this.stopRepeat();
    this.stopHold();
  },

  methods: {
    startRepeat(key) {
      if (this.isOff || this.isOther) return;
      if (!this._debounce()) return;
      this.flash(key);
      this._repeatActive = true;
      fetch(`${config.tvTvUrl}/tv/key/${key}`).catch(() => {});
      let count = 0;
      const tick = () => {
        if (!this._repeatActive) return;
        fetch(`${config.tvTvUrl}/tv/key/${key}`).catch(() => {});
        this._repeatTimer = setTimeout(tick, count++ < 4 ? 500 : 100);
      };
      this._repeatDelay = setTimeout(tick, 400);
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
    },

    startHold(action) {
      this._holdTimer = setTimeout(action, 500);
    },

    stopHold() {
      clearTimeout(this._holdTimer);
    },

    modeBtnStyle(m) {
      const active = this.mode === m;
      const bg =
        this.flashBtn === m ? "orange" : active ? "lightblue" : "white";
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
      this.flash("google");
      fetch(`${config.tvTvUrl}/tv/googlebtn`).catch(() => {});
    },

    async fireBtn() {
      this.flash("fire");
      fetch(`${config.tvTvUrl}/tv/firebtn`).catch(() => {});
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

    _debounce() {
      const now = Date.now();
      if (now - (this._lastCmd || 0) < 250) return false;
      this._lastCmd = now;
      return true;
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
      this.flash(key);
      const res = await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      const data = await res.json();
      console.log(`[TV] key ${key} response:`, data);
    },
  },
};
</script>
