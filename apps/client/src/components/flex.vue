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
          <button
            @click.stop="forceRun"
            :disabled="forcing"
            :style="{
              fontSize: '13px',
              cursor: forcing ? 'default' : 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': forcing ? '#ccc' : 'whitesmoke',
            }"
          >
            Run
          </button>
          <button
            @click.stop="flexInfoClick"
            :disabled="selectedRows.size === 0"
            :style="{
              fontSize: '13px',
              cursor: selectedRows.size > 0 ? 'pointer' : 'default',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': selectedRows.size > 0 ? 'whitesmoke' : '#e8e8e8',
              color: selectedRows.size > 0 ? 'inherit' : '#aaa',
            }"
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
          <button
            @click.stop="flexSelClick"
            :disabled="selectedRows.size === 0"
            :style="{
              fontSize: '13px',
              cursor: selectedRows.size > 0 ? 'pointer' : 'default',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': selectedRows.size > 0 ? 'whitesmoke' : '#e8e8e8',
              color: selectedRows.size > 0 ? 'inherit' : '#aaa',
            }"
          >
            Sel
          </button>
          <button
            @click.stop="flexFromClick"
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
            @click.stop="flexAllClick"
            :disabled="selectedRows.size === 0"
            :style="{
              fontSize: '13px',
              cursor: selectedRows.size > 0 ? 'pointer' : 'default',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': selectedRows.size > 0 ? 'whitesmoke' : '#e8e8e8',
              color: selectedRows.size > 0 ? 'inherit' : '#aaa',
            }"
          >
            All
          </button>
          <button
            @click.stop="flexFirstClick"
            :disabled="selectedRows.size === 0"
            :style="{
              fontSize: '13px',
              cursor: selectedRows.size > 0 ? 'pointer' : 'default',
              borderRadius: '7px',
              padding: '4px 10px',
              border: '1px solid #bbb',
              '--btn-bg': selectedRows.size > 0 ? 'whitesmoke' : '#e8e8e8',
              color: selectedRows.size > 0 ? 'inherit' : '#aaa',
            }"
          >
            First
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
          font-size: 16px;
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
        >
          {{ row.line }}
        </div>
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
import * as util from "../util.js";

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
      const idxSuffix = idx > 1 ? " *" : "";
      const seKey = `${e.seasonKey || "?"}${e.episodeKey || "?"}`;
      const resSuffix = e.resolution ? ` ${e.resolution}` : "";
      const line = `${e.showName || "?"} (${seKey})${resSuffix}${idxSuffix}`;
      rows.push({
        key: `${epKey}\x00${e.sent}\x00${idx}`,
        line,
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
      selectedRows: new Set(), // Multi-select; From button is the only source of multiple
      lastSelectedIndex: null,
      dialogRow: null,
      _pollTimer: null,
      _polling: false,
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
      const fields = [
        "showName",
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
  },

  watch: {
    show() {
      this.highlightKey = null;
    },
  },

  mounted() {
    evtBus.on("paneChanged", this.onPaneChanged);
    void this.pollOnce();
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
      const isHighlighted =
        this.selectedRows.has(row) ||
        (this.highlightKey && row.key === this.highlightKey);
      return {
        padding: "2px 4px",
        cursor: "pointer",
        borderRadius: "3px",
        background: isHighlighted ? "#fffacd" : "transparent",
        whiteSpace: "pre",
      };
    },

    handleRowClick(row, event) {
      if (row.isHeader) return;
      // Alt-click: copy show name + season/episode to clipboard
      if (event?.altKey) {
        const text = row.line ? String(row.line).trim() : "";
        navigator.clipboard.writeText(text).catch(() => {});
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
      if (this._polling) return;
      this._polling = true;
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
          this.scheduleNextPoll(10000);
        },
        Math.max(0, Number(delayMs) || 0),
      );
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
      if (this.forcing) return;
      this.forcing = true;
      this.flexRunning = true;
      try {
        await fetch(`${config.tvSrvrUrl}/api/flexget-run`, { method: "POST" });
        this.scheduleNextPoll(3000);
      } catch {
        // ignore
      } finally {
        this.forcing = false;
      }
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

    async pollOnce() {
      this.startLoadingDelay();
      try {
        const scroller = this.getScroller();
        const wasAtBottom = this.isAtBottom(scroller);

        const url = `${config.tvSrvrUrl}/api/flexget-history`;
        const res = await fetch(url);
        if (!res.ok) return;
        const entries = await res.json();

        const newRows = buildRows(Array.isArray(entries) ? entries : []);

        // Re-map selectedRows to new row objects by key so selection survives polling
        if (this.selectedRows.size > 0) {
          const selectedKeys = new Set(
            [...this.selectedRows].map((r) => r.key),
          );
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

        // Also fetch running status
        try {
          const statusRes = await fetch(
            `${config.tvSrvrUrl}/api/flexget-status`,
          );
          if (statusRes.ok) {
            const statusJson = await statusRes.json();
            this.flexRunning = Boolean(statusJson?.running);
          }
        } catch {
          // ignore
        }

        this.rows = newRows;
        this._didLoadOnce = true;

        await this.$nextTick();
        if (!this._didInitialScroll) {
          this.scrollToBottom();
          this._didInitialScroll = true;
        } else if (wasAtBottom) {
          this.scrollToBottom();
        }
      } catch {
        // ignore transient errors
      } finally {
        this.finishLoadingDelay();
      }
    },
  },
};
</script>
