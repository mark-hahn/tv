<template lang="pug">

#history(:style="{ height:'100%', padding:'5px', margin:0, marginLeft:'16px', display:'flex', flexDirection:'column', overflow:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa', fontWeight:'bold' }")

  #scroller(ref="scroller" :style="{ flex:'1 1 auto', minHeight:'0px', overflowY:'auto', overflowX:'hidden' }")

    div(v-if="sortedTorrents.length === 0" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
      span(v-if="emptyStateText") {{ emptyStateText }}

    div(v-else style="padding:5px; font-size:13px; line-height:1.6;")
      div(v-for="t in sortedTorrents" :key="String(t.hash || t.name || t.added_on)" :style="getCardStyle(t)" @click="handleCardClick(t)")
        div(style="font-size:13px; font-weight:bold; color:#333; word-break:break-word;") {{ t.name || t.hash }}
        div(style="font-size:13px; color:rgba(0,0,0,0.50) !important;") {{ infoLine(t) }}

</template>

<script>
import evtBus from '../evtBus.js';
import { config } from '../config.js';

export default {
  name: 'History',

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
      torrents: [],
      activeDownLoads: [],
      _pollTimer: null,
      _polling: false,
      useStaticSamples: false,
      _didInitialScroll: false,
      _didLoadOnce: false,
      _inFlight: false,
      _loadingTimer: null,
      _showLoading: false
    };
  },

  computed: {
    sortedTorrents() {
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoff = nowSec - (60 * 24 * 60 * 60);
      return [...(this.torrents || [])]
        .filter(t => {
          const added = Number(t?.added_on) || 0;
          return added >= cutoff;
        })
        .sort((a, b) => {
          const aa = Number(a?.added_on) || 0;
          const bb = Number(b?.added_on) || 0;
          return aa - bb;
        });
    },

    emptyStateText() {
      if (this.sortedTorrents.length > 0) return '';
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
    this.torrents = [];
  },

  methods: {
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
      if (pane === 'history') {
        this._didInitialScroll = false;
        if (!this.useStaticSamples) this.startPolling();
      } else {
        this.stopPolling();
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
        if (this._inFlight && this.sortedTorrents.length === 0 && !this._didLoadOnce) {
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
        // Poll again 5 seconds after the last call completed.
        this.scheduleNextPoll(5000);
      }, Math.max(0, Number(delayMs) || 0));
    },

    async getQbtInfo(filterObj) {
      const url = new URL(`${config.torrentsApiUrl}/api/qbt/info`);
      if (filterObj && typeof filterObj === 'object') {
        if (filterObj.hash) url.searchParams.set('hash', filterObj.hash);
        if (filterObj.category) url.searchParams.set('category', filterObj.category);
        if (filterObj.tag) url.searchParams.set('tag', filterObj.tag);
        if (filterObj.filter) url.searchParams.set('filter', filterObj.filter);
      }
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res.json();
    },

    async pollOnce() {
      this.startLoadingDelay();
      try {
        const scroller = this.getScroller();
        const wasAtBottom = this.isAtBottom(scroller);

        const torrents = await this.getQbtInfo({});
        if (Array.isArray(torrents)) {
          const hashOf = (t) => String(t?.hash || '').trim();
          const curDownloading = torrents
            .filter(t => String(t?.state || '').trim() === 'downloading')
            .map(hashOf)
            .filter(Boolean);

          // Once the Qbt pane has loaded any cards, track currently-downloading titles.
          if (!this._didLoadOnce && torrents.length > 0) {
            this.activeDownLoads = curDownloading;
          } else {
            // On each poll: if any previously-downloading title is no longer downloading,
            // kick tvproc to start the next cycle.
            const prev = Array.isArray(this.activeDownLoads) ? this.activeDownLoads : [];
            const missing = prev.filter(h => h && !curDownloading.includes(h));
            if (missing.length > 0) {
              console.log('History: download finished, starting tvproc cycle', { finishedHashes: missing });
              try {
                await fetch('https://hahnca.com/tvproc/startProc', { method: 'POST' });
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
          if (!this._didInitialScroll) {
            this.scrollToBottom();
            this._didInitialScroll = true;
          } else if (wasAtBottom) {
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
      return '\u00A0\u00A0|\u00A0\u00A0';
    },

    pad2(n) {
      return String(n).padStart(2, '0');
    },

    fmtMmDd_HhMm(epochSeconds) {
      const n = Number(epochSeconds);
      if (!Number.isFinite(n) || n <= 0) return '??/??.??:??:??';
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
      if (!Number.isFinite(n) || n <= 0) return '??/?? ??:??:??';
      const d = new Date(Math.floor(n) * 1000);
      const mm = this.pad2(d.getMonth() + 1);
      const dd = this.pad2(d.getDate());
      const hh = this.pad2(d.getHours());
      const mi = this.pad2(d.getMinutes());
      const ss = this.pad2(d.getSeconds());
      return `${mm}/${dd} ${hh}:${mi}:${ss}`;
    },

    fmtState(state) {
      const raw = (state === undefined || state === null) ? '' : String(state);
      if (!raw) return '';

      // Special-case qBittorrent's stalledUP to match requested wording.
      if (raw === 'stalledUP') return 'Finished';

      // Match TvProc wording.
      if (raw === 'downloading') return 'Getting';

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
      if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end) || end <= 0) {
        return '??:??';
      }
      const elapsedSeconds = Math.max(0, end - start);
      const mm = Math.floor(elapsedSeconds / 60);
      const ss = Math.floor(elapsedSeconds % 60);
      return `${mm}:${this.pad2(ss)}`;
    },

    fmtGbOneDecimal(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n)) return String(bytes);
      return `${(Math.max(0, n) / 1_000_000_000).toFixed(3)} GB`;
    },

    fmtProgPc(completedBytes, sizeBytes) {
      const c = Number(completedBytes);
      const s = Number(sizeBytes);
      if (!Number.isFinite(c) || !Number.isFinite(s) || s <= 0) return 0;
      return Math.max(0, Math.min(100, Math.round((c / s) * 100)));
    },

    getCardStyle(t) {
      const isDownloading = t?.state === 'downloading';
      return {
        position: 'relative',
        background: isDownloading ? '#fffacd' : '#fff',
        border: '1px solid #ddd',
        borderRadius: '5px',
        padding: '10px',
        cursor: 'pointer'
      };
    },

    handleCardClick(t) {
      const title = t?.name;
      if (title) evtBus.emit('selectShowFromCardTitle', title);
    },

    infoLine(t) {
      const added = this.fmtMmDd_HhMm(t?.added_on);
      const size = this.fmtGbOneDecimal(t?.size);
      const sep = this.sep();

      if (t?.state === 'downloading') {
        const prog = this.fmtProgPc(t?.completed, t?.size);
        const seeds = Number.isFinite(Number(t?.num_seeds)) ? Number(t?.num_seeds) : 0;
        const eta = this.fmtEtaMmSs(t?.eta);
        return `${size}${sep}${added}${sep}${seeds}${sep}${prog}%${sep}${eta}${sep}Getting`;
      }

      const elapsed = this.fmtElapsedMmSs(t?.added_on, t?.completion_on);
      const state = this.fmtState(t?.state);
      return `${size}${sep}${added}${sep}${elapsed}${sep}${state}`;
    },

    forceFile(title) {
      console.log('history: forceFile button clicked, title:', title);
      if (!title) return;
      console.log('history: emitting forceFile event');
      evtBus.emit('forceFile', title);
    }
  }
};
</script>
