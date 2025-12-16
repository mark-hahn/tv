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
      button(@click.stop="closeCard(card.hash)" title="Close" aria-label="Close" style="position:absolute; top:6px; right:6px; padding:0 6px; line-height:16px; height:16px; font-size:12px; border:none; background:transparent; cursor:pointer; color:#666;") X
      div(style="font-size:16px; font-weight:bold; color:#333; margin-bottom:0; word-break:break-word;") {{ card.name || card.hash }}
      div(style="display:flex;")
        div(style="margin-left:20px; margin-right:30px;")
          pre(style="margin:0;") {{ leftBoxText(card) }}
        div
          pre(style="margin:0;") {{ rightBoxText(card) }}

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
      _pollTimer: null,
      _polling: false
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
    closeCard(hash) {
      const h = String(hash || '');
      if (!h) return;
      const idx = this.cards.findIndex(c => c.hash === h);
      if (idx >= 0) this.cards.splice(idx, 1);
    },
    onPaneChanged(pane) {
      if (pane === 'dlstatus') {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    },

    startPolling() {
      if (this._polling) return;
      this._polling = true;
      // First call immediately on status pane load.
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
        // Poll again 1 second after the last call completed.
        this.scheduleNextPoll(1000);
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

    shouldShowTorrent(t) {
      const amountLeft = Number(t?.amount_left);
      if (Number.isFinite(amountLeft) && amountLeft > 0) return true;

      const progress = Number(t?.progress);
      if (Number.isFinite(progress) && progress >= 0 && progress < 1) return true;

      return false;
    },

    async pollOnce() {
      try {
        // No filter: qB state can flip between downloading/stalled/etc.
        // Client-side filter keeps cards updating while data is still relevant.
        const torrents = await this.getQbtInfo({});
        if (Array.isArray(torrents)) {
          for (const t of torrents) {
            if (this.shouldShowTorrent(t)) this.upsertTorrent(t);
          }
        }
      } catch {
        // ignore transient errors
      }
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

    fmtGbOneDecimal(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n)) return String(bytes);
      return (Math.max(0, n) / 1_000_000_000).toFixed(1);
    },

    fmtSpeedGbps(bytesPerSec) {
      const n = Number(bytesPerSec);
      if (!Number.isFinite(n)) return String(bytesPerSec);
      // qBittorrent reports bytes/sec. Convert to gigabits/sec.
      return `${((Math.max(0, n) * 8) / 1_000_000_000).toFixed(3)} Gb/s`;
    },

    fmtDownloadedOfSizeGb(completedBytes, sizeBytes) {
      const dl = this.fmtGbOneDecimal(completedBytes);
      const sz = this.fmtGbOneDecimal(sizeBytes);
      return `${dl} of ${sz} GB`;
    },

    fmtEtaMins(etaSeconds) {
      const mmss = this.fmtDurationMmSs(etaSeconds);
      return `${mmss}`;
    },

    formatAlignedBox(pairs) {
      const maxKeyLen = Math.max(...pairs.map(([k]) => String(k).length));
      return pairs
        .map(([k, v]) => {
          const key = String(k);
          const val = (v === undefined || v === null) ? '' : String(v);
          const pad = ' '.repeat(Math.max(0, maxKeyLen - key.length));
          return `${key}: ${pad}${val}`;
        })
        .join('\n');
    },

    leftBoxText(card) {
      const t = card?.torrent || {};
      return this.formatAlignedBox([
        ['State', t?.state],
        ['Down', this.fmtDownloadedOfSizeGb(t?.completed, t?.size)],
        ['Speed', this.fmtSpeedGbps(t?.dlspeed)]
      ]);
    },

    rightBoxText(card) {
      const t = card?.torrent || {};
      return this.formatAlignedBox([
        ['Seeds', t?.num_seeds],
        ['Progress', this.fmtPercent(t?.progress)],
        ['Eta', this.fmtEtaMins(t?.eta)]
      ]);
    }
  }
};
</script>
