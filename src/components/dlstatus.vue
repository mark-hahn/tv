<template lang="pug">

#dlstatus(:style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }")

  #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'15px', marginLeft:'-10px', marginRight:'-10px', marginTop:'-10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'15px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
    div(style="display:flex; justify-content:space-between; align-items:center;")
      div(style="margin-left:20px;") Status
      div(style="display:flex; gap:10px; margin-right:20px; justify-content:flex-end;")
        button(@click.stop="$emit('torrents')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Torrents
        button(@click.stop="$emit('history')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") History
        button(@click.stop="$emit('series')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Series
        button(@click.stop="$emit('map')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Map

  div(v-if="cards.length === 0" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
    | No files are downloading.

  div(v-else style="padding:10px; font-size:14px; line-height:1.6;")
    div(v-for="card in cards" :key="card.hash" style="position:relative; background:#fff; border:1px solid #ddd; border-radius:5px; padding:10px; margin:0 0 10px 0;")
      div(style="font-size:16px; font-weight:bold; color:#333; margin-bottom:6px; word-break:break-word;") {{ card.name || card.hash }}
      pre(style="margin:0; white-space:pre; overflow-x:auto;") {{ formatCard(card) }}

</template>

<script>
import evtBus from '../evtBus.js';
import { config } from '../config.js';

export default {
  name: 'DlStatus',

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
      _polling: false,
      _stopPolling: false
    };
  },

  mounted() {
    evtBus.on('paneChanged', this.onPaneChanged);
  },

  unmounted() {
    evtBus.off('paneChanged', this.onPaneChanged);
    this.stopPollingAndReset();
  },

  methods: {
    onPaneChanged(pane) {
      if (pane === 'dlstatus') {
        this.startPollingFresh();
      } else {
        this.stopPollingAndReset();
      }
    },

    startPollingFresh() {
      if (this._polling) return;
      this.cards = [];
      this._stopPolling = false;
      this._polling = true;
      void this.pollLoop();
    },

    stopPollingAndReset() {
      this._stopPolling = true;
      this._polling = false;
      this.cards = [];
    },

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
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

    upsertTorrent(t) {
      const hash = String(t?.hash || '');
      if (!hash) return;

      const idx = this.cards.findIndex(c => c.hash === hash);
      const next = {
        hash,
        name: t?.name || '',
        torrent: t
      };

      if (idx >= 0) {
        this.cards.splice(idx, 1, next);
      } else {
        this.cards.unshift(next);
      }
    },

    async pollLoop() {
      while (!this._stopPolling) {
        try {
          const torrents = await this.getQbtInfo({ filter: 'downloading' });
          if (Array.isArray(torrents)) {
            for (const t of torrents) this.upsertTorrent(t);
          }
        } catch {
          // ignore transient errors
        }

        await this.sleep(1000);
      }
    },

    fmtSize(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n)) return String(bytes);
      const b = Math.max(0, n);
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let v = b;
      let i = 0;
      while (v >= 1000 && i < units.length - 1) {
        v /= 1000;
        i += 1;
      }
      if (i === 0) return `${Math.round(v)} B`;
      return `${v.toFixed(1)} ${units[i]}`;
    },

    fmtPercent(progress) {
      const n = Number(progress);
      if (!Number.isFinite(n)) return String(progress);
      return `${Math.round(n * 100)}%`;
    },

    fmtDurationMmSs(seconds) {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n < 0) return String(seconds);
      const s = Math.floor(n);
      const mm = Math.floor(s / 60);
      const ss = s % 60;
      return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    },

    formatCard(card) {
      const t = card?.torrent || {};

      const lines = [];
      const push = (k, v) => {
        const shown = (v === undefined || v === null) ? '' : String(v);
        lines.push(`${k}: ${shown}`);
      };

      push('state', t?.state);
      push('progress', this.fmtPercent(t?.progress));
      push('downloaded', this.fmtSize(t?.downloaded));
      push('size', this.fmtSize(t?.size));
      push('dl speed', this.fmtSize(t?.dlspeed) + '/s');
      push('eta', this.fmtDurationMmSs(t?.eta));
      push('seeds', t?.num_seeds);

      return lines.join('\n');
    }
  }
};
</script>
