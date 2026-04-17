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
    <div style="display: flex; gap: 8px; align-items: center">
      <input
        ref="textInput"
        v-model="inputText"
        type="text"
        style="
          flex: 1;
          padding: 8px;
          font-size: 16px;
          border: 1px solid #bbb;
          border-radius: 5px;
          box-sizing: border-box;
          text-align: left;
        "
        placeholder="Type here..."
        @keydown.enter="sendText"
      />
    </div>
    <div style="overflow-y: auto; flex: 1">
      <div
        v-for="(item, idx) in history"
        :key="item"
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

export default {
  name: "KeyboardPane",
  data() {
    return {
      inputText: "",
      history: [],
    };
  },
  methods: {
    async sendText() {
      const text = this.inputText.trim();
      if (!text) return;
      for (let i = 0; i < 50; i++) {
        try {
          await fetch(config.tvTvUrl + "/tv/keyevent/KEYCODE_DEL");
        } catch (e) {}
      }
      try {
        await fetch(config.tvTvUrl + "/tv/text?t=" + encodeURIComponent(text));
      } catch (e) {
        console.error("[keybd] text error:", e);
      }
      try {
        await fetch(config.tvTvUrl + "/tv/keyevent/KEYCODE_ENTER");
      } catch (e) {
        console.error("[keybd] enter error:", e);
      }
      this.history = [text, ...this.history.filter((i) => i !== text)];
      this.inputText = "";
    },
    async sendKeyevent(code) {
      try {
        await fetch(config.tvTvUrl + "/tv/keyevent/" + code);
      } catch (e) {
        console.error("[keybd] keyevent error:", e);
      }
    },
    recallHistory(item) {
      this.inputText = item;
      this.$nextTick(() => this.$refs.textInput.focus());
    },
  },
};
</script>
