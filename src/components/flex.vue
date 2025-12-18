<template lang="pug">

#flex(:style="{ height:'100%', padding:'5px', margin:0, marginLeft:'16px', display:'flex', flexDirection:'column', overflow:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa', fontWeight:'bold' }")

  #header(:style="{ flex:'0 0 auto', backgroundColor:'#fafafa', paddingTop:'5px', paddingLeft:'5px', paddingRight:'5px', paddingBottom:'5px', marginLeft:'0px', marginRight:'0px', marginTop:'0px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'0px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
    div(style="display:flex; justify-content:space-between; align-items:center;")
      div(style="margin-left:20px;") Flexget History
      div(style="margin-right:20px;")

  #scroller(ref="scroller" :style="{ flex:'1 1 auto', minHeight:'0px', overflowY:'auto', overflowX:'hidden' }")
    div(v-if="cards.length === 0" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
      | No history.

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
  // Expected: "Tue Dec 16 05:25:08 2025"
  const parts = txt.split(/\s+/);
  if (parts.length < 5) return txt;

  const monStr = parts[1];
  const day = Number(parts[2]);
  const hhmmss = parts[3] || '';

  const monthMap = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12
  };
  const month = monthMap[monStr] || undefined;
  const [hhRaw, mmRaw] = hhmmss.split(':');
  const hh = String(hhRaw || '').padStart(2, '0');
  const mm = String(mmRaw || '').padStart(2, '0');

  if (!month || !Number.isFinite(day)) return txt;
  return `${month}/${day} ${hh}:${mm}`;
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
      _didInitialScroll: false
    };
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
      try {
        const scroller = this.getScroller();
        const wasAtBottom = this.isAtBottom(scroller);

        const url = new URL(`${config.torrentsApiUrl}/api/flexget`);
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const text = await res.text();

        this.cards = parseFlexgetHistoryText(text);

        await this.$nextTick();
        if (!this._didInitialScroll) {
          this.scrollToBottom();
          this._didInitialScroll = true;
        } else if (wasAtBottom) {
          this.scrollToBottom();
        }
      } catch {
        // ignore transient errors
      }
    }
  }
};
</script>
