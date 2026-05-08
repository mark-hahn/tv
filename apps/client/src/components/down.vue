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
          <span>Downloads</span
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
          ><span
            v-if="movieMode && movieDownloadStats.totalText"
            style="
              margin-left: 20px;
              align-self: center;
              font-size: 13px;
              color: #555;
              white-space: nowrap;
              font-weight: normal;
            "
            >{{ movieDownloadStats.totalText }}</span
          ><span
            v-if="movieMode && movieDownloadStats.avgText"
            style="
              margin-left: 20px;
              align-self: center;
              font-size: 13px;
              color: #555;
              white-space: nowrap;
              font-weight: normal;
            "
            >avg: {{ movieDownloadStats.avgText }}</span
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
            v-if="!movieMode"
            @click.stop="startCheck"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
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
            @click.stop="scrollToActive"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
            "
          >
            Active
          </button>
          <button
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
          <button
            @click.stop="downSelClick"
            :disabled="selectedItems.size === 0"
            :style="{
              fontSize: '13px',
              cursor: selectedItems.size > 0 ? 'pointer' : 'default',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': selectedItems.size > 0 ? 'whitesmoke' : '#e8e8e8',
              color: selectedItems.size > 0 ? 'inherit' : '#aaa',
            }"
          >
            Sel
          </button>
          <button
            @click.stop="downFromClick"
            :disabled="!show"
            :style="{
              fontSize: '13px',
              cursor: show ? 'pointer' : 'default',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': show ? 'whitesmoke' : '#e8e8e8',
              color: show ? 'inherit' : '#aaa',
            }"
          >
            From
          </button>
          <button
            @click.stop="downAllClick"
            :disabled="selectedItems.size === 0"
            :style="{
              fontSize: '13px',
              cursor: selectedItems.size > 0 ? 'pointer' : 'default',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': selectedItems.size > 0 ? 'whitesmoke' : '#e8e8e8',
              color: selectedItems.size > 0 ? 'inherit' : '#aaa',
            }"
          >
            All
          </button>
          <button
            @click.stop="downFirstClick"
            :disabled="selectedItems.size === 0"
            :style="{
              fontSize: '13px',
              cursor: selectedItems.size > 0 ? 'pointer' : 'default',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': selectedItems.size > 0 ? 'whitesmoke' : '#e8e8e8',
              color: selectedItems.size > 0 ? 'inherit' : '#aaa',
            }"
          >
            First
          </button>
          <button
            @click.stop="downDelClick"
            :disabled="selectedItems.size === 0"
            :style="{
              fontSize: '13px',
              cursor: selectedItems.size > 0 ? 'pointer' : 'default',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': selectedItems.size > 0 ? 'whitesmoke' : '#e8e8e8',
              color: selectedItems.size > 0 ? 'inherit' : '#aaa',
            }"
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
            v-if="showName(it)"
            style="
              font-size: 13px;
              font-weight: bold;
              color: #555;
              font-family: sans-serif;
              margin-bottom: 4px;
            "
          >
            {{ showName(it) }}
          </div>
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
              ><span v-if="line2(it).seasonEpisode">&nbsp;|&nbsp;</span
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
          {{ fmtSize(fmtMovieTotalBytes(job)) }} |
          {{ fmtSize(job.bytes_done) }} | {{ fmtMovieRsyncRate(job.rate) }} |
          Rem: {{ job.eta }} | Eta: {{ fmtMovieEta(job.eta) }} |
          {{ job.status }}
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import parseTorrentTitle from "parse-torrent-title";
import evtBus from "../evtBus.js";
import { config } from "../config.js";
import * as util from "../util.js";
import { parseTitleFromFilename } from "../util.js";

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
      _pollTimer: null,
      _polling: false,
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
      pollingStopped: false,
      fileSearch: "",
      selectedItems: new Set(), // Multi-select for new button group
      lastSelectedIndex: null,
      movieDownJobs: [],
      _moviePollTimer: null,
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
      const fmt = (v) =>
        v >= 1024
          ? `${(v / 1024).toFixed(2)} GB/s`
          : v >= 1
            ? `${v.toFixed(1)} MB/s`
            : `${(v * 1024).toFixed(0)} KB/s`;
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
      if (!this.showErrs) return this.orderedItems;
      return this.orderedItems.filter((it) => it && it.error);
    },

    errorItems() {
      return this.orderedItems.filter((it) => it && it.error);
    },

    errsButtonBg() {
      return this.showErrs ? "#aaa" : "whitesmoke";
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
      }
    },
  },

  mounted() {
    evtBus.on("paneChanged", this.onPaneChanged);
    evtBus.on("cycle-started", this.handleCycleStarted);

    // Start polling at boot so data is always fresh.
    this._polling = true;
    void this.loadTvproc();
    this.scheduleNextPoll(5000);
  },

  unmounted() {
    evtBus.off("paneChanged", this.onPaneChanged);
    evtBus.off("cycle-started", this.handleCycleStarted);
    this.stopPolling();
    this.stopMoviePoll();
    this.items = [];
    this.error = null;
  },

  methods: {
    startMoviePoll() {
      if (this._moviePollTimer) return;
      const poll = async () => {
        if (!this.movieMode) return;
        try {
          const res = await fetch(`${config.tvDownUrl}/movieDownloads`);
          if (res.ok) {
            const data = await res.json().catch(() => null);
            if (Array.isArray(data)) this.movieDownJobs = data;
          }
        } catch {
          /* ignore */
        }
        if (this.movieMode) {
          this._moviePollTimer = setTimeout(poll, 2000);
        }
      };
      poll();
    },

    stopMoviePoll() {
      if (this._moviePollTimer) {
        clearTimeout(this._moviePollTimer);
        this._moviePollTimer = null;
      }
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

    notifyAllUsbFinished(lastTitle) {
      try {
        if (typeof window === "undefined") return;
        if (!("Notification" in window)) return;

        const title = String(lastTitle || "").trim();
        const msg = title
          ? `All files have been downloaded from USB, the last is ${title}.`
          : "All USB downloads finished.";

        if (Notification.permission === "granted") {
          new Notification(msg);
          return;
        }

        // Do not request permission automatically (may require user gesture).
        // If user wants notifications, they can grant it in browser/site settings.
        console.log(
          "Desktop notification not shown (permission:",
          Notification.permission + ")",
        );
      } catch (e) {
        console.log("notifyAllUsbFinished failed:", e?.message || String(e));
      }
    },

    handleCycleStarted() {
      if (this.pollingStopped) return;
      // Start fast polling when a cycle starts
      this._fastPollStartTime = Date.now();
      this._oldDownloadingCount = this.items.filter((it) => {
        const st = String(it?.status || "")
          .trim()
          .toLowerCase();
        if (st !== "downloading") return false;
        const ended = Number(it?.dateEnded);
        return !Number.isFinite(ended) || ended === 0;
      }).length;
      // Start polling immediately, even if pane is not active.
      // Do not call loadTvproc() synchronously here; cycle-started can be emitted
      // from inside loadTvproc(), which would cause re-entrant loops.
      this.scheduleNextPoll(1000);
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
        this._polling = true;
        if (!this._pollTimer) {
          this.scheduleNextPoll(5000);
        }
      } else {
        this.pollingStopped = true;
        this.stopPolling();
      }
    },

    stopPolling() {
      this._polling = false;
      if (this._pollTimer) {
        clearTimeout(this._pollTimer);
        this._pollTimer = null;
      }
      this._inFlight = false;
      this._showLoading = false;
      if (this._loadingTimer) {
        clearTimeout(this._loadingTimer);
        this._loadingTimer = null;
      }
    },

    clearPollTimer() {
      if (this._pollTimer) {
        clearTimeout(this._pollTimer);
        this._pollTimer = null;
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

    scheduleNextPoll(ms) {
      if (!this._polling) return;
      // Only clear the poll timer; do not reset loading state here.
      // Poll cadence is defined as: wait N ms AFTER the previous poll completes.
      this.clearPollTimer();

      // Determine if we should use fast polling
      let pollDelay = ms;
      if (this._fastPollStartTime) {
        const elapsed = Date.now() - this._fastPollStartTime;
        if (elapsed < 30000) {
          // Still within 30-second fast polling window
          pollDelay = 1000;
        } else {
          // Timeout reached, go back to normal polling
          this._fastPollStartTime = null;
          pollDelay = 5000;
        }
      }

      this._pollTimer = setTimeout(
        async () => {
          await this.loadTvproc();
          // Default to a 5-second delay after completion; scheduleNextPoll will
          // override to 1s if the fast window is still active.
          this.scheduleNextPoll(5000);
        },
        Math.max(0, Number(pollDelay) || 0),
      );
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
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${month}/${day} ${hh}:${mm}:${ss}`;
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

    fmtElapsedMmSs(seconds) {
      const n = Number(seconds);
      if (seconds == null || !Number.isFinite(n) || n <= 0) return "";
      const mins = Math.floor(n / 60);
      const secs = Math.floor(n % 60);
      return `${mins}:${String(secs).padStart(2, "0")}`;
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
      return `${Math.round(mbps)} mb`;
    },

    fmtMovieEta(remStr) {
      const parts = String(remStr || "")
        .split(":")
        .map(Number);
      if (parts.length < 2 || parts.some(isNaN)) return "";
      let secs = 0;
      if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else secs = parts[0] * 60 + parts[1];
      if (secs <= 0) return "";
      const eta = new Date(Date.now() + secs * 1000);
      return `${String(eta.getHours()).padStart(2, "0")}:${String(eta.getMinutes()).padStart(2, "0")}`;
    },

    fmtEtaRemaining(eta) {
      const n = Number(eta);
      if (!Number.isFinite(n) || n <= 0) return "";

      // If it's a large number (Unix timestamp), calculate remaining time from now
      const now = Math.floor(Date.now() / 1000);
      const remaining = n > 10000000 ? Math.max(0, n - now) : n;

      const mins = Math.floor(remaining / 60);
      const secs = Math.floor(remaining % 60);
      return `${mins}:${String(secs).padStart(2, "0")}`;
    },

    fmtEtaTimestamp(eta) {
      const n = Number(eta);
      if (!Number.isFinite(n) || n <= 0) return "";

      // If it's a large number (Unix timestamp), format as time only
      if (n > 10000000) {
        const d = new Date(n * 1000);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        const ss = String(d.getSeconds()).padStart(2, "0");
        return `${hh}:${mm}:${ss}`;
      }
      return "";
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
    line2(it) {
      const s = Number(it?.season);
      const e = Number(it?.episode);
      const seasonEpisode =
        Number.isFinite(s) && Number.isFinite(e) ? `S${s}:E${e}` : "";

      const size = this.fmtSize(it?.fileSize);
      const started = this.fmtMdhm(it?.dateStarted);
      const speed = this.fmtGbPerSec(it?.speed);
      const status = String(it?.status || "").trim();
      const statusLower = status.toLowerCase();
      const progress = Number(it?.progress);

      // Error-downloaded: show original error reason + suffix
      if (statusLower === "error-downloaded") {
        const reason = String(it?.reason || "error").trim();
        const parts2 = [];
        if (size) parts2.push(size);
        parts2.push(`${reason} (downloaded to tv-errors)`);
        return { seasonEpisode, rest: parts2.join(" | ") };
      }

      // For waiting status (formerly "future"), only show size
      if (statusLower === "waiting" || statusLower === "future") {
        const parts = [];
        if (size) parts.push(size);
        parts.push("Waiting");
        return { seasonEpisode, rest: parts.join(" | ") };
      }

      const parts = [];
      if (size) parts.push(size);
      if (started) parts.push(started);

      if (statusLower === "finished") {
        const elapsed = this.fmtElapsedMmSs(this.elapsedSeconds(it));
        if (elapsed) parts.push(elapsed);
        if (speed) parts.push(speed);
        parts.push("Finished");
        return { seasonEpisode, rest: parts.join(" | ") };
      }

      if (statusLower === "downloading") {
        if (speed) parts.push(speed);
        const eta = this.fmtEtaRemaining(it?.eta);
        if (eta) parts.push(eta);
        const etaTimestamp = this.fmtEtaTimestamp(it?.eta);
        if (etaTimestamp) parts.push(etaTimestamp);
        if (Number.isFinite(progress) && progress >= 0 && progress <= 100) {
          parts.push(`${progress}%`);
        }
        parts.push("Downloading");
        return { seasonEpisode, rest: parts.join(" | ") };
      }

      if (statusLower === "encoding") {
        if (Number.isFinite(progress) && progress >= 0 && progress <= 100) {
          parts.push(`${progress}%`);
        }
        const eta = this.fmtEtaRemaining(it?.eta);
        const etaTimestamp = this.fmtEtaTimestamp(it?.eta);
        if (eta) {
          // Write phase: show ETA
          parts.push(eta);
          if (etaTimestamp) parts.push(etaTimestamp);
        } else {
          // Scan phase (no PRGV yet)
          const elapsed = this.fmtElapsedMmSs(this.elapsedSeconds(it));
          parts.push(elapsed ? `Scanning ${elapsed}` : "Scanning");
        }
        parts.push("Encoding");
        return { seasonEpisode, rest: parts.join(" | ") };
      }

      if (speed) parts.push(speed);
      if (status) parts.push(status);
      else parts.push("Unknown");
      return { seasonEpisode, rest: parts.join(" | ") };
    },

    getCardStyle(it) {
      const status = String(it?.status || "")
        .trim()
        .toLowerCase();
      const isDownloading = status === "downloading";
      const isSelected = this.selectedItems.has(it);
      return {
        position: "relative",
        border: "1px solid #ddd",
        borderRadius: "8px",
        padding: "10px",
        background: isSelected ? "#fffacd" : isDownloading ? "#e8f4e8" : "#fff",
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

      // Alt-click: copy title to clipboard
      if (isAltClick) {
        const title = String(it?.title || "");
        navigator.clipboard.writeText(title).catch(() => {});
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
        console.error("retryDownload failed:", e);
        delete this.retryingTitles[title];
      }
    },

    toggleErrs() {
      this.showErrs = !this.showErrs;
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
        console.error("clearErrorRecords failed:", e);
      }
    },

    showFirstDownloading() {
      // Find the card that matches the currently selected show (this.show)
      // and scroll to it.

      if (!this.show) {
        console.warn("showFirstDownloading: No show selected context");
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
        console.error("startCheck error", e);
        this.isChecking = false;
      }
    },

    scrollToBottomAction() {
      const el = this.$refs.scroller;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    },

    scrollToActive() {
      const scroller = this.$refs.scroller;
      if (!scroller) return;
      const items = this.displayedItems;
      const activeIdx = items.findIndex((it) => {
        const st = String(it?.status || "")
          .trim()
          .toLowerCase();
        return st === "waiting" || st === "downloading";
      });
      if (activeIdx === -1) {
        scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
        return;
      }
      const allChildren = Array.from(scroller.children);
      let currentIdx = 0;
      for (let i = 0; i < allChildren.length; i++) {
        const el = allChildren[i];
        if (el.textContent && el.textContent.includes("====")) continue;
        if (currentIdx === activeIdx) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        currentIdx++;
      }
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
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
        const arr = await res.json();

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

        this.items = arr;

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
