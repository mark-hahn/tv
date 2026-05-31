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
          >{{ chksrtFilename }}{{ activeTrackSuffix }}</span
        >
      </div>
      <!-- Filename (non-chksrt, non-intro modes) -->
      <div
        v-else-if="mode !== 'intro'"
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
      <!-- Intro mode: show name (left) -->
      <div
        v-else
        style="
          flex: 1;
          display: flex;
          align-items: center;
          padding-left: 14px;
          overflow: hidden;
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
          "
          >{{ introRemainingCount > 0 ? `(${introRemainingCount}) ` : ""
          }}{{ introShow ? introShow.name : ""
          }}{{ introSeasonEpisodeLabel }}</span
        >
      </div>
      <!-- Intro mode: mark controls (right, next to X) -->
      <template v-if="mode === 'intro'">
        <div
          v-if="waitingForVideo"
          style="
            position: absolute;
            left: 0;
            right: 0;
            top: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            color: yellow;
            font-size: 16px;
            user-select: none;
            text-shadow: 0 0 3px #000;
            pointer-events: none;
          "
        >
          Waiting for video
        </div>
        <template v-if="!waitingForVideo">
          <div
            v-if="seekTarget !== null"
            style="
              color: yellow;
              font-size: 13px;
              user-select: none;
              text-shadow: 0 0 3px #000;
              flex-shrink: 0;
              margin-right: 8px;
            "
          >
            {{ fmtTime(seekTarget * 1000) }}
          </div>
          <div
            style="
              color: white;
              font-size: 13px;
              min-width: 52px;
              text-align: right;
              user-select: none;
              text-shadow: 0 0 3px #000;
              flex-shrink: 0;
              margin-right: 14px;
            "
          >
            {{ fmtTime(currentTimeSec * 1000) }}
          </div>
        </template>
        <div
          @click.stop="clickIntroZero"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 0;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
            width: 50px;
            text-align: center;
          "
        >
          0
        </div>
        <div
          @click.stop="clickNavBack30"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          &lt;&lt;
        </div>
        <div
          @click.stop="clickNavBack10"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          &lt;
        </div>
        <div
          @click.stop="clickNavFwd10"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          &gt;
        </div>
        <div
          @click.stop="clickNavFwd30"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 20px;
          "
        >
          &gt;&gt;
        </div>
        <div
          @click.stop="clickIntroPre"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          Pre
        </div>
        <div
          @click.stop="clickIntroStart"
          style="
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 80, 0, 0.6);
            white-space: nowrap;
            flex-shrink: 0;
            width: 74px;
            text-align: center;
            margin-right: 6px;
          "
          :style="{ color: startMark < 2000 ? 'yellow' : 'white' }"
        >
          {{ introStartLabel }}
        </div>
        <div
          @click.stop="clickIntroEnd"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(80, 0, 0, 0.6);
            white-space: nowrap;
            flex-shrink: 0;
            width: 74px;
            text-align: center;
            margin-right: 6px;
          "
        >
          {{ introEndLabel }}
        </div>
        <div
          style="
            color: black;
            font-size: 13px;
            font-weight: bold;
            padding: 2px 8px;
            border-radius: 4px;
            background: white;
            white-space: nowrap;
            flex-shrink: 0;
            min-width: 60px;
            text-align: center;
            margin-right: 6px;
          "
        >
          {{ introDurLabel }}
        </div>
        <div
          @click.stop="clickIntroTest"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 100, 0.6);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          Test
        </div>
        <div
          @click.stop="clickIntroClear"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(100, 40, 0, 0.7);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          Clear
        </div>
        <div
          @click.stop="clickIntroNone"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
          :style="{
            background: isIntroNone
              ? 'rgba(0, 90, 0, 0.9)'
              : 'rgba(0, 0, 0, 0.5)',
          }"
        >
          None
        </div>
        <div
          @click.stop="clickIntroAnt"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
          :style="{
            background: introShow?.anticipating
              ? 'rgba(180, 50, 50, 0.9)'
              : 'rgba(0, 0, 0, 0.5)',
          }"
        >
          Ant
        </div>
        <div
          @click.stop="introSource !== 'map' && clickIntroEpi()"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
          :style="{
            background: epiNext ? 'rgba(0, 90, 0, 0.9)' : 'rgba(0, 0, 0, 0.5)',
            cursor: introSource !== 'map' ? 'pointer' : 'default',
            opacity: introSource !== 'map' ? 1 : 0.35,
          }"
        >
          Epi
        </div>
        <div
          @click.stop="clickIntroNext"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 0, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          Next
        </div>
      </template>
      <!-- Timing slider (srt tracks only, not in chksrt/simple/intro mode) -->
      <div
        v-if="
          showSlider &&
          mode !== 'chksrt' &&
          mode !== 'simple' &&
          mode !== 'intro'
        "
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
        v-if="
          showSlider &&
          mode !== 'chksrt' &&
          mode !== 'simple' &&
          mode !== 'intro'
        "
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
      <!-- Apply button (srt only, not in chksrt/simple/intro mode) -->
      <div
        v-if="
          showSlider &&
          mode !== 'chksrt' &&
          mode !== 'simple' &&
          mode !== 'intro'
        "
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
        v-if="mode !== 'simple' && mode !== 'intro'"
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
        {{ subtitleLabelMap.get(choice.id) ?? choice.label }}
      </div>
      <!-- Sel button (chksrt mode only) -->
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickChksrtAnt"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
        :style="{
          background: chksrtShowObj?.anticipating
            ? 'rgba(180, 50, 50, 0.9)'
            : 'rgba(0, 0, 0, 0.5)',
        }"
      >
        Ant
      </div>
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
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickChksrtNext"
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
        Next
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
      :muted="playerMuted"
      crossorigin="anonymous"
      :src="vidSrc"
      style="max-width: 100%; max-height: 100%; outline: none; display: block"
      @dblclick="toggleFullscreen"
      @error="onVideoError"
      @timeupdate="currentTimeSec = $refs.vid ? $refs.vid.currentTime : 0"
      @loadedmetadata="onVideoLoadedMetadata"
      @volumechange="onVideoVolumeChange"
      @durationchange="onVideoDurationChange"
      @seeked="onVideoSeeked"
      @play="onVideoPlay"
      @pause="onVideoPause"
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
  setTvdbFields,
} from "../srvr.js";

const TV_SRVR_URL = config.tvSrvrUrl;
const PLAYER_MUTE_STORAGE_KEY = "tvPlayerMuted";
const PLAYER_VOLUME_STORAGE_KEY = "tvPlayerVolume";
const offsetCache = new Map(); // in-memory per-file subtitle offset

function fmtTime(ms) {
  const totalSec = ms / 1000;
  const mm = Math.floor(totalSec / 60).toString();
  const ss = Math.floor(totalSec % 60)
    .toString()
    .padStart(2, "0");
  const t = Math.floor((totalSec % 1) * 10);
  return `${mm}:${ss}.${t}`;
}

function parseSeasonEpisodeFromPath(path) {
  if (!path) return { season: null, episode: null };
  const name = String(path).split("/").pop() || "";
  let m = name.match(/[sS](\d{1,2})[eE](\d{1,3})/);
  if (!m) m = name.match(/(?:^|[^0-9])(\d{1,2})x(\d{1,3})(?:[^0-9]|$)/i);
  if (!m) return { season: null, episode: null };

  const season = Number(m[1]);
  const episode = Number(m[2]);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) {
    return { season: null, episode: null };
  }
  return { season, episode };
}

export default {
  name: "VideoPlayer",
  props: {
    path: { type: String, default: null },
    mode: { type: String, default: null },
    chksrtCount: { type: Number, default: 0 },
    introCount: { type: Number, default: 0 },
    introShow: { type: Object, default: null },
    introShows: { type: Array, default: () => [] },
    introSeason: { type: Number, default: null },
    introEpisode: { type: Number, default: null },
    introSource: { type: String, default: null },
  },
  emits: ["close", "chksrt-next", "chksrt-sel", "intro-next"],
  data() {
    return {
      subtitleTracks: [],
      activeTrackId: null,
      subtitleOffset: 0,
      vidSrc: "",
      errorRetries: 0,
      chksrtMatch: null,
      startMark: 0,
      endMark: 0,
      currentTimeSec: 0,
      seekTarget: null,
      playerMuted: false,
      playerVolume: 1,
      introSavedMarks: {},
      waitingForVideo: false,
      waitingForVideoTarget: null,
      introMarkDirty: false,
      introLocalNone: false,
      epiNext: false,
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
        else if (t.type === "sdh") char = "H";
        else if (t.type === "embedded") char = "T";
        else if (t.type === "forced") char = "F";
        else if (/\.asr\.srt$/.test(t.file || "")) char = "+";
        else if (/\.mb\d+\.srt$/.test(t.file || "")) char = ">";
        else if (/\.opn[A-Z2-7]{5}\.srt$/i.test(t.file || "")) {
          const tag = ((t.file || "").match(/\.opn([A-Z2-7]{5})\.srt$/i) ||
            [])[1];
          char = tag ? `V ${tag.toUpperCase()}` : "V";
        } else char = "S";
        map.set(t.id, char);
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
    chksrtShowName() {
      if (!this.path) return null;
      const parts = this.path.split("/");
      return parts.length >= 3 ? parts[parts.length - 3] : null;
    },
    chksrtShowObj() {
      if (!this.chksrtShowName) return null;
      return (
        this.introShows.find((s) => s.name === this.chksrtShowName) ?? null
      );
    },
    isIntroNone() {
      return (
        this.mode === "intro" &&
        (this.introShow?.introDur === 0 || this.introLocalNone)
      );
    },
    introStartLabel() {
      return this.isIntroNone ? "-" : this.fmtTime(this.startMark);
    },
    introEndLabel() {
      return this.isIntroNone ? "-" : this.fmtTime(this.endMark);
    },
    introDurLabel() {
      if (
        this.mode === "intro" &&
        (this.introShow?.introDur == null || this.isIntroNone)
      ) {
        return "-";
      }
      return this.fmtTime(Math.max(0, this.endMark - this.startMark));
    },
    introSeasonForDisplay() {
      if (this.introSeason != null) return this.introSeason;
      return parseSeasonEpisodeFromPath(this.path).season;
    },
    introEpisodeForDisplay() {
      if (this.introEpisode != null) return this.introEpisode;
      return parseSeasonEpisodeFromPath(this.path).episode;
    },
    introSeasonEpisodeLabel() {
      if (
        this.introSeasonForDisplay == null ||
        this.introEpisodeForDisplay == null
      ) {
        return "";
      }
      return ` (s${String(this.introSeasonForDisplay).padStart(2, "0")}e${String(this.introEpisodeForDisplay).padStart(2, "0")})`;
    },
    introRemainingCount() {
      return this.introCount;
    },
  },
  watch: {
    introShow(newVal, oldVal) {
      if (!newVal?.name) return;
      if (newVal.name !== oldVal?.name) this.epiNext = false;
      this.introMarkDirty = false;
      const tvdbIntroDur = newVal?.introDur ?? null;
      const tvdbStartMark = newVal?.startMark ?? null;

      if (tvdbStartMark == null && tvdbIntroDur == null) {
        // Case 1: nothing set — not yet configured
        this.startMark = 0;
        this.endMark = 0;
        this.introLocalNone = false;
        this._introPlayTargetSec = 0;
        return;
      }

      if (tvdbStartMark != null && tvdbIntroDur == null) {
        // Case 2: startMark set, no introDur — not yet configured
        this.startMark = tvdbStartMark;
        this.endMark = tvdbStartMark;
        this.introLocalNone = false;
        this._introPlayTargetSec = 0;
        return;
      }

      this.introLocalNone = false;

      if (tvdbStartMark == null) {
        // Case 3: introDur set, no startMark
        this.startMark = 0;
        this.endMark = tvdbIntroDur === 0 ? 0 : Math.abs(tvdbIntroDur);
        this._introPlayTargetSec = 0;
        return;
      }

      // Case 4: both introDur and startMark set
      if (tvdbIntroDur < 0) {
        this.startMark = 0;
        this.endMark = Math.abs(tvdbIntroDur);
        this._introPlayTargetSec = 0;
      } else if (tvdbIntroDur === 0) {
        this.startMark = tvdbStartMark;
        this.endMark = tvdbStartMark;
        this._introPlayTargetSec = tvdbStartMark / 1000;
      } else {
        this.startMark = tvdbStartMark;
        this.endMark = tvdbStartMark + tvdbIntroDur;
        this._introPlayTargetSec = tvdbStartMark / 1000;
      }
      this.introSavedMarks = {
        ...this.introSavedMarks,
        [newVal.name]: { startMark: this.startMark, endMark: this.endMark },
      };
    },
    path(newVal) {
      this._mseStop();
      this._chksrtSelectedSrtPath = undefined;
      this._chksrtSelectedChoice = undefined;
      this.subtitleTracks = [];
      this.activeTrackId = null;
      this.chksrtMatch = null;
      this.errorRetries = 0;
      this.vidSrc = newVal ? this.streamUrl : "";
      if (newVal && this.mode === "intro") this._seekOnLoad = true;
      this.subtitleOffset = offsetCache.get(newVal) ?? 0;
      if (newVal) this._fetchSubtitleList(newVal);
      this.introMarkDirty = false;
      this.introLocalNone = false;
      this.waitingForVideo = false;
      this.waitingForVideoTarget = null;
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
      const last12 = videoFilename.slice(-12);
      for (const h of history) {
        if (h.showName !== showName) continue;
        if ((h.videoFilename || "").slice(-12) !== last12) continue;
        this.chksrtMatch = h;
        // Auto-select the previously chosen track
        let matchTrack = null;
        if (h.srtFile) {
          matchTrack =
            this.subtitleTracks.find((t) => t.file === h.srtFile) || null;
        } else if (h.embStreamIndex != null) {
          matchTrack =
            this.subtitleTracks.find((t) => t.index === h.embStreamIndex) ||
            null;
        }
        if (matchTrack) this.selectTrack(matchTrack.id);
        break;
      }
    },
    _saveChksrtHistory(choiceLabel, choice) {
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
        embStreamIndex:
          choice &&
          (choice.type === "embedded" ||
            choice.type === "sdh" ||
            choice.type === "forced" ||
            choice.type === "pgs")
            ? (choice.index ?? null)
            : null,
        srtFile: choice && choice.type === "srt" ? (choice.file ?? null) : null,
      }).catch((e) => console.error("[chksrt] addChksrtHistory error:", e));
    },
    onVideoLoadedMetadata() {
      this._applyIntroAudioState();
      if (this.mode !== "intro") {
        const vid = this.$refs.vid;
        if (vid) vid.play().catch(() => {});
        if (this.mode === "chksrt") return;
      }
      if (!this._seekOnLoad) return;
      this._seekOnLoad = false;
      const targetSec =
        this.mode === "intro" ? 0 : Math.max(0, (this.startMark - 3000) / 1000);
      this._seekWithConfirm(targetSec);
      const vid = this.$refs.vid;
      if (vid) vid.play().catch(() => {});
    },
    onVideoVolumeChange() {
      const vid = this.$refs.vid;
      if (!vid) return;
      const nextMuted = !!vid.muted;
      const nextVolume = Number(vid.volume);
      const volume = Number.isFinite(nextVolume)
        ? Math.max(0, Math.min(1, nextVolume))
        : 1;
      this.playerMuted = nextMuted;
      this.playerVolume = volume;
      window.localStorage.setItem(
        PLAYER_MUTE_STORAGE_KEY,
        nextMuted ? "1" : "0",
      );
      window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(volume));
    },
    _applyIntroAudioState() {
      const vid = this.$refs.vid;
      if (!vid) return;
      vid.muted = this.playerMuted;
      vid.volume = Math.max(0, Math.min(1, Number(this.playerVolume) || 0));
    },
    _seekWithConfirm(targetSec) {
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (!vid) {
        this.seekTarget = null;
        return;
      }
      if (
        this.mode === "intro" &&
        Number.isFinite(vid.duration) &&
        vid.duration > 0 &&
        targetSec > vid.duration
      ) {
        this._enterWaitingForVideo(targetSec);
        return;
      }
      this.seekTarget = targetSec;
      vid.currentTime = targetSec;
      this._seekPollInterval = setInterval(() => {
        const v = this.$refs.vid;
        if (!v || this.seekTarget === null) {
          clearInterval(this._seekPollInterval);
          this._seekPollInterval = null;
          return;
        }
        if (Math.abs(v.currentTime - this.seekTarget) < 1.0) {
          this.seekTarget = null;
          clearInterval(this._seekPollInterval);
          this._seekPollInterval = null;
        } else {
          v.currentTime = this.seekTarget;
        }
      }, 300);
    },
    _cancelSeek() {
      if (this._seekPollInterval) {
        clearInterval(this._seekPollInterval);
        this._seekPollInterval = null;
      }
      this.seekTarget = null;
    },
    clickNavBack30() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (vid) vid.currentTime = Math.max(0, vid.currentTime - 30);
    },
    clickNavBack10() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (vid) vid.currentTime = Math.max(0, vid.currentTime - 10);
    },
    clickNavFwd10() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (vid) vid.currentTime += 10;
    },
    clickNavFwd30() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (vid) vid.currentTime += 30;
    },
    clickIntroZero() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      this.introMarkDirty = true;
      this.startMark = 0;
      const vid = this.$refs.vid;
      if (vid) vid.currentTime = 0;
      this._saveIntroDur();
    },
    clickIntroNone() {
      if (!this.introShow?.name) return;
      this.introMarkDirty = true;
      if (this.isIntroNone) {
        this.introLocalNone = false;
        const saved = this.introSavedMarks[this.introShow.name];
        if (
          saved &&
          Number.isFinite(saved.startMark) &&
          Number.isFinite(saved.endMark)
        ) {
          this.startMark = saved.startMark;
          this.endMark = saved.endMark;
        } else {
          this.startMark = 0;
          this.endMark = 0;
        }
        if (this.introShow?.introDur === 0) {
          this._saveIntroDur();
        }
        return;
      }
      this.introSavedMarks = {
        ...this.introSavedMarks,
        [this.introShow.name]: {
          startMark: this.startMark,
          endMark: this.endMark,
        },
      };
      this._setIntroDur(0);
    },
    clickIntroPre() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      const vid = this.$refs.vid;
      if (!vid) return;
      this._cancelSeek();
      vid.currentTime = Math.max(0, (this.startMark - 3000) / 1000);
    },
    _restoreIntroMarksFromSaved() {
      if (!this.introShow?.name) return;
      this.introLocalNone = false;
      const saved = this.introSavedMarks[this.introShow.name];
      if (
        saved &&
        Number.isFinite(saved.startMark) &&
        Number.isFinite(saved.endMark)
      ) {
        this.startMark = saved.startMark;
        this.endMark = saved.endMark;
      } else {
        this.startMark = 0;
        this.endMark = 0;
      }
    },
    clickIntroStart() {
      const vid = this.$refs.vid;
      if (!vid) return;
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      if (this.isIntroNone) this._restoreIntroMarksFromSaved();
      this.introMarkDirty = true;
      this.startMark = vid.currentTime * 1000;
      this._saveIntroDur();
    },
    clickIntroEnd() {
      const vid = this.$refs.vid;
      if (!vid) return;
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      if (this.isIntroNone) this._restoreIntroMarksFromSaved();
      this.introMarkDirty = true;
      this.endMark = vid.currentTime * 1000;
      this._saveIntroDur();
    },
    clickIntroTest() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      const vid = this.$refs.vid;
      if (!vid) return;
      if (this.startMark < 2000) {
        vid.currentTime = 0;
      }
      const targetSec =
        (this.startMark < 2000 ? 0 : vid.currentTime) +
        Math.max(0, this.endMark - this.startMark) / 1000;
      this._seekWithConfirm(targetSec);
    },
    clickIntroClear() {
      this.introMarkDirty = true;
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._setIntroDur(null);
    },
    _saveIntroDur() {
      if (!this.introShow) return;
      const dur = Math.max(0, this.endMark - this.startMark);
      // Avoid converting a mark click into None mode when start/end are equal.
      if (dur === 0) return;
      const introDur = this.startMark < 2000 ? -dur : dur;
      this._setIntroDur(introDur);
    },
    _setIntroDur(introDur) {
      if (!this.introShow?.name) return;
      this.introShow.introDur = introDur;
      if (introDur !== null) this.introShow.needsIntro = false;
      setTvdbFields({ name: this.introShow.name, introDur }).catch((e) =>
        console.error("[intro] setTvdbFields error:", e),
      );
    },
    clickIntroEpi() {
      this.epiNext = !this.epiNext;
    },
    async clickIntroAnt() {
      if (!this.introShow?.name) return;
      const original = !!this.introShow.anticipating;
      this.introShow.anticipating = !original;
      try {
        await setTvdbFields({
          name: this.introShow.name,
          anticipating: this.introShow.anticipating,
        });
      } catch (e) {
        console.error("clickIntroAnt error:", e);
        this.introShow.anticipating = original;
      }
    },
    async clickChksrtAnt() {
      const show = this.chksrtShowObj;
      if (!show?.name) return;
      const original = !!show.anticipating;
      show.anticipating = !original;
      try {
        await setTvdbFields({
          name: show.name,
          anticipating: show.anticipating,
        });
      } catch (e) {
        console.error("clickChksrtAnt error:", e);
        show.anticipating = original;
      }
    },
    clickIntroNext() {
      if (this.introMarkDirty) this._saveStartMark();
      this.introMarkDirty = false;
      if (this.introSeason != null) this._seekOnLoad = true;
      this.$emit("intro-next", { epiNext: this.epiNext });
    },
    _saveStartMark() {
      if (!this.introShow?.name) return;
      const introDur = this.introShow?.introDur ?? null;
      const markToSave =
        introDur !== null && introDur <= 0 ? 0 : this.startMark;
      setTvdbFields({ name: this.introShow.name, startMark: markToSave }).catch(
        (e) => console.error("[intro] saveStartMark error:", e),
      );
    },
    _exitWaitingForVideo() {
      this.waitingForVideo = false;
      this.waitingForVideoTarget = null;
    },
    _enterWaitingForVideo(targetSec) {
      const vid = this.$refs.vid;
      if (!vid) return;
      this.waitingForVideo = true;
      this.waitingForVideoTarget = targetSec;
      this._waitingForVideoSetup = true;
      vid.pause();
      vid.currentTime = Math.max(0, vid.currentTime - 10);
      setTimeout(() => {
        this._waitingForVideoSetup = false;
      }, 600);
    },
    onVideoDurationChange() {
      if (!this.waitingForVideo || this.waitingForVideoTarget == null) return;
      const vid = this.$refs.vid;
      if (!vid || !Number.isFinite(vid.duration)) return;
      if (vid.duration >= this.waitingForVideoTarget) {
        const target = this.waitingForVideoTarget;
        this._exitWaitingForVideo();
        this._seekWithConfirm(target);
        vid.play().catch(() => {});
      }
    },
    onVideoSeeked() {
      if (this.waitingForVideo && !this._waitingForVideoSetup) {
        this._exitWaitingForVideo();
      }
    },
    onVideoPlay() {
      if (this.waitingForVideo) {
        this._exitWaitingForVideo();
      }
    },
    onVideoPause() {
      if (this.waitingForVideo && !this._waitingForVideoSetup) {
        this._exitWaitingForVideo();
      }
    },
    fmtTime(ms) {
      return fmtTime(ms);
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
      if (this.mode === "chksrt") {
        const choiceLabel =
          this.subtitleLabelMap.get(choice.id) ?? choice.label;
        if (choice.type === "srt" && choice.file) {
          const dir = this.path.replace(/\/[^\/]+$/, "");
          this._chksrtSelectedSrtPath = dir + "/" + choice.file;
          this._chksrtSelectedChoice = { choiceLabel, choice };
          this.selectTrack(choice.id);
        } else if (
          choice.type === "embedded" ||
          choice.type === "sdh" ||
          choice.type === "forced" ||
          choice.type === "pgs"
        ) {
          this._chksrtSelectedSrtPath = null;
          this._chksrtSelectedChoice = { choiceLabel, choice };
          this.selectTrack(choice.id);
        } else {
          this.selectTrack(choice.id);
        }
      } else {
        this.selectTrack(choice.id);
      }
    },
    async _submitChksrtSelection() {
      const sel = this._chksrtSelectedChoice;
      if (sel) {
        this._saveChksrtHistory(sel.choiceLabel, sel.choice);
        await chksrtSelect(this.path, this._chksrtSelectedSrtPath);
      } else {
        await chksrtOk(this.path);
      }
    },
    async clickChksrtNext() {
      try {
        await this._submitChksrtSelection();
      } catch (e) {
        console.error("[chksrt] next error:", e);
      }
      this.$emit("chksrt-next", null);
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
      if (this.mode === "intro" && this.introMarkDirty) this._saveStartMark();
      if (this.mode === "chksrt") {
        this._submitChksrtSelection().catch((e) =>
          console.error("[chksrt] close save error:", e),
        );
      }
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
    const savedMuted = window.localStorage.getItem(PLAYER_MUTE_STORAGE_KEY);
    const savedVolume = window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY);
    this.playerMuted = savedMuted === "1";
    if (savedVolume != null) {
      const n = Number(savedVolume);
      if (Number.isFinite(n)) this.playerVolume = Math.max(0, Math.min(1, n));
    }
    this.vidSrc = this.path ? this.streamUrl : "";
    this.subtitleOffset = offsetCache.get(this.path) ?? 0;
    if (this.path) this._fetchSubtitleList(this.path);
    this.$nextTick(() => {
      this._applyIntroAudioState();
    });
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onKeyDown);
  },
};
</script>
