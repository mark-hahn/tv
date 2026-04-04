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
        @click="tvCmd('off')"
        :style="btnStyle"
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
        ⌂
      </button>
      <button
        @click="tvKey('back')"
        :style="btnStyle"
      >
        ↩
      </button>
      <button
        @click="tvCmd('emby')"
        :style="btnStyle"
      >
        Emby
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
        :style="btnStyle"
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
    };
  },

  computed: {
    btnStyle() {
      return BTN_STYLE;
    },
  },

  methods: {
    modeBtnStyle(m) {
      return {
        ...BTN_STYLE,
        width: "auto",
        padding: "0 8px",
        "--btn-bg": this.mode === m ? "lightblue" : "whitesmoke",
      };
    },

    async setMode(m) {
      this.mode = m;
      await fetch(`${config.tvTvUrl}/tv/mode/${m}`);
    },

    async tvCmd(cmd) {
      const res = await fetch(`${config.tvTvUrl}/tv/${cmd}`);
      const data = await res.json();
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
