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
          <button
            @click.stop="showFirstDownloading"
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 10px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
            "
          >
            From show
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
          @click="handleRowClick(row)"
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
        <button
          @click.stop="dialogRow = null"
          style="
            margin-top: 16px;
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
</template>

<script>
import evtBus from "../evtBus.js";
import { config } from "../config.js";
import * as util from "../util.js";

const FLEX_DISPLAY_TIME_ZONE = "America/Los_Angeles";

function fmtSentTs(sent) {
  if (!sent) return "??/??/?? ??:??:??";
  return String(sent);
}

function buildRows(entries) {
  // entries sorted by sent ascending (server guarantees this)
  const episodeSendCount = new Map();
  const rows = [];
  for (const e of entries) {
    const epKey = `${e.showName}\x00${e.seasonKey}\x00${e.episodeKey}`;
    const count = (episodeSendCount.get(epKey) || 0) + 1;
    episodeSendCount.set(epKey, count);
    const idx = count === 1 ? "" : ` (${count})`;
    const seKey = `${e.seasonKey || "?"}${e.episodeKey || "?"}`;
    const ts = fmtSentTs(e.sent);
    const line = `${ts}  ${seKey}  ${e.showName || "?"}${idx}`;
    rows.push({
      key: `${epKey}\x00${e.sent}\x00${count}`,
      line,
      showName: e.showName || "",
      entry: e,
    });
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
      dialogRow: null,
      _pollTimer: null,
      _polling: false,
      _didInitialScroll: false,
      _didLoadOnce: false,
      _inFlight: false,
      _loadingTimer: null,
      _showLoading: false,
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
  },

  unmounted() {
    evtBus.off("paneChanged", this.onPaneChanged);
    this.stopPolling();
    this.rows = [];
    this.dialogRow = null;
  },

  methods: {
    getRowStyle(row) {
      const isHighlighted = this.highlightKey && row.key === this.highlightKey;
      return {
        padding: "2px 4px",
        cursor: "pointer",
        borderRadius: "3px",
        background: isHighlighted ? "#cce5ff" : "transparent",
        whiteSpace: "pre",
      };
    },

    handleRowClick(row) {
      this.dialogRow = row;
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

    async pollOnce() {
      this.startLoadingDelay();
      try {
        const scroller = this.getScroller();
        const wasAtBottom = this.isAtBottom(scroller);

        const url = `${config.tvSrvrUrl}/api/flexget-history`;
        const res = await fetch(url);
        if (!res.ok) return;
        const entries = await res.json();

        this.rows = buildRows(Array.isArray(entries) ? entries : []);
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
