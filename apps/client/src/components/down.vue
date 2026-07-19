<template>
  <div
    id="down"
    :style="{
      height: '100%',
      width: '100%',
      padding: '5px',
      margin: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      maxWidth: '100%',
      boxSizing: 'border-box',
      backgroundColor: '#fafafa',
      fontWeight: 'bold',
    }"
  >
    <div
      id="header"
      class="pane-header-title"
      :style="{
        position: 'sticky',
        top: '0px',
        zIndex: 100,
        backgroundColor: '#fafafa',
        paddingTop: '5px',
        paddingLeft: '5px',
        paddingRight: '5px',
        paddingBottom: '5px',
        marginLeft: '0px',
        marginRight: '0px',
        marginTop: '0px',
        marginBottom: '0px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }"
    >
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <div style="margin-left: 20px; display: flex; align-items: center">
          <span>{{ movieMode ? "Movie Downloads" : "Downloads" }}</span
          ><span
            v-if="isChecking"
            style="
              margin-left: 10px;
              align-self: center;
              font-size: 13px;
              color: #aaa;
              white-space: nowrap;
              font-weight: normal;
            "
            >&lt;Checking&gt;</span
          ><span
            v-if="!movieMode && totalDownloadingSpeedText"
            style="
              margin-left: 20px;
              align-self: center;
              font-size: 13px;
              color: #555;
              white-space: nowrap;
              font-weight: normal;
            "
            >{{ totalDownloadingSpeedText }}</span
          ><span
            v-if="!movieMode && avgDownloadingSpeedText"
            style="
              margin-left: 20px;
              align-self: center;
              font-size: 13px;
              color: #555;
              white-space: nowrap;
              font-weight: normal;
            "
            >{{ avgDownloadingSpeedText }}</span
          >
        </div>
        <div
          style="
            display: flex;
            gap: 10px;
            margin-right: 20px;
            justify-content: flex-end;
          "
        >
          <button
            v-if="movieMode"
            @click.stop="startMovieCycle"
            :style="{ '--btn-bg': movieCycling ? 'lightgray' : 'whitesmoke' }"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
            "
          >
            Cycle
          </button>
          <span
            v-if="movieMode && movieCycling"
            style="font-size: 13px; color: #555; align-self: center"
            >Cycling</span
          >
          <button
            v-if="!movieMode"
            @click.stop="startCheck"
            :style="{ '--btn-bg': isChecking ? 'lightgray' : 'whitesmoke' }"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
            "
          >
            Cycle
          </button>
          <button
            v-if="!movieMode"
            @click.stop="toggleErrs"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
            "
            :style="{ '--btn-bg': errsButtonBg }"
          >
            Errs
          </button>
          <button
            v-if="!movieMode"
            @click.stop="clearErrorRecords"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
            "
          >
            Clr
          </button>
          <button
            @click.stop="scrollToBottomAction"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
            "
          >
            Bot
          </button>
          <button
            v-if="!movieMode"
            @click.stop="activeOnly = !activeOnly"
            :style="{
              fontSize: '13px',
              cursor: 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: activeOnly ? '1px solid #888' : '1px solid #bbb',
              '--btn-bg': activeOnly ? '#ccc' : 'whitesmoke',
            }"
          >
            Active
          </button>
          <button
            v-if="movieMode"
            @click.stop="killMovieDownloads"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
            "
          >
            Kill
          </button>
          <button
            v-if="!movieMode"
            @click.stop="showFilterClick"
            :disabled="selectedItems.size === 0 && !showFilter"
            :class="{ 'btn-disabled': selectedItems.size === 0 && !showFilter }"
            :style="{
              fontSize: '13px',
              cursor: 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: showFilter ? '1px solid #888' : '1px solid #bbb',
              '--btn-bg': showFilter ? '#ccc' : 'whitesmoke',
            }"
          >
            Show
          </button>
          <button
            v-if="!movieMode"
            @click.stop="downAbortClick"
            :disabled="selectedAbortableCount === 0"
            :class="{ 'btn-disabled': selectedAbortableCount === 0 }"
            :style="{
              fontSize: '13px',
              cursor: 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: aborting ? '1px solid #888' : '1px solid #bbb',
              '--btn-bg': aborting ? '#ccc' : 'whitesmoke',
            }"
          >
            Abort
          </button>
          <button
            v-if="!movieMode"
            @click.stop="togglePolling"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
            "
            :style="{ backgroundColor: pollingStopped ? '#f66' : 'whitesmoke' }"
          >
            {{ pollingStopped ? "Resume" : "Stop" }}
          </button>
        </div>
      </div>
      <div
        v-if="!movieMode"
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin-top: 4px;
          margin-right: 20px;
        "
      >
        <input
          v-model="fileSearch"
          type="text"
          placeholder="Search"
          style="
            font-size: 13px;
            border-radius: 7px;
            padding: 4px 8px;
            border: 1px solid #bbb;
            background-color: white;
            width: 120px;
            margin-left: 20px;
            outline: none;
          "
        />
        <div style="display: flex; gap: 10px; align-items: center">
          <span
            v-if="selectedItems.size > 0"
            class="sel-count"
            style="
              font-size: 15px;
              font-weight: bold;
              color: green;
              align-self: center;
              white-space: nowrap;
            "
            >Sel: {{ selectedItems.size }}</span
          >
          <button
            @click.stop="downSelClick"
            :disabled="selectedItems.size === 0"
            :class="{ 'btn-disabled': selectedItems.size === 0 }"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
            "
          >
            Sel
          </button>
          <button
            @click.stop="downFromClick"
            :disabled="!show"
            :class="{ 'btn-disabled': !show }"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
            "
          >
            From
          </button>
          <button
            @click.stop="downAllClick"
            :disabled="selectedItems.size === 0"
            :class="{ 'btn-disabled': selectedItems.size === 0 }"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
            "
          >
            All
          </button>
          <button
            @click.stop="downFirstClick"
            :disabled="selectedItems.size === 0"
            :class="{ 'btn-disabled': selectedItems.size === 0 }"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
            "
          >
            First
          </button>
          <button
            @click.stop="downDelClick"
            :disabled="selectedItems.size === 0"
            :class="{ 'btn-disabled': selectedItems.size === 0 }"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
            "
          >
            Del
          </button>
        </div>
      </div>
      <div
        style="
          height: 1px;
          width: 100%;
          background-color: #000;
          margin-top: 6px;
        "
      ></div>
    </div>
    <div
      v-if="error && !movieMode"
      style="
        text-align: center;
        color: #c00;
        margin-top: 50px;
        font-size: 16px;
        white-space: pre-line;
        padding: 0 20px;
      "
    >
      <div>Error: {{ error }}</div>
    </div>
    <div
      v-else-if="!hasContent && !movieMode"
      style="text-align: center; color: #666; margin-top: 50px; font-size: 18px"
    >
      <div v-if="emptyStateText">{{ emptyStateText }}</div>
    </div>
    <div
      v-show="!movieMode"
      v-if="hasContent"
      ref="scroller"
      :style="{
        flex: '1 1 auto',
        margin: '0px',
        padding: '10px',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: '#fff',
        fontFamily: 'sans-serif',
        fontSize: '14px',
        fontWeight: 'normal',
      }"
      @wheel.stop.prevent="handleScaledWheel"
    >
      <template
        v-for="(it, idx) in filteredItems"
        :key="idx"
      >
        <div
          v-if="idx &gt; 0 &amp;&amp; Number(it?.sequence) === 1"
          style="
            margin: 0;
            padding: 0;
            line-height: 14px;
            white-space: nowrap;
            overflow: hidden;
            font-family: monospace;
          "
        >
          ====================================================================================================
        </div>
        <div
          :style="getCardStyle(it)"
          @click="handleCardClick($event, it)"
          @mousedown="$event.shiftKey && $event.preventDefault()"
          @mouseenter="handleMouseEnter($event, it)"
          @mouseleave="handleMouseLeave($event)"
        >
          <div
            style="
              font-weight: bold;
              font-size: 14px;
              word-wrap: break-word;
              overflow-wrap: break-word;
              font-family: sans-serif;
              display: flex;
              align-items: flex-start;
              justify-content: space-between;
              gap: 8px;
            "
          >
            <span>{{ it.title || "(no title)" }}</span>
            <!-- NOTE: never mix static style= and dynamic :style= on the same element for
                 properties you want to toggle — static style always wins and blocks :style changes.
                 Put ALL style properties in a single :style object instead.
                 NOTE: do not use :disabled for state-toggled buttons — the browser's disabled
                 styling overrides background/color, making the change invisible. Guard in the
                 click handler instead. -->
            <button
              v-if="it.error"
              :style="{
                flexShrink: 0,
                fontSize: '11px',
                padding: '2px 7px',
                cursor: retryingTitles[it.title] ? 'default' : 'pointer',
                border: retryingTitles[it.title]
                  ? '1px solid #aaa'
                  : '1px solid #c00',
                borderRadius: '4px',
                background: retryingTitles[it.title] ? '#eee' : '#fff0f0',
                color: retryingTitles[it.title] ? '#999' : '#c00',
                whiteSpace: 'nowrap',
              }"
              @click.stop="retryDownload(it.title)"
            >
              {{ retryingTitles[it.title] ? "..." : "Retry" }}
            </button>
          </div>
          <div
            style="
              margin-top: 8px;
              color: #333;
              font-size: 13px;
              word-wrap: break-word;
              overflow-wrap: break-word;
              font-family: sans-serif;
            "
          >
            <span
              v-if="line2(it).seasonEpisode"
              style="color: blue !important"
              >{{ line2(it).seasonEpisode }}</span
            ><span
              v-if="line2(it).rest"
              style="color: rgba(0, 0, 0, 0.5) !important"
              ><span v-if="line2(it).seasonEpisode">&nbsp;&nbsp;</span
              ><span style="color: rgba(0, 0, 0, 0.5) !important">{{
                line2(it).rest
              }}</span></span
            >
          </div>
        </div>
      </template>
    </div>
    <!-- Movie downloads pane: shows rsync progress from down server -->
    <div
      v-show="movieMode"
      :style="{
        flex: '1 1 auto',
        margin: '0px',
        padding: '10px',
        overflowY: 'auto',
        overflowX: 'hidden',
        background: '#fff',
        fontFamily: 'sans-serif',
        fontSize: '14px',
        fontWeight: 'normal',
      }"
    >
      <div
        v-if="movieDownJobs.length === 0"
        style="
          text-align: center;
          color: #666;
          margin-top: 50px;
          font-size: 18px;
        "
      >
        No movie downloads in progress.
      </div>
      <div
        v-for="(job, idx) in movieDownJobs"
        :key="idx"
        style="
          margin-bottom: 8px;
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 7px;
          background: #fafafa;
        "
      >
        <div style="font-weight: bold; font-size: 13px; margin-bottom: 4px">
          {{ job.name }}
        </div>
        <div style="font-size: 12px; color: #555">
          {{ movieLine(job) }}
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import parseTorrentTitle from "parse-torrent-title";
import evtBus from "../evtBus.js";
import { config } from "../config.js";
import * as srvr from "../srvr.js";
import * as util from "../util.js";
import { parseTitleFromFilename } from "../util.js";
import { unilog, logHere } from "../log.js";

// Audible alert played alongside the desktop notification when the laptop lid
// is closed and the notification can't be seen.
const BEEP_HZ = 880;
const BEEP_MS = 250;
const BEEP_GAP_MS = 150;
const BEEP_COUNT = 1;
const BEEP_VOLUME = 0.25;
const LID_URL = "/__lid";
const LID_TIMEOUT_MS = 6000;

export default {
  name: "TvProc",

  props: {
    show: {
      type: Object,
      default: null,
    },
    simpleMode: {
      type: Boolean,
      default: false,
    },
    sizing: {
      type: Object,
      default: () => ({}),
    },
    movieMode: {
      type: Boolean,
      default: false,
    },
  },

  data() {
    return {
      items: [],
      error: null,
      retryingTitles: {},
      aborting: false,
      _downloadsChannel: null,
      _active: false,
      _firstLoad: false,
      _didLoadOnce: false,
      _inFlight: false,
      _loadingTimer: null,
      _showLoading: false,
      _lastScrollTop: null,
      _hasEverMounted: false,
      _didInitialVisibleScroll: false,
      _fastPollStartTime: null,
      _oldDownloadingCount: 0,
      _lastFinishedEnded: 0,
      _lastNotifiedEnded: 0,
      _tvprocInitialized: false,
      _lastStartProcAt: 0,
      _startProcInFlight: false,
      _startProcPending: false,
      matchedTitle: null,
      isChecking: false,
      showErrs: false,
      activeOnly: false,
      showFilter: null,
      pollingStopped: false,
      fileSearch: "",
      flashingItem: null, // Item flashing after alt-click copy
      selectedItems: new Set(), // Multi-select for new button group
      lastSelectedIndex: null,
      movieDownJobs: [],
      movieCycling: false,
      _movieDownloadsChannel: null,
    };
  },

  computed: {
    hasContent() {
      return !this.error && Array.isArray(this.items) && this.items.length > 0;
    },

    movieDownloadStats() {
      const active = this.movieDownJobs.filter((j) => j.status !== "Finished");
      if (active.length === 0) return { totalText: "", avgText: "" };
      const parseRate = (r) => {
        if (!r) return 0;
        const m = r.match(/([\d.]+)(MB|KB|GB)\/s/i);
        if (!m) return 0;
        const n = parseFloat(m[1]);
        const u = m[2].toUpperCase();
        if (u === "GB") return n * 1024;
        if (u === "KB") return n / 1024;
        return n; // MB/s
      };
      const total = active.reduce((s, j) => s + parseRate(j.rate), 0);
      const avg = total / active.length;
      const fmt = (v) => `${Math.round(v * 8)} mb`;
      return { totalText: fmt(total), avgText: fmt(avg) };
    },

    totalDownloadingSpeedText() {
      const items = Array.isArray(this.items) ? this.items : [];
      const downloading = items.filter(
        (it) =>
          String(it?.status || "")
            .trim()
            .toLowerCase() === "downloading",
      );
      if (downloading.length === 0) return "";
      const totalBitsPerSec = downloading.reduce((sum, it) => {
        const n = Number(it?.speed);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
      return this.fmtGbPerSec(totalBitsPerSec);
    },

    avgDownloadingSpeedText() {
      const items = Array.isArray(this.items) ? this.items : [];
      const downloading = items.filter(
        (it) =>
          String(it?.status || "")
            .trim()
            .toLowerCase() === "downloading",
      );
      if (downloading.length === 0) return "";
      const totalBitsPerSec = downloading.reduce((sum, it) => {
        const n = Number(it?.speed);
        return sum + (Number.isFinite(n) ? n : 0);
      }, 0);
      const avgBitsPerSec = totalBitsPerSec / downloading.length;
      return this.fmtGbPerSec(avgBitsPerSec);
    },

    emptyStateText() {
      if (this.hasContent) return "";
      if (this._didLoadOnce) return "No results.";
      if (this._showLoading) return "Loading ...";
      return "";
    },

    orderedItems() {
      // Render in the exact array order returned by /api/tvproc.
      return Array.isArray(this.items) ? this.items : [];
    },

    displayedItems() {
      let base = this.orderedItems;
      if (this.showErrs) base = base.filter((it) => it && it.error);
      if (this.activeOnly) {
        base = base.filter((it) => {
          const st = String(it?.status || "")
            .trim()
            .toLowerCase();
          return st === "waiting" || st === "downloading";
        });
      }
      if (this.showFilter) {
        base = base.filter((it) => this.showName(it) === this.showFilter);
      }
      return base;
    },

    errorItems() {
      return this.orderedItems.filter((it) => it && it.error);
    },

    errsButtonBg() {
      return this.showErrs ? "#aaa" : "whitesmoke";
    },

    selectedAbortableCount() {
      let count = 0;
      for (const it of this.selectedItems) {
        const st = String(it?.status || "").toLowerCase();
        if (st === "waiting" || st === "downloading") count++;
      }
      return count;
    },

    filteredItems() {
      const q = (this.fileSearch || "").trim().toLowerCase();
      if (!q) return this.displayedItems;
      return this.displayedItems.filter((it) =>
        String(it?.title || "")
          .toLowerCase()
          .includes(q),
      );
    },
  },

  watch: {
    show() {
      this.matchedTitle = null;
      this.selectedItems = new Set();
      this.lastSelectedIndex = null;
    },
    movieMode(val) {
      if (val) {
        this.startMoviePoll();
      } else {
        this.stopMoviePoll();
        this.movieDownJobs = [];
        void this.loadTvproc();
      }
    },
  },

  mounted() {
    evtBus.on("paneChanged", this.onPaneChanged);
    evtBus.on("cycle-started", this.handleCycleStarted);

    this._onDownDelKey = () => {
      if (this.selectedItems.size > 0) this.downDelClick();
    };
    evtBus.on("downDelKey", this._onDownDelKey);

    // Subscribe at boot so data is always fresh.
    this.startPolling();
  },

  unmounted() {
    evtBus.off("paneChanged", this.onPaneChanged);
    evtBus.off("cycle-started", this.handleCycleStarted);
    if (this._onDownDelKey) evtBus.off("downDelKey", this._onDownDelKey);
    this.stopPolling();
    this.stopMoviePoll();
    this.items = [];
    this.error = null;
  },

  methods: {
    async startMovieCycle() {
      try {
        await fetch(`${config.tvDownUrl}/movieCycle`, { method: "POST" });
      } catch {
        /* ignore */
      }
    },

    async killMovieDownloads() {
      try {
        await fetch(`${config.tvDownUrl}/movieKill`, { method: "POST" });
      } catch {
        /* ignore */
      }
    },

    startMoviePoll() {
      if (this._movieDownloadsChannel) return;
      const applyMovieDownloads = (data) => {
        if (Array.isArray(data?.jobs)) {
          this.movieDownJobs = data.jobs;
          this.movieCycling = !!data.cycling;
        }
      };
      this._movieDownloadsChannel = srvr.openChannel("movieDownloads", {
        onSnapshot: applyMovieDownloads,
        onDelta: applyMovieDownloads,
      });
    },

    stopMoviePoll() {
      this._movieDownloadsChannel?.close();
      this._movieDownloadsChannel = null;
    },

    handleScaledWheel(event) {
      if (!event) return;
      const el = event.currentTarget;
      if (!el) return;
      const dy = event.deltaY || 0;
      const scaledDy = dy * 0.125;
      const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      el.scrollTop = Math.max(0, Math.min(max, (el.scrollTop || 0) + scaledDy));
    },

    // True when Windows reports no active display panel, meaning the lid is
    // shut. Only the vite dev server answers this; anywhere else we can't tell
    // and report open so no beep is emitted.
    async lidIsClosed() {
      try {
        const res = await fetch(LID_URL, {
          signal: AbortSignal.timeout(LID_TIMEOUT_MS),
        });
        if (!res.ok) return false;
        const body = await res.json();
        return body?.closed === true;
      } catch (e) {
        logHere({ grp: "down" }, `lid state check failed: ${e?.message || e}`);
        return false;
      }
    },

    async beep() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      try {
        if (ctx.state === "suspended") await ctx.resume();
        for (let i = 0; i < BEEP_COUNT; i++) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = BEEP_HZ;
          gain.gain.value = BEEP_VOLUME;
          osc.connect(gain).connect(ctx.destination);
          const start = ctx.currentTime + i * ((BEEP_MS + BEEP_GAP_MS) / 1000);
          osc.start(start);
          osc.stop(start + BEEP_MS / 1000);
        }
        const totalMs = BEEP_COUNT * (BEEP_MS + BEEP_GAP_MS);
        await new Promise((r) => setTimeout(r, totalMs));
      } finally {
        void ctx.close();
      }
    },

    async notifyAllUsbFinished(lastTitle) {
      try {
        if (typeof window === "undefined") return;
        if (!("Notification" in window)) return;

        const title = String(lastTitle || "").trim();
        const msg = title
          ? `All files have been downloaded from USB, the last is ${title}.`
          : "All USB downloads finished.";

        if (Notification.permission === "granted") {
          new Notification(msg);
          if (await this.lidIsClosed()) await this.beep();
          return;
        }

        // Do not request permission automatically (may require user gesture).
        // If user wants notifications, they can grant it in browser/site settings.
        unilog(
          917,
          "Desktop notification not shown (permission:",
          Notification.permission + ")",
        );
      } catch (e) {
        unilog(918, "notifyAllUsbFinished failed:", e?.message || String(e));
      }
    },

    handleCycleStarted() {
      if (this.pollingStopped) return;
      // Channel updates now arrive from tv-down; keep this as state bookkeeping.
      this._fastPollStartTime = Date.now();
      this._oldDownloadingCount = this.items.filter((it) => {
        const st = String(it?.status || "")
          .trim()
          .toLowerCase();
        if (st !== "downloading") return false;
        const ended = Number(it?.dateEnded);
        return !Number.isFinite(ended) || ended === 0;
      }).length;
    },

    onPaneChanged(pane) {
      const active = pane === "down";
      this._active = active;
      if (active) {
        // Load data when switching to this pane.
        // On app load, tvproc is mounted under v-show and may have been polling while hidden
        // (display:none). Scroll-to-bottom can't reliably take effect while hidden, so force a
        // one-time bottom scroll the first time the pane becomes visible.
        if (!this._didInitialVisibleScroll) {
          void this.loadTvproc({
            isInitialPaneSwitch: true,
            forceScrollToBottom: true,
          });
          this._didInitialVisibleScroll = true;
        } else {
          void this.loadTvproc({ isInitialPaneSwitch: true });
        }
      } else {
        // Clear highlight when leaving pane
        this.matchedTitle = null;

        // Store scroll position when leaving
        const el = this.$refs.scroller;
        if (el) {
          this._lastScrollTop = el.scrollTop;
        }
      }
    },

    togglePolling() {
      if (this.pollingStopped) {
        this.pollingStopped = false;
        this.startPolling();
      } else {
        this.pollingStopped = true;
        this.stopPolling();
      }
    },

    startPolling() {
      if (this._downloadsChannel) return;
      this.startLoadingDelay();
      const applyDownloads = async (items) => {
        await this.loadTvproc({ channelItems: items });
      };
      this._downloadsChannel = srvr.openChannel("downloads", {
        onSnapshot: applyDownloads,
        onDelta: applyDownloads,
        onUnavailable: () => this.finishLoadingDelay(),
      });
    },

    stopPolling() {
      this._downloadsChannel?.close();
      this._downloadsChannel = null;
      this._inFlight = false;
      this._showLoading = false;
      if (this._loadingTimer) {
        clearTimeout(this._loadingTimer);
        this._loadingTimer = null;
      }
    },

    startLoadingDelay() {
      this._inFlight = true;
      this._showLoading = false;
      if (this._loadingTimer) {
        clearTimeout(this._loadingTimer);
        this._loadingTimer = null;
      }
      this._loadingTimer = setTimeout(() => {
        if (this._inFlight && !this._didLoadOnce && !this.hasContent) {
          this._showLoading = true;
        }
      }, 2000);
    },

    finishLoadingDelay() {
      this._inFlight = false;
      this._showLoading = false;
      if (this._loadingTimer) {
        clearTimeout(this._loadingTimer);
        this._loadingTimer = null;
      }
    },

    isNearBottom(el) {
      if (!el) return false;
      const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
      return dist <= 20;
    },

    scrollToBottom(el) {
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    },

    fmtMdhm(ts) {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= 0) return "";

      // Accept seconds or milliseconds.
      const ms = n > 1e12 ? n : n * 1000;
      const d = new Date(ms);
      if (Number.isNaN(d.getTime())) return "";

      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      let hh = String(d.getHours()).padStart(2, "0");
      if (hh === "24") hh = "00";
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${month}/${day}.${hh}:${mm}:${ss}`;
    },

    // Duration in mm:ss, or h:mm:ss when >= 1 hour. Blank for null/invalid.
    fmtDuration(seconds) {
      if (seconds == null) return "";
      const n = Number(seconds);
      if (!Number.isFinite(n) || n < 0) return "";
      const s = Math.floor(n);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = s % 60;
      return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
        : `${m}:${String(sec).padStart(2, "0")}`;
    },

    // Bit rate in integer megabits/sec with a "Mb" unit. Input is bits/sec.
    fmtRateMb(bitsPerSec) {
      const n = Number(bitsPerSec);
      if (!Number.isFinite(n) || n < 0) return "";
      return `${Math.round(n / 1e6)} Mb`;
    },

    // Remaining seconds from an eta that may be a duration or a unix timestamp.
    etaRemainingSeconds(eta) {
      const n = Number(eta);
      if (!Number.isFinite(n) || n <= 0) return null;
      const now = Math.floor(Date.now() / 1000);
      return n > 10000000 ? Math.max(0, n - now) : n;
    },

    // Parse "h:mm:ss" / "mm:ss" / "ss" into total seconds.
    parseDurationStr(str) {
      const parts = String(str || "")
        .split(":")
        .map(Number);
      if (parts.length === 0 || parts.some((x) => !Number.isFinite(x)))
        return null;
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      if (parts.length === 1) return parts[0];
      return null;
    },

    fmtHhmm(ts) {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= 0) return "";

      // Accept seconds or milliseconds.
      const ms = n > 1e12 ? n : n * 1000;
      const d = new Date(ms);
      if (Number.isNaN(d.getTime())) return "";

      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${hh}:${mm}:${ss}`;
    },

    fmtSize(bytesOrHumanString) {
      return util.fmtBytesSize(bytesOrHumanString);
    },

    fmtGbPerSec(bitsPerSec) {
      // Server reports bits/sec. Display as integer megabits/sec with no units.
      const n = Number(bitsPerSec);
      if (!Number.isFinite(n) || n < 0) return "";
      const mbps = n / 1e6;
      return `${Math.round(mbps)} mb`;
    },

    fmtMovieTotalBytes(job) {
      if (!job.bytes_done || !job.percent) return 0;
      return Math.round(job.bytes_done / (job.percent / 100));
    },

    fmtMovieRsyncRate(rateStr) {
      const m = String(rateStr || "").match(/^([\d.]+)(KB|MB|GB)\/s$/i);
      if (!m) return rateStr || "";
      let mbps = parseFloat(m[1]);
      const unit = m[2].toUpperCase();
      if (unit === "KB") mbps = (mbps * 8) / 1024;
      else if (unit === "MB") mbps = mbps * 8;
      else if (unit === "GB") mbps = mbps * 8 * 1024;
      return `${Math.round(mbps)} Mb`;
    },


    elapsedSeconds(it) {
      const started = Number(it?.dateStarted);
      if (!Number.isFinite(started) || started === 0) return null;
      const ended = it?.dateEnded
        ? Number(it.dateEnded)
        : Math.floor(Date.now() / 1000);
      if (!Number.isFinite(ended)) return null;
      return Math.max(0, ended - started);
    },

    showName(it) {
      if (it?.seriesName) return it.seriesName;
      const fname = it?.title || "";
      const usbPath = it?.usbPath || "";
      // Extract folder name from usbPath (the last non-empty path segment)
      const parts = usbPath.replace(/[\\/]+$/, "").split(/[\\/]/);
      const folderName = parts[parts.length - 1] || "";

      let _pttParser = null;
      try {
        if (typeof parseTorrentTitle === "function")
          _pttParser = parseTorrentTitle;
        else if (parseTorrentTitle?.parse) _pttParser = parseTorrentTitle.parse;
        else if (parseTorrentTitle?.default?.parse)
          _pttParser = parseTorrentTitle.default.parse;
      } catch (e) {}
      let parsedPtt = {};
      try {
        if (_pttParser) parsedPtt = _pttParser(fname) || {};
      } catch (e) {}

      const result = parseTitleFromFilename(fname, folderName, parsedPtt) || "";
      if (
        !result &&
        String(it?.status || "").toLowerCase() === "error-downloaded"
      ) {
        return "<unknown show name>";
      }
      return result;
    },
    // Resolution parsed from a download's filename/title (e.g. "1080p"),
    // omitting unknown or mixed values.
    parseResolution(title) {
      const raw = String(title || "").trim();
      if (!raw) return "";
      let parser = null;
      if (typeof parseTorrentTitle === "function") parser = parseTorrentTitle;
      else if (parseTorrentTitle?.parse) parser = parseTorrentTitle.parse;
      else if (parseTorrentTitle?.default?.parse)
        parser = parseTorrentTitle.default.parse;
      let res = "";
      try {
        res = String(parser?.(raw)?.resolution || "").trim();
      } catch {
        res = "";
      }
      if (!res || res.toLowerCase() === "mixed") return "";
      return res;
    },

    line2(it) {
      const sep = "\u00A0\u00A0";
      const s = Number(it?.season);
      const e = Number(it?.episode);
      // Blue label: "2/1 - 720p" (single season "2", resolution omitted if
      // unknown or mixed). Matches the tor/qbt/flex panes.
      let seasonEpisode = "";
      if (Number.isFinite(s)) {
        seasonEpisode = Number.isFinite(e) ? `${s}/${e}` : String(s);
        const res = this.parseResolution(it?.title);
        if (res) seasonEpisode = `${seasonEpisode} - ${res}`;
      }

      const added = this.fmtMdhm(it?.dateAdded);
      const size = this.fmtSize(it?.fileSize);
      const status = String(it?.status || "").trim();
      const statusLower = status.toLowerCase();
      const progress = Number(it?.progress);
      const progPc =
        Number.isFinite(progress) && progress >= 0 && progress <= 100
          ? `${progress}%`
          : "";
      const rate = this.fmtRateMb(it?.speed);
      const eta = this.fmtDuration(this.etaRemainingSeconds(it?.eta));

      const out = (arr) => ({
        seasonEpisode,
        rest: arr.filter(Boolean).join(sep),
      });

      // Error-downloaded: preserve original error reason + suffix.
      if (statusLower === "error-downloaded") {
        const reason = String(it?.reason || "error").trim();
        return out([added, size, `${reason} (downloaded to tv-errors)`]);
      }

      // Waiting: added  size  0 Mb  0%  Waiting
      if (statusLower === "waiting" || statusLower === "future") {
        return out([added, size, "0 Mb", "0%", "Waiting"]);
      }

      // Downloading: added  size  rate  prog%  eta  Downloading
      if (statusLower === "downloading") {
        return out([added, size, rate, progPc, eta, "Downloading"]);
      }

      // Encoding (write phase, has eta): added  size  prog%  eta  Encoding
      // Scanning (encoding, no eta yet): added  size  Scanning
      if (statusLower === "encoding") {
        if (eta) return out([added, size, progPc, eta, "Encoding"]);
        return out([added, size, "Scanning"]);
      }

      // Finished: added  size  rate  100%  elapsed  Finished
      if (statusLower === "finished") {
        const elapsed = this.fmtDuration(this.elapsedSeconds(it));
        return out([added, size, rate, "100%", elapsed, "Finished"]);
      }

      // Other / unknown: added  size  status
      return out([added, size, status || "Unknown"]);
    },

    // Movie rsync card line — mirrors the down downloading / finished formats.
    movieLine(job) {
      const sep = "\u00A0\u00A0";
      const added = this.fmtMdhm(job?.startTime);
      const size = this.fmtSize(job?.total_bytes);
      const status = String(job?.status || "").trim();
      const statusLower = status.toLowerCase();
      const join = (arr) => arr.filter(Boolean).join(sep);

      if (statusLower === "downloading") {
        // added  size  rate  prog%  eta  Downloading
        const rate = this.fmtMovieRsyncRate(job?.rate);
        const pct = Number(job?.percent);
        const progPc = Number.isFinite(pct) ? `${pct}%` : "";
        const eta = this.fmtDuration(this.parseDurationStr(job?.eta));
        return join([added, size, rate, progPc, eta, "Downloading"]);
      }

      if (statusLower === "finished") {
        // added  size  rate(avg)  100%  elapsed  Finished
        const startMs = Number(job?.startTime);
        const endMs = Number(job?.endTime);
        const elapsedSec =
          Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
            ? (endMs - startMs) / 1000
            : null;
        const elapsed = this.fmtDuration(elapsedSec);
        const bytes = Number(job?.total_bytes);
        const avgMb =
          Number.isFinite(bytes) && elapsedSec && elapsedSec > 0
            ? `${Math.round((bytes * 8) / 1e6 / elapsedSec)} Mb`
            : "";
        return join([added, size, avgMb, "100%", elapsed, "Finished"]);
      }

      // Error / Killed / other: added  size  status
      return join([added, size, status || "Unknown"]);
    },

    getCardStyle(it) {
      const status = String(it?.status || "")
        .trim()
        .toLowerCase();
      const isDownloading = status === "downloading";
      const isSelected = this.selectedItems.has(it);
      const isFlashing = this.flashingItem === it;
      return {
        position: "relative",
        border: "1px solid #ddd",
        borderRadius: "8px",
        padding: "10px",
        background: isFlashing
          ? "#ffcccc"
          : isSelected
            ? "#fffacd"
            : isDownloading
              ? "#e8f4e8"
              : "#fff",
        cursor: "pointer",
      };
    },

    handleMouseEnter(event, it) {
      void it;
      event.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
    },

    handleMouseLeave(event) {
      event.currentTarget.style.boxShadow = "none";
    },

    handleCardClick(event, it) {
      const isAltClick = Boolean(event?.altKey);
      const isCtrlClick = Boolean(event?.ctrlKey || event?.metaKey);
      const isShiftClick = Boolean(event?.shiftKey);

      // Alt-click: copy destination file path to clipboard (relative to /mnt/media/tv, bash-quoted if needed)
      if (isAltClick) {
        const localPath = String(it?.localPath || "").replace(/\/?$/, "/");
        const fileName = String(it?.destTitle || it?.title || "");
        const fullPath = localPath + fileName;
        const relPath = fullPath.replace(/^\/mnt\/media\/[^/]+\//, "");
        navigator.clipboard.writeText(util.shellQuote(relPath)).catch(() => {});
        this.flashingItem = it;
        setTimeout(() => {
          this.flashingItem = null;
        }, 300);
        return;
      }

      const idx = this.orderedItems.indexOf(it);

      if (isShiftClick && this.lastSelectedIndex !== null) {
        event.preventDefault(); // prevent browser text selection on shift-click
        const lo = Math.min(this.lastSelectedIndex, idx);
        const hi = Math.max(this.lastSelectedIndex, idx);
        for (let i = lo; i <= hi; i++) {
          this.selectedItems.add(this.orderedItems[i]);
        }
      } else if (isCtrlClick) {
        if (this.selectedItems.has(it)) {
          this.selectedItems.delete(it);
        } else {
          this.selectedItems.add(it);
        }
        this.lastSelectedIndex = idx;
      } else {
        // Plain click: single-select
        this.selectedItems.clear();
        this.selectedItems.add(it);
        this.lastSelectedIndex = idx;
      }
      // Trigger reactivity
      this.selectedItems = new Set(this.selectedItems);
    },

    async retryDownload(title) {
      if (!title) return;
      if (this.retryingTitles[title] != null) return;
      // Store the current dateEnded — any re-processing (success or re-error) produces a new one.
      const currentItem = this.items.find((x) => x && x.title === title);
      this.retryingTitles[title] =
        currentItem && currentItem.dateEnded ? currentItem.dateEnded : -1;
      try {
        await fetch(`${config.tvDownUrl}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
      } catch (e) {
        unilog(919, "retryDownload failed:", e);
        delete this.retryingTitles[title];
      }
    },

    toggleErrs() {
      this.showErrs = !this.showErrs;
    },

    async downAbortClick() {
      const active = [...this.selectedItems].filter((it) => {
        const st = String(it?.status || "").toLowerCase();
        return st === "waiting" || st === "downloading";
      });
      if (active.length === 0) return;
      this.aborting = true;
      try {
        for (const it of active) {
          const title = it?.title;
          if (!title) continue;
          try {
            const res = await fetch(`${config.tvDownUrl}/abortDown`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title }),
            });
            if (!res.ok) {
              const text = await res.text().catch(() => "");
              window.alert(
                `Abort failed for ${title}: ${text || res.statusText}`,
              );
            }
          } catch (e) {
            window.alert(
              `Abort failed for ${title}: ${e?.message || String(e)}`,
            );
          }
        }
      } finally {
        this.aborting = false;
      }
      this.selectedItems = new Set();
      await this.loadTvproc();
    },

    async clearErrorRecords() {
      const errItems = this.errorItems;
      const count = errItems.length;
      const confirmed = window.confirm(
        `Do you want to delete ${count} files with download errors`,
      );
      this.showErrs = false;
      if (!confirmed) return;
      try {
        await fetch(`${config.tvDownUrl}/deleteErrors`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        await this.loadTvproc();
      } catch (e) {
        unilog(920, "clearErrorRecords failed:", e);
      }
    },

    showFirstDownloading() {
      // Find the card that matches the currently selected show (this.show)
      // and scroll to it.

      if (!this.show) {
        unilog(1081, "showFirstDownloading: No show selected context");
        return;
      }

      const showName = this.show.name || this.show.name; // Robustness
      if (!showName) return;

      const candidates = [this.show];
      let bestMatch = null;

      // Determine search start index
      // If we already have a focused match, start strictly AFTER it ("Next" behavior)
      let startIndex = 0;
      if (this.matchedTitle) {
        const currentIdx = this.orderedItems.findIndex(
          (it) => it && it.title === this.matchedTitle,
        );
        if (currentIdx !== -1) {
          startIndex = currentIdx + 1;
        }
      }

      // Iterate all items to find best match
      for (let i = startIndex; i < this.orderedItems.length; i++) {
        const it = this.orderedItems[i];
        const rawTitle = it.title || "";
        if (!rawTitle) continue;

        // Use parseTorrentTitle to extract clean title and year
        let parsed = null;
        try {
          let parser = null;
          if (typeof parseTorrentTitle === "function") {
            parser = parseTorrentTitle;
          } else if (
            parseTorrentTitle &&
            typeof parseTorrentTitle.parse === "function"
          ) {
            parser = parseTorrentTitle.parse;
          } else if (
            parseTorrentTitle &&
            parseTorrentTitle.default &&
            typeof parseTorrentTitle.default.parse === "function"
          ) {
            parser = parseTorrentTitle.default.parse;
          }

          parsed = parser ? parser(rawTitle) : null;
        } catch (e) {
          // ignore
        }

        const searchTitle = parsed?.title || rawTitle;
        const searchYear = parsed?.year || null;

        // Use smartTitleMatch to compare this download item against the current show
        // Task Correlation: forceChoice = false
        const match = util.smartTitleMatch(
          searchTitle,
          candidates,
          searchYear,
          false,
        );
        if (match) {
          bestMatch = it;
          break; // Found it
        }
      }

      // If no match found and we started in the middle, wrap around?
      // User instruction: "search again using only down card panes below/after the highlighted card"
      // Interpretation: STRICT, do NOT wrap. If nothing found, nothing happens (or maybe clear match?).
      // However, if nothing is found, we should probably inform user or clear the stale match if desired.
      // But clearing stale match prevents "staying" on visual context.
      // If nothing found "next", we just don't move.

      if (!bestMatch) {
        if (startIndex > 0) {
          // We were looking for "next" but found none.
          // Maybe alert "No more matches found"?
          // For now, silently fail as per "only ... below/after"
        }
        return;
      }

      this.matchedTitle = bestMatch.title;

      const scroller = this.$refs.scroller;
      if (!scroller) return;

      const idx = this.orderedItems.findIndex((it) => it === bestMatch);
      if (idx === -1) return;

      // Calculate scroll position logic...

      // Using DOM query since orderedItems maps to children (mostly)
      // Filter out separators from children to find the card index
      const allChildren = Array.from(scroller.children);
      // The list contains separators div + card div.
      // It's safer to find the element that contains the title text?
      // Or rely on idx logic properly.

      // logic from previous read_file seems to try to match array index to child index
      // but separator divs mess it up.
      // "v-for" produces divs. Separators are also divs *inside* the template v-for structure?
      // Let's check the template again.

      /*
       <template v-for="(it, idx) in orderedItems" :key="idx">
         <div v-if="..."> ==== </div>
         <div :style="..."> ... </div>
       </template>
       */

      // Each item produces 1 or 2 divs.
      // If I scan children, I can't easily map idx -> child.
      // But I can scan children for text?

      let currentIdx = 0;
      let targetEl = null;

      for (let i = 0; i < allChildren.length; i++) {
        const el = allChildren[i];
        // Skip separator divs (check content or class?)
        // Separator has "===="
        if (el.textContent && el.textContent.includes("====")) {
          continue;
        }

        if (currentIdx === idx) {
          targetEl = el;
          break;
        }
        currentIdx++;
      }

      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        // Visual highlight is handled by getCardStyle binding to matchedTitle
      }
    },

    async startCheck() {
      try {
        this.isChecking = true;
        await fetch(`${config.tvDownUrl}/startProc`, {
          method: "POST",
        });
        // Keep checking indicator for a reasonable time
        setTimeout(() => {
          this.isChecking = false;
        }, 5000);
      } catch (e) {
        unilog(921, "startCheck error", e);
        this.isChecking = false;
      }
    },

    scrollToBottomAction() {
      const el = this.$refs.scroller;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    },

    async trimLog() {
      this.error = null;
      try {
        const res = await fetch(`${config.torrentsApiUrl}/api/tvproc/trim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keepLines: 1000 }),
        });
        if (!res.ok) {
          let detail = "";
          try {
            const ct = res.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              const j = await res.json();
              detail = j?.error ? String(j.error) : JSON.stringify(j);
            } else {
              detail = await res.text();
            }
          } catch {
            // ignore
          }
          throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
        }
        await this.loadTvproc({ forceScrollToBottom: true });
      } catch (e) {
        this.error = e?.message || String(e);
      }
    },

    async loadTvproc(opts = {}) {
      this.error = null;
      this.startLoadingDelay();
      try {
        const initializing = !this._tvprocInitialized;
        const el = this.$refs.scroller;
        // Only auto-scroll if: 1) explicitly requested, or 2) not initial switch AND near bottom
        const wasNearBottom =
          !opts.isInitialPaneSwitch && el && this.isNearBottom(el);
        const shouldStick = Boolean(opts.forceScrollToBottom) || wasNearBottom;

        let arr = Array.isArray(opts.channelItems) ? opts.channelItems : null;
        if (!arr) {
          const res = await fetch(`${config.tvDownUrl}/downloads`);
          if (!res.ok) {
            let detail = "";
            try {
              const ct = res.headers.get("content-type") || "";
              if (ct.includes("application/json")) {
                const j = await res.json();
                detail = j?.error ? String(j.error) : JSON.stringify(j);
              } else {
                detail = await res.text();
              }
            } catch {
              // ignore
            }
            throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
          }
          arr = await res.json();
        }

        try {
          const toParsedTitle = (rawTitle) => {
            const raw = String(rawTitle || "").trim();
            if (!raw) return "";
            try {
              let parser = null;
              if (typeof parseTorrentTitle === "function") {
                parser = parseTorrentTitle;
              } else if (
                parseTorrentTitle &&
                typeof parseTorrentTitle.parse === "function"
              ) {
                parser = parseTorrentTitle.parse;
              } else if (
                parseTorrentTitle &&
                parseTorrentTitle.default &&
                typeof parseTorrentTitle.default.parse === "function"
              ) {
                parser = parseTorrentTitle.default.parse;
              }
              const parsed = parser ? parser(raw) : null;
              return String(parsed?.title || raw).trim();
            } catch {
              return raw;
            }
          };

          const downloadingTitles = Array.isArray(arr)
            ? arr
                .filter((it) => {
                  const st = String(it?.status || "")
                    .trim()
                    .toLowerCase();
                  return (
                    st === "downloading" ||
                    st === "waiting" ||
                    st === "future" ||
                    st === "encoding"
                  );
                })
                .map((it) => it?.seriesName || toParsedTitle(it?.title))
                .filter(Boolean)
            : [];
          evtBus.emit("activeDownTitles", downloadingTitles);
        } catch {
          // ignore
        }

        // downActive: true when any item is downloading or waiting (formerly "future").
        try {
          const active = Array.isArray(arr)
            ? arr.some((it) => {
                const st = String(it?.status || "")
                  .trim()
                  .toLowerCase();
                return (
                  st === "downloading" ||
                  st === "waiting" ||
                  st === "future" ||
                  st === "encoding"
                );
              })
            : false;
          evtBus.emit("downActivePart", { source: "tvproc", active });
        } catch {
          // ignore
        }

        const isActiveDownloading = (it) => {
          const st = String(it?.status || "")
            .trim()
            .toLowerCase();
          if (st !== "downloading" && st !== "encoding") return false;
          const ended = Number(it?.dateEnded);
          // Old behavior: treat downloads with no/zero end time as active.
          return !Number.isFinite(ended) || ended === 0;
        };

        const isFuture = (it) => {
          const st = String(it?.status || "")
            .trim()
            .toLowerCase();
          return st === "waiting" || st === "future";
        };

        // Track status changes for downloading items
        const oldDownloading = Array.isArray(this.items)
          ? this.items.filter(isActiveDownloading)
          : [];
        const oldFutures = Array.isArray(this.items)
          ? this.items.filter(isFuture)
          : [];
        const newDownloading = Array.isArray(arr)
          ? arr.filter(isActiveDownloading)
          : [];
        const newFutures = Array.isArray(arr) ? arr.filter(isFuture) : [];

        // Detect newly-finished items since last poll.
        // dateEnded is expected to be epoch seconds (or ms); treat both.
        const toSeconds = (n) => {
          const x = Number(n);
          if (!Number.isFinite(x) || x <= 0) return 0;
          return x > 1e12 ? Math.floor(x / 1000) : Math.floor(x);
        };
        const finishedEndedMax = Array.isArray(arr)
          ? arr
              .filter((it) => String(it?.status || "").trim() === "finished")
              .reduce((mx, it) => Math.max(mx, toSeconds(it?.dateEnded)), 0)
          : 0;
        let didFinishSomething =
          finishedEndedMax > Number(this._lastFinishedEnded || 0);

        // On the first successful load, establish a baseline so we don't
        // notify for historical "finished" items already present.
        if (initializing) {
          this._tvprocInitialized = true;
          this._lastFinishedEnded = finishedEndedMax;
          this._lastNotifiedEnded = finishedEndedMax;
          didFinishSomething = false;
        }

        // (debug logging removed)

        // If we've already asked the server to start downloads, wait until we see the
        // queue actually advance before sending another startProc.
        if (this._startProcPending) {
          const didAdvance =
            newFutures.length === 0 ||
            newFutures.length < oldFutures.length ||
            newDownloading.length > oldDownloading.length;
          if (didAdvance) this._startProcPending = false;
        }

        // Keep starting downloads while there is a queue.
        // With concurrent downloads, do not wait for newDownloading.length === 0.
        // Only send one startProc per observed queue advance.
        if (!initializing && newFutures.length > 0) {
          const nowMs = Date.now();
          const cooldownMs = 1500;
          const canStart =
            !this._startProcInFlight &&
            !this._startProcPending &&
            nowMs - Number(this._lastStartProcAt || 0) >= cooldownMs;

          if (canStart) {
            this._lastStartProcAt = nowMs;
            this._startProcInFlight = true;
            // Ensure we observe the newly-started downloads quickly.
            this._fastPollStartTime = nowMs;

            let ok = false;
            try {
              const resp = await fetch(`${config.tvDownUrl}/startProc`, {
                method: "POST",
              });
              ok = Boolean(resp && resp.ok);
            } catch {
              ok = false;
            } finally {
              this._startProcInFlight = false;
            }

            if (ok) {
              this._startProcPending = true;
            }
          }
        }

        // Notify only once per newly observed finished timestamp, and only when everything is done.
        // With concurrent downloads, this means: no active downloads and no future queue.
        if (
          !initializing &&
          newDownloading.length === 0 &&
          newFutures.length === 0 &&
          (oldDownloading.length > 0 || didFinishSomething)
        ) {
          // Mark the finished item as processed BEFORE emitting cycle-started
          // to avoid re-entrant loadTvproc() calls re-detecting it.
          if (finishedEndedMax > Number(this._lastFinishedEnded || 0)) {
            this._lastFinishedEnded = finishedEndedMax;
          }

          if (finishedEndedMax > Number(this._lastNotifiedEnded || 0)) {
            this._lastNotifiedEnded = finishedEndedMax;
            const lastTitle = String(
              oldDownloading?.[oldDownloading.length - 1]?.title || "",
            ).trim();
            this.notifyAllUsbFinished(lastTitle);
          }

          // No further action needed here; the queue is empty.
        }

        // Update last-finished timestamp after processing.
        if (finishedEndedMax > Number(this._lastFinishedEnded || 0)) {
          this._lastFinishedEnded = finishedEndedMax;
        }

        // Clear busy indicator for any retrying title where processing completed.
        // Clears when: item gone, error resolved, or dateEnded changed (re-errored with new attempt).
        for (const t of Object.keys(this.retryingTitles)) {
          const item = arr.find((x) => x && x.title === t);
          if (!item || !item.error || item.dateEnded !== this.retryingTitles[t])
            delete this.retryingTitles[t];
        }

        if (!this.movieMode) {
          this.items = arr;
        }

        // Remap selectedItems to new objects by title so selection persists through polls
        if (this.selectedItems.size > 0) {
          const selectedTitles = new Set(
            [...this.selectedItems].map((it) => it?.title).filter(Boolean),
          );
          if (selectedTitles.size > 0) {
            const newSel = new Set();
            let newLastIdx = null;
            for (let i = 0; i < arr.length; i++) {
              const newIt = arr[i];
              if (newIt && selectedTitles.has(newIt.title)) {
                newSel.add(newIt);
                newLastIdx = i;
              }
            }
            this.selectedItems = newSel;
            if (newLastIdx !== null) this.lastSelectedIndex = newLastIdx;
          }
        }

        const isFirstLoad = !this._didLoadOnce;
        this._didLoadOnce = true;

        await this.$nextTick();
        const el2 = this.$refs.scroller;

        // Scroll to bottom on very first load ever
        if (isFirstLoad && !this._hasEverMounted) {
          this._hasEverMounted = true;
          this.scrollToBottom(el2);
        } else if (shouldStick) {
          this.scrollToBottom(el2);
        }
        // Don't touch scroll position otherwise - v-show preserves it naturally
        this._firstLoad = false;
      } catch (e) {
        this.error = e?.message || String(e);
      } finally {
        this.finishLoadingDelay();
      }
    },

    // Helper: extract show name from a download item
    downExtractShowName(it) {
      const rawTitle = String(it?.seriesName || it?.title || "");
      if (!rawTitle) return "";
      try {
        let parser = null;
        if (typeof parseTorrentTitle === "function") {
          parser = parseTorrentTitle;
        } else if (
          parseTorrentTitle &&
          typeof parseTorrentTitle.parse === "function"
        ) {
          parser = parseTorrentTitle.parse;
        } else if (
          parseTorrentTitle?.default &&
          typeof parseTorrentTitle.default.parse === "function"
        ) {
          parser = parseTorrentTitle.default.parse;
        }
        if (!parser) return rawTitle;
        const parsed = parser(rawTitle);
        return parsed?.title || rawTitle;
      } catch {
        return rawTitle;
      }
    },

    // Helper: scroll scroller to item at orderedItems index
    downScrollToIndex(idx) {
      const scroller = this.$refs.scroller;
      if (!scroller) return;
      const allChildren = Array.from(scroller.children);
      let currentIdx = 0;
      for (const el of allChildren) {
        if (el.textContent && el.textContent.includes("====")) continue;
        if (currentIdx === idx) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        currentIdx++;
      }
    },

    // Sel: emit selectShowFromCardTitle for first selected item
    downSelClick() {
      const first = [...this.selectedItems][0];
      if (!first) return;
      const name = this.downExtractShowName(first);
      if (name) evtBus.emit("selectShowFromCardTitle", name);
    },

    showFilterClick() {
      if (this.showFilter) {
        this.showFilter = null;
        return;
      }
      const first = [...this.selectedItems][0];
      if (!first) return;
      this.showFilter = this.showName(first) || null;
    },

    // From: select all items matching current show; scroll to first
    downFromClick() {
      if (!this.show) return;
      const candidates = [this.show];
      const newSel = new Set();
      let firstIdx = null;
      for (let i = 0; i < this.orderedItems.length; i++) {
        const it = this.orderedItems[i];
        const name = this.downExtractShowName(it);
        if (!name) continue;
        const match = util.smartTitleMatch(name, candidates, null, false);
        if (match) {
          newSel.add(it);
          if (firstIdx === null) firstIdx = i;
        }
      }
      this.selectedItems = newSel;
      if (firstIdx !== null) {
        this.lastSelectedIndex = firstIdx;
        this.$nextTick(() => this.downScrollToIndex(firstIdx));
      }
    },

    // All: select all items matching first selected item's show
    downAllClick() {
      const first = [...this.selectedItems][0];
      if (!first) return;
      const pivotName = this.downExtractShowName(first);
      if (!pivotName) return;
      const newSel = new Set();
      let firstIdx = null;
      for (let i = 0; i < this.orderedItems.length; i++) {
        const it = this.orderedItems[i];
        const name = this.downExtractShowName(it);
        if (!name) continue;
        const match = util.smartTitleMatch(
          name,
          [{ name: pivotName }],
          null,
          false,
        );
        if (match) {
          newSel.add(it);
          if (firstIdx === null) firstIdx = i;
        }
      }
      this.selectedItems = newSel;
      if (firstIdx !== null) {
        this.lastSelectedIndex = firstIdx;
        this.$nextTick(() => this.downScrollToIndex(firstIdx));
      }
    },

    // First: scroll to first selected item
    downFirstClick() {
      const first = [...this.selectedItems][0];
      if (!first) return;
      const idx = this.orderedItems.indexOf(first);
      if (idx < 0) return;
      this.$nextTick(() => this.downScrollToIndex(idx));
    },

    // Del: confirm then delete selected items (DB + file)
    async downDelClick() {
      const count = this.selectedItems.size;
      if (count === 0) return;
      const ok = window.confirm(
        `Delete ${count} file${count === 1 ? "" : "s"}?`,
      );
      if (!ok) return;
      const titles = [...this.selectedItems]
        .map((it) => String(it?.title || ""))
        .filter(Boolean);
      this.selectedItems = new Set();
      if (titles.length === 0) return;
      try {
        const res = await fetch(`${config.tvDownUrl}/delItems`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ titles }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          window.alert(`Delete failed: ${text || res.statusText}`);
        }
      } catch (err) {
        window.alert(`Delete failed: ${err?.message || String(err)}`);
      }
      await this.loadTvproc();
    },
  },
};
</script>
