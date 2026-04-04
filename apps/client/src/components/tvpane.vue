<template>
  <div
    id="tvPane"
    style="
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 10px;
      box-sizing: border-box;
      gap: 10px;
    "
  >
    <!-- Mode row -->
    <div style="display: flex; gap: 6px; align-items: center">
      <button
        @click="setMode('google')"
        :style="modeBtnStyle('google')"
        style="width: auto; padding: 0 8px"
      >
        Google
      </button>
      <button
        @click="setMode('roku')"
        :style="modeBtnStyle('roku')"
        style="width: auto; padding: 0 8px"
      >
        Roku
      </button>
      <button
        @click="
          flash('off');
          tvCmd('off');
        "
        :style="offBtnStyle"
      >
        Off
      </button>
    </div>
    <!-- D-pad -->
    <div
      style="
        display: grid;
        grid-template-columns: repeat(3, 36px);
        grid-template-rows: repeat(3, 36px);
        gap: 4px;
      "
    >
      <div></div>
      <button
        @click="tvKey('up')"
        :style="btnStyle"
      >
        ▲
      </button>
      <div></div>
      <button
        @click="tvKey('left')"
        :style="btnStyle"
      >
        ◀
      </button>
      <button
        @click="tvKey('ok')"
        :style="btnStyle"
      >
        OK
      </button>
      <button
        @click="tvKey('right')"
        :style="btnStyle"
      >
        ▶
      </button>
      <div></div>
      <button
        @click="tvKey('down')"
        :style="btnStyle"
      >
        ▼
      </button>
      <div></div>
    </div>
    <!-- Nav row -->
    <div style="display: flex; gap: 6px; margin-top: 4px">
      <button
        @click="tvKey('home')"
        :style="btnStyle"
      >
        <span style="font-size: 22px; font-weight: bold">⌂</span>
      </button>
      <button
        @click="tvKey('back')"
        :style="btnStyle"
      >
        ↩
      </button>
    </div>
    <!-- Volume row -->
    <div style="display: flex; gap: 6px">
      <button
        @click="tvCmd('vol/up')"
        :style="btnStyle"
      >
        Vol+
      </button>
      <button
        @click="tvCmd('vol/down')"
        :style="btnStyle"
      >
        Vol-
      </button>
      <button
        @click="tvCmd('mute')"
        :style="muteBtnStyle"
      >
        Mute
      </button>
    </div>
  </div>
</template>

<script>
import { config } from "../config.js";

const BTN_STYLE = {
  width: "36px",
  height: "36px",
  fontSize: "13px",
  cursor: "pointer",
  borderRadius: "7px",
  padding: "0",
  border: "1px solid #bbb",
};

export default {
  name: "TvPane",

  data() {
    return {
      mode: "google",
      muted: false,
      power: "unknown",
      flashBtn: null,
    };
  },

  computed: {
    btnStyle() {
      return BTN_STYLE;
    },
    offBtnStyle() {
      const isOff = this.power === "off" || this.power === "standby";
      return {
        ...BTN_STYLE,
        "--btn-bg":
          this.flashBtn === "off"
            ? "#90ee90"
            : isOff
              ? "lightblue"
              : "whitesmoke",
      };
    },
    muteBtnStyle() {
      return {
        ...BTN_STYLE,
        "--btn-bg": this.muted ? "#ffb3b3" : "whitesmoke",
      };
    },
  },

  mounted() {
    this.pollMute();
    this._muteTimer = setInterval(() => this.pollMute(), 3000);
  },

  beforeUnmount() {
    clearInterval(this._muteTimer);
  },

  methods: {
    modeBtnStyle(m) {
      const isOff = this.power === "off" || this.power === "standby";
      return {
        ...BTN_STYLE,
        width: "auto",
        padding: "0 8px",
        "--btn-bg":
          this.flashBtn === m
            ? "#90ee90"
            : !isOff && this.mode === m
              ? "lightblue"
              : "whitesmoke",
      };
    },

    flash(btn) {
      this.flashBtn = btn;
      setTimeout(() => {
        this.flashBtn = null;
      }, 300);
    },

    async setMode(m) {
      this.flash(m);
      this.mode = m;
      await fetch(`${config.tvTvUrl}/tv/mode/${m}`);
      this._startFastPoll();
    },

    _startFastPoll() {
      clearInterval(this._muteTimer);
      const startedAt = Date.now();
      this._muteTimer = setInterval(() => {
        this.pollMute();
        if (Date.now() - startedAt > 30000) {
          clearInterval(this._muteTimer);
          this._muteTimer = setInterval(() => this.pollMute(), 3000);
        }
      }, 500);
    },

    async pollMute() {
      try {
        const data = await fetch(`${config.tvTvUrl}/tv/mutestate`).then((r) =>
          r.json(),
        );
        if (data.ok) {
          if (data.muted !== null) this.muted = data.muted;
          if (data.power) this.power = data.power;
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
