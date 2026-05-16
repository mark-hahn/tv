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
    <!-- Top bar -->
    <div
      style="
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 5001;
        display: flex;
        align-items: center;
        padding: 6px 14px 6px 0;
        background: rgba(0, 0, 0, 0.75);
      "
    >
      <!-- Chksrt filename (chksrt mode only) -->
      <div
        v-if="mode === 'chksrt'"
        style="
          flex: 1;
          display: flex;
          align-items: center;
          padding-left: 14px;
          overflow: hidden;
          gap: 6px;
        "
      >
        <span
          v-if="chksrtMatch"
          style="
            color: yellow;
            font-size: 13px;
            flex-shrink: 0;
            text-shadow: 0 0 3px #000;
            user-select: none;
          "
          >Match</span
        >
        <span
          style="
            color: white;
            font-size: 13px;
            user-select: none;
            text-shadow: 0 0 3px #000;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          "
          >{{ chksrtFilename }}</span
        >
      </div>
      <!-- Filename (non-chksrt modes) -->
      <div
        v-else
        style="
          padding-left: 14px;
          padding-right: 14px;
          overflow: hidden;
          flex-shrink: 1;
          min-width: 0;
        "
      >
        <span
          style="
            color: white;
            font-size: 13px;
            user-select: none;
            text-shadow: 0 0 3px #000;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            display: block;
          "
          >{{ path ? path.split("/").pop() : "" }}{{ activeTrackSuffix }}</span
        >
      </div>
      <!-- Timing slider (srt tracks only, not in chksrt/simple mode) -->
      <div
        v-if="showSlider && mode !== 'chksrt' && mode !== 'simple'"
        ref="slider"
        style="
          flex: 1;
          margin: 0 30px;
          position: relative;
          height: 44px;
          cursor: pointer;
          user-select: none;
        "
        @mousedown.stop.prevent="sliderMouseDown"
        @touchstart.stop.prevent="sliderTouchStart"
      >
        <!-- Tick marks and labels -->
        <template
          v-for="t in ticks"
          :key="t.val"
        >
          <div
            :style="{
              position: 'absolute',
              left: t.pct + '%',
              top: '8px',
              width: '1px',
              height: '10px',
              background: 'white',
              transform: 'translateX(-50%)',
            }"
          />
          <div
            :style="{
              position: 'absolute',
              left: t.pct + '%',
              top: '30px',
              fontSize: '12px',
              color: 'white',
              transform: 'translateX(-50%)',
              lineHeight: '1',
            }"
          >
            {{ t.val }}
          </div>
        </template>
        <!-- Line -->
        <div
          style="
            position: absolute;
            top: 22px;
            left: 0;
            right: 0;
            height: 2px;
            background: white;
          "
        />
        <!-- Ball -->
        <div
          :style="{
            position: 'absolute',
            top: '16px',
            left: ballPct + '%',
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: 'white',
            transform: 'translateX(-50%)',
            boxShadow: '0 0 4px rgba(0,0,0,0.8)',
          }"
        />
      </div>
      <!-- Offset value -->
      <div
        v-if="showSlider && mode !== 'chksrt' && mode !== 'simple'"
        style="
          color: white;
          font-size: 13px;
          min-width: 42px;
          text-align: right;
          padding-right: 8px;
          user-select: none;
          text-shadow: 0 0 3px #000;
        "
      >
        {{ offsetDisplay }}
      </div>
      <!-- Apply button (srt only, not in chksrt/simple mode) -->
      <div
        v-if="showSlider && mode !== 'chksrt' && mode !== 'simple'"
        @click.stop="applySliderOffset"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(0, 0, 0, 0.5);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        Apply
      </div>
      <!-- Chksrt OK / Bad buttons -->
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickOk"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(0, 100, 0, 0.5);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        OK
      </div>
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickGenSrt"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(120, 0, 0, 0.5);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        GenSrt
      </div>
      <!-- Subtitle choice buttons -->
      <div
        v-if="mode !== 'simple'"
        v-for="(choice, i) in subtitleChoices"
        :key="choice.id"
        @click.stop="onChoiceClick(choice, $event)"
        :style="{
          marginLeft:
            i === 0 && !showSlider && mode !== 'chksrt' ? 'auto' : '0',
          padding: '2px 8px',
          borderRadius: '4px',
          border:
            chksrtMatch &&
            (subtitleLabelMap.get(choice.id) ?? choice.label) ===
              chksrtMatch.choice
              ? '2px solid yellow'
              : activeTrackId === choice.id
                ? '2px solid white'
                : '1px solid #666',
          color: activeTrackId === choice.id ? 'white' : '#999',
          fontSize: '13px',
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: 'rgba(0,0,0,0.5)',
          textShadow: '0 0 3px #000',
          fontWeight: 'bold',
          whiteSpace: 'nowrap',
          marginRight: '8px',
        }"
      >
        {{
          mode === "chksrt"
            ? (subtitleLabelMap.get(choice.id) ?? choice.label)
            : choice.type && choice.type !== "srt"
              ? choice.label + " *"
              : choice.label
        }}
      </div>
      <!-- Sel button (chksrt mode only) -->
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickSel"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(0, 0, 100, 0.5);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        Sel
      </div>
      <!-- X close -->
      <div
        @click.stop="close"
        style="
          margin-left: auto;
          color: white;
          font-size: 28px;
          line-height: 1;
          cursor: pointer;
          user-select: none;
          text-shadow: 0 0 4px #000;
          padding-left: 14px;
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
      :src="vidSrc"
      style="max-width: 100%; max-height: 100%; outline: none; display: block"
      @dblclick="toggleFullscreen"
      @error="onVideoError"
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
import {
  applySubOffset,
  chksrtOk,
  chksrtGenSrt,
  chksrtSelect,
  getChksrtHistory,
  addChksrtHistory,
} from "../srvr.js";

const TV_SRVR_URL = config.tvSrvrUrl;
const offsetCache = new Map(); // in-memory per-file subtitle offset

export default {
  name: "VideoPlayer",
  props: {
    path: { type: String, default: null },
    mode: { type: String, default: null },
    chksrtCount: { type: Number, default: 0 },
  },
  emits: ["close", "chksrt-next", "chksrt-sel"],
  data() {
    return {
      subtitleTracks: [],
      activeTrackId: null,
      subtitleOffset: 0,
      vidSrc: "",
      errorRetries: 0,
      chksrtMatch: null,
    };
  },
  computed: {
    streamUrl() {
      if (!this.path) return "";
      return `${TV_SRVR_URL}/api/stream?path=${encodeURIComponent(this.path)}`;
    },
    activeTrack() {
      if (!this.activeTrackId || this.activeTrackId === "off") return null;
      return (
        this.subtitleTracks.find((t) => t.id === this.activeTrackId) || null
      );
    },
    activeTrackUrl() {
      const track = this.activeTrack;
      if (!track || !this.path) return null;
      const base = `${TV_SRVR_URL}/api/subtitle?path=${encodeURIComponent(this.path)}`;
      if (
        track.type === "embedded" ||
        track.type === "forced" ||
        track.type === "pgs"
      )
        return `${base}&index=${track.index}`;
      if (track.type === "srt") {
        let url = `${base}&file=${encodeURIComponent(track.file)}`;
        if (this.subtitleOffset !== 0) url += `&offset=${this.subtitleOffset}`;
        return url;
      }
      return null;
    },
    showSlider() {
      return this.activeTrack?.type === "srt";
    },
    activeTrackSuffix() {
      const track = this.activeTrack;
      if (!track) return "";
      const keywords = ["SDH", "CC", "HI", "FORCED"];
      const src = [
        track.type === "forced" ? "forced" : "",
        track.label || "",
        track.file || "",
      ]
        .join(" ")
        .toUpperCase();
      const found = keywords.filter((k) => src.includes(k));
      return found.length ? " (" + found.join(", ") + ")" : "";
    },
    ballPct() {
      return ((this.subtitleOffset + 3) / 6) * 100;
    },
    offsetDisplay() {
      return this.subtitleOffset.toFixed(2);
    },
    ticks() {
      return [-3, -2, -1, 0, 1, 2, 3].map((v) => ({
        val: v,
        pct: ((v + 3) / 6) * 100,
      }));
    },
    subtitleChoices() {
      if (this.subtitleTracks.length === 0) return [];
      return [...this.subtitleTracks, { id: "off", label: "off" }];
    },
    subtitleLabelMap() {
      const map = new Map();
      let n = 1;
      for (const t of this.subtitleTracks) {
        let char;
        if (t.type === "pgs") char = "*";
        else if (t.type === "embedded") char = "t";
        else if (t.type === "forced") char = "f";
        else if (/\.asr\.srt$/.test(t.file || "")) char = "+";
        else if (/\.mb\d+\.srt$/.test(t.file || "")) char = "e";
        else if (/\.opn[A-Z2-7]{5}\.srt$/i.test(t.file || "")) char = "v";
        else char = "s";
        map.set(t.id, char.toUpperCase());
        n++;
      }
      map.set("off", "off");
      return map;
    },
    chksrtFilename() {
      if (!this.path) return "";
      const parts = this.path.split("/");
      const name = parts[parts.length - 1];
      return this.chksrtCount > 0 ? `(${this.chksrtCount}) ${name}` : name;
    },
  },
  watch: {
    path(newVal) {
      this._mseStop();
      this.subtitleTracks = [];
      this.activeTrackId = null;
      this.chksrtMatch = null;
      this.errorRetries = 0;
      this.vidSrc = newVal ? this.streamUrl : "";
      this.subtitleOffset = offsetCache.get(newVal) ?? 0;
      if (newVal) this._fetchSubtitleList(newVal);
    },
    activeTrackUrl(newVal) {
      if (newVal) {
        this.$nextTick(() => {
          const vid = this.$refs.vid;
          if (vid) for (const tt of vid.textTracks) tt.mode = "showing";
        });
      }
    },
  },
  methods: {
    _buildStreamUrl(subIndex = null) {
      let url = `${TV_SRVR_URL}/api/stream?path=${encodeURIComponent(this.path)}`;
      if (subIndex !== null) url += `&sub=${subIndex}`;
      return url;
    },
    async _fetchSubtitleList(filePath) {
      try {
        const resp = await fetch(
          `${TV_SRVR_URL}/api/subtitle-list?path=${encodeURIComponent(filePath)}`,
        );
        if (!resp.ok) return;
        const tracks = await resp.json();
        this.subtitleTracks = tracks;
        if (tracks.length > 0) {
          this.activeTrackId = tracks[0].id;
          if (tracks[0].type === "pgs") {
            this.vidSrc = this._buildStreamUrl(tracks[0].index);
          }
        }
        if (this.mode === "chksrt")
          await this._loadChksrtHistoryAndCompare(filePath);
      } catch (e) {
        console.error("[subtitle-list] fetch error:", e);
      }
    },
    selectTrack(id) {
      const prevTrack = this.activeTrack;
      this.activeTrackId = id;
      const newTrack = this.subtitleTracks.find((t) => t.id === id) || null;
      const wasPgs = prevTrack?.type === "pgs";
      const isPgs = newTrack?.type === "pgs";
      if (isPgs) {
        this.vidSrc = this._buildStreamUrl(newTrack.index);
      } else if (wasPgs) {
        this.vidSrc = this.streamUrl;
      }
      if (id === "off") {
        const vid = this.$refs.vid;
        if (vid) for (const tt of vid.textTracks) tt.mode = "disabled";
      }
    },
    _setOffsetFromX(clientX) {
      const rect = this.$refs.slider.getBoundingClientRect();
      const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
      const raw = (x / rect.width) * 6 - 3;
      this.subtitleOffset = Math.round(raw / 0.05) * 0.05;
      offsetCache.set(this.path, this.subtitleOffset);
    },
    sliderMouseDown(e) {
      this._setOffsetFromX(e.clientX);
      const onMove = (e) => this._setOffsetFromX(e.clientX);
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    sliderTouchStart(e) {
      this._setOffsetFromX(e.touches[0].clientX);
      const onMove = (e) => this._setOffsetFromX(e.touches[0].clientX);
      const onEnd = () => {
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onEnd);
      };
      window.addEventListener("touchmove", onMove, { passive: true });
      window.addEventListener("touchend", onEnd);
    },
    onVideoError(e) {
      const vid = this.$refs.vid;
      if (!vid) return;
      if (!this.vidSrc) return;
      const err = vid.error;
      if (!err) return;
      if (this.errorRetries >= 3) {
        console.log(
          `[video] error code=${err.code}, giving up after ${this.errorRetries} retries`,
        );
        return;
      }
      this.errorRetries++;
      const resumeAt = vid.currentTime;
      console.log(
        `[video] error code=${err.code} at ${resumeAt.toFixed(1)}s, retry ${this.errorRetries}`,
      );
      this._mseStop();
      setTimeout(() => {
        const v = this.$refs.vid;
        if (!v) return;
        if (resumeAt > 0) {
          this._mseRecover(resumeAt);
        } else {
          v.load();
          v.play().catch(() => {});
        }
      }, 1000);
    },
    _mseStop() {
      if (this._mseAbort) {
        this._mseAbort.abort();
        this._mseAbort = null;
      }
    },
    _mseRecover(startSec) {
      const vid = this.$refs.vid;
      if (!vid) return;
      const url = `${this.streamUrl}&start=${Math.floor(startSec)}`;
      const mimeType = 'video/mp4; codecs="avc1.640028,mp4a.40.2"';
      if (!window.MediaSource || !MediaSource.isTypeSupported(mimeType)) {
        vid.load();
        vid.play().catch(() => {});
        return;
      }
      const abort = new AbortController();
      this._mseAbort = abort;
      const ms = new MediaSource();
      const blobUrl = URL.createObjectURL(ms);
      ms.addEventListener(
        "sourceopen",
        async () => {
          URL.revokeObjectURL(blobUrl);
          let sb;
          try {
            sb = ms.addSourceBuffer(mimeType);
          } catch (e) {
            if (!abort.signal.aborted) {
              vid.load();
              vid.play().catch(() => {});
            }
            return;
          }
          sb.timestampOffset = startSec;
          let res;
          try {
            res = await fetch(url, { signal: abort.signal });
            if (!res.ok) throw new Error(String(res.status));
          } catch (e) {
            if (!abort.signal.aborted) {
              vid.load();
              vid.play().catch(() => {});
            }
            return;
          }
          const reader = res.body.getReader();
          try {
            while (!abort.signal.aborted) {
              const { done, value } = await reader.read();
              if (done) {
                ms.endOfStream();
                break;
              }
              sb.appendBuffer(value);
              await new Promise((ok, fail) => {
                sb.addEventListener("updateend", ok, { once: true });
                sb.addEventListener("error", fail, { once: true });
              });
            }
          } catch (e) {
            if (!abort.signal.aborted) console.error("[mse]", e);
          }
          if (abort.signal.aborted) reader.cancel().catch(() => {});
        },
        { once: true },
      );
      this.vidSrc = blobUrl;
    },
    async _loadChksrtHistoryAndCompare(forPath) {
      this.chksrtMatch = null;
      let history;
      try {
        history = await getChksrtHistory();
      } catch (e) {
        return;
      }
      if (this.path !== forPath) return; // stale — path changed while fetching
      if (!Array.isArray(history) || history.length === 0) return;
      const pathParts = forPath.split("/");
      const videoFilename = pathParts[pathParts.length - 1];
      const showName = forPath.startsWith("/mnt/media/tv/")
        ? forPath.slice("/mnt/media/tv/".length).split("/")[0]
        : "";
      const embeddedCounts = {};
      let openSubsCount = 0;
      for (const t of this.subtitleTracks) {
        if (t.type === "pgs")
          embeddedCounts.pgs = (embeddedCounts.pgs || 0) + 1;
        else if (t.type === "embedded" || t.type === "forced")
          embeddedCounts.text = (embeddedCounts.text || 0) + 1;
        else if (
          t.type === "srt" &&
          /\.opn[A-Z2-7]{5}\.srt$/i.test(t.file || "")
        )
          openSubsCount++;
      }
      const last12 = videoFilename.slice(-12);
      const ecStr = JSON.stringify(embeddedCounts);
      for (const h of history) {
        if (h.showName !== showName) continue;
        if ((h.videoFilename || "").slice(-12) !== last12) continue;
        if (JSON.stringify(h.embeddedCounts || {}) !== ecStr) continue;
        this.chksrtMatch = h;
        break;
      }
    },
    _saveChksrtHistory(choiceLabel) {
      if (!this.path) return;
      const pathParts = this.path.split("/");
      const videoFilename = pathParts[pathParts.length - 1];
      const showName = this.path.startsWith("/mnt/media/tv/")
        ? this.path.slice("/mnt/media/tv/".length).split("/")[0]
        : "";
      const embeddedCounts = {};
      let openSubsCount = 0;
      for (const t of this.subtitleTracks) {
        if (t.type === "pgs")
          embeddedCounts.pgs = (embeddedCounts.pgs || 0) + 1;
        else if (t.type === "embedded" || t.type === "forced")
          embeddedCounts.text = (embeddedCounts.text || 0) + 1;
        else if (
          t.type === "srt" &&
          /\.opn[A-Z2-7]{5}\.srt$/i.test(t.file || "")
        )
          openSubsCount++;
      }
      addChksrtHistory({
        showName,
        videoFilename,
        embeddedCounts,
        openSubsCount,
        choice: choiceLabel,
      }).catch((e) => console.error("[chksrt] addChksrtHistory error:", e));
    },
    async applySliderOffset() {
      const track = this.activeTrack;
      if (!track || track.type !== "srt" || this.subtitleOffset === 0) return;
      const offsetMs = Math.round(this.subtitleOffset * 1000);
      try {
        await applySubOffset({
          videoPath: this.path,
          srtFile: track.file,
          offsetMs,
        });
        offsetCache.set(this.path, 0);
        this.subtitleOffset = 0;
      } catch (e) {
        console.error("[applySliderOffset]", e);
      }
    },
    async clickOk() {
      try {
        await chksrtOk(this.path);
        this.$emit("chksrt-next", null);
      } catch (e) {
        console.error("[chksrt] clickOk error:", e);
      }
    },
    async clickGenSrt() {
      const embedded = this.subtitleTracks.filter(
        (t) => t.type === "embedded" || t.type === "forced" || t.type === "pgs",
      );
      const currentIdx = embedded.findIndex((t) => t.id === this.activeTrackId);
      if (currentIdx >= 0 && currentIdx < embedded.length - 1) {
        this.selectTrack(embedded[currentIdx + 1].id);
      } else {
        try {
          await chksrtGenSrt(this.path);
          this.$emit("chksrt-next", null);
        } catch (e) {
          console.error("[chksrt] clickGenSrt error:", e);
        }
      }
    },
    onChoiceClick(choice, event) {
      if (event.ctrlKey && this.mode === "chksrt") {
        const choiceLabel =
          this.subtitleLabelMap.get(choice.id) ?? choice.label;
        if (choice.type === "srt" && choice.file) {
          const dir = this.path.replace(/\/[^\/]+$/, "");
          const selectedSrtPath = dir + "/" + choice.file;
          this._saveChksrtHistory(choiceLabel);
          chksrtSelect(this.path, selectedSrtPath)
            .then(() => this.$emit("chksrt-next", null))
            .catch((e) => console.error("[chksrt] select error:", e));
        } else if (
          choice.type === "embedded" ||
          choice.type === "forced" ||
          choice.type === "pgs"
        ) {
          this._saveChksrtHistory(choiceLabel);
          chksrtSelect(this.path, null)
            .then(() => this.$emit("chksrt-next", null))
            .catch((e) => console.error("[chksrt] select error:", e));
        } else {
          this.selectTrack(choice.id);
        }
      } else {
        this.selectTrack(choice.id);
      }
    },
    clickSel() {
      this._mseStop();
      this.vidSrc = "";
      const vid = this.$refs.vid;
      if (vid) {
        vid.pause();
        vid.src = "";
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      this.$emit("chksrt-sel", this.path);
    },
    close() {
      this._mseStop();
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
    this.vidSrc = this.path ? this.streamUrl : "";
    this.subtitleOffset = offsetCache.get(this.path) ?? 0;
    if (this.path) this._fetchSubtitleList(this.path);
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onKeyDown);
  },
};
</script>
