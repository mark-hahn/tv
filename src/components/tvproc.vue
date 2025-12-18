<template lang="pug">

#tvproc(:style="{ height:'100%', padding:'5px', margin:0, display:'flex', flexDirection:'column', overflow:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa', fontWeight:'bold' }")

  #header(:style="{ position:'sticky', top:'0px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'5px', paddingLeft:'5px', paddingRight:'5px', paddingBottom:'5px', marginLeft:'0px', marginRight:'0px', marginTop:'0px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'0px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
    div(style="display:flex; justify-content:space-between; align-items:center;")
      div(style="margin-left:20px;") TV Proc
      div(style="display:flex; gap:10px; margin-right:20px; justify-content:flex-end;")
        button(@click.stop="trimLog" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Trim
        button(@click.stop="clearLog" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Clear

  div(v-if="error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px; white-space:pre-line; padding:0 20px;")
    div Error: {{ error }}

  div(v-else-if="isEmpty" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
    div The log is empty.

  pre(v-else ref="logPane" :style="{ flex:'1 1 auto', margin:'0px', padding:'10px', overflowY:'auto', overflowX:'auto', background:'#fff', border:'1px solid #ddd', borderRadius:'5px', fontFamily:'monospace', fontSize:'14px', fontWeight:'normal', whiteSpace:'pre' }") {{ logText }}

</template>

<script>
import evtBus from '../evtBus.js';
import { config } from '../config.js';

export default {
  name: 'TvProc',

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
      logText: '',
      error: null,
      _pollTimer: null,
      _active: false,
      _firstLoad: false
    };
  },

  computed: {
    isEmpty() {
      return !this.error && String(this.logText || '').trim().length === 0;
    }
  },

  mounted() {
    evtBus.on('paneChanged', this.onPaneChanged);
  },

  unmounted() {
    evtBus.off('paneChanged', this.onPaneChanged);
    this.stopPolling();
    this.logText = '';
    this.error = null;
  },

  methods: {
    onPaneChanged(pane) {
      const active = pane === 'tvproc';
      this._active = active;
      if (active) {
        this._firstLoad = true;
        void this.loadLog();
        this.scheduleNextPoll(5000);
      } else {
        this.stopPolling();
      }
    },

    stopPolling() {
      if (this._pollTimer) {
        clearTimeout(this._pollTimer);
        this._pollTimer = null;
      }
    },

    scheduleNextPoll(ms) {
      this.stopPolling();
      this._pollTimer = setTimeout(() => {
        if (!this._active) return;
        void this.loadLog();
        this.scheduleNextPoll(5000);
      }, ms);
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

    suppressSections(txt) {
      const lines = String(txt || '').split(/\r?\n/);
      const out = [];

      const isDateLine = (s) => {
        // Example: Tue Dec 16 03:45:01 AM PST 2025
        return /^\w{3} \w{3} \d{1,2} \d{2}:\d{2}:\d{2} [AP]M [A-Z]{3} \d{4}$/.test(String(s || '').trim());
      };
      const isSkippedLine = (s) => /^skipped recent:\s+\d+\s*$/.test(String(s || ''));
      const isElapsedLine = (s) => /^elapsed\(mins\):\s+[0-9.]+\s*$/.test(String(s || ''));
      const isBlankLine = (s) => String(s || '').trim().length === 0;

      for (let i = 0; i < lines.length; i++) {
        const l0 = lines[i];
        const l1 = lines[i + 1];
        const l2 = lines[i + 2];
        const l3 = lines[i + 3];

        if (isDateLine(l0) && isSkippedLine(l1) && isElapsedLine(l2) && (isBlankLine(l3) || typeof l3 === 'undefined')) {
          i += (typeof l3 === 'undefined' ? 2 : 3);
          continue;
        }
        out.push(l0);
      }

      return out.join('\n');
    },

    async trimLog() {
      this.error = null;
      try {
        const res = await fetch(`${config.torrentsApiUrl}/api/tvproc/trim`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keepLines: 1000 })
        });
        if (!res.ok) {
          let detail = '';
          try {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
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
        await this.loadLog({ forceScrollToBottom: true });
      } catch (e) {
        this.error = e?.message || String(e);
      }
    },

    async clearLog() {
      this.error = null;
      try {
        const res = await fetch(`${config.torrentsApiUrl}/api/tvproc/clear`, {
          method: 'POST'
        });
        if (!res.ok) {
          let detail = '';
          try {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
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
        await this.loadLog({ forceScrollToBottom: true });
      } catch (e) {
        this.error = e?.message || String(e);
      }
    },

    async loadLog(opts = {}) {
      this.error = null;
      try {
        const el = this.$refs.logPane;
        const shouldStick = Boolean(opts.forceScrollToBottom) || this._firstLoad || this.isNearBottom(el);

        const res = await fetch(`${config.torrentsApiUrl}/api/tvproc`);
        if (!res.ok) {
          let detail = '';
          try {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
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
        const raw = await res.text();
        this.logText = this.suppressSections(raw);

        await this.$nextTick();
        const el2 = this.$refs.logPane;
        if (shouldStick) this.scrollToBottom(el2);
        this._firstLoad = false;
      } catch (e) {
        this.error = e?.message || String(e);
      }
    }
  }
};
</script>
