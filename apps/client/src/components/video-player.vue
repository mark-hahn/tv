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
    <div
      style="
        position: absolute;
        top: 10px;
        right: 14px;
        z-index: 5001;
        display: flex;
        align-items: center;
        gap: 8px;
      "
    >
      <div
        v-for="choice in subtitleChoices"
        :key="choice.id"
        @click.stop="selectTrack(choice.id)"
        :style="{
          padding: '2px 8px',
          borderRadius: '4px',
          border:
            activeTrackId === choice.id ? '2px solid white' : '1px solid #666',
          color: activeTrackId === choice.id ? 'white' : '#999',
          fontSize: '13px',
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: 'rgba(0,0,0,0.5)',
          textShadow: '0 0 3px #000',
          whiteSpace: 'nowrap',
        }"
      >
        {{ choice.label }}
      </div>
      <div
        @click.stop="close"
        style="
          color: white;
          font-size: 28px;
          line-height: 1;
          cursor: pointer;
          user-select: none;
          text-shadow: 0 0 4px #000;
        "
      >
        ✕
      </div>
    </div>
    <video
      ref="vid"
      controls
      autoplay
      crossorigin="anonymous"
      :src="streamUrl"
      style="max-width: 100%; max-height: 100%; outline: none; display: block"
      @dblclick="toggleFullscreen"
    >
      <track
        v-if="activeTrackUrl"
        :key="activeTrackUrl"
        kind="subtitles"
        srclang="en"
        label="subtitles"
        :src="activeTrackUrl"
        default
      />
    </video>
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
  data() {
    return {
      subtitleTracks: [],
      activeTrackId: null,
    };
  },
  computed: {
    streamUrl() {
      if (!this.path) return "";
      return `${TV_SRVR_URL}/api/stream?path=${encodeURIComponent(this.path)}`;
    },
    activeTrackUrl() {
      if (!this.activeTrackId || this.activeTrackId === "off" || !this.path)
        return null;
      const track = this.subtitleTracks.find(
        (t) => t.id === this.activeTrackId,
      );
      if (!track) return null;
      const base = `${TV_SRVR_URL}/api/subtitle?path=${encodeURIComponent(this.path)}`;
      if (track.type === "embedded") return `${base}&index=${track.index}`;
      if (track.type === "srt")
        return `${base}&file=${encodeURIComponent(track.file)}`;
      return null;
    },
    subtitleChoices() {
      if (this.subtitleTracks.length === 0) return [];
      return [...this.subtitleTracks, { id: "off", label: "off" }];
    },
  },
  watch: {
    path(newVal) {
      this.subtitleTracks = [];
      this.activeTrackId = null;
      if (newVal) this._fetchSubtitleList(newVal);
    },
  },
  methods: {
    async _fetchSubtitleList(filePath) {
      try {
        const resp = await fetch(
          `${TV_SRVR_URL}/api/subtitle-list?path=${encodeURIComponent(filePath)}`,
        );
        if (!resp.ok) return;
        const tracks = await resp.json();
        this.subtitleTracks = tracks;
        if (tracks.length > 0) this.activeTrackId = tracks[0].id;
      } catch (e) {
        console.error("[subtitle-list] fetch error:", e);
      }
    },
    selectTrack(id) {
      this.activeTrackId = id;
      if (id === "off") {
        const vid = this.$refs.vid;
        if (vid) for (const tt of vid.textTracks) tt.mode = "disabled";
      } else {
        // Wait for Vue to (re-)insert the <track> element, then force showing
        this.$nextTick(() => {
          const vid = this.$refs.vid;
          if (vid) for (const tt of vid.textTracks) tt.mode = "showing";
        });
      }
    },
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
    if (this.path) this._fetchSubtitleList(this.path);
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onKeyDown);
  },
};
</script>
