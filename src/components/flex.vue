<template lang="pug">

#flex(:style="{ height:'100%', padding:'5px', margin:0, marginLeft:'16px', display:'flex', flexDirection:'column', overflow:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa', fontWeight:'bold' }")

  #scroller(ref="scroller" :style="{ flex:'1 1 auto', minHeight:'0px', overflowY:'auto', overflowX:'hidden' }")
    div(v-if="cards.length === 0" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
      span(v-if="emptyStateText") {{ emptyStateText }}

    div(v-else style="padding:5px; font-size:16px; line-height:1.6;")
      div(v-for="c in cards" :key="c.key" style="position:relative; background:#fff; border:1px solid #ddd; border-radius:5px; padding:10px; margin:0 0 10px 0;")
        div(style="font-size:16px; font-weight:bold; color:#333; word-break:break-word;") {{ c.title }}
        div(style="font-size:16px; color:rgba(0,0,0,0.50) !important; word-break:break-word;") {{ c.subline }}

</template>

<script>
import evtBus from '../evtBus.js';
import { config } from '../config.js';

function splitCells(line) {
  return String(line || '')
    .split(/[│|]/)
    .map(s => String(s).trim())
    .filter(Boolean);
}

function fmtFlexgetTime(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return '';

  // 1) If the string already includes TZ info (Z or +/-HH:MM), let Date.parse handle it.
  // Example: 2025-12-16T05:25:08Z
  if (/[zZ]$/.test(txt) || /[+-]\d{2}:?\d{2}$/.test(txt)) {
    const d = new Date(txt);
    if (!Number.isNaN(d.getTime())) {
      const m = d.getMonth() + 1;
      const day = d.getDate();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${m}/${day} ${hh}:${mm}`;
    }
  }

  // 2) Legacy format from flexget: "Tue Dec 16 05:25:08 2025" (assume UTC)
  const parts = txt.split(/\s+/);
  if (parts.length >= 5) {
    const monStr = parts[1];
    const day = Number(parts[2]);
    const hhmmss = parts[3] || '';
    const year = Number(parts[4]);

    const monthMap = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };
    const monthIdx = monthMap[monStr];
    const [hhRaw, mmRaw, ssRaw] = hhmmss.split(':');
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
      // Interpret the input as UTC, then render as local.
      const utcMs = Date.UTC(year, monthIdx, day, hh, mm, Number.isFinite(ss) ? ss : 0);
      const d = new Date(utcMs);
      const mOut = d.getMonth() + 1;
      const dayOut = d.getDate();
      const hhOut = String(d.getHours()).padStart(2, '0');
      const mmOut = String(d.getMinutes()).padStart(2, '0');
      return `${mOut}/${dayOut} ${hhOut}:${mmOut}`;
    }
  }

  // 3) Fallback: return as-is if we can't parse
  return txt;
}

function parseFlexgetHistoryText(text) {
  const lines = String(text || '').split(/\r?\n/);

  // Separator lines contain only spaces and vertical bars.
  const contentLines = lines
    .map(l => String(l))
    .filter(l => !/^[\s|]+$/.test(l))
    .map(l => l.trim())
    .filter(Boolean);

  const cards = [];
  for (let i = 0; i < contentLines.length; i += 5) {
    const group = contentLines.slice(i, i + 5);
    if (group.length < 5) break;

    let provider = '';
    let title = '';
    let time = '';
    let reason = '';

    for (const line of group) {
      const cells = splitCells(line);
      const key = cells[0];
      const val = cells.slice(1).join(' | ');
      if (!key) continue;

      if (key === 'Task') provider = val;
      else if (key === 'Title') title = val;
      else if (key === 'Time') time = val;
      else if (key === 'Details') {
        const m = val.match(/reason:\s*([^)]*)\)?/i);
        reason = m ? String(m[1]).trim() : val;
      }
    }

    const timeFmt = fmtFlexgetTime(time);
    const subline = [provider, timeFmt, reason].filter(Boolean).join(', ');

    cards.push({
      key: `${title}::${provider}::${time}::${reason}::${i}`,
      title: title || '(no title)',
      subline
    });
  }

  return cards;
}

export default {
  name: 'Flex',

  props: {
    simpleMode: {
      type: Boolean,
      default: false
    },
    sizing: {
      type: Object,
      default: () => ({})
    }
  },

  data() {
    return {
      cards: [],
      _pollTimer: null,
      _polling: false,
      _didInitialScroll: false,
      _didLoadOnce: false,
      _inFlight: false,
      _loadingTimer: null,
      _showLoading: false
    };
  },

  computed: {
    emptyStateText() {
      if (this.cards.length > 0) return '';
      if (this._didLoadOnce) return 'No results.';
      if (this._showLoading) return 'Loading ...';
      return '';
    }
  },

  mounted() {
    evtBus.on('paneChanged', this.onPaneChanged);
  },

  unmounted() {
    evtBus.off('paneChanged', this.onPaneChanged);
    this.stopPolling();
    this.cards = [];
  },

  methods: {
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
      return (el.scrollTop + el.clientHeight) >= (el.scrollHeight - tolerance);
    },

    scrollToBottom() {
      const el = this.getScroller();
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    },

    onPaneChanged(pane) {
      if (pane === 'flex') {
        this._didInitialScroll = false;
        this.startPolling();
      } else {
        this.stopPolling();
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
      this._pollTimer = setTimeout(async () => {
        if (!this._polling) return;
        await this.pollOnce();
        this.scheduleNextPoll(this.pollDelayMs());
      }, Math.max(0, Number(delayMs) || 0));
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
    }
  }
};
</script>
