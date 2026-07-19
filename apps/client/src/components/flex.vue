<template>
  <div
    id="flex"
    :style="{
      height: '100%',
      width: '100%',
      padding: '5px',
      margin: 0,
      marginLeft: '16px',
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
          <span>Flexget</span>
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
            v-if="flexRunning || forcing"
            style="
              font-size: 13px;
              color: #666;
              align-self: center;
              margin-right: 4px;
            "
            >Running...</span
          >
          <span
            v-if="selectedRows.size > 0"
            style="
              font-size: 15px;
              font-weight: bold;
              color: green;
              align-self: center;
              white-space: nowrap;
            "
            >Sel: {{ selectedRows.size }}</span
          >
          <button
            @click.stop="flexSelClick"
            :disabled="selectedRows.size === 0"
            :class="{ 'btn-disabled': selectedRows.size === 0 }"
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
            @click.stop="flexFromClick"
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
            @click.stop="flexAllClick"
            :disabled="selectedRows.size === 0"
            :class="{ 'btn-disabled': selectedRows.size === 0 }"
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
            @click.stop="flexFirstClick"
            :disabled="selectedRows.size === 0"
            :class="{ 'btn-disabled': selectedRows.size === 0 }"
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
            @click.stop="forceRun"
            :style="{
              fontSize: '13px',
              cursor: 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': showRunPane ? 'lightgray' : 'whitesmoke',
            }"
          >
            Run
          </button>
          <button
            @click.stop="flexInfoClick"
            :disabled="selectedRows.size === 0"
            :class="{ 'btn-disabled': selectedRows.size === 0 }"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
            "
          >
            Info
          </button>
          <button
            @click.stop="toggleConfig"
            :style="{
              fontSize: '13px',
              cursor: 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': showConfig ? 'lightgray' : 'whitesmoke',
            }"
          >
            Config
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
          height: 1px;
          width: 100%;
          background-color: #000;
          margin-top: 6px;
        "
      ></div>
    </div>

    <div
      v-if="showConfig"
      :style="{
        flex: '1 1 auto',
        minHeight: '0px',
        overflowY: 'auto',
        overflowX: 'auto',
        padding: '10px',
        fontFamily: 'monospace',
        fontSize: '13px',
        fontWeight: 'normal',
        whiteSpace: 'pre',
      }"
    >
      <span
        v-if="configLoading"
        style="color: #666"
        >Loading...</span
      >
      <span v-else>{{ configText }}</span>
    </div>
    <div
      v-else-if="showRunPane"
      ref="runPane"
      :style="{
        flex: '1 1 auto',
        minHeight: '0px',
        overflowY: 'auto',
        overflowX: 'auto',
        padding: '10px',
        fontFamily: 'monospace',
        fontSize: '13px',
        fontWeight: 'normal',
        whiteSpace: 'pre',
      }"
    >
      {{ runOutput }}
    </div>
    <div
      v-else
      id="scroller"
      ref="scroller"
      :style="{
        flex: '1 1 auto',
        minHeight: '0px',
        overflowY: 'auto',
        overflowX: 'hidden',
      }"
      @wheel.stop.prevent="handleScaledWheel"
    >
      <div
        v-if="rows.length === 0"
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
          font-size: 13px;
          font-family: monospace;
          font-weight: normal;
        "
      >
        <div
          v-for="row in rows"
          :key="row.key"
          @click="handleRowClick(row, $event)"
          @mousedown="$event.shiftKey && $event.preventDefault()"
          :style="getRowStyle(row)"
        ><span
            v-if="!row.isHeader && row.se"
            style="color: blue !important"
            >{{ row.se }}</span
          >{{ row.isHeader ? row.line : (row.se ? " " : "") + row.rest }}</div>
      </div>
    </div>

    <!-- Detail dialog -->
    <div
      v-if="dialogRow"
      @click.stop="dialogRow = null"
      style="
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
      "
    >
      <div
        @click.stop
        style="
          background: #fff;
          padding: 20px;
          border-radius: 8px;
          max-width: 640px;
          width: 90%;
          max-height: 80vh;
          overflow-y: auto;
          font-size: 13px;
          font-family: monospace;
        "
      >
        <div
          v-for="(val, key) in dialogFields"
          :key="key"
          style="margin-bottom: 6px; word-break: break-all"
        >
          <span style="font-weight: bold; color: #444">{{ key }}</span
          >: {{ val }}
        </div>
        <div
          v-if="dialogPtt"
          style="
            margin-top: 12px;
            padding-top: 10px;
            border-top: 1px solid #ddd;
          "
        >
          <div style="font-weight: bold; color: #444; margin-bottom: 4px">
            parse-torrent-title
          </div>
          <pre
            style="
              margin: 0;
              font-size: 12px;
              white-space: pre-wrap;
              word-break: break-all;
            "
            >{{ JSON.stringify(dialogPtt, null, 2) }}</pre
          >
        </div>
        <div style="margin-top: 16px; display: flex; gap: 10px">
          <button
            @click.stop="dialogRow = null"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 14px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
            "
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import evtBus from "../evtBus.js";
import { config } from "../config.js";
import * as srvr from "../srvr.js";
import * as util from "../util.js";
import { parse as parseTorrentTitle } from "parse-torrent-title";

function fmtSentTs(sent) {
  if (!sent) return "??/??/?? ??:??:??";
  return String(sent);
}

// Parse "2026/05/04-14:41:48" → ms timestamp, returns 0 on failure
function sentToMs(sent) {
  if (!sent) return 0;
  // Format: YYYY/MM/DD-HH:mm:ss
  const m = /(\d{4})\/(\d{2})\/(\d{2})-(\d{2}):(\d{2}):(\d{2})/.exec(
    String(sent),
  );
  if (!m) return 0;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`).getTime();
}

// Format ms timestamp as "MM-DD HH:mm" PST
function fmtGroupTs(ms) {
  if (!ms) return "?";
  const d = new Date(ms);
  const opts = { timeZone: "America/Los_Angeles" };
  const weekday = d.toLocaleString("en-US", { ...opts, weekday: "short" });
  const rest = d
    .toLocaleString("en-US", {
      ...opts,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
    .replace(/(\d+)\/(\d+),\s*/, "$1/$2 ");
  return `${weekday} ${rest}`;
}

const RUN_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const GROUP_GAP_MS = RUN_INTERVAL_MS / 2; // 7.5 minutes

// Blue season/episode string, matching the tor/qbt panes:
// single episode -> "2/1", single season -> "2". Derived from the
// server's seasonKey ("S02") and episodeKey ("E01").
function fmtSeasonEpisode(seasonKey, episodeKey) {
  const sMatch = String(seasonKey || "").match(/(\d+)/);
  if (!sMatch) return "";
  const season = parseInt(sMatch[1], 10);
  const eMatch = String(episodeKey || "").match(/(\d+)/);
  const episode = eMatch ? parseInt(eMatch[1], 10) : null;
  return episode !== null ? `${season}/${episode}` : String(season);
}

function buildRows(entries) {
  if (entries.length === 0) return [];

  // Sort all entries by sent timestamp ascending
  const sorted = [...entries].sort(
    (a, b) => sentToMs(a.sent) - sentToMs(b.sent),
  );

  // Compute global duplicate index per episode (independent of grouping)
  const globalEpCount = new Map();
  const globalIdx = new Map();
  for (const e of sorted) {
    const epKey = `${e.showName}\x00${e.seasonKey}\x00${e.episodeKey}`;
    const count = (globalEpCount.get(epKey) || 0) + 1;
    globalEpCount.set(epKey, count);
    globalIdx.set(e, count);
  }

  // Group consecutive entries where gap < GROUP_GAP_MS
  const groups = [];
  let currentGroup = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gap = sentToMs(curr.sent) - sentToMs(prev.sent);
    if (gap <= GROUP_GAP_MS) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);

  const rows = [];

  for (const group of groups) {
    // Sort within group: showName → seasonKey → episodeKey → globalIdx → sent
    const withIdx = group.map((e) => {
      const epKey = `${e.showName}\x00${e.seasonKey}\x00${e.episodeKey}`;
      return { e, epKey, idx: globalIdx.get(e) || 1 };
    });
    withIdx.sort((a, b) => {
      const sn = (a.e.showName || "").localeCompare(b.e.showName || "");
      if (sn !== 0) return sn;
      const sk = (a.e.seasonKey || "").localeCompare(b.e.seasonKey || "");
      if (sk !== 0) return sk;
      const ek = (a.e.episodeKey || "").localeCompare(b.e.episodeKey || "");
      if (ek !== 0) return ek;
      if (a.idx !== b.idx) return a.idx - b.idx;
      return sentToMs(a.e.sent) - sentToMs(b.e.sent);
    });

    // Header row
    const oldestMs = Math.min(...group.map((e) => sentToMs(e.sent)));
    const headerTs = fmtGroupTs(oldestMs);
    const dashes = `──────────── ${headerTs} ────────────`;
    rows.push({
      key: `__header__${oldestMs}`,
      line: dashes,
      showName: "",
      entry: null,
      isHeader: true,
    });

    // Entry rows (no timestamp)
    for (const { e, epKey, idx } of withIdx) {
      // Blue label: "2/1 - 720p" (resolution omitted when unknown or mixed).
      const seBase = fmtSeasonEpisode(e.seasonKey, e.episodeKey);
      const res = String(e.resolution || "").trim();
      const se =
        seBase && res && res.toLowerCase() !== "mixed"
          ? `${seBase} - ${res}`
          : seBase;
      const dupePart = idx > 1 ? " (dupe)" : "";
      const rest = `${e.showName || "?"}${dupePart}`;
      const line = se ? `${se} ${rest}` : rest;
      rows.push({
        key: `${epKey}\x00${e.sent}\x00${idx}`,
        line,
        se,
        rest,
        showName: e.showName || "",
        entry: e,
        isHeader: false,
      });
    }
  }

  return rows;
}

export default {
  name: "Flex",

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
  },

  data() {
    return {
      rows: [],
      highlightKey: null,
      flashingRowKey: null,
      selectedRows: new Set(), // Multi-select; From button is the only source of multiple
      lastSelectedIndex: null,
      dialogRow: null,
      _flexgetChannel: null,
      forcing: false,
      flexRunning: false,
      _didInitialScroll: false,
      _didLoadOnce: false,
      _inFlight: false,
      _loadingTimer: null,
      _showLoading: false,
      showConfig: false,
      configText: "",
      configLoading: false,
      showRunPane: false,
      runOutput: "",
      _runAbortCtrl: null,
    };
  },

  computed: {
    emptyStateText() {
      if (this.rows.length > 0) return "";
      if (this._didLoadOnce) return "No results.";
      if (this._showLoading) return "Loading ...";
      return "";
    },
    dialogFields() {
      if (!this.dialogRow) return {};
      const e = this.dialogRow.entry;
      const out = {};
      const pttTitle = this.dialogPtt?.title ?? "";
      out["Regex"] = e.regexp ?? e.showName ?? "";
      out["Ptt Title"] = pttTitle;
      out["Tvdb Show Name"] = e.showName ?? "";
      const fields = [
        "seasonKey",
        "episodeKey",
        "title",
        "sent",
        "provider",
        "url",
        "quality",
        "release_group",
        "torrent_seeds",
        "torrent_leeches",
        "content_size",
        "proper",
        "task",
      ];
      for (const f of fields) {
        if (e[f] !== undefined && e[f] !== null) {
          out[f] = f === "sent" ? `${fmtSentTs(e[f])} (${e[f]})` : e[f];
        }
      }
      return out;
    },
    dialogPtt() {
      const title = this.dialogRow?.entry?.title;
      if (!title) return null;
      return parseTorrentTitle(title.replace(/\.[a-z0-9]{2,4}$/i, ""));
    },
  },

  watch: {
    show() {
      this.highlightKey = null;
    },
  },

  mounted() {
    evtBus.on("paneChanged", this.onPaneChanged);
    void this.$nextTick(() => {
      this.scrollToBottom();
    });
    this._onKeyDown = (e) => {
      if (e.key === "Enter" && this.dialogRow) this.dialogRow = null;
    };
    window.addEventListener("keydown", this._onKeyDown);
  },

  unmounted() {
    evtBus.off("paneChanged", this.onPaneChanged);
    this.stopPolling();
    this.rows = [];
    this.dialogRow = null;
    window.removeEventListener("keydown", this._onKeyDown);
    if (this._runAbortCtrl) {
      this._runAbortCtrl.abort();
      this._runAbortCtrl = null;
    }
  },

  methods: {
    async toggleConfig() {
      this.showConfig = !this.showConfig;
      if (this.showConfig) {
        this.configLoading = true;
        this.configText = "";
        try {
          const res = await fetch(`${config.tvSrvrUrl}/api/flexget-config`);
          this.configText = res.ok ? await res.text() : `Error: ${res.status}`;
        } catch (e) {
          this.configText = `Error: ${e.message}`;
        } finally {
          this.configLoading = false;
        }
      }
    },

    goToShow() {
      const name = this.dialogRow?.entry?.showName;
      if (name) evtBus.emit("selectShowFromCardTitle", name);
      this.dialogRow = null;
    },
    getRowStyle(row) {
      if (row.isHeader) {
        return {
          padding: "6px 4px 2px 4px",
          color: "#000",
          fontWeight: "bold",
          whiteSpace: "pre",
          userSelect: "none",
          cursor: "default",
        };
      }
      const isFlashing = this.flashingRowKey && row.key === this.flashingRowKey;
      const isHighlighted =
        this.selectedRows.has(row) ||
        (this.highlightKey && row.key === this.highlightKey);
      return {
        padding: "2px 4px",
        cursor: "pointer",
        borderRadius: "3px",
        background: isFlashing
          ? "#ffcccc"
          : isHighlighted
            ? "#fffacd"
            : "transparent",
        whiteSpace: "pre",
      };
    },

    handleRowClick(row, event) {
      if (row.isHeader) return;
      // Alt-click: copy show name + season/episode to clipboard
      if (event?.altKey) {
        const text = row.line ? String(row.line).trim() : "";
        navigator.clipboard.writeText(text).catch(() => {});
        this.flashingRowKey = row.key;
        setTimeout(() => {
          this.flashingRowKey = null;
        }, 300);
        return;
      }
      const rows = this.rows.filter((r) => !r.isHeader);
      const idx = rows.indexOf(row);
      if (event?.shiftKey && this.lastSelectedIndex !== null) {
        event.preventDefault(); // prevent browser text selection on shift-click
        const lo = Math.min(this.lastSelectedIndex, idx);
        const hi = Math.max(this.lastSelectedIndex, idx);
        const newSel = new Set(this.selectedRows);
        for (let i = lo; i <= hi; i++) {
          if (rows[i]) newSel.add(rows[i]);
        }
        this.selectedRows = newSel;
        this.highlightKey = row.key;
      } else if (event?.ctrlKey || event?.metaKey) {
        // Toggle clicked item
        const newSel = new Set(this.selectedRows);
        if (newSel.has(row)) {
          newSel.delete(row);
        } else {
          newSel.add(row);
          this.highlightKey = row.key;
        }
        this.selectedRows = newSel;
        this.lastSelectedIndex = idx;
      } else {
        // Plain click: single-select (no toggle)
        this.selectedRows = new Set([row]);
        this.highlightKey = row.key;
        this.lastSelectedIndex = idx;
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

    getScroller() {
      return this.$refs.scroller || null;
    },

    isAtBottom(el) {
      if (!el) return false;
      return el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    },

    scrollToBottom() {
      const el = this.getScroller();
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    },

    scrollToBottomAction() {
      this.scrollToBottom();
    },

    onPaneChanged(pane) {
      if (pane === "flex") {
        this._didInitialScroll = false;
        this.startPolling();
        this.$nextTick(() => this.scrollToBottom());
      } else {
        this.stopPolling();
        this.highlightKey = null;
        this.dialogRow = null;
      }
    },

    startPolling() {
      if (this._flexgetChannel) return;
      this.startLoadingDelay();
      const apply = async (payload) => {
        try {
          await this.applyFlexgetPayload(payload);
        } finally {
          this.finishLoadingDelay();
        }
      };
      this._flexgetChannel = srvr.openChannel("flexget", {
        onSnapshot: apply,
        onDelta: apply,
        onUnavailable: () => this.finishLoadingDelay(),
      });
    },

    stopPolling() {
      this._flexgetChannel?.close();
      this._flexgetChannel = null;
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
        if (this._inFlight && this.rows.length === 0 && !this._didLoadOnce) {
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

    showFirstDownloading() {
      if (!this.show) return;
      const showName = this.show.name;
      if (!showName) return;
      const candidates = [this.show];

      let startIndex = 0;
      if (this.highlightKey) {
        const currentIdx = this.rows.findIndex(
          (r) => r.key === this.highlightKey,
        );
        if (currentIdx !== -1) startIndex = currentIdx + 1;
      }

      let bestRow = null;
      for (let i = startIndex; i < this.rows.length; i++) {
        const row = this.rows[i];
        if (row.isHeader) continue;
        const match = util.smartTitleMatch(
          row.showName,
          candidates,
          null,
          false,
        );
        if (match) {
          bestRow = row;
          break;
        }
      }
      if (!bestRow) return;

      this.highlightKey = bestRow.key;
      const idx = this.rows.indexOf(bestRow);
      const scroller = this.getScroller();
      if (!scroller) return;
      const wrapper = scroller.children[0];
      if (!wrapper || !wrapper.children) return;
      const targetEl = wrapper.children[idx];
      if (targetEl)
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
    },

    async forceRun() {
      if (this.showRunPane) {
        this.showRunPane = false;
        if (this._runAbortCtrl) {
          this._runAbortCtrl.abort();
          this._runAbortCtrl = null;
        }
        return;
      }
      if (this.forcing) return;
      this.showRunPane = true;
      this.runOutput = "";
      this.forcing = true;
      this.flexRunning = true;
      const ctrl = new AbortController();
      this._runAbortCtrl = ctrl;
      try {
        const res = await fetch(`${config.tvSrvrUrl}/api/flexget-run-stream`, {
          signal: ctrl.signal,
        });
        if (!res.ok) {
          this.runOutput = `Error: ${res.status}`;
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n");
          buf = parts.pop();
          for (const part of parts) {
            if (part.startsWith("data:")) {
              this.runOutput += part.slice(5).replace(/^ /, "") + "\n";
              await this.$nextTick();
              this._scrollRunPaneToBottom();
            }
          }
        }
      } catch (e) {
        if (e.name !== "AbortError") {
          this.runOutput += `\nError: ${e.message}`;
        }
      } finally {
        this.forcing = false;
        this.flexRunning = false;
        this._runAbortCtrl = null;
      }
    },

    _scrollRunPaneToBottom() {
      const el = this.$refs.runPane;
      if (el) el.scrollTop = el.scrollHeight;
    },

    // Sel: emit selectShowFromCardTitle for the selected row's show name
    flexSelClick() {
      const row = [...this.selectedRows][0];
      if (!row || !row.showName) return;
      evtBus.emit("selectShowFromCardTitle", row.showName);
    },

    // From: select all rows whose show matches current show prop; scroll to first
    flexFromClick() {
      if (!this.show) return;
      const candidates = [this.show];
      const newSel = new Set();
      let firstRow = null;
      for (const row of this.rows) {
        if (row.isHeader) continue;
        const match = util.smartTitleMatch(
          row.showName,
          candidates,
          null,
          false,
        );
        if (match) {
          newSel.add(row);
          if (!firstRow) firstRow = row;
        }
      }
      this.selectedRows = newSel;
      if (firstRow) {
        this.highlightKey = firstRow.key;
        this.$nextTick(() => {
          const idx = this.rows.indexOf(firstRow);
          const scroller = this.getScroller();
          if (!scroller || idx < 0) return;
          const wrapper = scroller.children[0];
          if (!wrapper || !wrapper.children) return;
          const targetEl = wrapper.children[idx];
          if (targetEl)
            targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    },

    // All: select all rows whose show matches the currently selected row's show
    flexAllClick() {
      const first = [...this.selectedRows][0];
      if (!first || !first.showName) return;
      const pivotName = first.showName;
      const newSel = new Set();
      let firstRow = null;
      for (const row of this.rows) {
        if (row.isHeader) continue;
        const match = util.smartTitleMatch(
          row.showName,
          [{ name: pivotName }],
          null,
          false,
        );
        if (match) {
          newSel.add(row);
          if (!firstRow) firstRow = row;
        }
      }
      this.selectedRows = newSel;
      if (firstRow) {
        this.highlightKey = firstRow.key;
        this.$nextTick(() => {
          const idx = this.rows.indexOf(firstRow);
          const scroller = this.getScroller();
          if (!scroller || idx < 0) return;
          const wrapper = scroller.children[0];
          if (!wrapper || !wrapper.children) return;
          const targetEl = wrapper.children[idx];
          if (targetEl)
            targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    },

    // First: scroll to the first selected row
    flexFirstClick() {
      const first = [...this.selectedRows][0];
      if (!first) return;
      const idx = this.rows.indexOf(first);
      if (idx < 0) return;
      this.$nextTick(() => {
        const scroller = this.getScroller();
        if (!scroller) return;
        const wrapper = scroller.children[0];
        if (!wrapper || !wrapper.children) return;
        const targetEl = wrapper.children[idx];
        if (targetEl)
          targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },

    // Info: open detail dialog for selected row
    flexInfoClick() {
      const row = [...this.selectedRows][0];
      if (!row) return;
      this.dialogRow = row;
    },

    async applyFlexgetPayload(payload) {
      const scroller = this.getScroller();
      const wasAtBottom = this.isAtBottom(scroller);
      const entries = Array.isArray(payload?.history) ? payload.history : [];

      const newRows = buildRows(entries);

      // Re-map selectedRows to new row objects by key so selection survives updates
      if (this.selectedRows.size > 0) {
        const selectedKeys = new Set([...this.selectedRows].map((r) => r.key));
        const newKeyMap = new Map(newRows.map((r) => [r.key, r]));
        const remapped = new Set();
        for (const k of selectedKeys) {
          const newRow = newKeyMap.get(k);
          if (newRow) remapped.add(newRow);
        }
        this.selectedRows = remapped;
        // Update highlightKey to first still-selected row
        if (this.highlightKey && !newKeyMap.has(this.highlightKey)) {
          this.highlightKey = remapped.size > 0 ? [...remapped][0].key : null;
        }
      }

      this.flexRunning = Boolean(payload?.status?.running);
      this.rows = newRows;
      this._didLoadOnce = true;

      await this.$nextTick();
      if (!this._didInitialScroll) {
        this.scrollToBottom();
        this._didInitialScroll = true;
      } else if (wasAtBottom) {
        this.scrollToBottom();
      }
    },
  },
};
</script>
