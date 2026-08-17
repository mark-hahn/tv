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
          @click.stop="clickNavBack3"
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
          &minus;
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
          @click.stop="clickTrimSet"
          style="
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            color: white;
            background: rgba(0, 80, 0, 0.6);
            white-space: nowrap;
            flex-shrink: 0;
            width: 74px;
            min-width: 74px;
            text-align: center;
            margin-right: 6px;
          "
        >
          {{ trimPosLabel || "\u00a0" }}
        </div>
        <div
          @click.stop="clickTrimJump"
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
          Trim
        </div>
        <div
          @click.stop="clickTrimClr"
          title="clear trim"
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
            margin-right: 20px;
          "
        >
          Clr
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
            min-width: 74px;
            text-align: center;
            margin-right: 6px;
          "
          :style="{ color: startMark < 2000 ? 'yellow' : 'white' }"
        >
          {{ startMarkLabel || "\u00a0" }}
        </div>
        <div
          @click.stop="clickSkipSet"
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
            min-width: 74px;
            text-align: center;
            margin-right: 6px;
          "
        >
          {{ skipDurLabel || "\u00a0" }}
        </div>
        <div
          @click.stop="clickSkipTest"
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
          Skip
        </div>
        <div
          @click.stop="clickSkipClr"
          title="clear skip"
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
            margin-right: 20px;
          "
        >
          Clr
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
          @click.stop="clickIntroSel"
          style="
            color: white;
            font-size: 13px;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid #666;
            cursor: pointer;
            user-select: none;
            background: rgba(0, 0, 100, 0.5);
            white-space: nowrap;
            flex-shrink: 0;
            margin-right: 6px;
          "
        >
          Sel
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
      <!-- Waiting for first cue (chksrt mode only) -->
      <div
        v-if="waitingForFirstCue"
        style="
          color: red;
          font-size: 13px;
          margin-right: 8px;
          white-space: nowrap;
          user-select: none;
          text-shadow: 0 0 3px #000;
        "
      >
        Waiting for first title
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
      <!-- All Off: same as off + Save for every queued episode of this show -->
      <div
        v-if="mode === 'chksrt'"
        @click.stop="clickChksrtAllOff"
        title="leave subs as-is for all queued episodes of this show"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(90, 0, 90, 0.6);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        All Off
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
        @click.stop="clickChksrtSnooze"
        style="
          color: white;
          font-size: 13px;
          padding: 2px 8px;
          border-radius: 4px;
          border: 1px solid #666;
          cursor: pointer;
          user-select: none;
          background: rgba(70, 45, 0, 0.75);
          margin-right: 8px;
          white-space: nowrap;
          text-shadow: 0 0 3px #000;
        "
      >
        Snooze
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
        Save
      </div>
      <div
        v-if="audioTracks.length > 1"
        @click.stop="cycleAudioTrack"
        :title="activeAudioLabel"
        :style="{
          color: 'white',
          fontSize: '13px',
          padding: '2px 8px',
          borderRadius: '4px',
          border: '1px solid #666',
          cursor: 'pointer',
          userSelect: 'none',
          background: 'rgba(0, 0, 0, 0.5)',
          marginRight: '8px',
          whiteSpace: 'nowrap',
          textShadow: '0 0 3px #000',
        }"
      >
        Audio
      </div>
      <!-- Playback speed (click cycles 1x / 2x / 5x / 10x) -->
      <div
        @click.stop="cyclePlaybackRate"
        title="playback speed"
        :style="{
          marginLeft: 'auto',
          color: 'white',
          fontSize: '13px',
          padding: '2px 8px',
          borderRadius: '4px',
          border: '1px solid #666',
          cursor: 'pointer',
          userSelect: 'none',
          background:
            playbackRate === 1 ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 100, 0.9)',
          marginRight: '8px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          textShadow: '0 0 3px #000',
        }"
      >
        {{ playbackRate }}x
      </div>
      <!-- Intro mode: None (checked, no intro) — sits just left of the X -->
      <div
        v-if="mode === 'intro'"
        @click.stop="clickIntroNone"
        title="checked, no intro"
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
          margin-right: 14px;
          text-shadow: 0 0 3px #000;
        "
        :style="{
          background: introNone
            ? 'rgba(180, 50, 50, 0.9)'
            : 'rgba(0, 0, 0, 0.5)',
        }"
      >
        None
      </div>
      <!-- X close -->
      <div
        @click.stop="close"
        :style="{
          color: 'white',
          fontSize: '28px',
          lineHeight: '1',
          cursor: 'pointer',
          userSelect: 'none',
          textShadow: '0 0 4px #000',
          paddingLeft: '14px',
        }"
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
        @load="onSubTrackLoad"
      />
    </video>
  </div>
</template>

<script>
import { config } from "../config.js";
import {
  applySubOffset,
  chksrtOk,
  chksrtOkShow,
  chksrtGenSrt,
  chksrtUnsnooze,
  chksrtSnooze,
  chksrtSelect,
  getChksrtHistory,
  addChksrtHistory,
  setTvdbFields,
  saveSeasonIntro,
} from "../srvr.js";

import { fmtPos, getSeasonIntro } from "@tv/share";
import { logHere, unilog } from "../log.js";

const TV_SRVR_URL = config.tvSrvrUrl;
const PLAYER_MUTE_STORAGE_KEY = "tvPlayerMuted";
const PLAYER_VOLUME_STORAGE_KEY = "tvPlayerVolume";
const SPEED_RATES = [1, 2, 5, 10];
const FIRST_CUE_LEAD_SEC = 1;
// The chksrt stream is a ten minute mirror of the episode; a first cue past
// that is not reviewable, so it never sets the jump point.
const FIRST_CUE_MAX_SEC = 600;
// Never land on the last seconds of the mirror — there would be nothing left
// to watch.
const FIRST_CUE_TAIL_SEC = 5;
const FIRST_CUE_SEEK_POLL_MS = 400;
const FIRST_CUE_SEEK_TRIES = 8;
const FIRST_CUE_SEEK_SLOP_SEC = 2;
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
  emits: ["close", "chksrt-next", "chksrt-sel", "intro-next", "intro-sel"],
  data() {
    return {
      audioTracks: [],
      activeAudioIndex: null,
      subtitleTracks: [],
      firstCueSec: null,
      chksrtFirstCueSec: null,
      activeTrackId: null,
      subtitleOffset: 0,
      vidSrc: "",
      errorRetries: 0,
      chksrtMatch: null,
      startMark: 0,
      trimPos: null,
      skipDur: null,
      introNone: false,
      currentTimeSec: 0,
      seekTarget: null,
      playerMuted: false,
      playerVolume: 1,
      waitingForVideo: false,
      waitingForVideoTarget: null,
      pendingSourceResumeTime: null,
      pendingSourceResumePlay: false,
      playbackRate: 1,
    };
  },
  computed: {
    streamUrl() {
      if (!this.path) return "";
      return this._buildStreamUrl(
        this.activeTrack?.type === "pgs" ? this.activeTrack.index : null,
      );
    },
    activeAudioTrack() {
      if (this.audioTracks.length === 0) return null;
      if (this.activeAudioIndex == null) return this.audioTracks[0] || null;
      return (
        this.audioTracks.find(
          (track) => track.index === this.activeAudioIndex,
        ) ||
        this.audioTracks[0] ||
        null
      );
    },
    activeAudioLabel() {
      return this.activeAudioTrack
        ? `Audio: ${this.activeAudioTrack.label}`
        : "Audio";
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
    waitingForFirstCue() {
      return (
        this.mode === "chksrt" &&
        this.firstCueSec !== null &&
        this.currentTimeSec < this.firstCueSec
      );
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
    startMarkLabel() {
      return fmtPos(this.startMark);
    },
    trimPosLabel() {
      return fmtPos(this.trimPos);
    },
    skipDurLabel() {
      return fmtPos(this.skipDur);
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
    introShow(newVal) {
      if (!newVal?.name) return;
      const si = getSeasonIntro(newVal?.seasonIntros, this.introSeason);
      this.startMark = si.startMark ?? 0;
      this.trimPos = si.trimPos ?? null;
      this.skipDur = si.skipDur ?? null;
      this.introNone = si.none === true;
    },
    introSeason(newVal) {
      if (!this.introShow?.name) return;
      const si = getSeasonIntro(this.introShow?.seasonIntros, newVal);
      this.startMark = si.startMark ?? 0;
      this.trimPos = si.trimPos ?? null;
      this.skipDur = si.skipDur ?? null;
      this.introNone = si.none === true;
    },
    path(newVal) {
      this._mseStop();
      this._chksrtSelectedSrtPath = undefined;
      this._chksrtSelectedChoice = undefined;
      this.audioTracks = [];
      this.activeAudioIndex = null;
      this.subtitleTracks = [];
      this.activeTrackId = null;
      this.firstCueSec = null;
      this.chksrtFirstCueSec = null;
      this._firstCueJumpPath = null;
      this._clearFirstCueSeek();
      this.chksrtMatch = null;
      this.errorRetries = 0;
      this.pendingSourceResumeTime = null;
      this.pendingSourceResumePlay = false;
      this.playbackRate = 1;
      this.vidSrc = newVal ? this._buildStreamUrl() : "";
      if (newVal && this.mode === "intro") this._seekOnLoad = true;
      this.subtitleOffset = offsetCache.get(newVal) ?? 0;
      if (newVal) {
        this._fetchSubtitleList(newVal);
        this._fetchAudioList(newVal);
      }
      this.waitingForVideo = false;
      this.waitingForVideoTarget = null;
    },
    activeTrackUrl(newVal) {
      this.firstCueSec = null;
      if (newVal) {
        this.$nextTick(() => {
          const vid = this.$refs.vid;
          if (vid) for (const tt of vid.textTracks) tt.mode = "showing";
        });
      }
    },
  },
  methods: {
    _buildStreamUrl(subIndex = null, audioIndex = this.activeAudioIndex) {
      let url = `${TV_SRVR_URL}/api/stream?path=${encodeURIComponent(this.path)}`;
      if (subIndex !== null) url += `&sub=${subIndex}`;
      if (audioIndex !== null && audioIndex !== undefined)
        url += `&audio=${audioIndex}`;
      return url;
    },
    async _fetchAudioList(filePath) {
      try {
        const resp = await fetch(
          `${TV_SRVR_URL}/api/audio-list?path=${encodeURIComponent(filePath)}`,
        );
        if (!resp.ok) return;
        const tracks = await resp.json();
        if (this.path !== filePath) return;
        this.audioTracks = Array.isArray(tracks) ? tracks : [];
        if (
          this.activeAudioIndex != null &&
          !this.audioTracks.some(
            (track) => track.index === this.activeAudioIndex,
          )
        ) {
          this.activeAudioIndex = null;
        }
      } catch (e) {
        unilog(1047, "fetch error:", e);
      }
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
          // Prefer a text track for the opening pick. pgs is bitmap, so showing
          // it means burning it in with ffmpeg on the original — that gives up
          // the seekable mp4 mirror and its known duration, leaving the timeline
          // with only the seconds ffmpeg has piped so far. Selecting pgs by hand
          // still switches to the burn-in stream.
          const first = tracks.find((t) => t.type !== "pgs") || tracks[0];
          this.activeTrackId = first.id;
          if (first.type === "pgs") {
            this.vidSrc = this._buildStreamUrl(first.index);
          }
        }
        if (this.mode === "chksrt") {
          this._setChksrtFirstCue(tracks);
          await this._loadChksrtHistoryAndCompare(filePath);
        }
      } catch (e) {
        unilog(1048, "fetch error:", e);
      }
    },
    // chksrt: take the first cue time of any text subtitle (embedded or srt)
    // so the video can jump straight to where subtitles start. pgs is bitmap
    // and forced covers only foreign dialog, so neither says where subs begin.
    _setChksrtFirstCue(tracks) {
      // Every track's cue time arrives with the list, so take the latest of
      // them: by then every track has text, so whichever subtitle the reviewer
      // switches to is showing something.
      let best = null;
      for (const t of tracks) {
        if (t.type !== "embedded" && t.type !== "sdh" && t.type !== "srt")
          continue;
        if (typeof t.firstCue !== "number") continue;
        // A track that starts past the mirror is junk for this purpose — it
        // would drag the jump to the end of the ten minutes on offer.
        if (t.firstCue > FIRST_CUE_MAX_SEC) continue;
        if (best === null || t.firstCue > best.firstCue) best = t;
      }
      if (best === null) return;
      this.chksrtFirstCueSec = best.firstCue;
      this._maybeJumpToFirstCue();
    },
    _maybeJumpToFirstCue() {
      if (this.mode !== "chksrt") return;
      const forPath = this.path;
      if (!forPath || this._firstCueJumpPath === forPath) return;
      const sec = this.chksrtFirstCueSec;
      if (sec === null) return;
      const target = sec - FIRST_CUE_LEAD_SEC;
      if (target < 1) return;
      const vid = this.$refs.vid;
      if (!vid || vid.readyState < 1) return; // no metadata yet
      if (
        Number.isFinite(vid.duration) &&
        target > vid.duration - FIRST_CUE_TAIL_SEC
      ) {
        return;
      }
      this._firstCueJumpPath = forPath;
      this._clearFirstCueSeek();
      vid.currentTime = target;
      // A fresh stream can silently drop the seek while it is still
      // buffering, so keep re-applying it until it takes.
      let tries = 0;
      this._firstCueSeekTimer = setInterval(() => {
        const v = this.$refs.vid;
        if (
          !v ||
          this.path !== forPath ||
          v.currentTime >= target - FIRST_CUE_SEEK_SLOP_SEC ||
          ++tries >= FIRST_CUE_SEEK_TRIES
        ) {
          this._clearFirstCueSeek();
          return;
        }
        v.currentTime = target;
      }, FIRST_CUE_SEEK_POLL_MS);
    },
    _clearFirstCueSeek() {
      if (this._firstCueSeekTimer) {
        clearInterval(this._firstCueSeekTimer);
        this._firstCueSeekTimer = null;
      }
    },
    _swapStream(subIndex = null, audioIndex = this.activeAudioIndex) {
      const vid = this.$refs.vid;
      this.pendingSourceResumeTime =
        vid && Number.isFinite(vid.currentTime) ? vid.currentTime : 0;
      this.pendingSourceResumePlay = vid ? !vid.paused : false;
      this._mseStop();
      this.errorRetries = 0;
      if (vid) vid.pause();
      this.vidSrc = this._buildStreamUrl(subIndex, audioIndex);
    },
    cycleAudioTrack() {
      if (this.audioTracks.length <= 1) return;
      const currentPos =
        this.activeAudioIndex == null
          ? 0
          : this.audioTracks.findIndex(
              (track) => track.index === this.activeAudioIndex,
            );
      const safePos = currentPos >= 0 ? currentPos : 0;
      const nextPos = (safePos + 1) % this.audioTracks.length;
      const nextAudioIndex =
        nextPos === 0 ? null : this.audioTracks[nextPos].index;
      this.activeAudioIndex = nextAudioIndex;
      this._swapStream(
        this.activeTrack?.type === "pgs" ? this.activeTrack.index : null,
        nextAudioIndex,
      );
    },
    onSubTrackLoad(e) {
      const cues = e.target.track?.cues;
      this.firstCueSec = cues && cues.length > 0 ? cues[0].startTime : null;
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
        unilog(1759, `error code=${err.code}, giving up after ${this.errorRetries} retries`);
        return;
      }
      this.errorRetries++;
      const resumeAt = vid.currentTime;
      unilog(1760, `error code=${err.code} at ${resumeAt.toFixed(1)}s, retry ${this.errorRetries}`);
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
            if (!abort.signal.aborted) unilog(1051, "", e);
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
      }).catch((e) => unilog(1052, "addChksrtHistory error:", e));
    },
    cyclePlaybackRate() {
      const idx = SPEED_RATES.indexOf(this.playbackRate);
      const rate = SPEED_RATES[(idx + 1) % SPEED_RATES.length];
      this.playbackRate = rate;
      const vid = this.$refs.vid;
      if (vid) vid.playbackRate = rate;
    },
    onVideoLoadedMetadata() {
      this._applyIntroAudioState();
      const vid = this.$refs.vid;
      if (vid) vid.playbackRate = this.playbackRate;
      if (this.pendingSourceResumeTime !== null) {
        const resumeTime = this.pendingSourceResumeTime;
        const shouldPlay = this.pendingSourceResumePlay;
        this.pendingSourceResumeTime = null;
        this.pendingSourceResumePlay = false;
        if (vid && resumeTime > 0) {
          try {
            vid.currentTime = resumeTime;
          } catch {}
        }
        if (vid && shouldPlay) vid.play().catch(() => {});
        return;
      }
      if (this.mode !== "intro") {
        if (vid) vid.play().catch(() => {});
        if (this.mode === "chksrt") {
          this._maybeJumpToFirstCue();
          return;
        }
      }
      if (!this._seekOnLoad) return;
      this._seekOnLoad = false;
      const targetSec =
        this.mode === "intro" ? 0 : Math.max(0, (this.startMark - 3000) / 1000);
      this._seekWithConfirm(targetSec);
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
    clickNavBack3() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const vid = this.$refs.vid;
      if (vid) vid.currentTime = Math.max(0, vid.currentTime - 3);
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
      const vid = this.$refs.vid;
      if (vid) vid.currentTime = 0;
    },
    clickIntroNone() {
      // removed in trim/skip redesign
    },
    clickIntroPre() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      const vid = this.$refs.vid;
      if (!vid) return;
      this._cancelSeek();
      vid.currentTime = Math.max(0, (this.startMark - 3000) / 1000);
    },
    clickIntroStart() {
      const vid = this.$refs.vid;
      if (!vid) return;
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      this.startMark = Math.round(vid.currentTime * 1000);
      this._persistField("startMark", this.startMark);
    },
    // Trimming (absolute video position)
    clickTrimSet() {
      const vid = this.$refs.vid;
      if (!vid) return;
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      this.trimPos = Math.round(vid.currentTime * 1000);
      this._persistField("trimPos", this.trimPos);
    },
    clickTrimJump() {
      if (this.waitingForVideo) this._exitWaitingForVideo();
      const vid = this.$refs.vid;
      if (!vid || !this.trimPos) return;
      this._cancelSeek();
      this._seekWithConfirm(this.trimPos / 1000);
    },
    clickTrimClr() {
      // >0 -> 0, null -> 0, 0 -> null
      this.trimPos = this.trimPos === 0 ? null : 0;
      this._persistField("trimPos", this.trimPos);
    },
    // Skipping (relative duration from startMark)
    clickSkipSet() {
      const vid = this.$refs.vid;
      if (!vid) return;
      if (this.startMark == null) return;
      if (this.waitingForVideo) this._exitWaitingForVideo();
      this._cancelSeek();
      const curPos = Math.round(vid.currentTime * 1000);
      if (curPos < this.startMark) return;
      this.skipDur = curPos - this.startMark;
      this._persistField("skipDur", this.skipDur);
    },
    clickSkipTest() {
      // Seek ahead by skipDur from current video position
      if (this.waitingForVideo) this._exitWaitingForVideo();
      const vid = this.$refs.vid;
      if (!vid || !this.skipDur) return;
      this._cancelSeek();
      this._seekWithConfirm(vid.currentTime + this.skipDur / 1000);
    },
    clickSkipClr() {
      // >0 -> 0, null -> 0, 0 -> null
      this.skipDur = this.skipDur === 0 ? null : 0;
      this._persistField("skipDur", this.skipDur);
    },
    // None: toggle "checked, no intro" so needsIntro stays false with no
    // trim/skip configured.
    clickIntroNone() {
      this.introNone = !this.introNone;
      this._persistField("none", this.introNone ? true : null);
    },
    _persistField(field, value) {
      if (!this.introShow?.name) return;
      const season = this.introSeason;
      if (season == null) return;
      // Update local reactive state for immediate UI feedback
      if (!this.introShow.seasonIntros) this.introShow.seasonIntros = {};
      if (!this.introShow.seasonIntros[season])
        this.introShow.seasonIntros[season] = {};
      this.introShow.seasonIntros[season][field] = value;
      if ((field === "trimPos" || field === "skipDur") && value != null) {
        this.introShow.needsIntro = false;
      }
      if (field === "none" && value === true) {
        this.introShow.needsIntro = false;
      }
      saveSeasonIntro(this.introShow.name, season, field, value).catch((e) =>
        unilog(1053, `saveSeasonIntro ${field} error:`, e),
      );
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
        unilog(1054, "clickIntroAnt error:", e);
        this.introShow.anticipating = original;
      }
    },
    clickIntroSel() {
      const name = this.introShow?.name;
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
      this.$emit("intro-sel", name);
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
        unilog(1055, `clickChksrtAnt error for ${show.name}:`, e);
        show.anticipating = original;
      }
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
        unilog(1056, "", e);
      }
    },
    async clickOk() {
      try {
        await chksrtOk(this.path);
        this.$emit("chksrt-next", null);
      } catch (e) {
        unilog(1057, "clickOk error:", e);
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
          unilog(1058, "clickGenSrt error:", e);
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
      } else if (this.activeTrack && this.activeTrackId !== "off") {
        // Save the currently active track even if no button was clicked
        const track = this.activeTrack;
        const choiceLabel = this.subtitleLabelMap.get(track.id) ?? track.label;
        let srtPath = null;
        if (track.type === "srt" && track.file) {
          const dir = this.path.replace(/\/[^\/]+$/, "");
          srtPath = dir + "/" + track.file;
        }
        this._saveChksrtHistory(choiceLabel, track);
        await chksrtSelect(this.path, srtPath);
      } else {
        await chksrtOk(this.path);
      }
    },
    async clickChksrtNext() {
      try {
        await chksrtUnsnooze(this.path);
      } catch (e) {
        unilog(1476, "unsnooze error:", e);
      }
      try {
        await this._submitChksrtSelection();
      } catch (e) {
        unilog(1059, "next error:", e);
      }
      this.$emit("chksrt-next", null);
    },
    async clickChksrtAllOff() {
      const showName = this.chksrtShowName;
      if (!showName) return;
      if (
        !window.confirm(
          `Leave subtitles as they are for all queued episodes of ${showName}?`,
        )
      )
        return;
      try {
        await chksrtOkShow(showName);
      } catch (e) {
        unilog(1970, `chksrt all off failed for ${showName}: ${e.message}`);
        return;
      }
      this.$emit("chksrt-next", null);
    },
    async clickChksrtSnooze() {
      try {
        await chksrtSnooze(this.path);
      } catch (e) {
        unilog(1060, "snooze error:", e);
        return;
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
      this._mseStop();
      this._clearFirstCueSeek();
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
    this.vidSrc = this.path ? this._buildStreamUrl() : "";
    this.subtitleOffset = offsetCache.get(this.path) ?? 0;
    this.chksrtFirstCueSec = null;
    if (this.path) {
      this._fetchSubtitleList(this.path);
      this._fetchAudioList(this.path);
    }
    this.$nextTick(() => {
      this._applyIntroAudioState();
    });
  },
  beforeUnmount() {
    window.removeEventListener("keydown", this.onKeyDown);
    this._clearFirstCueSeek();
  },
};
</script>
