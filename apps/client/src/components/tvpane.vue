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
      <!-- Row 5: google, fire, roku, off (spans all 3 cols, inner 4-col flex) -->
      <div style="grid-column: 1 / -1; display: flex">
        <div
          :style="modeBtnStyle('google')"
          style="flex: 1"
          @mousedown="startHold(() => setMode('google'))"
          @mouseup="stopHold"
          @mouseleave="stopHold"
          @touchstart.prevent="startHold(() => setMode('google'))"
          @touchend="stopHold"
        >
          Google
        </div>
        <div
          :style="modeBtnStyle('fire')"
          style="flex: 1"
          @mousedown="startHold(() => setMode('fire'))"
          @mouseup="stopHold"
          @mouseleave="stopHold"
          @touchstart.prevent="startHold(() => setMode('fire'))"
          @touchend="stopHold"
        >
          Fire
        </div>
        <div
          :style="modeBtnStyle('roku')"
          style="flex: 1"
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
          style="flex: 1"
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
          ? "orange"
          : this.muted
            ? "#ffb3b3"
            : "lightgreen";
      return { ...CELL_BASE, backgroundColor: bg };
    },
    offBtnStyle() {
      const isOff = this.power === "off" || this.power === "standby";
      const bg =
        this.flashBtn === "off" ? "orange" : isOff ? "lightblue" : "white";
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
      if (this.power === "off" || this.power === "standby") return;
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
      this._holdTimer = setTimeout(action, 750);
    },

    stopHold() {
      clearTimeout(this._holdTimer);
    },

    modeBtnStyle(m) {
      const isOff = this.power === "off" || this.power === "standby";
      const bg =
        this.flashBtn === m
          ? "orange"
          : !isOff && this.mode === m
            ? "lightblue"
            : "white";
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
      if (data.mode) this.mode = data.mode;
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
      if (this.power === "off" || this.power === "standby") return;
      this.flash(cmd);
      if (!this._debounce()) return;
      const res = await fetch(`${config.tvTvUrl}/tv/${cmd}`);
      const data = await res.json();
      if (cmd === "mute" && data.ok) this.muted = data.muted;
      console.log(`[TV] ${cmd} response:`, data);
    },

    async tvVolCmd(dir) {
      if (this.power === "off" || this.power === "standby") return;
      this.flash(dir === "down" ? "vold" : "volu");
      fetch(`${config.tvTvUrl}/tv/vol/${dir}`).catch(() => {});
    },

    async _tvKeyRaw(key) {
      const res = await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      const data = await res.json();
      console.log(`[TV] key ${key} response:`, data);
    },

    async tvKey(key) {
      if (this.power === "off" || this.power === "standby") return;
      this.flash(key);
      const res = await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      const data = await res.json();
      console.log(`[TV] key ${key} response:`, data);
    },
  },
};
</script>
