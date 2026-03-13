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
        v-if="cards.length === 0"
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
          v-for="c in cards"
          :key="c.key"
          @click="handleCardClick(c)"
          :style="getCardStyle(c)"
        >
          <div
            style="
              font-size: 14px;
              font-weight: bold;
              color: #000;
              word-break: break-word;
            "
          >
            {{ c.title }}
          </div>
          <div
            style="
              margin-top: 8px;
              font-size: 14px;
              font-weight: normal;
              color: rgba(0, 0, 0, 0.5) !important;
              word-break: break-word;
            "
          >
            {{ c.subline }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import evtBus from "../evtBus.js";
import { config } from "../config.js";
import * as util from "../util.js";
import parseTorrentTitle from "parse-torrent-title";

const FLEX_DISPLAY_TIME_ZONE = "America/Los_Angeles";
// USB server is in the Netherlands and emits legacy timestamps without TZ info.
// Treat those naive timestamps as Europe/Amsterdam so we don't drift by +1 hour.
const FLEX_SERVER_TIME_ZONE = "Europe/Amsterdam";

function getTimeZoneOffsetMs(timeZone, date) {
  // Returns: (wall-clock time in `timeZone` interpreted as UTC) - (actual epoch).
  // Example: if `timeZone` is UTC+1 at that instant, this returns +3600000.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const y = Number(get("year"));
  const m = Number(get("month"));
  const d = Number(get("day"));
  const hh = Number(get("hour"));
  const mm = Number(get("minute"));
  const ss = Number(get("second"));

  if (![y, m, d, hh, mm, ss].every(Number.isFinite)) return 0;
  const asUTC = Date.UTC(y, m - 1, d, hh, mm, ss);
  return asUTC - date.getTime();
}

function zonedTimeToUtcMs(timeZone, year, monthIdx, day, hh, mm, ss) {
  // Converts a wall-clock time in `timeZone` into a UTC epoch ms.
  // Iterates to account for DST.
  let utcGuess = Date.UTC(year, monthIdx, day, hh, mm, ss);
  for (let i = 0; i < 3; i++) {
    const offset = getTimeZoneOffsetMs(timeZone, new Date(utcGuess));
    const next = Date.UTC(year, monthIdx, day, hh, mm, ss) - offset;
    if (Math.abs(next - utcGuess) < 1000) return next;
    utcGuess = next;
  }
  return utcGuess;
}

function splitCells(line) {
  return String(line || "")
    .split(/[│|]/)
    .map((s) => String(s).trim())
    .filter(Boolean);
}

function fmtPacificMmDd_HhMm(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: FLEX_DISPLAY_TIME_ZONE,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    }).formatToParts(date);

    const get = (type) => parts.find((p) => p.type === type)?.value || "";
    const m = get("month");
    const d = get("day");
    const hh = get("hour");
    const mm = get("minute");
    if (!m || !d || !hh || !mm) return "";
    return `${m}/${d} ${hh}:${mm}`;
  } catch {
    // Fallback: local time formatting.
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    return `${m}/${d} ${hh}:${mm}`;
  }
}

function fmtFlexgetTime(raw) {
  const txt = String(raw || "").trim();
  if (!txt) return "";

  // 1) If the string already includes TZ info (Z or +/-HH:MM), let Date.parse handle it.
  // Example: 2025-12-16T05:25:08Z
  if (/[zZ]$/.test(txt) || /[+-]\d{2}:?\d{2}$/.test(txt)) {
    const d = new Date(txt);
    if (!Number.isNaN(d.getTime())) {
      return fmtPacificMmDd_HhMm(d);
    }
  }

  // 2) Legacy format from flexget: "Tue Dec 16 05:25:08 2025" (no TZ)
  // Server emits this without TZ info; interpret it as Netherlands local time.
  const parts = txt.split(/\s+/);
  if (parts.length >= 5) {
    const monStr = parts[1];
    const day = Number(parts[2]);
    const hhmmss = parts[3] || "";
    const year = Number(parts[4]);

    const monthMap = {
      Jan: 0,
      Feb: 1,
      Mar: 2,
      Apr: 3,
      May: 4,
      Jun: 5,
      Jul: 6,
      Aug: 7,
      Sep: 8,
      Oct: 9,
      Nov: 10,
      Dec: 11,
    };
    const monthIdx = monthMap[monStr];
    const [hhRaw, mmRaw, ssRaw] = hhmmss.split(":");
    const hh = Number(hhRaw);
    const mm = Number(mmRaw);
    const ss = Number(ssRaw);

    if (
      monthIdx !== undefined &&
      Number.isFinite(day) &&
      Number.isFinite(year) &&
      Number.isFinite(hh) &&
      Number.isFinite(mm)
    ) {
      const utcMs = zonedTimeToUtcMs(
        FLEX_SERVER_TIME_ZONE,
        year,
        monthIdx,
        day,
        hh,
        mm,
        Number.isFinite(ss) ? ss : 0,
      );
      return fmtPacificMmDd_HhMm(new Date(utcMs));
    }
  }

  // 3) Fallback: return as-is if we can't parse
  return txt;
}

function parseFlexgetHistoryText(text) {
  const lines = String(text || "").split(/\r?\n/);

  // Separator lines contain only spaces and vertical bars.
  const contentLines = lines
    .map((l) => String(l))
    .filter((l) => !/^[\s|]+$/.test(l))
    .map((l) => l.trim())
    .filter(Boolean);

  const cards = [];
  for (let i = 0; i < contentLines.length; i += 5) {
    const group = contentLines.slice(i, i + 5);
    if (group.length < 5) break;

    let provider = "";
    let title = "";
    let time = "";
    let reason = "";

    for (const line of group) {
      const cells = splitCells(line);
      const key = cells[0];
      const val = cells.slice(1).join(" | ");
      if (!key) continue;

      if (key === "Task") provider = val;
      else if (key === "Title") title = val;
      else if (key === "Time") time = val;
      else if (key === "Details") {
        const m = val.match(/reason:\s*([^)]*)\)?/i);
        reason = m ? String(m[1]).trim() : val;
      }
    }

    const timeFmt = fmtFlexgetTime(time);
    const subline = [provider, timeFmt, reason].filter(Boolean).join(" | ");

    cards.push({
      key: `${title}::${provider}::${time}::${reason}::${i}`,
      title: title || "(no title)",
      subline,
    });
  }

  return cards;
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
      cards: [],
      matchedTitle: null,
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
      if (this.cards.length > 0) return "";
      if (this._didLoadOnce) return "No results.";
      if (this._showLoading) return "Loading ...";
      return "";
    },
  },

  watch: {
    show() {
      this.matchedTitle = null;
    },
  },

  mounted() {
    evtBus.on("paneChanged", this.onPaneChanged);

    // Poll once at boot so data is ready before the user opens the pane.
    void this.pollOnce();

    // Establish an initial "bottom" baseline on app load.
    // v-show preserves scroll position even when hidden.
    void this.$nextTick(() => {
      this.scrollToBottom();
    });
  },

  unmounted() {
    evtBus.off("paneChanged", this.onPaneChanged);
    this.stopPolling();
    this.cards = [];
  },

  methods: {
    getCardStyle(c) {
      const isMatched = this.matchedTitle && c?.title === this.matchedTitle;
      return {
        position: "relative",
        background: "#fff",
        border: isMatched ? "3px solid #007bff" : "1px solid #ddd",
        borderRadius: "5px",
        padding: "10px",
        cursor: "pointer",
        zIndex: isMatched ? 1 : 0,
      };
    },

    handleCardClick(c) {
      const title = c?.title;
      if (title) evtBus.emit("selectShowFromCardTitle", title);
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

    pollDelayMs() {
      // Delay is measured from the END of one pollOnce() call
      // to the START of the next pollOnce() call.
      return 10000;
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
      if (pane === "flex") {
        this._didInitialScroll = false;
        this.startPolling();
        this.$nextTick(() => this.scrollToBottom());
      } else {
        this.stopPolling();
        this.matchedTitle = null;
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
        if (this._inFlight && this.cards.length === 0 && !this._didLoadOnce) {
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
          this.scheduleNextPoll(this.pollDelayMs());
        },
        Math.max(0, Number(delayMs) || 0),
      );
    },

    scrollToBottomAction() {
      this.scrollToBottom();
    },

    showFirstDownloading() {
      if (!this.show) {
        console.warn("showFirstDownloading: No show selected context");
        return;
      }

      const showName = this.show.Name || this.show.name;
      if (!showName) return;

      const candidates = [this.show];
      let bestMatch = null;

      // Determine search start index
      let startIndex = 0;
      if (this.matchedTitle) {
        const currentIdx = this.cards.findIndex(
          (it) => it && it.title === this.matchedTitle,
        );
        if (currentIdx !== -1) {
          startIndex = currentIdx + 1;
        }
      }

      for (let i = startIndex; i < this.cards.length; i++) {
        const it = this.cards[i];
        const rawTitle = it.title || "";
        if (!rawTitle) continue;

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

        // Task Correlation: forceChoice = false
        const match = util.smartTitleMatch(
          searchTitle,
          candidates,
          searchYear,
          false,
        );
        if (match) {
          bestMatch = it;
          break;
        }
      }

      if (!bestMatch) {
        return;
      }

      this.matchedTitle = bestMatch.title;

      const idx = this.cards.findIndex((it) => it === bestMatch);
      if (idx === -1) return;

      const scroller = this.getScroller();
      if (!scroller) return;

      // flex template structure: scroller > div (v-else) > divs (cards)
      // scroller has one child (the wrapper div) when cards exist.
      // Be careful of comments or whitespace text nodes if using childNodes. children is safer.
      const wrapper = scroller.children[0];
      if (!wrapper || !wrapper.children) return;

      const targetEl = wrapper.children[idx];
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    },

    async pollOnce() {
      this.startLoadingDelay();
      try {
        const scroller = this.getScroller();
        const wasAtBottom = this.isAtBottom(scroller);

        const url = new URL(`${config.torrentsApiUrl}/api/flexget`);
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const text = await res.text();

        this.cards = parseFlexgetHistoryText(text);
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
