<template>
  <div
    id="tvPane"
    style="padding: 0; box-sizing: border-box; width: 100%; height: 100%"
  >
    <!-- Streamers pane -->
    <div
      v-if="showStreamers"
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
        Off
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
