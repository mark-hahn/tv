<template lang="pug">

#history(:style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }")

  #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'15px', marginLeft:'-10px', marginRight:'-10px', marginTop:'-10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'15px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
    div(style="display:flex; justify-content:space-between; align-items:center;")
      div(style="margin-left:20px;") History
      div(style="display:flex; gap:10px; margin-right:20px; justify-content:flex-end;")
        button(@click.stop="$emit('torrents')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Torrents
        button(@click.stop="$emit('status')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Status
        button(@click.stop="$emit('series')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Series
        button(@click.stop="$emit('map')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Map

  div(v-if="sortedTorrents.length === 0" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
    | No history.

  div(v-else style="padding:10px; font-size:14px; line-height:1.6;")
    div(v-for="t in sortedTorrents" :key="String(t.hash || t.name || t.added_on)" style="position:relative; background:#fff; border:1px solid #ddd; border-radius:5px; padding:10px; margin:0 0 10px 0;")
      div(style="font-size:16px; font-weight:bold; color:#333; word-break:break-word;") {{ t.name || t.hash }}
      div(style="font-size:14px; color:#333;") {{ infoLine(t) }}

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
      _pollTimer: null,
      useStaticSamples: false
    };
  },

  computed: {
    sortedTorrents() {
      return [...(this.torrents || [])].sort((a, b) => {
        const aa = Number(a?.added_on) || 0;
        const bb = Number(b?.added_on) || 0;
        return bb - aa;
      });
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
    onPaneChanged(pane) {
      if (pane === 'history') {
        if (!this.useStaticSamples) this.startPolling();
      } else {
        this.stopPolling();
      }
    },

    startPolling() {
      if (this._pollTimer) return;
      this._pollTimer = setInterval(() => {
        void this.pollOnce();
      }, 5000);
      void this.pollOnce();
    },

    stopPolling() {
      if (this._pollTimer) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
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
      try {
        const torrents = await this.getQbtInfo({});
        if (Array.isArray(torrents)) {
          this.torrents = torrents;
        }
      } catch {
        // ignore transient errors
      }
    },

    pad2(n) {
      return String(n).padStart(2, '0');
    },

    fmtMmDd_HhMm(epochSeconds) {
      const n = Number(epochSeconds);
      if (!Number.isFinite(n) || n <= 0) return '??/??.??:??';
      const d = new Date(Math.floor(n) * 1000);
      const mm = this.pad2(d.getMonth() + 1);
      const dd = this.pad2(d.getDate());
      const hh = this.pad2(d.getHours());
      const mi = this.pad2(d.getMinutes());
      return `${mm}/${dd}.${hh}:${mi}`;
    },

    fmtHhMm(epochSeconds) {
      const n = Number(epochSeconds);
      if (!Number.isFinite(n) || n <= 0) return '??:??';
      const d = new Date(Math.floor(n) * 1000);
      const hh = this.pad2(d.getHours());
      const mi = this.pad2(d.getMinutes());
      return `${hh}:${mi}`;
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

    fmtGbOneDecimal(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n)) return String(bytes);
      return `${(Math.max(0, n) / 1_000_000_000).toFixed(1)} GB`;
    },

    fmtProgPc(completedBytes, sizeBytes) {
      const c = Number(completedBytes);
      const s = Number(sizeBytes);
      if (!Number.isFinite(c) || !Number.isFinite(s) || s <= 0) return 0;
      return Math.max(0, Math.min(100, Math.round((c / s) * 100)));
    },

    infoLine(t) {
      const added = this.fmtMmDd_HhMm(t?.added_on);
      const size = this.fmtGbOneDecimal(t?.size);

      if (t?.state === 'downloading') {
        const prog = this.fmtProgPc(t?.completed, t?.size);
        const eta = this.fmtEtaMmSs(t?.eta);
        return `${added} | ${size} | downloading | ${prog}% | ${eta}`;
      }

      const finished = this.fmtHhMm(t?.completion_on);
      return `${added} | ${finished} | ${size} | finished`;
    }
  }
};
</script>
