<template>
  <div
    style="
      padding: 12px;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 10px;
    "
  >
    <!-- Input row -->
    <div style="display: flex; gap: 8px; align-items: center">
      <input
        ref="textInput"
        v-model="inputText"
        type="text"
        style="
          width: 25%;
          padding: 8px;
          font-size: 16px;
          border: 1px solid #bbb;
          border-radius: 5px;
          box-sizing: border-box;
        "
        placeholder="Type here..."
        @keydown.enter="sendText"
      />
      <button
        @click="sendBackspace"
        :style="btnStyle"
      >
        Backspace
      </button>
      <button
        @click="sendSearch"
        :style="btnStyle"
      >
        Search
      </button>
      <button
        @click="sendEnter"
        :style="btnStyle"
      >
        Enter
      </button>
      <button
        @click="sendHaKey('back')"
        :style="btnStyle"
      >
        ↩ Back
      </button>
      <button
        @click="sendHaKey('ok')"
        :style="btnStyle"
      >
        OK
      </button>
    </div>
    <!-- History list -->
    <div style="overflow-y: auto; flex: 1">
      <div
        v-for="(item, idx) in history"
        :key="idx"
        @click="recallHistory(item)"
        style="
          padding: 6px 8px;
          border-bottom: 1px solid #eee;
          cursor: pointer;
          font-size: 15px;
          user-select: none;
        "
        :style="{ backgroundColor: idx % 2 === 0 ? '#fafafa' : '#fff' }"
      >
        {{ item }}
      </div>
    </div>
  </div>
</template>

<script>
import { config } from "../config.js";

const btnStyle = {
  padding: "8px 12px",
  fontSize: "14px",
  cursor: "pointer",
  border: "1px solid #bbb",
  borderRadius: "5px",
  backgroundColor: "whitesmoke",
  whiteSpace: "nowrap",
};

export default {
  name: "KeyboardPane",
  data() {
    return {
      inputText: "",
      history: [],
      btnStyle,
    };
  },
  methods: {
    async sendText() {
      const text = this.inputText.trim();
      if (!text) return;
      try {
        await fetch(`${config.tvTvUrl}/tv/text?t=${encodeURIComponent(text)}`);
      } catch (e) {
        console.error("[keybd] text error:", e);
      }
      this.history.unshift(text);
      this.inputText = "";
    },
    async sendKeyevent(code) {
      try {
        await fetch(`${config.tvTvUrl}/tv/keyevent/${code}`);
      } catch (e) {
        console.error("[keybd] keyevent error:", e);
      }
    },
    sendBackspace() {
      this.sendKeyevent("KEYCODE_DEL");
    },
    sendSearch() {
      this.sendKeyevent("KEYCODE_SEARCH");
    },
    sendEnter() {
      this.sendKeyevent("KEYCODE_ENTER");
    },
    async sendHaKey(key) {
      try {
        await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      } catch (e) {
        console.error("[keybd] ha key error:", e);
      }
    },
    recallHistory(item) {
      this.inputText = item;
      this.$nextTick(() => this.$refs.textInput.focus());
    },
  },
};
</script>
