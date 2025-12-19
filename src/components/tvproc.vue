<template lang="pug">

#tvproc(:style="{ height:'100%', padding:'5px', margin:0, display:'flex', flexDirection:'column', overflow:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa', fontWeight:'bold' }")

  #header(:style="{ position:'sticky', top:'0px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'5px', paddingLeft:'5px', paddingRight:'5px', paddingBottom:'5px', marginLeft:'0px', marginRight:'0px', marginTop:'0px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'0px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
    div(style="display:flex; justify-content:space-between; align-items:center;")
      div(style="margin-left:20px;") TV Proc
      div(style="display:flex; gap:10px; margin-right:20px; justify-content:flex-end;")
        button(@click.stop="trimLog" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 10px; border:1px solid #bbb; background-color:whitesmoke;") Trim
        button(@click.stop="clearLog" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 10px; border:1px solid #bbb; background-color:whitesmoke;") Clear

  div(v-if="error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px; white-space:pre-line; padding:0 20px;")
    div Error: {{ error }}

  div(v-else-if="!hasContent" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
    div(v-if="emptyStateText") {{ emptyStateText }}

  div(v-else ref="scroller" :style="{ flex:'1 1 auto', margin:'0px', padding:'10px', overflowY:'auto', overflowX:'hidden', background:'#fff', border:'1px solid #ddd', borderRadius:'5px', fontFamily:'sans-serif', fontSize:'14px', fontWeight:'normal' }")
    template(v-for="(it, idx) in orderedItems" :key="idx")
      div(v-if="idx > 0 && Number(it?.sequence) === 1" style="margin:0; padding:0; line-height:14px; white-space:nowrap; overflow:hidden; font-family:monospace;") ====================================================================================================
      div(style="border:1px solid #ddd; border-radius:8px; padding:10px; margin-bottom:10px; background:#fff;")
        div(style="font-weight:bold; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;")
          span(v-if="it?.sequence !== undefined && it?.sequence !== null" style="color:blue !important;") {{ it.sequence }})
          span(v-if="it?.sequence !== undefined && it?.sequence !== null") &nbsp;
          span {{ it.title || '(no title)' }}
        div(style="margin-top:4px; color:#333; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;")
          span(v-if="line2(it).seasonEpisode" style="color:blue !important;") {{ line2(it).seasonEpisode }}
          span(v-if="line2(it).rest")
            span(v-if="line2(it).seasonEpisode") ,&nbsp;
            span {{ line2(it).rest }}

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
      items: [],
      error: null,
      _pollTimer: null,
      _active: false,
      _firstLoad: false,
      _didLoadOnce: false,
      _inFlight: false,
      _loadingTimer: null,
      _showLoading: false
    };
  },

  computed: {
    hasContent() {
      return !this.error && Array.isArray(this.items) && this.items.length > 0;
    },

    emptyStateText() {
      if (this.hasContent) return '';
      if (this._didLoadOnce) return 'No results.';
      if (this._showLoading) return 'Loading ...';
      return '';
    },

    orderedItems() {
      // Render in the exact array order returned by /api/tvproc.
      return Array.isArray(this.items) ? this.items : [];
    }
  },

  mounted() {
    evtBus.on('paneChanged', this.onPaneChanged);
  },

  unmounted() {
    evtBus.off('paneChanged', this.onPaneChanged);
    this.stopPolling();
    this.items = [];
    this.error = null;
  },

  methods: {
    onPaneChanged(pane) {
      const active = pane === 'tvproc';
      this._active = active;
      if (active) {
        this._firstLoad = true;
        void this.loadTvproc();
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

    scheduleNextPoll(ms) {
      this.stopPolling();
      this._pollTimer = setTimeout(() => {
        if (!this._active) return;
        void this.loadTvproc();
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

    fmtMdhm(ts) {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= 0) return '';

      // Accept seconds or milliseconds.
      const ms = n > 1e12 ? n : n * 1000;
      const d = new Date(ms);
      if (Number.isNaN(d.getTime())) return '';

      const m = d.getMonth() + 1;
      const day = d.getDate();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${m}/${day} ${hh}:${mm}`;
    },

    fmtGb(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n) || n <= 0) return '';
      const gb = n / 1e9;
      return `${gb.toFixed(3)} GB`;
    },

    fmtElapsedMmSs(seconds) {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n < 0) return '';
      const mins = Math.floor(n / 60);
      const secs = Math.floor(n % 60);
      return `${mins}:${String(secs).padStart(2, '0')}`;
    },

    elapsedSeconds(it) {
      const started = Number(it?.dateStarted);
      const ended = Number(it?.dateEnded);
      if (!Number.isFinite(started) || !Number.isFinite(ended)) return null;
      return Math.max(0, ended - started);
    },

    line2(it) {
      const s = Number(it?.season);
      const e = Number(it?.episode);
      const seasonEpisode = Number.isFinite(s) && Number.isFinite(e) ? `S${s}:E${e}` : '';

      const size = this.fmtGb(it?.fileSize);
      const started = this.fmtMdhm(it?.dateStarted);
      const ended = this.fmtMdhm(it?.dateEnded);
      const status = String(it?.status || '').trim();

      const parts = [];
      if (size) parts.push(size);
      if (started) parts.push(started);

      if (status === 'finished') {
        if (ended) parts.push(ended);
        const elapsed = this.fmtElapsedMmSs(this.elapsedSeconds(it));
        if (elapsed) parts.push(elapsed);
        parts.push('Finished');
        return { seasonEpisode, rest: parts.join(', ') };
      }

      if (status === 'downloading') {
        parts.push('Downloading');
        return { seasonEpisode, rest: parts.join(', ') };
      }

      if (ended) parts.push(ended);
      if (status) parts.push(status);
      return { seasonEpisode, rest: parts.join(', ') };
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
        await this.loadTvproc({ forceScrollToBottom: true });
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
        await this.loadTvproc({ forceScrollToBottom: true });
      } catch (e) {
        this.error = e?.message || String(e);
      }
    },

    async loadTvproc(opts = {}) {
      this.error = null;
      this.startLoadingDelay();
      try {
        const el = this.$refs.scroller;
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
        const arr = await res.json();
        this.items = Array.isArray(arr) ? arr : [];
        this._didLoadOnce = true;

        await this.$nextTick();
        const el2 = this.$refs.scroller;
        if (shouldStick) this.scrollToBottom(el2);
        this._firstLoad = false;
      } catch (e) {
        this.error = e?.message || String(e);
      } finally {
        this.finishLoadingDelay();
      }
    }
  }
};
</script>
