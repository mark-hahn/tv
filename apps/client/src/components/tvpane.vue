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
        @mousedown="
          flash('back');
          tvKey('back');
        "
        @touchstart.prevent="
          flash('back');
          tvKey('back');
        "
      >
        ↩
      </div>
      <div
        :style="cellStyle('#fffde7', 'up')"
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
        @mousedown="
          flash('home');
          tvKey('home');
        "
        @touchstart.prevent="
          flash('home');
          tvKey('home');
        "
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
        :style="cellStyle('#fffde7', 'left')"
        @mousedown="startRepeat('left')"
        @mouseup="stopRepeat"
        @mouseleave="stopRepeat"
        @touchstart.prevent="startRepeat('left')"
        @touchend="stopRepeat"
      >
        ◀
      </div>
      <div
        :style="cellStyle('#e8f5e9', 'ok')"
        @mousedown="
          flash('ok');
          tvKey('ok');
        "
        @touchstart.prevent="
          flash('ok');
          tvKey('ok');
        "
      >
        OK
      </div>
      <div
        :style="cellStyle('#fffde7', 'right')"
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
        @mousedown="
          flash('emby');
          tvCmd('emby');
        "
        @touchstart.prevent="
          flash('emby');
          tvCmd('emby');
        "
      >
        Emby
      </div>
      <div
        :style="cellStyle('#fffde7', 'down')"
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
        :style="cellStyle('#e8f5e9', 'vold')"
        @mousedown="startRepeatCmd('vold', 'vol/down')"
        @mouseup="stopRepeat"
        @mouseleave="stopRepeat"
        @touchstart.prevent="startRepeatCmd('vold', 'vol/down')"
        @touchend="stopRepeat"
      >
        Vol-
      </div>
      <div
        :style="cellStyle('#e8f5e9', 'volu')"
        @mousedown="startRepeatCmd('volu', 'vol/up')"
        @mouseup="stopRepeat"
        @mouseleave="stopRepeat"
        @touchstart.prevent="startRepeatCmd('volu', 'vol/up')"
        @touchend="stopRepeat"
      >
        Vol+
      </div>
      <div
        :style="muteCellStyle"
        @mousedown="
          flash('mute');
          tvCmd('mute');
        "
        @touchstart.prevent="
          flash('mute');
          tvCmd('mute');
        "
      >
        Mute
      </div>
      <!-- Row 5: google, roku, off -->
      <div
        :style="modeBtnStyle('google')"
        @mousedown="startHold(() => setMode('google'))"
        @mouseup="stopHold"
        @mouseleave="stopHold"
        @touchstart.prevent="startHold(() => setMode('google'))"
        @touchend="stopHold"
      >
        Google
      </div>
      <div
        :style="modeBtnStyle('roku')"
        @mousedown="startHold(() => setMode('roku'))"
        @mouseup="stopHold"
        @mouseleave="stopHold"
        @touchstart.prevent="startHold(() => setMode('roku'))"
        @touchend="stopHold"
      >
        Roku
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
        Off
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
      mode: "google",
      muted: false,
      power: "unknown",
      flashBtn: null,
      activeDevice: null,
    };
  },

  computed: {
    muteCellStyle() {
      const bg =
        this.flashBtn === "mute"
          ? "#90ee90"
          : this.muted
            ? "#ffb3b3"
            : "#e8f5e9";
      return { ...CELL_BASE, backgroundColor: bg };
    },
    offBtnStyle() {
      const isOff = this.power === "off" || this.power === "standby";
      const bg =
        this.flashBtn === "off" ? "#90ee90" : isOff ? "lightblue" : "white";
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
      const now = Date.now();
      if (now - (this._lastVol || 0) < 150) return;
      this._lastVol = now;
      this.flash(flashKey);
      this._repeatActive = true;
      fetch(`${config.tvTvUrl}/tv/${cmd}`).catch(() => {});
      const tick = () => {
        if (!this._repeatActive) return;
        fetch(`${config.tvTvUrl}/tv/${cmd}`).catch(() => {});
        this._repeatTimer = setTimeout(tick, 250);
      };
      this._repeatDelay = setTimeout(tick, 250);
    },

    stopRepeat() {
      this._repeatActive = false;
      clearTimeout(this._repeatDelay);
      clearTimeout(this._repeatTimer);
    },

    startHold(action) {
      this._holdTimer = setTimeout(action, 1500);
    },

    stopHold() {
      clearTimeout(this._holdTimer);
    },

    modeBtnStyle(m) {
      const isOff = this.power === "off" || this.power === "standby";
      const bg =
        this.flashBtn === m
          ? "#90ee90"
          : !isOff && this.mode === m
            ? "lightblue"
            : "white";
      return { ...CELL_BASE, backgroundColor: bg };
    },

    cellStyle(bg, key = null) {
      const flashActive = key && this.flashBtn === key;
      return { ...CELL_BASE, backgroundColor: flashActive ? "#90ee90" : bg };
    },

    flash(btn) {
      this.flashBtn = btn;
      setTimeout(() => {
        this.flashBtn = null;
      }, 150);
    },

    async setMode(m) {
      this.flash(m);
      this.mode = m;
      this.power = "on";
      await fetch(`${config.tvTvUrl}/tv/mode/${m}`);
    },

    _onTvMuteState(data) {
      if (!data) return;
      if (data.muted !== null) this.muted = data.muted;
      if (data.power) this.power = data.power;
      if (data.activeDevice !== undefined)
        this.activeDevice = data.activeDevice;
    },

    async pollMute() {
      try {
        const data = await fetch(`${config.tvTvUrl}/tv/mutestate`).then((r) =>
          r.json(),
        );
        if (data.ok) {
          if (data.muted !== null) this.muted = data.muted;
          if (data.power) this.power = data.power;
          if (data.activeDevice) this.activeDevice = data.activeDevice;
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
      if (!this._debounce()) return;
      const res = await fetch(`${config.tvTvUrl}/tv/${cmd}`);
      const data = await res.json();
      if (cmd === "mute" && data.ok) this.muted = data.muted;
      console.log(`[TV] ${cmd} response:`, data);
    },

    async _tvKeyRaw(key) {
      const res = await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      const data = await res.json();
      console.log(`[TV] key ${key} response:`, data);
    },

    async tvKey(key) {
      const res = await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      const data = await res.json();
      console.log(`[TV] key ${key} response:`, data);
    },
  },
};
</script>
