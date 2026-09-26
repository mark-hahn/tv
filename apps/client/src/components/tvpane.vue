<template>
  <div
    id="tvPane"
    style="
      padding: 0;
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      position: relative;
    "
  >
    <!-- Lock pane overlay -->
    <div
      v-if="locked"
      style="
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: white;
        z-index: 10;
        display: flex;
        flex-direction: column;
        border: 3px solid #000;
        box-sizing: border-box;
      "
    >
      <div
        style="
          padding: 8px 10px;
          font-size: 28px;
          font-weight: bold;
          flex-shrink: 0;
        "
      >
        Remote Collision
      </div>
      <div
        style="
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          text-align: center;
          font-size: 24px;
          font-weight: bold;
        "
      >
        A remote collision has been detected. The remote has been locked.
        Press and hold unlock button to continue.
      </div>
      <div
        v-if="lockInfo"
        style="
          color: red;
          text-align: left;
          margin-left: 20px;
          font-size: 22px;
          font-weight: bold;
          flex-shrink: 0;
          padding-bottom: 10px;
        "
      >
        <div>{{ keyLabel(lockInfo.sentKey) }} sent</div>
        <div>{{ keyLabel(lockInfo.blockedKey) }} ignored</div>
      </div>
      <div
        @mousedown.prevent="startUnlockHold"
        @mouseup="stopUnlockHold"
        @mouseleave="stopUnlockHold"
        @touchstart.prevent="startUnlockHold"
        @touchend="stopUnlockHold"
        style="
          background: lightgreen;
          border-top: 3px solid #000;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 26px;
          font-weight: bold;
          cursor: pointer;
          flex-shrink: 0;
          height: 20%;
          user-select: none;
        "
      >
        Unlock
      </div>
    </div>
    <!-- Streamers pane -->
    <div
      v-else-if="showStreamers"
      style="
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #111;
      "
    >
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 2px solid #333;
        "
      >
        <span style="color: #fff; font-size: 20px; font-weight: bold"
          >Streaming Services</span
        >
        <button
          @mousedown.prevent="showStreamers = false"
          @touchstart.prevent="showStreamers = false"
          :style="{
            '--btn-bg': '#111',
            border: 'none',
            color: '#fff',
            fontSize: '28px',
            cursor: 'pointer',
            padding: '4px 8px',
            lineHeight: '1',
          }"
        >
          ✕
        </button>
      </div>
      <div style="overflow-y: auto; flex: 1; padding: 8px">
        <div style="display: flex; gap: 8px; margin-bottom: 8px">
          <button
            v-for="svc in services
              .filter((s) =>
                ['Netflix', 'Prime Video', 'HBO Max'].includes(s.name),
              )
              .sort(
                (a, b) =>
                  ['Netflix', 'Prime Video', 'HBO Max'].indexOf(a.name) -
                  ['Netflix', 'Prime Video', 'HBO Max'].indexOf(b.name),
              )"
            :key="'pin-' + svc.name"
            @pointerdown="flashSvcName('pin-' + svc.name)"
            @click="openApp(svc)"
            :style="{
              '--btn-bg':
                flashSvc === 'pin-' + svc.name ? 'lightblue' : 'white',
              flex: '1',
              boxSizing: 'border-box',
              padding: '10px 8px',
              border: '1px solid #ccc',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
            }"
          >
            <img
              :src="'logos/' + svc.logo"
              :alt="svc.name"
              style="
                width: 72px;
                height: 72px;
                object-fit: contain;
                border-radius: 6px;
              "
            />
            <span
              style="
                color: #000;
                font-size: 21px;
                text-align: center;
                word-break: break-word;
              "
              >{{ svc.name }}</span
            >
          </button>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px">
          <button
            v-for="svc in services"
            :key="svc.name"
            @pointerdown="flashSvcName(svc.name)"
            @click="openApp(svc)"
            :style="{
              '--btn-bg': flashSvc === svc.name ? 'lightblue' : 'white',
              width: 'calc(33.333% - 6px)',
              boxSizing: 'border-box',
              padding: '10px 8px',
              border: '1px solid #ccc',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
            }"
          >
            <img
              :src="'logos/' + svc.logo"
              :alt="svc.name"
              style="
                width: 72px;
                height: 72px;
                object-fit: contain;
                border-radius: 6px;
              "
            />
            <span
              style="
                color: #000;
                font-size: 21px;
                text-align: center;
                word-break: break-word;
              "
              >{{ svc.name }}</span
            >
          </button>
        </div>
      </div>
    </div>
    <!-- Subtitle pane: the tracks of the video tvapp is playing -->
    <div
      v-else-if="showSubCtrl"
      style="
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #fff;
      "
    >
      <div
        style="
          padding: 8px 12px;
          border-bottom: 2px solid #ccc;
          font-size: 18px;
          font-weight: bold;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        "
      >
        {{ subList?.title ?? "No video playing" }}
      </div>
      <div style="overflow-y: auto; flex: 1">
        <div v-if="!subList" style="padding: 16px; color: #666">
          No video playing
        </div>
        <template v-else>
          <div
            v-for="sub in subRows"
            :key="sub.index"
            @mousedown.prevent="subSelectTrack(sub.index)"
            @touchstart.prevent="subSelectTrack(sub.index)"
            :style="{
              padding: '10px 14px',
              borderBottom: '1px solid #eee',
              cursor: 'pointer',
              fontSize: '17px',
              fontWeight: subList.selected === sub.index ? 'bold' : 'normal',
              backgroundColor:
                subList.selected === sub.index ? '#d0e8ff' : '#fff',
            }"
          >
            {{ sub.label }}
          </div>
        </template>
      </div>
      <div
        @mousedown.prevent="showSubCtrl = false"
        @touchstart.prevent="showSubCtrl = false"
        style="
          background: lightgreen;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 26px;
          font-weight: bold;
          cursor: pointer;
          flex-shrink: 0;
          height: 20%;
          user-select: none;
        "
      >
        Close
      </div>
    </div>
    <!-- Picture settings pane -->
    <div
      v-else-if="showPicCtrl"
      style="
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #fff;
      "
    >
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 2px solid #ccc;
          flex-shrink: 0;
        "
      >
        <span style="font-size: 20px; font-weight: bold">Picture Settings</span>
        <button
          @mousedown.prevent="closePicCtrl"
          @touchstart.prevent="closePicCtrl"
          :style="{
            '--btn-bg': '#fff',
            border: 'none',
            fontSize: '28px',
            cursor: 'pointer',
            padding: '4px 8px',
            lineHeight: '1',
          }"
        >
          ✕
        </button>
      </div>
      <div style="overflow-y: auto; flex: 1">
        <div
          v-for="s in picSettings"
          :key="s.target"
          style="
            display: flex;
            align-items: center;
            padding: 10px 16px;
            border-bottom: 1px solid #eee;
            gap: 8px;
          "
        >
          <div style="flex: 1; display: flex; flex-direction: column; gap: 2px">
            <span style="font-size: 18px; font-weight: bold">{{
              s.label
            }}</span>
            <span
              v-if="s.type === 'range'"
              style="font-size: 16px; color: #000"
              >{{ s.min }}–{{ s.max }}</span
            >
          </div>
          <button
            @mousedown.prevent="picAdjust(s, -1)"
            @touchstart.prevent="picAdjust(s, -1)"
            :style="{
              '--btn-bg': 'whitesmoke',
              fontSize: '20px',
              padding: '6px 14px',
              border: '1px solid #bbb',
              cursor: 'pointer',
            }"
          >
            ▼
          </button>
          <input
            v-if="s.type === 'range'"
            :value="picInputVal(s)"
            @keydown="picKeydown($event, s)"
            @blur="picBlur($event, s)"
            style="
              width: 72px;
              text-align: center;
              font-size: 18px;
              font-weight: bold;
              border: 1px solid #bbb;
              padding: 4px 2px;
              background: #fff;
            "
          />
          <span
            v-else
            style="
              min-width: 72px;
              text-align: center;
              font-size: 18px;
              font-weight: bold;
            "
            >{{ picValText(s.value) }}</span
          >
          <button
            @mousedown.prevent="picAdjust(s, +1)"
            @touchstart.prevent="picAdjust(s, +1)"
            :style="{
              '--btn-bg': 'whitesmoke',
              fontSize: '20px',
              padding: '6px 14px',
              border: '1px solid #bbb',
              cursor: 'pointer',
            }"
          >
            ▲
          </button>
        </div>
        <div
          style="
            display: flex;
            align-items: center;
            padding: 10px 16px;
            border-bottom: 1px solid #eee;
            gap: 8px;
          "
        >
          <div style="flex: 1; display: flex; flex-direction: column; gap: 2px">
            <span style="font-size: 18px; font-weight: bold">ADB</span>
            <span v-if="adbStatus" style="font-size: 16px; color: #000">{{
              adbStatus
            }}</span>
          </div>
          <input
            v-model="adbPort"
            placeholder="port"
            inputmode="numeric"
            style="
              width: 72px;
              text-align: center;
              font-size: 18px;
              font-weight: bold;
              border: 1px solid #bbb;
              padding: 4px 2px;
              background: #fff;
            "
          />
          <input
            v-model="adbCode"
            placeholder="code"
            inputmode="numeric"
            style="
              width: 72px;
              text-align: center;
              font-size: 18px;
              font-weight: bold;
              border: 1px solid #bbb;
              padding: 4px 2px;
              background: #fff;
            "
          />
          <button
            @click="adbConnect"
            :style="{
              '--btn-bg': 'whitesmoke',
              fontSize: '20px',
              padding: '6px 14px',
              border: '1px solid #bbb',
              cursor: 'pointer',
            }"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
    <div
      v-else
      :style="gridStyle"
      @mousedown.capture="gateGridPress"
      @touchstart.capture="gateGridPress"
    >
      <!-- Row 0 (tvapprc only): sort, filter, info. Each one hands tvapp's
           focus to one of its own areas, which the arrow keys cannot all
           reach; info also rotates cardMisc once cardMisc has the focus. -->
      <template v-if="tvapprcMode">
        <div
          :style="cellStyle('white', 'sort')"
          @mousedown="startTvapprcFocusHold('sort')"
          @mouseup="stopTvapprcFocusHold"
          @mouseleave="stopTvapprcFocusHold"
          @touchstart.prevent="startTvapprcFocusHold('sort')"
          @touchend="stopTvapprcFocusHold"
        >
          Sort
        </div>
        <div
          :style="cellStyle('white', 'filter')"
          @mousedown="startTvapprcFocusHold('filter')"
          @mouseup="stopTvapprcFocusHold"
          @mouseleave="stopTvapprcFocusHold"
          @touchstart.prevent="startTvapprcFocusHold('filter')"
          @touchend="stopTvapprcFocusHold"
        >
          Filter
        </div>
        <div
          :style="cellStyle('white', 'info')"
          @mousedown="startTvapprcFocusHold('info')"
          @mouseup="stopTvapprcFocusHold"
          @mouseleave="stopTvapprcFocusHold"
          @touchstart.prevent="startTvapprcFocusHold('info')"
          @touchend="stopTvapprcFocusHold"
        >
          Info
        </div>
      </template>
      <!-- Row 1: back, up, home -->
      <div
        :style="cellStyle('white', 'back')"
        @mousedown="startBackHold"
        @mouseup="stopBackHold"
        @mouseleave="stopBackHold"
        @touchstart.prevent="startBackHold"
        @touchend="stopBackHold"
      >
        ↩
      </div>
      <div
        :style="cellStyle('#f5e642', 'up')"
        @mousedown="startRepeat('up')"
        @mouseup="stopRepeat"
        @mouseleave="stopRepeat"
        @touchstart.prevent="startRepeat('up')"
        @touchend="stopRepeat"
      >
        ▲
      </div>
      <!-- While tvapp is up, Hide/Unhide of the selected show. -->
      <div
        v-if="tvapprcMode"
        :style="cellStyle('white', 'hide')"
        @mousedown="startHideHold"
        @mouseup="stopHideHold"
        @mouseleave="stopHideHold"
        @touchstart.prevent="startHideHold"
        @touchend="stopHideHold"
      >
        {{ tvapprcHidden ? "Unhide" : "Hide" }}
      </div>
      <div
        v-else
        :style="cellStyle('white', 'home')"
        @mousedown="startHomeHold"
        @mouseup="stopHomeHold"
        @mouseleave="stopHomeHold"
        @touchstart.prevent="startHomeHold"
        @touchend="stopHomeHold"
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
        :style="cellStyle('#f5e642', 'left')"
        @mousedown="startRepeat('left')"
        @mouseup="stopRepeat"
        @mouseleave="stopRepeat"
        @touchstart.prevent="startRepeat('left')"
        @touchend="stopRepeat"
      >
        ◀
      </div>
      <div
        :style="cellStyle('lightgreen', 'ok')"
        @mousedown="startOkHold"
        @mouseup="stopOkHold"
        @mouseleave="stopOkHold"
        @touchstart.prevent="startOkHold"
        @touchend="stopOkHold"
      >
        OK
      </div>
      <div
        :style="cellStyle('#f5e642', 'right')"
        @mousedown="startRepeat('right')"
        @mouseup="stopRepeat"
        @mouseleave="stopRepeat"
        @touchstart.prevent="startRepeat('right')"
        @touchend="stopRepeat"
      >
        ▶
      </div>
      <!-- Row 3: sel, down, skip -->
      <!-- This is where the phone's Search key is. The web client has no
           filter input screen, so instead it selects tvapp's active show in
           the shows list. -->
      <div
        v-if="tvapprcMode"
        :style="cellStyle('white', 'sel')"
        @mousedown="startSelHold"
        @mouseup="stopSelHold"
        @mouseleave="stopSelHold"
        @touchstart.prevent="startSelHold"
        @touchend="stopSelHold"
      >
        Sel
      </div>
      <div
        v-else
        :style="cellStyle('white', 'emby')"
        @mousedown="openEmby"
        @touchstart.prevent="openEmby"
      >
        Emby
      </div>
      <div
        :style="cellStyle('#f5e642', 'down')"
        @mousedown="startRepeat('down')"
        @mouseup="stopRepeat"
        @mouseleave="stopRepeat"
        @touchstart.prevent="startRepeat('down')"
        @touchend="stopRepeat"
      >
        ▼
      </div>
      <!-- While tvapp is up, Skip skips the intro of the video it is playing;
           otherwise this is the set's Input key. -->
      <div
        v-if="tvapprcMode"
        :style="cellStyle('white', 'skip')"
        @mousedown="tvKey('skip')"
        @touchstart.prevent="tvKey('skip')"
      >
        Skip
      </div>
      <div
        v-else
        :style="cellStyle('white', 'input')"
        @mousedown="inputKey"
        @touchstart.prevent="inputKey"
      >
        Input
      </div>
      <!-- Row 4: vol-, vol+, mute -->
      <div
        :style="cellStyle('lightgreen', 'vold')"
        @mousedown="startVolDownHold"
        @mouseup="stopVolDownHold"
        @mouseleave="stopVolDownHold"
        @touchstart.prevent="startVolDownHold"
        @touchend="stopVolDownHold"
      >
        Vol-
      </div>
      <div
        :style="cellStyle('lightgreen', 'volu')"
        @mousedown="startVolUpHold"
        @mouseup="stopVolUpHold"
        @mouseleave="stopVolUpHold"
        @touchstart.prevent="startVolUpHold"
        @touchend="stopVolUpHold"
      >
        Vol+
      </div>
      <div
        :style="muteCellStyle"
        @mousedown="startMuteHold"
        @mouseup="stopMuteHold"
        @mouseleave="stopMuteHold"
        @touchstart.prevent="startMuteHold"
        @touchend="stopMuteHold"
      >
        Mute
      </div>
      <!-- Row 5: shows, apps, google -->
      <div
        :style="cellStyle(tvapprcMode ? 'lightblue' : 'white', 'shows')"
        @mousedown="startShowsHold('shows')"
        @mouseup="stopShowsHold('shows')"
        @mouseleave="stopShowsHold('shows')"
        @touchstart.prevent="startShowsHold('shows')"
        @touchend="stopShowsHold('shows')"
      >
        Shows
      </div>
      <div
        :style="cellStyle('white', 'stream')"
        @mousedown="startAppsHold"
        @mouseup="stopAppsHold"
        @mouseleave="stopAppsHold"
        @touchstart.prevent="startAppsHold"
        @touchend="stopAppsHold"
      >
        Apps
      </div>
      <div
        :style="modeBtnStyle('google')"
        @mousedown="startGoogleHold"
        @mouseup="stopGoogleHold"
        @mouseleave="stopGoogleHold"
        @touchstart.prevent="startGoogleHold"
        @touchend="stopGoogleHold"
      >
        <span :style="powerIconStyle">
          <span :style="powerRingStyle"></span>
          <span :style="powerGapStyle"></span>
          <span :style="powerBarStyle"></span>
        </span>
      </div>
    </div>
  </div>
</template>

<script>
import { config } from "../config.js";
import evtBus from "../evtBus.js";
import { wsSend, clientId, openChannel, tvRemoteKey } from "../srvr.js";
import allServices from "../../../tv/services.json";
import { keyLabels } from "../keyLabels.js";
import { logHere, unilog} from "../log.js"

const EMBY_SERVICE = allServices.google.find((s) => s.name === "Emby");
const SCRUB_HOLD_DELAY_MS = 400;
const SCRUB_PING_INTERVAL_MS = 500;
const VOL_STEP = 1;
const PIC_VAL_MAX_CHARS = 20;
const PIC_VAL_EDGE_CHARS = 8;
const TVPANE_VERSION = 2;

// tvapprc bridge (mirrors apps/android/App.js) -- lets this remote follow
// tvapp's open/closed state and, while it's open, drive it directly instead
// of the tv. The phone reaches the bridge port on the lan, which this page
// cannot do over https, so it comes in through nginx's wss route instead.
const TVAPPRC_WS_URL = "wss://hahnca.com/tv-tvapprc";
const TVAPPRC_RECONNECT_MS = 2000;
const TVAPPRC_CONNECT_TIMEOUT_MS = 5000;
const MSG_TVAPP_UP = "u";
const MSG_TVAPP_DOWN = "d";
// tvapp names the show its cursor is on, which is the one Hide acts on.
const MSG_ACTIVE_SHOW = "a";
// Whether that show is hidden, which is what the hide key reads Unhide for.
const MSG_ACTIVE_HIDDEN = "i";
// The subtitle tracks of the video tvapp is playing, as JSON {title, tracks:
// [{label, type}], selected}, or null when none is up. Asked for with
// CMD_SUBTITLES; CMD_SUBTITLE,<n> turns track n on, -1 turns them off.
const MSG_SUBTITLES = "l";
const CMD_SUBTITLES = "l";
const CMD_SUBTITLE = "t";
const CMD_OPEN_TVAPP = "o";
const CMD_BACK = "b";
// Back to a clean tvapp screen: the show list focused and nothing else,
// cardMisc back to its description, filters off.
const CMD_CLEAR_STATE = "r";
const CMD_KEY = "k";
// An auto-repeat of a held key, so tvapp can tell a repeat from a press: a
// hold belongs to whatever it started on, and its repeats are dropped once
// that is gone (a seek held past the end of a video).
const CMD_KEY_REPEAT = "kr";
// The hide key. What it acts on -- the episode under the map's cursor, else
// the selected show -- is tvapp's to decide, so the press is all that is sent.
const CMD_HIDE = "h";
// Letter-skip variant of CMD_KEY, up/down only -- sent instead of CMD_KEY
// once a held key has been auto-repeating fast long enough that tvapp's show
// list starts jumping by starting letter instead of by row.
const CMD_KEY_LETTER = "j";
// tvapp arrow-key repeat: fast cadence once a hold clears the initial
// SCRUB_HOLD_DELAY_MS. After another SCRUB_HOLD_DELAY_MS of fast repeats,
// up/down switch to letter-skip mode, which repeats at SCRUB_HOLD_DELAY_MS
// again -- the same "slow" pace, reused rather than a new constant.
const TVAPP_FAST_REPEAT_MS = 120;
const TVAPPRC_ROWS = 6;
const REMOTE_ROWS = 5;
// Entering or leaving tvapprc mode redraws the grid one row taller or shorter,
// so every cell moves. A press this soon after the switch was aimed at the old
// layout: it is dropped and the grid dims for a moment to say so (mirrors
// apps/android/App.js, which flashes the cell).
const MODE_SWITCH_LOCKOUT_MS = 800;
// How long a Shows key is held, while the set is off, before it toggles the
// doorbell camera; the same 400ms _lpStart uses when the set is on.
const SHOWS_OFF_HOLD_MS = 400;
const DENIED_BG = "lightcoral";

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

// The power toggle on the google key, drawn rather than typed: U+23FB is
// missing from the fonts here and on the phone and comes out as a tofu box.
// A ring, a patch of the key's own background across the top of it, and the
// bar standing in that gap, half way between the black the lettering is drawn
// in and the white the key is painted.
const POWER_GRAY = "#808080";
const POWER_ICON = { position: "relative", width: "40px", height: "40px" };
const POWER_RING = {
  position: "absolute",
  top: "3px",
  left: "3px",
  width: "34px",
  height: "34px",
  boxSizing: "border-box",
  border: `4px solid ${POWER_GRAY}`,
  borderRadius: "50%",
};
const POWER_GAP = {
  position: "absolute",
  top: "1px",
  left: "13px",
  width: "14px",
  height: "8px",
};
const POWER_BAR = {
  position: "absolute",
  top: "0",
  left: "18px",
  width: "4px",
  height: "22px",
  backgroundColor: POWER_GRAY,
};

export default {
  name: "TvPane",

  props: {
    show: { type: Object, default: null },
  },

  data() {
    return {
      flashBtn: null,
      haState: null,
      mediaTitle: null,
      showStreamers: false,
      flashSvc: null,
      locked: false,
      lockInfo: null,
      showPicCtrl: false,
      showSubCtrl: false,
      subList: null,
      picSettings: [],
      picInputs: {}, // target -> { typing: bool, raw: string }
      adbPort: "",
      adbCode: "",
      adbStatus: "",
      _picChannel: null,
      tvapprcMode: false,
      tvapprcHidden: false,
      deniedBtn: null, // cell whose press was refused, painted DENIED_BG
      deniedGrid: false, // a press was refused during the post-switch lockout
    };
  },

  computed: {
    // tvapprc mode adds a row of its own on top -- sort, filter, info -- so the
    // cells there are shorter than the ordinary remote's.
    gridStyle() {
      return {
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gridTemplateRows: `repeat(${
          this.tvapprcMode ? TVAPPRC_ROWS : REMOTE_ROWS
        }, 1fr)`,
        borderTop: "3px solid #000",
        borderLeft: "3px solid #000",
        height: "100%",
        filter: this.deniedGrid ? "brightness(0.5)" : "none",
      };
    },
    powerIconStyle() {
      return POWER_ICON;
    },
    powerRingStyle() {
      return POWER_RING;
    },
    powerGapStyle() {
      return { ...POWER_GAP, backgroundColor: this.modeBg("google") };
    },
    powerBarStyle() {
      return POWER_BAR;
    },
    subRows() {
      const typeChar = { pgs: "*", sdh: "H", embedded: "T", forced: "F" };
      return [{ label: "None", index: -1 }].concat(
        (this.subList?.tracks ?? []).map((sub, index) => ({
          label: `${typeChar[sub.type] ?? "S"}: ${(sub.label || "").replace(/\bdefault\b/gi, "Def")}`,
          index,
        })),
      );
    },
    muteCellStyle() {
      const bg = this.flashBtn === "mute" ? "orange" : "lightgreen";
      return { ...CELL_BASE, backgroundColor: bg };
    },
    mode() {
      if (this.tvapprcMode) return "tvapprc";
      const on =
        this.haState &&
        this.haState !== "off" &&
        this.haState !== "unavailable" &&
        this.haState !== "unknown";
      if (!on) return "off";
      if (this.mediaTitle === "Smart TV") return "google";
      if (this.mediaTitle === "TV") return "tv";
      return "other";
    },
    // Streaming-app list is keyed by the TV's actual input, so it must ignore
    // the tvapprc collapse above -- otherwise it looks up "tvapprc" in
    // services.json (which only has "google") and comes back empty.
    servicesMode() {
      if (this.mediaTitle === "Smart TV") return "google";
      return this.mode;
    },
    services() {
      return allServices[this.servicesMode] ?? [];
    },
    isOff() {
      return this.mode === "off";
    },
    isOther() {
      return this.mode === "other";
    },
    offBtnStyle() {
      const bg =
        this.flashBtn === "off" ? "orange" : this.isOff ? "lightblue" : "white";
      return { ...CELL_BASE, backgroundColor: bg };
    },
  },

  watch: {
    tvapprcMode() {
      this._modeSwitchAt = Date.now();
    },

    // tv-tv keeps a "most relevant show" of its own -- this feeds it -- so
    // tvapp starting fresh can select
    // that instead of whatever the client happens to have open right now.
    "show.name"(name) {
      if (!name) return;
      fetch(`${config.tvTvUrl}/tv/clientShow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show: name }),
      }).catch(() => {});
    },
  },

  mounted() {
    evtBus.on("tvMuteState", this._onTvMuteState);
    evtBus.on("tvRemoteLock", this._onTvRemoteLock);
    evtBus.on("tvRemoteUnlock", this._onTvRemoteUnlock);
    evtBus.on("tvArrowKey", this._onTvArrowKey);
    evtBus.on("tvOkKey", this._onTvOkKey);
    evtBus.on("tvBackKey", this._onTvBackKey);
    this._connectTvapprc();
  },

  beforeUnmount() {
    this._tvapprcDone = true;
    clearTimeout(this._tvapprcRetryTimer);
    clearTimeout(this._tvapprcOpenTimer);
    this._tvapprcWs?.close();
    this._tvapprcWs = null;
    evtBus.off("tvMuteState", this._onTvMuteState);
    evtBus.off("tvRemoteLock", this._onTvRemoteLock);
    evtBus.off("tvRemoteUnlock", this._onTvRemoteUnlock);
    evtBus.off("tvArrowKey", this._onTvArrowKey);
    evtBus.off("tvOkKey", this._onTvOkKey);
    evtBus.off("tvBackKey", this._onTvBackKey);
    this.stopRepeat();
    this.stopHold();
    clearTimeout(this._lpDebounceTimer);
    clearTimeout(this._lpLongTimer);
    this._lp = null;
    clearTimeout(this._dbTimer);
    this._db = null;
    clearTimeout(this._googleTimer);
    this.closePicCtrl();
    clearTimeout(this._unlockHoldTimer);
  },

  methods: {
    // Single choke point for every key/command this pane sends — the server's
    // keySendWithChk checks it against the other remote's last press before
    // forwarding to the tv (base "tv") or to srvr's own api (base "srvr", for
    // skip-intro). path=null just arms the collision window without sending
    // anything (the arrow button-down, whose real send is decided later by
    // hold-duration). repeating=true marks a held/scrub send so it wins the
    // floor over another remote's key.
    async sendKeyThrough(
      key,
      path,
      { method = "GET", body, fromSubCtrl = false, repeating = false, base = "tv" } = {},
    ) {
      try {
        return await tvRemoteKey({
          key,
          senderId: clientId,
          fromSubCtrl,
          repeating,
          base,
          method,
          path,
          body,
        });
      } catch (_) {
        return { blocked: false, result: null };
      }
    },

    // tvapprc bridge (mirrors apps/android/App.js) -- so this remote learns
    // when tvapp is open and can drive it directly (CMD_KEY etc.) instead of
    // the tv.
    _connectTvapprc() {
      if (this._tvapprcDone) return;
      const ws = new WebSocket(TVAPPRC_WS_URL);
      this._tvapprcWs = ws;
      ws.onopen = () => clearTimeout(this._tvapprcOpenTimer);
      ws.onerror = () => this._scheduleTvapprcRetry();
      ws.onclose = () => {
        this.tvapprcMode = false;
        this.tvapprcHidden = false;
        this._tvapprcActiveShow = null;
        this._scheduleTvapprcRetry();
      };
      ws.onmessage = (e) => {
        if (e.data === MSG_TVAPP_UP) this.tvapprcMode = true;
        else if (e.data === MSG_TVAPP_DOWN) {
          this.tvapprcMode = false;
          this.tvapprcHidden = false;
          this._tvapprcActiveShow = null;
        } else if (
          typeof e.data === "string" &&
          e.data.startsWith(`${MSG_ACTIVE_SHOW},`)
        ) {
          this._tvapprcActiveShow = e.data.slice(MSG_ACTIVE_SHOW.length + 1);
        } else if (
          typeof e.data === "string" &&
          e.data.startsWith(`${MSG_ACTIVE_HIDDEN},`)
        ) {
          this.tvapprcHidden =
            e.data.slice(MSG_ACTIVE_HIDDEN.length + 1) === "1";
        } else if (
          typeof e.data === "string" &&
          e.data.startsWith(`${MSG_SUBTITLES},`)
        ) {
          this.subList = JSON.parse(e.data.slice(MSG_SUBTITLES.length + 1));
        }
      };
      this._tvapprcOpenTimer = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) ws.close();
      }, TVAPPRC_CONNECT_TIMEOUT_MS);
    },

    _scheduleTvapprcRetry() {
      if (this._tvapprcDone || this._tvapprcRetryTimer) return;
      clearTimeout(this._tvapprcOpenTimer);
      this._tvapprcRetryTimer = setTimeout(() => {
        this._tvapprcRetryTimer = null;
        this._connectTvapprc();
      }, TVAPPRC_RECONNECT_MS);
    },

    sendTvapprc(message) {
      const ws = this._tvapprcWs;
      if (ws?.readyState !== WebSocket.OPEN) return false;
      ws.send(message);
      return true;
    },

    // tvapprc mode is not set here, only asked for: the bridge's tvapp-up
    // message is the one thing that knows tvapp really came up, and this remote
    // has to be in the mode tvapp is in and no other.
    openTvapp() {
      this.flash("shows");
      if (!this.sendTvapprc(CMD_OPEN_TVAPP)) {
        fetch(`${config.tvTvUrl}/tv/opentvapp`).catch(() => {});
      }
    },

    // Back button while tvapp is open: one level out over there. tvapp is
    // home, so it never closes -- at its top level the press does nothing --
    // and tvapprc mode is left alone.
    async tvappBack() {
      this.flash("back");
      if ((await this.sendKeyThrough("back", null)).blocked) return;
      if (!this.sendTvapprc(CMD_BACK)) {
        fetch(`${config.tvTvUrl}/tv/tvapprc/back`, { method: "POST" }).catch(
          () => {},
        );
      }
    },

    // The Shows key while tvapp is up: put the tvapp show list up with nothing
    // else in the way, clearing whatever tvapp is showing back to that.
    // flashKey is which of the two Shows cells was pressed, so only that one
    // lights up.
    clearTvappState(flashKey) {
      this.flash(flashKey);
      this.sendTvapprc(CMD_CLEAR_STATE);
    },

    // Human-readable label for the lockout message. openapp: keys carry their
    // own readable suffix already, everything else looks up
    // ../../../tv/keyLabels.json (see that file to change wording).
    keyLabel(key) {
      if (!key) return key;
      if (key.startsWith("openapp:")) return key.slice("openapp:".length);
      return keyLabels[key] ?? key;
    },

    _onTvRemoteLock(data) {
      this.locked = true;
      this.lockInfo = data;
    },

    _onTvRemoteUnlock() {
      this.locked = false;
      this.lockInfo = null;
    },

    // Keyboard left/right arrow — same as a short tap on the arrow button.
    async _onTvArrowKey(dir) {
      await this.tvKey(dir);
    },

    // Keyboard enter — same as a short tap on the OK button.
    async _onTvOkKey() {
      this.stopRepeat();
      await this.tvKey("ok");
    },

    // Keyboard escape — same as a short tap on the Back button.
    async _onTvBackKey() {
      if (this.tvapprcMode) {
        await this.tvappBack();
        return;
      }
      await this.tvKey("back");
    },

    startUnlockHold() {
      this._unlockHoldTimer = setTimeout(() => {
        this.locked = false;
        this.lockInfo = null;
        wsSend({ fname: "tvRemoteUnlock" });
      }, 500);
    },

    stopUnlockHold() {
      clearTimeout(this._unlockHoldTimer);
    },

    // Every grid key except the power one reaches the set through startRepeat
    // or one of the _lpStart/_armHold/_dbStart primitives below, so the
    // set-is-off gate lives on those four. startGoogleHold runs its own timer
    // and so stays live -- it is the only way back on.
    startRepeat(key) {
      if (this.isOff) return;
      if (this.tvapprcMode) {
        this.flash(key);
        this._repeatActive = true;
        this._pendingLRKey = null;
        const isUpDown = key === "up" || key === "down";
        (async () => {
          const r = await this.sendKeyThrough(key, null);
          if (r.blocked) return this.stopRepeat();
          this.sendTvapprc(`${CMD_KEY},${key}`);
          await new Promise((r) => {
            this._repeatTimer = setTimeout(r, SCRUB_HOLD_DELAY_MS);
          });
          // Fast phase, repeating every TVAPP_FAST_REPEAT_MS. Once up/down have
          // held through another SCRUB_HOLD_DELAY_MS of it -- the same delay
          // that got us here -- switch to letter-skip mode: back to the slow
          // SCRUB_HOLD_DELAY_MS cadence, but each repeat jumps a letter.
          let fastElapsedMs = 0;
          let letterMode = false;
          while (this._repeatActive) {
            const rr = await this.sendKeyThrough(key, null, {
              repeating: true,
            });
            if (rr.blocked) return this.stopRepeat();
            this.sendTvapprc(
              `${letterMode ? CMD_KEY_LETTER : CMD_KEY_REPEAT},${key}`,
            );
            const delay = letterMode
              ? SCRUB_HOLD_DELAY_MS
              : TVAPP_FAST_REPEAT_MS;
            await new Promise((r) => {
              this._repeatTimer = setTimeout(r, delay);
            });
            if (!letterMode && isUpDown) {
              fastElapsedMs += TVAPP_FAST_REPEAT_MS;
              if (fastElapsedMs >= SCRUB_HOLD_DELAY_MS) letterMode = true;
            }
          }
        })();
        return;
      }
      if (this.isOff || this.isOther) return;
      if (!this._debounce()) return;
      this.flash(key);
      this._repeatActive = true;
      this._pendingLRKey = null;
      const isLR = key === "left" || key === "right";
      (async () => {
        if (!isLR) {
          const r = await this.sendKeyThrough(key, `/tv/key/${key}`);
          if (r.blocked) return this.stopRepeat();
          if (!this._repeatActive) return;
        } else {
          // Only arms the collision window here — the actual send (tap
          // release below, or scrub start/ping) happens once we know
          // whether this is a short tap or a long-press scrub.
          const r = await this.sendKeyThrough(key, null);
          if (r.blocked) return this.stopRepeat();
          this._pendingLRKey = key;
        }
        await new Promise((r) => {
          this._repeatTimer = setTimeout(r, SCRUB_HOLD_DELAY_MS);
        });
        if (!this._repeatActive) return;
        if (isLR) {
          this._pendingLRKey = null; // long press — key will not be sent on release
          // Start server-side scrubbing (repeating: a held scrub owns the floor)
          const r = await this.sendKeyThrough(key, `/tv/scrub/start`, {
            method: "POST",
            body: { direction: key },
            repeating: true,
          });
          if (r.blocked) return this.stopRepeat();
          // Send ping repeatedly while holding
          while (this._repeatActive) {
            await new Promise((r) => {
              this._repeatTimer = setTimeout(r, SCRUB_PING_INTERVAL_MS);
            });
            if (!this._repeatActive) break;
            const p = await this.sendKeyThrough(key, `/tv/scrub/ping`, {
              method: "POST",
              repeating: true,
            });
            if (p.blocked) return this.stopRepeat();
          }
          return;
        }
        // Non-LR keys: standard repeat logic
        let count = 0;
        while (this._repeatActive) {
          const r = await this.sendKeyThrough(key, `/tv/key/${key}`, {
            repeating: true,
          });
          if (r.blocked) return this.stopRepeat();
          if (!this._repeatActive) break;
          const FAST_REPEAT_MS = 100;
          const delay = count++ < 2 ? 500 : FAST_REPEAT_MS;
          await new Promise((r) => {
            this._repeatTimer = setTimeout(r, delay);
          });
        }
      })();
    },

    startRepeatCmd(flashKey, cmd) {
      if (this._repeatActive) return;
      this.flash(flashKey);
      this._repeatActive = true;
      (async () => {
        while (this._repeatActive) {
          await fetch(`${config.tvTvUrl}/tv/${cmd}`).catch(() => {});
        }
      })();
    },

    stopRepeat() {
      this._repeatActive = false;
      clearTimeout(this._repeatTimer);
      const pendingLRKey = this._pendingLRKey;
      this._pendingLRKey = null;
      if (this.tvapprcMode) return;
      // Stop server-side scrubbing. This is a gesture-end cleanup, not a
      // keypress, and must fire even when locked (else the tv keeps scrubbing),
      // so it goes direct rather than through the collision gate.
      fetch(`${config.tvTvUrl}/tv/scrub/stop`, { method: "POST" }).catch(
        () => {},
      );
      if (pendingLRKey) {
        // Short press on left/right — send key on release (through the gate)
        this.sendKeyThrough(pendingLRKey, `/tv/key/${pendingLRKey}`);
      }
    },

    startHold(action) {
      this._holdTimer = setTimeout(action, 400);
    },

    stopHold() {
      clearTimeout(this._holdTimer);
    },

    // Shared long-press helper: immediate short action registration, 400ms then long
    _lpStart(shortAction, longAction, holdMs = 400) {
      if (this.isOff) return;
      clearTimeout(this._lpDebounceTimer);
      clearTimeout(this._lpLongTimer);
      this._lp = { shortAction, longAction, phase: 0 };
      this._lpDebounceTimer = setTimeout(() => {
        if (this._lp) this._lp.phase = 1;
      }, 0);
      this._lpLongTimer = setTimeout(() => {
        if (!this._lp) return;
        const lp = this._lp;
        this._lp = null;
        lp.longAction?.();
      }, holdMs);
    },

    // Drops a hold in flight without running either of its actions.
    _lpCancel() {
      if (!this._lp) return;
      clearTimeout(this._lpDebounceTimer);
      clearTimeout(this._lpLongTimer);
      this._lp = null;
    },

    _lpStop() {
      if (!this._lp) return;
      const lp = this._lp;
      clearTimeout(this._lpDebounceTimer);
      clearTimeout(this._lpLongTimer);
      this._lp = null;
      if (lp.phase === 0) return;
      if (lp.phase === 1) lp.shortAction?.();
    },

    // A hold button does not send its key until it is released, which can be a
    // long time after the press, so on its own it would reach the collision
    // gate well after another remote's simultaneous press had left the window
    // -- and not at all when the press is held past its long-press. This arms
    // the window on the press instead, and drops the hold if that press
    // already lost to another remote. Buttons with no long action (back, home,
    // ok) send on the press already and need none of this.
    _armHold(key, start) {
      if (this.isOff) return;
      start();
      this.sendKeyThrough(key, null).then((r) => {
        if (r.blocked) this._lpCancel();
      });
    },

    // Shared simple debounce helper: immediate action, no long-press
    _dbStart(action) {
      if (this.isOff) return;
      clearTimeout(this._dbTimer);
      this._db = { action };
      this._dbTimer = setTimeout(() => {
        if (!this._db) return;
        const a = this._db.action;
        this._db = null;
        a?.();
      }, 0);
    },

    _dbStop() {
      if (!this._db) return;
      clearTimeout(this._dbTimer);
      this._db = null;
    },

    startBackHold() {
      this._dbStart(() => {
        if (this.tvapprcMode) this.tvappBack();
        else this.tvKey("back");
      });
    },
    stopBackHold() {
      this._dbStop();
    },

    startHomeHold() {
      this._dbStart(() => this.tvKey("home"));
    },
    stopHomeHold() {
      this._dbStop();
    },

    startOkHold() {
      this.stopRepeat();
      this._dbStart(() => this.tvKey("ok"));
    },
    stopOkHold() {
      this._dbStop();
    },

    // The tvapprc row's three focus keys: one message per click and no repeat,
    // since each one only says which of tvapp's areas the keys talk to next.
    startTvapprcFocusHold(key) {
      this._dbStart(async () => {
        this.flash(key);
        const r = await this.sendKeyThrough(key, null);
        if (!r.blocked) this.sendTvapprc(`${CMD_KEY},${key}`);
      });
    },

    stopTvapprcFocusHold() {
      this._dbStop();
    },

    // The hide key, which tvapp reads as either of two things: the watched mark
    // on the episode its map has under the cursor, or hide/unhide of the show
    // it has selected. Only tvapp knows which of those the screen is on, so it
    // is told the key went down and does the rest itself.
    hideSelectedShow() {
      this.flash("hide");
      this.sendTvapprc(CMD_HIDE);
    },

    startHideHold() {
      this._dbStart(this.hideSelectedShow);
    },

    stopHideHold() {
      this._dbStop();
    },

    // Put the doorbell camera on the television, or take it back off: the same
    // toggle ctrl-clicking /ring's View button does. It lives on the long
    // press of every Shows key, in both modes -- tvapp is what the camera
    // appears over, so there is nothing for tvapprc mode to change.
    //
    // 'toggle' rather than reading a state and deciding here: hvac2 is the only
    // one that knows whether a view is up, so asking first would race this
    // press against its own next one.
    toggleDoorCam(flashKey) {
      this.flash(flashKey);
      fetch(`${config.ringUrl}/tvcam?action=toggle`, {
        cache: "no-store",
      }).catch((e) => {
        unilog(2418, `door toggle failed: ${e.message}`);
      });
    },

    // Select the show tvapp has selected in the web client's own shows list.
    startSelHold() {
      this._dbStart(() => {
        if (!this.tvapprcMode) return;
        const showName = this._tvapprcActiveShow;
        if (!showName) return;
        this.flash("sel");
        evtBus.emit("selectShowFromCardTitle", showName);
      });
    },
    stopSelHold() {
      this._dbStop();
    },

    startMuteHold() {
      this._dbStart(() => this.tvCmd("mute"));
    },
    stopMuteHold() {
      this._dbStop();
    },

    // Shows: opens tvapp on the tv, or, while tvapp is already up, clears it
    // back to a bare show list. Held, it toggles the doorbell camera on the
    // television. flashKey is which of the two Shows cells was pressed.
    startShowsHold(flashKey) {
      // The one key besides power that is live while the set is off, because
      // the camera has to work precisely then: somebody is at the door, and
      // tv-tv turns the set on for a view anyway. Only the hold, though: a tap
      // has nothing to open on a set that is off, so it is refused and says
      // so. Its own timer, like startGoogleHold, because _lpStart is gated on
      // the set being on.
      if (this.isOff) {
        clearTimeout(this._showsOffTimer);
        this._showsOffTimer = setTimeout(() => {
          this._showsOffTimer = null;
          this.toggleDoorCam(flashKey);
        }, SHOWS_OFF_HOLD_MS);
        return;
      }
      if (this.tvapprcMode) {
        this._lpStart(
          () => this.clearTvappState(flashKey),
          () => this.toggleDoorCam(flashKey),
        );
        return;
      }
      this._lpStart(
        () => this.openTvapp(),
        () => this.toggleDoorCam(flashKey),
      );
    },
    stopShowsHold(flashKey) {
      if (this._showsOffTimer) {
        clearTimeout(this._showsOffTimer);
        this._showsOffTimer = null;
        this.deny(flashKey);
      }
      this._dbStop();
      this._lpStop();
    },

    startGoogleHold() {
      this._googleTimer = setTimeout(() => this.googleBtn(), 400);
    },
    stopGoogleHold() {
      clearTimeout(this._googleTimer);
    },

    startVolDownHold() {
      this._armHold("vold", () =>
        this._lpStart(
          () => this.tvVolCmd("down"),
          () => {
            this.flash("vold");
            this.openPicCtrl();
          },
        ),
      );
    },

    stopVolDownHold() {
      this._lpStop();
    },

    // Held, Vol+ opens the subtitle panel while tvapp is up; otherwise the
    // hold is just the key.
    startVolUpHold() {
      const volUp = () => this.tvVolCmd("up");
      this._armHold("volu", () =>
        this._lpStart(volUp, () => {
          if (!this.tvapprcMode) return volUp();
          this.flash("volu");
          this.openSubCtrl();
        }),
      );
    },

    // The subtitle panel: fed by tvapp's MSG_SUBTITLES pushes, asked for once
    // on the way in.
    openSubCtrl() {
      this.showSubCtrl = true;
      this.sendTvapprc(CMD_SUBTITLES);
    },

    subSelectTrack(index) {
      if (this.subList) this.subList = { ...this.subList, selected: index };
      this.sendTvapprc(`${CMD_SUBTITLE},${index}`);
    },

    stopVolUpHold() {
      this._lpStop();
    },

    openPicCtrl() {
      this.showPicCtrl = true;
      if (this._picChannel) return;
      this._picChannel = openChannel("tvPicture", {
        onSnapshot: this.applyPicSettings,
        onDelta: this.applyPicSettings,
      });
    },

    // Reconnects tv-tv's adb to the TV. Port and code come from the TV's
    // Developer options > Wireless debugging > Pair device with pairing code;
    // left empty, tv-tv only hunts for the port wireless debugging moved to.
    async adbConnect() {
      this.adbStatus = "Connecting...";
      try {
        const data = await fetch(`${config.tvTvUrl}/tv/adbconnect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            port: this.adbPort.trim(),
            code: this.adbCode.trim(),
          }),
        }).then((r) => r.json());
        this.adbStatus = data.ok ? `Connected ${data.serial}` : data.error;
        if (data.ok) {
          this.adbPort = "";
          this.adbCode = "";
        }
      } catch (e) {
        this.adbStatus = e.message;
      }
    },

    closePicCtrl() {
      this._picChannel?.close();
      this._picChannel = null;
      this.showPicCtrl = false;
    },

    applyPicSettings(data) {
      if (!data?.ok) return;
      this.picSettings = data.settings;
      // clear typing state for any setting that was updated
      for (const s of data.settings) {
        const inp = this.picInputs[s.target];
        if (inp && inp.typing) continue; // don't override while user is typing
        this.picInputs[s.target] = { typing: false, raw: s.value };
      }
    },

    async fetchPicSettings() {
      try {
        const data = await fetch(`${config.tvTvUrl}/tv/picture`).then((r) =>
          r.json(),
        );
        this.applyPicSettings(data);
      } catch (_) {}
    },

    picInputVal(s) {
      return this.picInputs[s.target]?.raw ?? s.value;
    },

    // long option names push the arrow buttons off the edge of the screen
    picValText(v) {
      const s = String(v);
      if (s.length <= PIC_VAL_MAX_CHARS) return s;
      return `${s.slice(0, PIC_VAL_EDGE_CHARS)}...${s.slice(
        -PIC_VAL_EDGE_CHARS,
      )}`;
    },

    picKeydown(e, s) {
      const inp = this.picInputs[s.target] ?? { typing: false, raw: s.value };
      const key = e.key;

      if (key === "Enter") {
        e.preventDefault();
        this._commitPicInput(s).then(() => e.target.blur());
        return;
      }
      if (key === "Escape") {
        this.picInputs = {
          ...this.picInputs,
          [s.target]: { typing: false, raw: s.value },
        };
        e.target.blur();
        return;
      }
      if (key === "Backspace") {
        const next = inp.typing ? inp.raw.slice(0, -1) || "0" : "0";
        this.picInputs = {
          ...this.picInputs,
          [s.target]: { typing: true, raw: next },
        };
        this._schedulePicCommit(s);
        e.preventDefault();
        return;
      }
      if (!/^[0-9\-]$/.test(key)) {
        e.preventDefault();
        return;
      }

      let next;
      if (!inp.typing) {
        // first digit replaces current value
        next = key === "-" ? "-" : key;
      } else {
        next = inp.raw + key;
      }
      this.picInputs = {
        ...this.picInputs,
        [s.target]: { typing: true, raw: next },
      };
      this._schedulePicCommit(s);
      e.preventDefault();
    },

    picBlur(e, s) {
      this._commitPicInput(s);
    },

    _schedulePicCommit(s) {
      clearTimeout(this._picCommitTimers?.[s.target]);
      if (!this._picCommitTimers) this._picCommitTimers = {};
      this._picCommitTimers[s.target] = setTimeout(
        () => this._commitPicInput(s),
        750,
      );
    },

    async _commitPicInput(s) {
      clearTimeout(this._picCommitTimers?.[s.target]);
      const inp = this.picInputs[s.target];
      if (!inp || !inp.typing) return;
      const num = Number(inp.raw);
      if (isNaN(num) || num < s.min || num > s.max) {
        // invalid — revert
        this.picInputs = {
          ...this.picInputs,
          [s.target]: { typing: false, raw: s.value },
        };
        return;
      }
      const newVal = String(Math.round(num));
      this.picInputs = {
        ...this.picInputs,
        [s.target]: { typing: false, raw: newVal },
      };
      try {
        await fetch(`${config.tvTvUrl}/tv/picture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: s.target, value: newVal }),
        });
      } catch (_) {}
      await this.fetchPicSettings();
    },

    async picAdjust(setting, dir) {
      const newVal = this.picNextValue(setting, dir);
      if (newVal === null) return;
      this.picInputs = {
        ...this.picInputs,
        [setting.target]: { typing: false, raw: newVal },
      };
      try {
        await fetch(`${config.tvTvUrl}/tv/picture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: setting.target, value: newVal }),
        });
      } catch (_) {}
      await this.fetchPicSettings();
    },

    picNextValue(setting, dir) {
      if (setting.type === "range") {
        const v = Number(setting.value) + dir * setting.step;
        if (v < setting.min || v > setting.max) return null;
        return String(v);
      } else {
        const idx = setting.options.indexOf(setting.value);
        if (idx < 0)
          return dir > 0
            ? setting.options[0]
            : setting.options[setting.options.length - 1];
        const next = idx + dir;
        if (next < 0 || next >= setting.options.length) return null;
        return setting.options[next];
      }
    },

    startAppsHold() {
      this._dbStart(() => {
        this.flash("stream");
        this.showStreamers = true;
      });
    },

    stopAppsHold() {
      this._dbStop();
    },

    // Only the power key is painted this way now. Blue whenever the set is on --
    // the same lightblue the Shows key wears in tvapprc mode -- pink on live TV.
    modeBg(m) {
      if (this.flashBtn === m) return "orange";
      if (m === "google" && this.mode === "tv") return "#ffb3c1";
      return this.isOff ? "white" : "lightblue";
    },

    modeBtnStyle(m) {
      return { ...CELL_BASE, backgroundColor: this.modeBg(m) };
    },

    cellStyle(bg, key = null) {
      const flashActive = key && this.flashBtn === key;
      const denied = key && this.deniedBtn === key;
      return {
        ...CELL_BASE,
        backgroundColor: flashActive ? "orange" : denied ? DENIED_BG : bg,
      };
    },

    flash(btn) {
      this.flashBtn = btn;
      setTimeout(() => {
        this.flashBtn = null;
      }, 300);
    },

    // A press that was refused, shown for as long as flash shows orange.
    deny(btn) {
      this.deniedBtn = btn;
      setTimeout(() => {
        this.deniedBtn = null;
      }, 300);
    },

    // Capture-phase gate on the whole grid: inside the post-switch lockout the
    // press never reaches its cell. preventDefault on the touch also stops the
    // browser synthesizing a mouse press for it after the lockout has ended.
    gateGridPress(e) {
      if (Date.now() - (this._modeSwitchAt || 0) >= MODE_SWITCH_LOCKOUT_MS)
        return;
      e.stopPropagation();
      e.preventDefault();
      this.deniedGrid = true;
      setTimeout(() => {
        this.deniedGrid = false;
      }, 300);
    },

    // Checks the TV's actual current input (mediaTitle) rather than the
    // derived `mode`, because `mode` collapses to "tvapprc" whenever tvapprc
    // mode is active — that would otherwise run the power-on sequence while
    // tvapp is up, which sends Home and so closes tvapp and leaves the set on.
    async googleBtn() {
      if (this.mediaTitle === "Smart TV") {
        this.tvCmd("off");
      } else {
        this.flash("google");
        this.sendKeyThrough("googlebtn", `/tv/googlebtn`);
      }
    },

    _onTvMuteState(data) {
      if (!data) return;
      if (data.state !== undefined) this.haState = data.state;
      if (data.mediaTitle !== undefined) this.mediaTitle = data.mediaTitle;
    },

    async openApp(svc) {
      if (this.isOff) return;
      setTimeout(() => {
        this.showStreamers = false;
      }, 1000);
      await this.sendKeyThrough(
        `openapp:${svc.name}`,
        `/tv/openapp?uri=${encodeURIComponent(svc.uri)}`,
      );
    },

    flashSvcName(name) {
      this.flashSvc = name;
      setTimeout(() => {
        this.flashSvc = null;
      }, 500);
    },

    _debounce() {
      const now = Date.now();
      const ok = now - (this._lastCmd || 0) >= 250;
      this._lastCmd = now;
      return ok;
    },

    async tvCmd(cmd) {
      if (this.isOff || this.isOther) return;
      this.flash(cmd);
      if (!this._debounce()) return;
      const { result } = await this.sendKeyThrough(cmd, `/tv/${cmd}`);
      if (cmd === "mute" && result?.ok) this.muted = result.muted;
    },

    async tvVolCmd(dir) {
      if (this.isOff || this.isOther) return;
      const key = dir === "down" ? "vold" : "volu";
      this.flash(key);
      await this.sendKeyThrough(key, `/tv/vol/${dir}`);
    },

    async _tvKeyRaw(key) {
      const res = await fetch(`${config.tvTvUrl}/tv/key/${key}`);
      const data = await res.json();
    },

    openEmby() {
      this.flash("emby");
      this.openApp(EMBY_SERVICE);
    },

    // The set's Input key, which is wanted on an HDMI input too, so unlike the
    // other keys it only needs the set on.
    async inputKey() {
      if (this.isOff) return;
      if (!this._debounce()) return;
      this.flash("input");
      await this.sendKeyThrough("input", "/tv/key/input");
    },

    async tvKey(key) {
      if (this.tvapprcMode) {
        this.flash(key);
        const r = await this.sendKeyThrough(key, null);
        if (!r.blocked) this.sendTvapprc(`${CMD_KEY},${key}`);
        return;
      }
      if (this.isOff || this.isOther) return;
      if (!this._debounce()) return;
      this.flash(key);
      await this.sendKeyThrough(key, `/tv/key/${key}`);
    },
  },
};
</script>
