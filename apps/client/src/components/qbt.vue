<template>
  <div
    id="qbt"
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
          <span>{{ movieMode ? "Movies - qBittorrent" : "qBittorrent" }}</span>
        </div>
        <div
          style="
            display: flex;
            gap: 10px;
            margin-right: 20px;
            justify-content: flex-end;
          "
        >
          <span
            v-if="stoppedCount > 0"
            style="
              font-size: 13px;
              color: #b05000;
              align-self: center;
              white-space: nowrap;
            "
            >{{ stoppedCount }} titles stopped.</span
          >
          <button
            @click.stop="openQbtUI"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
            "
          >
            Open UI
          </button>
          <button
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
            @click.stop="cleanMissingFiles"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
            "
          >
            {{
              missingFilesCount > 0 ? `Clean (${missingFilesCount})` : "Clean"
            }}
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
            Bottom
          </button>
        </div>
      </div>
      <div
        style="
          display: flex;
          justify-content: flex-end;
          align-items: center;
          gap: 10px;
          margin-top: 4px;
          margin-right: 20px;
        "
      >
        <span
          v-if="!movieMode && selectedItems.size > 0"
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
          v-if="!movieMode"
          @click.stop="qbtSelClick"
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
          v-if="!movieMode"
          @click.stop="qbtFromClick"
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
          @click.stop="qbtAllClick"
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
          @click.stop="qbtFirstClick"
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
          @click.stop="qbtBadGrpClick"
          :disabled="selectedItems.size === 0 || qbtBadGrpBusy"
          :class="{ 'btn-disabled': selectedItems.size === 0 || qbtBadGrpBusy }"
          :style="{
            fontSize: '13px',
            cursor: 'pointer',
            borderRadius: '7px',
            padding: '4px 10px',
            border: '1px solid #bbb',
            '--btn-bg': qbtBadGrpBusy ? 'lightgray' : 'whitesmoke',
          }"
        >
          Bad Grp
        </button>
        <button
          @click.stop="qbtForceClick"
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
          Force Usb
        </button>
        <button
          v-if="movieMode"
          @click.stop="qbtRecheckClick"
          :style="{
            fontSize: '13px',
            cursor: 'pointer',
            borderRadius: '7px',
            padding: '4px 10px',
            border: '1px solid #bbb',
          }"
        >
          Recheck
        </button>
        <button
          @click.stop="qbtDelClick"
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
      id="scroller"
      ref="scroller"
      :style="{
        flex: '1 1 auto',
        minHeight: '0px',
        overflowY: 'auto',
        overflowX: 'hidden',
      }"
      @wheel.stop.prevent="handleScaledWheel"
      @scroll.passive="handleScroll"
    >
      <div
        v-if="sortedTorrents.length === 0"
        style="
          text-align: center;
          color: #666;
          margin-top: 50px;
          font-size: 18px;
        "
      >
        <span v-if="emptyStateText">{{ emptyStateText }}</span>
      </div>
      <div
        v-else
        style="
          padding: 10px;
          font-size: 14px;
          font-family: sans-serif;
          font-weight: normal;
        "
      >
        <div
          v-for="t in sortedTorrents"
          :key="String(t.hash || t.name || t.added_on)"
          :style="getCardStyle(t)"
          @click="handleCardClick($event, t)"
          @mousedown="$event.shiftKey && $event.preventDefault()"
        >
          <div
            style="
              font-size: 14px;
              font-weight: bold;
              color: #333;
              word-break: break-word;
            "
          >
            {{ t.name || t.hash }}
          </div>
          <div
            style="
              margin-top: 8px;
              font-size: 14px;
              font-weight: normal;
              color: rgba(0, 0, 0, 0.5) !important;
            "
          >
            {{ infoLine(t) }}
          </div>
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
import { unilog } from "../log.js";

export default {
  name: "History",

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
      torrents: [],
      activeDownLoads: [],
      _pollTimer: null,
      _polling: false,
      _active: false,
      useStaticSamples: false,
      _didInitialScroll: false,
      _didInitialVisibleScroll: false,
      _stickToBottom: true,
      _didLoadOnce: false,
      _inFlight: false,
      _loadingTimer: null,
      _showLoading: false,
      matchedTitle: null,
      activeOnly: false,
      showFilter: null,
      qbtBadGrpBusy: false,
      _knownHashes: new Set(),
      selectedItems: new Set(), // Multi-select for new button group
      lastSelectedIndex: null,
      flashingHash: null,
    };
  },

  watch: {
    show() {
      this.matchedTitle = null;
      this.selectedItems = new Set();
      this.lastSelectedIndex = null;
    },
    movieMode() {
      this.torrents = [];
      this.pollOnce();
    },
  },

  computed: {
    sortedTorrents() {
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoff = nowSec - 60 * 24 * 60 * 60;
      return [...(this.torrents || [])]
        .filter((t) => {
          const added = Number(t?.added_on) || 0;
          if (added < cutoff) return false;
          if (this.activeOnly && this.fmtState(t?.state) === "Finished")
            return false;
          const isMovie = String(t?.save_path || "")
            .replace(/\/+$/, "")
            .endsWith("/movies");
          if (this.movieMode && !isMovie) return false;
          if (!this.movieMode && isMovie) return false;
          if (
            this.showFilter &&
            this.toParsedTitle(t?.name) !== this.showFilter
          )
            return false;
          return true;
        })
        .sort((a, b) => {
          const aa = Number(a?.added_on) || 0;
          const bb = Number(b?.added_on) || 0;
          return aa - bb;
        });
    },

    missingFilesCount() {
      return (this.torrents || []).filter(
        (t) => String(t?.state || "").trim() === "missingFiles",
      ).length;
    },

    stoppedCount() {
      return (this.torrents || []).filter((t) => {
        const st = String(t?.state || "").trim();
        return st === "stoppedDL" || st === "stoppedUP";
      }).length;
    },

    emptyStateText() {
      if (this.sortedTorrents.length > 0) return "";
      if (this._didLoadOnce) return "No results.";
      if (this._showLoading) return "Loading ...";
      return "";
    },
  },

  mounted() {
    evtBus.on("paneChanged", this.onPaneChanged);

    // Start polling immediately so activeQbtTitles events are emitted
    // even before the user opens the pane (drives shows-list green highlight).
    if (!this.useStaticSamples) this.startPolling();

    // When the browser tab regains focus, poll immediately.
    // setTimeout is throttled to ~1 minute in background tabs, so without this
    // a torrent completing while the tab is hidden wouldn't trigger startProc
    // until the user returns and the next throttled poll fires.
    this._onVisibilityChange = () => {
      if (document.visibilityState === "visible" && this._polling) {
        this.scheduleNextPoll(0);
      }
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);
  },

  unmounted() {
    evtBus.off("paneChanged", this.onPaneChanged);
    this.stopPolling();
    this.torrents = [];
    if (this._onVisibilityChange) {
      document.removeEventListener(
        "visibilitychange",
        this._onVisibilityChange,
      );
      this._onVisibilityChange = null;
    }
  },

  methods: {
    scrollToBottomAction() {
      this._stickToBottom = true;
      const el = this.$refs.scroller;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    },
    handleScroll(event) {
      const el = event?.currentTarget;
      if (!el) return;
      // When user scrolls up, stop auto-scrolling on future polls.
      // When user scrolls back to bottom, re-enable it.
      this._stickToBottom = this.isAtBottom(el);
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

    getScroller() {
      return this.$refs.scroller || null;
    },

    isAtBottom(el) {
      if (!el) return false;
      const tolerance = 2;
      return el.scrollTop + el.clientHeight >= el.scrollHeight - tolerance;
    },

    scrollToBottom() {
      const el = this.getScroller();
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    },

    onPaneChanged(pane) {
      this.matchedTitle = null;
      this._active = pane === "qbt";
      if (this._active) {
        // On first view, force a one-time scroll-to-bottom after the pane becomes visible.
        // This avoids the top->bottom flash that would otherwise wait for the next poll.
        if (!this._didInitialVisibleScroll) {
          this._didInitialVisibleScroll = true;
          void this.$nextTick(() => {
            this.scrollToBottom();
            this._didInitialScroll = true;
            this._stickToBottom = true;
          });
        }
      }
    },

    startPolling() {
      if (this._polling) return;
      this._polling = true;
      // First call immediately on history pane load.
      this.scheduleNextPoll(0);
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

    startLoadingDelay() {
      this._inFlight = true;
      this._showLoading = false;
      if (this._loadingTimer) {
        clearTimeout(this._loadingTimer);
        this._loadingTimer = null;
      }
      this._loadingTimer = setTimeout(() => {
        if (
          this._inFlight &&
          this.sortedTorrents.length === 0 &&
          !this._didLoadOnce
        ) {
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

    scheduleNextPoll(delayMs) {
      if (!this._polling) return;
      if (this._pollTimer) {
        clearTimeout(this._pollTimer);
        this._pollTimer = null;
      }
      this._pollTimer = setTimeout(
        async () => {
          if (!this._polling) return;
          await this.pollOnce();
          // Poll again 5 seconds after the last call completed.
          this.scheduleNextPoll(5000);
        },
        Math.max(0, Number(delayMs) || 0),
      );
    },

    async getQbtInfo(filterObj) {
      const url = new URL(`${config.torrentsApiUrl}/api/qbt/info`);
      if (filterObj && typeof filterObj === "object") {
        if (filterObj.hash) url.searchParams.set("hash", filterObj.hash);
        if (filterObj.category)
          url.searchParams.set("category", filterObj.category);
        if (filterObj.tag) url.searchParams.set("tag", filterObj.tag);
        if (filterObj.filter) url.searchParams.set("filter", filterObj.filter);
      }
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res.json();
    },

    async pollOnce() {
      this.startLoadingDelay();
      try {
        const scroller = this.getScroller();
        // Update stickiness based on current scroll position at the start of the poll.
        if (scroller) this._stickToBottom = this.isAtBottom(scroller);

        const torrents = await this.getQbtInfo({});
        if (Array.isArray(torrents)) {
          const hashOf = (t) => String(t?.hash || "").trim();
          const nameOf = (t) => String(t?.name || "").trim();

          // Re-map selectedItems to new torrent objects by hash so selection survives polling
          if (this.selectedItems.size > 0) {
            const selectedHashes = new Set(
              [...this.selectedItems].map(hashOf).filter(Boolean),
            );
            const newByHash = new Map(
              torrents.map((t) => [hashOf(t), t]).filter(([h]) => h),
            );
            const remapped = new Set();
            for (const h of selectedHashes) {
              const newT = newByHash.get(h);
              if (newT) remapped.add(newT);
            }
            this.selectedItems = remapped;
            // Re-map lastSelectedIndex
            if (this.lastSelectedIndex !== null) {
              const sorted = [...(torrents || [])].sort((a, b) => {
                // Use same sort logic as computed sortedTorrents
                const stA = String(a?.state || "").trim();
                const stB = String(b?.state || "").trim();
                const dl = (s) => (s === "downloading" ? 0 : 1);
                if (dl(stA) !== dl(stB)) return dl(stA) - dl(stB);
                return (a?.name || "").localeCompare(b?.name || "");
              });
              if (remapped.size > 0) {
                const lastRemapped = [...remapped][remapped.size - 1];
                this.lastSelectedIndex = sorted.indexOf(lastRemapped);
              }
            }
          }

          // Track new and removed hashes for history events.
          const curHashes = new Set(torrents.map(hashOf).filter(Boolean));
          const torrentByHash = {};
          for (const t of torrents) {
            const h = hashOf(t);
            if (h) torrentByHash[h] = t;
          }

          for (const h of curHashes) {
            if (!this._knownHashes.has(h)) {
              // new torrent appeared
            }
          }
          if (this._didLoadOnce) {
            for (const h of this._knownHashes) {
              if (!curHashes.has(h)) {
                // torrent removed
              }
            }
          }
          this._knownHashes = curHashes;
          const downloadingTitles = torrents
            .filter((t) => {
              const st = String(t?.state || "")
                .trim()
                .toLowerCase();
              return st === "downloading";
            })
            .map((t) => this.toParsedTitle(t?.name))
            .filter(Boolean);
          evtBus.emit("activeQbtTitles", downloadingTitles);

          const curDownloading = torrents
            .filter((t) => String(t?.state || "").trim() === "downloading")
            .map(hashOf)
            .filter(Boolean);

          // Once the Qbt pane has loaded any cards, track currently-downloading titles.
          if (!this._didLoadOnce && torrents.length > 0) {
            this.activeDownLoads = curDownloading;
          } else {
            // On each poll: if any previously-downloading title is no longer downloading,
            // kick tvproc to start the next cycle.
            const prev = Array.isArray(this.activeDownLoads)
              ? this.activeDownLoads
              : [];
            const missing = prev.filter(
              (h) => h && !curDownloading.includes(h),
            );
            if (missing.length > 0) {
              unilog(
                1030,
                "History: download finished, starting tvproc cycle",
                {
                  finishedHashes: missing,
                },
              );
              for (const h of missing) {
                // torrent finished downloading
              }
              try {
                await fetch(`${config.tvDownUrl}/startProc`, {
                  method: "POST",
                });
              } catch {
                // ignore
              }
            }
            // Always refresh activeDownLoads after the check.
            this.activeDownLoads = curDownloading;
          }

          this.torrents = torrents;
          this._didLoadOnce = true;

          await this.$nextTick();
          // On app load, establish an initial "bottom" baseline even if the pane
          // is not currently visible (v-show preserves scroll position).
          if (!this._didInitialScroll) {
            this.scrollToBottom();
            this._didInitialScroll = true;
            this._stickToBottom = true;
          } else if (this._active && this._stickToBottom) {
            this.scrollToBottom();
          }
        }
      } catch {
        // ignore transient errors
      } finally {
        this.finishLoadingDelay();
      }
    },

    sep() {
      // Replace spaces around '|' with two non-breaking spaces.
      return "\u00A0\u00A0|\u00A0\u00A0";
    },

    parseTorrentName(rawTitle) {
      const raw = String(rawTitle || "").trim();
      if (!raw) return null;
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
        return parser ? parser(raw) : null;
      } catch {
        return null;
      }
    },

    toParsedTitle(rawTitle) {
      const raw = String(rawTitle || "").trim();
      if (!raw) return "";
      const parsed = this.parseTorrentName(raw);
      return String(parsed?.title || raw).trim();
    },

    pad2(n) {
      return String(n).padStart(2, "0");
    },

    fmtMmDd_HhMm(epochSeconds) {
      const n = Number(epochSeconds);
      if (!Number.isFinite(n) || n <= 0) return "??/?? ??:??:??";
      const d = new Date(Math.floor(n) * 1000);
      const mm = this.pad2(d.getMonth() + 1);
      const dd = this.pad2(d.getDate());
      const hh = this.pad2(d.getHours());
      const mi = this.pad2(d.getMinutes());
      const ss = this.pad2(d.getSeconds());
      return `${mm}/${dd} ${hh}:${mi}:${ss}`;
    },

    fmtCompletionMmDd_HhMm(epochSeconds) {
      const n = Number(epochSeconds);
      if (!Number.isFinite(n) || n <= 0) return "??/?? ??:??:??";
      const d = new Date(Math.floor(n) * 1000);
      const mm = this.pad2(d.getMonth() + 1);
      const dd = this.pad2(d.getDate());
      const hh = this.pad2(d.getHours());
      const mi = this.pad2(d.getMinutes());
      const ss = this.pad2(d.getSeconds());
      return `${mm}/${dd} ${hh}:${mi}:${ss}`;
    },

    fmtState(state) {
      const raw = state === undefined || state === null ? "" : String(state);
      if (!raw) return "";

      // Special-case qBittorrent's stalledUP to match requested wording.
      if (raw === "stalledUP") return "Finished";

      // Treat active seeding the same as finished.
      if (raw === "uploading") return "Finished";
      if (raw === "stoppedUP") return "Finished";

      // Special-case qBittorrent's stalledDL to match requested wording.
      if (raw.toLowerCase() === "stalleddl") return "Stalled";

      // Match TvProc wording.
      if (raw === "downloading") return "Getting";

      const lower = raw.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    },

    fmtEtaMmSs(seconds) {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n < 0) return String(seconds);
      const s = Math.floor(n);
      const mm = Math.floor(s / 60);
      const ss = s % 60;
      // Remove any leading 0 from minutes; keep seconds 2-digit.
      return `${mm}:${this.pad2(ss)}`;
    },

    fmtElapsedMmSs(startEpoch, endEpoch) {
      const start = Number(startEpoch);
      const end = Number(endEpoch);
      if (
        !Number.isFinite(start) ||
        start <= 0 ||
        !Number.isFinite(end) ||
        end <= 0
      ) {
        return "??:??";
      }
      const elapsedSeconds = Math.max(0, end - start);
      const mm = Math.floor(elapsedSeconds / 60);
      const ss = Math.floor(elapsedSeconds % 60);
      return `${mm}:${this.pad2(ss)}`;
    },

    fmtSize(bytesOrHumanString) {
      return util.fmtBytesSize(bytesOrHumanString);
    },

    calcRateMb(t) {
      const size = Number(t?.size_bytes ?? t?.total_size_bytes ?? t?.size);
      const completed = Number(t?.completed);
      const eta = Number(t?.eta);
      if (
        !Number.isFinite(size) ||
        !Number.isFinite(completed) ||
        !Number.isFinite(eta) ||
        eta <= 0
      )
        return null;
      const remBytes = Math.max(0, size - completed);
      return (remBytes * 8) / 1e6 / eta;
    },

    fmtRateMb(t) {
      if (t?.state === "downloading") {
        const rate = this.calcRateMb(t);
        return rate === null ? "" : `${rate.toFixed(0)} mb`;
      }
      const avg = Number(t?.avg_rate_mb);
      return Number.isFinite(avg) ? `${avg.toFixed(0)} mb` : "";
    },

    fmtProgPc(completedBytes, sizeBytes) {
      const c = Number(completedBytes);
      const s = Number(sizeBytes);
      if (!Number.isFinite(c) || !Number.isFinite(s) || s <= 0) return 0;
      return Math.max(0, Math.min(100, Math.round((c / s) * 100)));
    },

    getCardStyle(t) {
      const isDownloading = t?.state === "downloading";
      const isSelected = this.selectedItems.has(t);
      const isFlashing =
        this.flashingHash && this.flashingHash === String(t?.hash || "");
      return {
        position: "relative",
        background: isFlashing
          ? "#ffcccc"
          : isSelected
            ? "#fffacd"
            : isDownloading
              ? "#ffe"
              : "#fff",
        border: "1px solid #ddd",
        borderRadius: "5px",
        padding: "10px",
        cursor: "pointer",
      };
    },

    async cleanMissingFiles() {
      let all;
      try {
        all = await this.getQbtInfo({});
      } catch {
        return;
      }
      if (!Array.isArray(all)) return;
      const missing = all.filter(
        (t) => String(t?.state || "").trim() === "missingFiles",
      );
      if (missing.length === 0) {
        alert("No titles with missing files found.");
        return;
      }
      const confirmed = confirm(
        `Delete ${missing.length} titles with no files?`,
      );
      if (!confirmed) return;
      for (const t of missing) {
        try {
          await this.deleteTorrentAndFiles(t);
        } catch {
          // ignore individual failures
        }
      }
      await this.pollOnce();
    },

    async deleteTorrentAndFiles(t) {
      const hash = String(t?.hash || "").trim();
      if (!hash) throw new Error("Missing torrent hash; cannot delete.");

      const url = new URL(`${config.torrentsApiUrl}/api/qbt/delTorrent`);
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash, deleteFiles: true }),
      });

      if (!res.ok) {
        let details = "";
        try {
          details = await res.text();
        } catch {
          // ignore
        }
        const suffix = details ? `\n${details}` : "";
        throw new Error(
          `qbt delete failed: HTTP ${res.status}: ${res.statusText}${suffix}`,
        );
      }

      // Endpoint may return JSON or empty/ok text. Treat both as success.
      const contentType = String(
        res.headers.get("content-type") || "",
      ).toLowerCase();
      if (contentType.includes("application/json")) {
        const data = await res.json().catch(() => null);
        if (data?.error) throw new Error(String(data.error));
        return data;
      }
      return "ok";
    },

    async handleCardClick(event, t) {
      const isAltClick = Boolean(event?.altKey);
      const isCtrlClick = Boolean(event?.ctrlKey || event?.metaKey);
      const isShiftClick = Boolean(event?.shiftKey);

      // Alt-click: copy torrent name to clipboard
      if (isAltClick) {
        const title = String(t?.name || "");
        navigator.clipboard.writeText(title).catch(() => {});
        this.flashingHash = String(t?.hash || "");
        setTimeout(() => {
          this.flashingHash = null;
        }, 300);
        return;
      }

      const idx = this.sortedTorrents.indexOf(t);

      if (isShiftClick && this.lastSelectedIndex !== null) {
        event.preventDefault(); // prevent browser text selection on shift-click
        const lo = Math.min(this.lastSelectedIndex, idx);
        const hi = Math.max(this.lastSelectedIndex, idx);
        for (let i = lo; i <= hi; i++) {
          this.selectedItems.add(this.sortedTorrents[i]);
        }
      } else if (isCtrlClick) {
        if (this.selectedItems.has(t)) {
          this.selectedItems.delete(t);
        } else {
          this.selectedItems.add(t);
        }
        this.lastSelectedIndex = idx;
      } else {
        // Plain click: single-select
        this.selectedItems.clear();
        this.selectedItems.add(t);
        this.lastSelectedIndex = idx;
      }
      // Trigger reactivity
      this.selectedItems = new Set(this.selectedItems);
    },

    openQbtUI() {
      util.openExternalPage("https://hahnca.com/tv-srvr/api/qbt-open");
    },

    highlightShow() {
      // and scroll to it.

      if (!this.show) {
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
        // sortedTorrents is a computed property, so finding index in it is fine
        const currentIdx = this.sortedTorrents.findIndex(
          (t) => t && t.name === this.matchedTitle,
        );
        if (currentIdx !== -1) {
          startIndex = currentIdx + 1;
        }
      }

      // Iterate all items to find best match
      for (let i = startIndex; i < this.sortedTorrents.length; i++) {
        const t = this.sortedTorrents[i];
        const rawTitle = t.name || "";
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
          bestMatch = t;
          break; // Found it
        }
      }

      if (!bestMatch) {
        return;
      }

      // Found the matching card
      this.selectedItems = new Set([bestMatch]);
      this.lastSelectedIndex = this.sortedTorrents.indexOf(bestMatch);
      this.matchedTitle = bestMatch.name;

      const scroller = this.$refs.scroller;
      if (!scroller) return;

      const idx = this.sortedTorrents.findIndex((t) => t === bestMatch);
      if (idx === -1) return;

      // Scroll logic
      const allChildren = Array.from(scroller.children);

      if (allChildren.length === 0) return;

      const container = allChildren[0];
      const itemElements = Array.from(container.children);

      if (itemElements[idx]) {
        itemElements[idx].scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    },

    infoLine(t) {
      const added = this.fmtMmDd_HhMm(t?.added_on);
      const bytes =
        (t && (t.size_bytes ?? t.total_size_bytes ?? t.size)) ?? undefined;
      const size =
        this.fmtSize(bytes) || this.fmtSize(t?.size) || String(t?.size ?? "");
      const sep = this.sep();
      const remBytes =
        Number.isFinite(Number(bytes)) && Number.isFinite(Number(t?.completed))
          ? Number(bytes) - Number(t.completed)
          : NaN;
      const remaining = Number.isFinite(remBytes)
        ? remBytes <= 0
          ? "0"
          : this.fmtSize(remBytes)
        : "";

      const rate = this.fmtRateMb(t);
      const rateSeg = rate ? `${rate}${sep}` : "";

      if (t?.state === "downloading") {
        const prog = this.fmtProgPc(t?.completed, t?.size);
        const seeds = Number.isFinite(Number(t?.num_seeds))
          ? Number(t?.num_seeds)
          : 0;
        const eta = this.fmtEtaMmSs(t?.eta);
        return `${size}${sep}${remaining}${sep}${added}${sep}${seeds}${sep}${prog}%${sep}${rateSeg}${eta}${sep}Getting`;
      }

      const curSeeds = Number.isFinite(Number(t?.num_seeds))
        ? Number(t?.num_seeds)
        : 0;
      const lastSeeds = Number(t?.last_seeds);
      const seeds =
        curSeeds > 0
          ? curSeeds
          : Number.isFinite(lastSeeds)
            ? lastSeeds
            : curSeeds;
      const elapsed = this.fmtElapsedMmSs(t?.added_on, t?.completion_on);
      const state = this.fmtState(t?.state);
      return `${size}${sep}${remaining}${sep}${added}${sep}${seeds}${sep}${rateSeg}${elapsed}${sep}${state}`;
    },

    forceFile(title) {
      unilog(1031, "history: forceFile button clicked, title:", title);
      if (!title) return;
      unilog(1097, "history: emitting forceFile event");
      evtBus.emit("forceFile", title);
    },

    // Helper: extract clean show name from torrent name using parse-torrent-title
    qbtExtractShowName(t) {
      const rawTitle = String(t?.name || "");
      if (!rawTitle) return "";
      return this.toParsedTitle(rawTitle) || rawTitle;
    },

    // Sel: emit selectShowFromCardTitle for first selected item
    qbtSelClick() {
      const first = [...this.selectedItems][0];
      if (!first) return;
      const name = this.qbtExtractShowName(first);
      if (name) evtBus.emit("selectShowFromCardTitle", name);
    },

    showFilterClick() {
      if (this.showFilter) {
        this.showFilter = null;
        return;
      }
      const first = [...this.selectedItems][0];
      if (!first) return;
      this.showFilter = this.toParsedTitle(first?.name) || null;
    },

    // From: select all items matching current show
    qbtFromClick() {
      if (!this.show) return;
      const candidates = [this.show];
      const newSel = new Set();
      let firstIdx = null;
      for (let i = 0; i < this.sortedTorrents.length; i++) {
        const t = this.sortedTorrents[i];
        const name = this.qbtExtractShowName(t);
        if (!name) continue;
        const match = util.smartTitleMatch(name, candidates, null, false);
        if (match) {
          newSel.add(t);
          if (firstIdx === null) firstIdx = i;
        }
      }
      this.selectedItems = newSel;
      if (firstIdx !== null) {
        this.lastSelectedIndex = firstIdx;
        this.$nextTick(() => {
          const scroller = this.$refs.scroller;
          if (!scroller) return;
          const container = scroller.children[0];
          if (!container) return;
          const card = container.children[firstIdx];
          if (card)
            card.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    },

    // All: select all items matching first selected item's show
    qbtAllClick() {
      const first = [...this.selectedItems][0];
      if (!first) return;
      const pivotName = this.qbtExtractShowName(first);
      if (!pivotName) return;
      const newSel = new Set();
      let firstIdx = null;
      for (let i = 0; i < this.sortedTorrents.length; i++) {
        const t = this.sortedTorrents[i];
        const name = this.qbtExtractShowName(t);
        if (!name) continue;
        const match = util.smartTitleMatch(
          name,
          [{ name: pivotName }],
          null,
          false,
        );
        if (match) {
          newSel.add(t);
          if (firstIdx === null) firstIdx = i;
        }
      }
      this.selectedItems = newSel;
      if (firstIdx !== null) {
        this.lastSelectedIndex = firstIdx;
        this.$nextTick(() => {
          const scroller = this.$refs.scroller;
          if (!scroller) return;
          const container = scroller.children[0];
          if (!container) return;
          const card = container.children[firstIdx];
          if (card)
            card.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    },

    // First: scroll to first selected item
    qbtFirstClick() {
      const first = [...this.selectedItems][0];
      if (!first) return;
      const idx = this.sortedTorrents.indexOf(first);
      if (idx < 0) return;
      this.$nextTick(() => {
        const scroller = this.$refs.scroller;
        if (!scroller) return;
        const container = scroller.children[0];
        if (!container) return;
        const card = container.children[idx];
        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },

    async qbtBadGrpClick() {
      const first = [...this.selectedItems][0];
      const group = String(
        this.parseTorrentName(first?.name)?.group || "",
      ).trim();
      if (!group) {
        window.alert("Selected torrent has no group name.");
        return;
      }

      this.qbtBadGrpBusy = true;
      try {
        const result = await srvr.toggleBadGroup(group);
        if (result?.action === "added") {
          window.alert(`Added bad group: ${group}`);
        } else if (result?.action === "removed") {
          window.alert(`Removed bad group: ${group}`);
        }
      } catch (err) {
        window.alert(`Bad group toggle failed: ${err?.message || String(err)}`);
      } finally {
        this.qbtBadGrpBusy = false;
      }
    },

    // Force: delete each selected torrent then re-add via magnet URI
    async qbtForceClick() {
      const count = this.selectedItems.size;
      if (count === 0) return;
      const ok = window.confirm(
        `Restart download for ${count} torrent${count === 1 ? "" : "s"}?`,
      );
      if (!ok) return;
      const items = [...this.selectedItems];
      for (const t of items) {
        const magnetUrl = String(t?.magnet_uri || "").trim();
        try {
          await this.deleteTorrentAndFiles(t);
        } catch (err) {
          window.alert(
            `Delete failed for ${t?.name}: ${err?.message || String(err)}`,
          );
          continue;
        }
        if (magnetUrl) {
          try {
            const url = new URL(`${config.torrentsApiUrl}/api/qbt/addMagnet`);
            const res = await fetch(url.toString(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ magnetUrl }),
            });
            if (!res.ok) {
              const text = await res.text().catch(() => "");
              window.alert(
                `Re-add failed for ${t?.name}: ${text || res.statusText}`,
              );
            }
          } catch (err) {
            window.alert(
              `Re-add failed for ${t?.name}: ${err?.message || String(err)}`,
            );
          }
        }
      }
      await this.pollOnce();
    },

    // Recheck: force qBittorrent to re-scan files for all movie torrents
    async qbtRecheckClick() {
      const hashes = this.sortedTorrents.map((t) => t.hash).filter(Boolean);
      if (hashes.length === 0) return;
      try {
        const url = new URL(`${config.torrentsApiUrl}/api/qbt/recheck`);
        const res = await fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hash: hashes }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          window.alert(`Recheck failed: ${text || res.statusText}`);
        }
      } catch (err) {
        window.alert(`Recheck failed: ${err?.message || String(err)}`);
      }
      await this.pollOnce();
    },

    // Del: confirm then delete each selected torrent and its files
    async qbtDelClick() {
      const count = this.selectedItems.size;
      if (count === 0) return;
      const ok = window.confirm(
        `Delete ${count} torrent${count === 1 ? "" : "s"} from qbt and their files from USB disk?`,
      );
      if (!ok) return;
      const items = [...this.selectedItems];
      this.selectedItems = new Set();
      for (const t of items) {
        try {
          await this.deleteTorrentAndFiles(t);
        } catch (err) {
          window.alert(
            `Delete failed for ${t?.name}: ${err?.message || String(err)}`,
          );
        }
      }
      await this.pollOnce();
    },
  },
};
</script>
