<template lang="pug">

#dlstatus(:style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }")

  div(v-if="cards.length === 0" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
    | USB is not getting any files from swarm.

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
      _polling: false,
      _inFlight: false,
      _isVisible: false,
      _everVisible: false,
      _cycleStartTime: null,
      _cycleTimer: null
    };
  },

  mounted() {
    evtBus.on('paneChanged', this.onPaneChanged);
  },

  unmounted() {
    this.stopCycleTimer();
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

    applyEarlyFinish(card) {
      const t = card?.torrent;
      if (!t || typeof t !== 'object') return;

      const progress = Number(t.progress);
      const eta = Number(t.eta);

      // Only apply if the card isn't already finished.
      const needsFinish = (Number.isFinite(progress) && progress < 1) || (Number.isFinite(eta) && eta !== 0);
      if (!needsFinish) return;

      const size = Number(t.size);
      const nowSec = Math.floor(Date.now() / 1000);
      const next = {
        ...t,
        state: 'Early Finish',
        progress: 1,
        eta: 0,
        completion_on: Number.isFinite(Number(t.completion_on)) && Number(t.completion_on) > 0
          ? Number(t.completion_on)
          : nowSec
      };
      if (Number.isFinite(size) && size >= 0) {
        next.size = size;
        next.completed = size;
      }

      card.torrent = next;
    },
    onPaneChanged(pane) {
      this._isVisible = pane === 'dlstatus';
      if (this._isVisible) this._everVisible = true;

      // Start polling only once the pane has been shown at least once.
      if (this._everVisible) {
        this.startPolling();
      }

      // If we already have a scheduled next poll and we're not mid-request,
      // reschedule to match the visible/hidden interval.
      if (this._polling && !this._inFlight) {
        this.scheduleNextPoll(this.getPollDelayMs());
      }
    },

    startPolling() {
      if (this._polling) return;
      this._polling = true;
      console.log('GET TAB: Scheduling first poll immediately');
      // First call immediately the first time we start.
      this.scheduleNextPoll(0);
    },

    stopPolling() {
      this._polling = false;
      this._inFlight = false;
      if (this._pollTimer) {
        clearTimeout(this._pollTimer);
        this._pollTimer = null;
      }
    },

    stopCycleTimer() {
      if (this._cycleTimer) {
        clearTimeout(this._cycleTimer);
        this._cycleTimer = null;
      }
      this._cycleStartTime = null;
    },

    getPollDelayMs() {
      return this._isVisible ? 1000 : 10000;
    },

    scheduleNextPoll(delayMs) {
      if (!this._polling) return;
      if (this._pollTimer) {
        clearTimeout(this._pollTimer);
        this._pollTimer = null;
      }
      this._pollTimer = setTimeout(async () => {
        if (!this._polling) return;
        if (this._inFlight) return;
        this._inFlight = true;
        try {
          await this.pollOnce();
        } finally {
          this._inFlight = false;
        }
        // Poll again after the last call completed; interval depends on visibility.
        this.scheduleNextPoll(this.getPollDelayMs());
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
          const seen = new Set();
          let hasAnyFinished = false;
          
          for (const t of torrents) {
            if (this.shouldShowTorrent(t)) {
              const hash = String(t?.hash || '');
              if (hash) seen.add(hash);
              this.upsertTorrent(t);
            }
          }

          // If a previously shown torrent is no longer in the active set, mark it as finished.
          for (const card of this.cards) {
            if (!card?.hash) continue;
            const stillActive = seen.has(card.hash);
            if (!stillActive) {
              this.applyEarlyFinish(card);
              hasAnyFinished = true;
            }
          }
          
          // If something finished, check tvproc and start new cycle if nothing is downloading
          if (hasAnyFinished) {
            await this.checkAndStartNewCycle();
          }
        }
      } catch (e) {
        // Silently ignore polling errors
      }
    },

    async checkAndStartNewCycle() {
      try {
        // Wait 2 seconds for tvproc to refresh and see the finished download
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check tvproc status
        const res = await fetch(`${config.torrentsApiUrl}/api/tvproc`);
        if (!res.ok) return;
        
        const items = await res.json();
        if (!Array.isArray(items)) return;
        
        // Check if anything is downloading
        const downloadingItems = items.filter(it => String(it?.status || '').trim() === 'downloading');
        const hasDownloading = downloadingItems.length > 0;
        
        // If something is downloading, stop the aggressive cycling
        if (hasDownloading) {
          this.stopCycleTimer();
          evtBus.emit('cycle-started');
          return;
        }
        
        // Start aggressive cycling if not already started
        if (!this._cycleStartTime) {
          this._cycleStartTime = Date.now();
        }
        
        // Check if we've been cycling for more than 1 minute
        const elapsed = Date.now() - this._cycleStartTime;
        
        if (elapsed > 60000) {
          this.stopCycleTimer();
          return;
        }
        
        // Start a new cycle
        const cycleRes = await fetch(`${config.torrentsApiUrl}/api/tvproc/cycle`, {
          method: 'POST'
        });
        
        if (cycleRes.ok) {
          const result = await cycleRes.text();
          // Check again in 2 seconds
          this._cycleTimer = setTimeout(() => {
            void this.checkAndStartNewCycle();
          }, 2000);
        } else {
          console.log('GET TAB: Cycle API failed:', cycleRes.status);
          this.stopCycleTimer();
        }
      } catch (e) {
        console.error('GET TAB: checkAndStartNewCycle error:', e);
        this.stopCycleTimer();
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
      const ss2 = String(ss).padStart(2, '0');
      // If minutes would render as "00", drop just one leading zero.
      if (mm === 0) return `0:${ss2}`;
      return `${String(mm).padStart(2, '0')}:${ss2}`;
    },

    fmtElapsedMmSs(seconds) {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n < 0) return String(seconds);
      const s = Math.floor(n);
      const mm = Math.floor(s / 60);
      const ss = s % 60;
      return `${mm}:${String(ss).padStart(2, '0')}`;
    },

    fmtFinishedMmDd_HhMm(epochSeconds) {
      const n = Number(epochSeconds);
      if (!Number.isFinite(n) || n <= 0) return '';
      const d = new Date(Math.floor(n) * 1000);
      const hh = String(d.getHours()).padStart(2, '0');
      const mi = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${hh}:${mi}:${ss}`;
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

    fmtState(state) {
      const s = (state === undefined || state === null) ? '' : String(state);
      if (!s) return '';
      if (s === 'downloading') return 'Getting';
      // Simple capitalization: "downloading" -> "Downloading", "Early Finish" stays.
      return s
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    },

    isFinishedTorrent(t) {
      const progress = Number(t?.progress);
      const amountLeft = Number(t?.amount_left);
      const eta = Number(t?.eta);
      if (Number.isFinite(amountLeft) && amountLeft === 0) return true;
      if (Number.isFinite(progress) && progress >= 1 && Number.isFinite(eta) && eta === 0) return true;
      if (String(t?.state || '') === 'Early Finish') return true;
      return false;
    },

    elapsedSeconds(t) {
      const completion = Number(t?.completion_on);
      const added = Number(t?.added_on);
      if (Number.isFinite(completion) && completion > 0 && Number.isFinite(added) && added > 0) {
        return Math.max(0, completion - added);
      }
      const active = Number(t?.time_active);
      if (Number.isFinite(active) && active >= 0) return active;
      return NaN;
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
        ['Up', this.fmtDownloadedOfSizeGb(t?.completed, t?.size)],
        ['Speed', this.fmtSpeedGbps(t?.dlspeed)],
        ['Eta', this.fmtEtaMins(t?.eta)]
      ]);
    },

    rightBoxText(card) {
      const t = card?.torrent || {};
      if (this.isFinishedTorrent(t)) {
        const finished = this.fmtFinishedMmDd_HhMm(t?.completion_on);
        return this.formatAlignedBox([
          ['Seeds', t?.num_seeds],
          ['Finished', finished],
          ['State', this.fmtState(t?.state)]
        ]);
      }

      return this.formatAlignedBox([
        ['Seeds', t?.num_seeds],
        ['Progress', this.fmtPercent(t?.progress)],
        ['State', this.fmtState(t?.state)]
      ]);
    }
  }
};
</script>
