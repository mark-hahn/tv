<template>
  <div
    v-if="path"
    style="
      position: fixed;
      inset: 0;
      z-index: 5000;
      background: #000;
      display: flex;
      align-items: center;
      justify-content: center;
    "
    @click.self="close"
  >
    <video
      ref="vid"
      controls
      autoplay
      :src="streamUrl"
      style="max-width: 100%; max-height: 100%; outline: none; display: block"
      @dblclick="toggleFullscreen"
    />
  </div>
</template>

<script>
import { config } from "../config.js";

const TV_SRVR_URL = config.tvSrvrUrl;

export default {
  name: "VideoPlayer",
  props: {
    path: { type: String, default: null },
  },
  emits: ["close"],
  computed: {
    streamUrl() {
      if (!this.path) return "";
      return `${TV_SRVR_URL}/api/stream?path=${encodeURIComponent(this.path)}`;
    },
  },
  methods: {
    close() {
      const vid = this.$refs.vid;
      if (vid) {
        vid.pause();
        vid.src = "";
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      this.$emit("close");
    },
    toggleFullscreen() {
      const vid = this.$refs.vid;
      if (!vid) return;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        vid.requestFullscreen().catch(() => {});
      }
    },
    onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    },
  },
  mounted() {
    window.addEventListener("keydown", this.onKeyDown);
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onKeyDown);
  },
};
</script>
