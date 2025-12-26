<template lang="pug">

#tvproc(:style="{ height:'100%', padding:'5px', margin:0, display:'flex', flexDirection:'column', overflow:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa', fontWeight:'bold' }")

  #header(:style="{ position:'sticky', top:'0px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'5px', paddingLeft:'5px', paddingRight:'5px', paddingBottom:'5px', marginLeft:'0px', marginRight:'0px', marginTop:'0px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'0px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
    div(style="display:flex; justify-content:space-between; align-items:center;")
      div(style="margin-left:20px;") Downloads
      div(style="display:flex; gap:10px; margin-right:20px; justify-content:flex-end;")
        div(v-if="libraryProgressText" style="align-self:center; font-size:13px; color:#555; white-space:nowrap;") {{ libraryProgressText }}
        button(@click.stop="startLibraryRefresh" :disabled="_libBusy" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 10px; border:1px solid #bbb; background-color:whitesmoke;") Library
        button(@click.stop="showFirstDownloading" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 10px; border:1px solid #bbb; background-color:whitesmoke;") Show
        button(@click.stop="clearLog" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 10px; border:1px solid #bbb; background-color:whitesmoke;") Clear

  div(v-if="error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px; white-space:pre-line; padding:0 20px;")
    div Error: {{ error }}

  div(v-else-if="!hasContent" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
    div(v-if="emptyStateText") {{ emptyStateText }}

  div(v-else ref="scroller" :style="{ flex:'1 1 auto', margin:'0px', padding:'10px', overflowY:'auto', overflowX:'hidden', background:'#fff', border:'1px solid #ddd', borderRadius:'5px', fontFamily:'sans-serif', fontSize:'14px', fontWeight:'normal' }")
    template(v-for="(it, idx) in orderedItems" :key="idx")
      div(v-if="idx > 0 && Number(it?.sequence) === 1" style="margin:0; padding:0; line-height:14px; white-space:nowrap; overflow:hidden; font-family:monospace;") ====================================================================================================
      div(:style="getCardStyle(it)" @click="handleCardClick(it)" @mouseenter="handleMouseEnter($event, it)" @mouseleave="handleMouseLeave($event)")
        div(v-if="isFutureClicked(it)" style="position:absolute; top:8px; right:8px; color:#4CAF50; font-size:20px; font-weight:bold;") ✓
        div(style="font-weight:bold; font-size:13px; word-wrap:break-word; overflow-wrap:break-word;")
          span(v-if="it?.sequence !== undefined && it?.sequence !== null" style="color:blue !important;") {{ it.sequence }})
          span(v-if="it?.sequence !== undefined && it?.sequence !== null") &nbsp;
          span {{ it.title || '(no title)' }}
        div(style="margin-top:4px; color:#333; font-size:13px; word-wrap:break-word; overflow-wrap:break-word;")
          span(v-if="line2(it).seasonEpisode" style="color:blue !important;") {{ line2(it).seasonEpisode }}
          span(v-if="line2(it).rest")
            span(v-if="line2(it).seasonEpisode") ,&nbsp;
            span {{ line2(it).rest }}

</template>

<script>
import evtBus from '../evtBus.js';
import { config } from '../config.js';
import * as emby from '../emby.js';

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
      _libPollTimer: null,
      _libBusy: false,
      _libTaskId: null,
      libraryProgressText: '',
      _active: false,
      _firstLoad: false,
      _didLoadOnce: false,
      _inFlight: false,
      _loadingTimer: null,
      _showLoading: false,
      clickedFutures: new Set(),
      _lastScrollTop: null,
      _hasEverMounted: false,
      _fastPollStartTime: null,
      _oldDownloadingCount: 0,
      _lastFinishedEnded: 0,
      _tvprocInitialized: false
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
    evtBus.on('forceFile', this.handleForceFile);
    evtBus.on('cycle-started', this.handleCycleStarted);
  },

  unmounted() {
    evtBus.off('paneChanged', this.onPaneChanged);
    evtBus.off('forceFile', this.handleForceFile);
    evtBus.off('cycle-started', this.handleCycleStarted);
    this.stopPolling();
    this.stopLibraryPolling();
    this.items = [];
    this.error = null;
  },

  methods: {
    notifyAllUsbFinished(lastTitle) {
      try {
        if (typeof window === 'undefined') return;
        if (!('Notification' in window)) return;

        const title = String(lastTitle || '').trim();
        const msg = title
          ? `All files have been downloaded from USB, the last is ${title}.`
          : 'All USB downloads finished.';

        if (Notification.permission === 'granted') {
          new Notification(msg);
          return;
        }

        // Do not request permission automatically (may require user gesture).
        // If user wants notifications, they can grant it in browser/site settings.
        console.log('Desktop notification not shown (permission:', Notification.permission + ')');
      } catch (e) {
        console.log('notifyAllUsbFinished failed:', e?.message || String(e));
      }
    },

    handleCycleStarted() {
      // Start fast polling when a cycle starts
      this._fastPollStartTime = Date.now();
      this._oldDownloadingCount = this.items.filter(it => it.status === 'downloading' && (!it.dateEnded || it.dateEnded === 0)).length;
      // Start polling immediately, even if pane is not active
      void this.loadTvproc();
      this.scheduleNextPoll(1000);
    },

    onPaneChanged(pane) {
      const active = pane === 'tvproc';
      this._active = active;
      if (active) {
        // Load data when switching to this pane
        void this.loadTvproc({ isInitialPaneSwitch: true });
        // Start polling if not already running
        if (!this._pollTimer) {
          this.scheduleNextPoll(5000);
        }
      } else {
        // Store scroll position when leaving
        const el = this.$refs.scroller;
        if (el) {
          this._lastScrollTop = el.scrollTop;
        }
        // Don't stop polling - let it continue in background
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

    stopLibraryPolling() {
      if (this._libPollTimer) {
        clearTimeout(this._libPollTimer);
        this._libPollTimer = null;
      }
    },

    async startLibraryRefresh() {
      if (this._libBusy) return;

      this.stopLibraryPolling();
      this.libraryProgressText = '';
      this._libTaskId = null;
      this._libBusy = true;

      const res = await emby.refreshLib();
      if (res?.status === 'hasTask') {
        this._libTaskId = res.taskId;
        this.libraryProgressText = 'Refreshing...';
        void this.pollLibraryStatus();
        return;
      }

      this._libBusy = false;
      if (res?.status && res.status !== 'notask') {
        this.libraryProgressText = String(res.status);
      }
    },

    async pollLibraryStatus() {
      if (!this._libTaskId) {
        this._libBusy = false;
        return;
      }

      const res = await emby.taskStatus(this._libTaskId);
      if (res?.status === 'refreshing') {
        if (Number.isFinite(Number(res?.progress))) {
          this.libraryProgressText = `${Number(res.progress).toFixed(0)}%`;
        } else if (res?.taskStatus) {
          this.libraryProgressText = String(res.taskStatus);
        } else {
          this.libraryProgressText = 'Refreshing...';
        }

        this._libPollTimer = setTimeout(() => {
          void this.pollLibraryStatus();
        }, 2000);
        return;
      }

      this._libBusy = false;
      this._libTaskId = null;
      if (res?.status === 'refreshdone') {
        // Always keep a completion indicator; only clear on a fresh pane load.
        this.libraryProgressText = '100%';
        // Emit event to trigger show list refresh
        evtBus.emit('library-refresh-complete');
      } else if (res?.status) {
        this.libraryProgressText = String(res.status);
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
      
      // Determine if we should use fast polling
      let pollInterval = ms;
      if (this._fastPollStartTime) {
        const elapsed = Date.now() - this._fastPollStartTime;
        if (elapsed < 30000) {
          // Still within 30-second fast polling window
          pollInterval = 1000;
        } else {
          // Timeout reached, go back to normal polling
          this._fastPollStartTime = null;
          pollInterval = 5000;
        }
      }
      
      this._pollTimer = setTimeout(() => {
        void this.loadTvproc();
        this.scheduleNextPoll(5000);
      }, pollInterval);
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

      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${month}/${day} ${hh}:${mm}:${ss}`;
    },

    fmtHhmm(ts) {
      const n = Number(ts);
      if (!Number.isFinite(n) || n <= 0) return '';

      // Accept seconds or milliseconds.
      const ms = n > 1e12 ? n : n * 1000;
      const d = new Date(ms);
      if (Number.isNaN(d.getTime())) return '';

      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
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

    fmtEtaRemaining(eta) {
      const n = Number(eta);
      if (!Number.isFinite(n) || n <= 0) return '';
      
      // If it's a large number (Unix timestamp), calculate remaining time from now
      const now = Math.floor(Date.now() / 1000);
      const remaining = n > 10000000 ? Math.max(0, n - now) : n;
      
      const mins = Math.floor(remaining / 60);
      const secs = Math.floor(remaining % 60);
      return `${mins}:${String(secs).padStart(2, '0')}`;
    },

    fmtEtaTimestamp(eta) {
      const n = Number(eta);
      if (!Number.isFinite(n) || n <= 0) return '';
      
      // If it's a large number (Unix timestamp), format as time only
      if (n > 10000000) {
        const d = new Date(n * 1000);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
      }
      return '';
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
      const progress = Number(it?.progress);

      // For future status, only show size
      if (status === 'future') {
        const parts = [];
        if (size) parts.push(size);
        parts.push('Future');
        return { seasonEpisode, rest: parts.join(' | ') };
      }

      const parts = [];
      if (size) parts.push(size);
      if (started) parts.push(started);

      if (status === 'finished') {
        const elapsed = this.fmtElapsedMmSs(this.elapsedSeconds(it));
        if (elapsed) parts.push(elapsed);
        parts.push('Finished');
        return { seasonEpisode, rest: parts.join(' | ') };
      }

      if (status === 'downloading') {
        if (ended) parts.push(ended);
        const eta = this.fmtEtaRemaining(it?.eta);
        if (eta) parts.push(eta);
        const etaTimestamp = this.fmtEtaTimestamp(it?.eta);
        if (etaTimestamp) parts.push(etaTimestamp);
        if (Number.isFinite(progress) && progress >= 0 && progress <= 100) {
          parts.push(`${progress}%`);
        }
        parts.push('Downloading');
        return { seasonEpisode, rest: parts.join(' | ') };
      }

      if (ended) parts.push(ended);
      if (status) parts.push(status);
      else parts.push('Unknown');
      return { seasonEpisode, rest: parts.join(' | ') };
    },

    async handleForceFile(title) {
      if (!title) return;
      try {
        const encodedTitle = encodeURIComponent(title);
        const url = `${config.torrentsApiUrl}/api/tvproc/forceFile?title=${encodedTitle}`;
        const res = await fetch(url, {
          method: 'GET',
          mode: 'cors'
        });
        if (!res.ok) {
          const text = await res.text();
          console.error(`forceFile failed: HTTP ${res.status}`, text);
        }
      } catch (e) {
        console.error('forceFile error:', e);
      }
    },

    getCardStyle(it) {
      const status = String(it?.status || '').trim();
      const isFuture = status === 'future';
      const isDownloading = status === 'downloading';
      return {
        position: 'relative',
        border: '1px solid #ddd',
        borderRadius: '8px',
        padding: '10px',
        background: isDownloading ? '#fffacd' : '#fff',
        cursor: isFuture ? 'pointer' : 'default'
      };
    },

    handleMouseEnter(event, it) {
      const status = String(it?.status || '').trim();
      if (status === 'future') {
        event.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
      }
    },

    handleMouseLeave(event) {
      event.currentTarget.style.boxShadow = 'none';
    },

    handleCardClick(it) {
      const clickedTitle = it?.title;
      if (clickedTitle) evtBus.emit('selectShowFromCardTitle', clickedTitle);

      const status = String(it?.status || '').trim();
      if (status === 'future') {
        const title = it?.title;
        if (title) {
          this.clickedFutures.add(title);
          void this.handleForceFile(title);
        }
      }
    },

    isFutureClicked(it) {
      const status = String(it?.status || '').trim();
      if (status !== 'future') return false;
      const title = it?.title;
      return title && this.clickedFutures.has(title);
    },

    showFirstDownloading() {
      const downloading = this.items.find(it => String(it?.status || '').trim() === 'downloading');
      if (!downloading) return;
      
      const scroller = this.$refs.scroller;
      if (!scroller) return;
      
      // Find the index of the downloading item in orderedItems
      const idx = this.orderedItems.findIndex(it => it === downloading);
      if (idx === -1) return;
      
      // Get all card divs (direct children of the template v-for)
      const allChildren = Array.from(scroller.children);
      // Filter out separator divs (which have === in text)
      const cards = allChildren.filter(el => !el.textContent.includes('===='));
      
      if (cards[idx]) {
        cards[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
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
        const res = await fetch('https://hahnca.com/tvproc/clearCache', {
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
        // Immediately reload to show cleared data
        this.items = [];
        await this.loadTvproc({ forceScrollToBottom: true });
      } catch (e) {
        this.error = e?.message || String(e);
      }
    },

    async loadTvproc(opts = {}) {
      this.error = null;
      this.startLoadingDelay();
      try {
        const initializing = !this._tvprocInitialized;
        const el = this.$refs.scroller;
        // Only auto-scroll if: 1) explicitly requested, or 2) not initial switch AND near bottom
        const wasNearBottom = !opts.isInitialPaneSwitch && el && this.isNearBottom(el);
        const shouldStick = Boolean(opts.forceScrollToBottom) || wasNearBottom;

        const res = await fetch('https://hahnca.com/tvproc/downloads');
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
        
        // Track status changes for downloading items
        const oldDownloading = Array.isArray(this.items) ? this.items.filter(it => String(it?.status || '').trim() === 'downloading') : [];
        const newDownloading = Array.isArray(arr) ? arr.filter(it => String(it?.status || '').trim() === 'downloading') : [];

        // Detect newly-finished items since last poll.
        // dateEnded is expected to be epoch seconds (or ms); treat both.
        const toSeconds = (n) => {
          const x = Number(n);
          if (!Number.isFinite(x) || x <= 0) return 0;
          return x > 1e12 ? Math.floor(x / 1000) : Math.floor(x);
        };
        const finishedEndedMax = Array.isArray(arr)
          ? arr
              .filter(it => String(it?.status || '').trim() === 'finished')
              .reduce((mx, it) => Math.max(mx, toSeconds(it?.dateEnded)), 0)
          : 0;
        let didFinishSomething = finishedEndedMax > Number(this._lastFinishedEnded || 0);

        // On the first successful load, establish a baseline so we don't
        // notify for historical "finished" items already present.
        if (initializing) {
          this._tvprocInitialized = true;
          this._lastFinishedEnded = finishedEndedMax;
          didFinishSomething = false;
        }
        
        // (debug logging removed)
        
        // Check if download started during fast polling
        if (this._fastPollStartTime && newDownloading.length > this._oldDownloadingCount) {
          this._fastPollStartTime = null;
        }
        
        // If a download finished and nothing is downloading, trigger cycle.
        // Notify when we observe a new finished item (since baseline) and nothing is downloading.
        if (!initializing && newDownloading.length === 0 && (oldDownloading.length > 0 || didFinishSomething)) {
          const lastTitle = String(oldDownloading?.[oldDownloading.length - 1]?.title || '').trim();
          this.notifyAllUsbFinished(lastTitle);

          // Call cycle endpoint to start next download
          try {
            await fetch('https://hahnca.com/tvproc/startProc', {
              method: 'POST'
            });
          } catch (e) {
            // Silently ignore
          }

          evtBus.emit('cycle-started');
        }

        // Update last-finished timestamp after processing.
        if (finishedEndedMax > Number(this._lastFinishedEnded || 0)) {
          this._lastFinishedEnded = finishedEndedMax;
        }
        
        this.items = arr;
        const isFirstLoad = !this._didLoadOnce;
        this._didLoadOnce = true;

        await this.$nextTick();
        const el2 = this.$refs.scroller;
        
        // Scroll to bottom on very first load ever
        if (isFirstLoad && !this._hasEverMounted) {
          this._hasEverMounted = true;
          this.scrollToBottom(el2);
        } else if (shouldStick) {
          this.scrollToBottom(el2);
        }
        // Don't touch scroll position otherwise - v-show preserves it naturally
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
