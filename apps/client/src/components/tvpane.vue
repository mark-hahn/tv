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
        @click="
          flash('back');
          tvKey('back');
        "
      >
        ↩
      </div>
      <div
        :style="cellStyle('#fffde7', 'up')"
        @click="
          flash('up');
          tvKey('up');
        "
      >
        ▲
      </div>
      <div
        :style="cellStyle('white', 'home')"
        @click="
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
        @click="
          flash('left');
          tvKey('left');
        "
      >
        ◀
      </div>
      <div
        :style="cellStyle('#e8f5e9', 'ok')"
        @click="
          flash('ok');
          tvKey('ok');
        "
      >
        OK
      </div>
      <div
        :style="cellStyle('#fffde7', 'right')"
        @click="
          flash('right');
          tvKey('right');
        "
      >
        ▶
      </div>
      <!-- Row 3: emby, down, keyboard -->
      <div
        :style="cellStyle('white', 'emby')"
        @click="
          flash('emby');
          tvCmd('emby');
        "
      >
        Emby
      </div>
      <div
        :style="cellStyle('#fffde7', 'down')"
        @click="
          flash('down');
          tvKey('down');
        "
      >
        ▼
      </div>
      <div :style="cellStyle('white')">ABC</div>
      <!-- Row 4: vol-, vol+, mute -->
      <div
        :style="cellStyle('#e8f5e9', 'vold')"
        @click="
          flash('vold');
          tvCmd('vol/down');
        "
      >
        Vol-
      </div>
      <div
        :style="cellStyle('#e8f5e9', 'volu')"
        @click="
          flash('volu');
          tvCmd('vol/up');
        "
      >
        Vol+
      </div>
      <div
        :style="muteCellStyle"
        @click="
          flash('mute');
          tvCmd('mute');
        "
      >
        Mute
      </div>
      <!-- Row 5: google, roku, off -->
      <div
        :style="modeBtnStyle('google')"
        @click="setMode('google')"
      >
        Google
      </div>
      <div
        :style="modeBtnStyle('roku')"
        @click="setMode('roku')"
      >
        Roku
      </div>
      <div
        :style="offBtnStyle"
        @click="
          flash('off');
          tvCmd('off');
        "
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
  },

  methods: {
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

    async tvCmd(cmd) {
      const res = await fetch(`${config.tvTvUrl}/tv/${cmd}`);
      const data = await res.json();
      if (cmd === "mute" && data.ok) this.muted = data.muted;
      console.log(`[TV] ${cmd} response:`, data);
    },

    async tvKey(key) {
      const res = await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      const data = await res.json();
      console.log(`[TV] key ${key} response:`, data);
    },
  },
};
</script>
