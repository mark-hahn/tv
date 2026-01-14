<template lang="pug">
.torrents-container(:style="{ height:'100%', width:'100%', display:'flex', justifyContent:'flex-start' }")
  #torrents(
    ref="scroller"
    :style="{ height:'100%', width:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', boxSizing:'border-box', backgroundColor:'#fafafa' }"
    @wheel.stop.prevent="handleScaledWheel"
  )

    #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'10px', marginLeft:'0px', marginRight:'0px', marginTop:'-10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'0px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
      div(style="display:flex; justify-content:space-between; align-items:center;")
        div(style="margin-left:20px;") {{ headerShowName }}
        div(style="display:flex; gap:8px; margin-left:auto;")
          button(v-if="selectedTorrent" @click.stop="continueDownload" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px; border:1px solid #bbb; background-color:whitesmoke;") Get
          button(v-if="selectedTorrent" @click.stop="openDetails" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px; border:1px solid #bbb; background-color:whitesmoke;") Tab
          button(@click.stop="searchClick" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px; border:1px solid #bbb; background-color:whitesmoke;") Search
          button(@click.stop="forceClick" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px; border:1px solid #bbb; background-color:whitesmoke;") Force
          button(@click.stop="toggleCookieInputs" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px; border:1px solid #bbb; background-color:whitesmoke;") Cookies
          button(@click.stop="toggleDebug" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px; border:1px solid #bbb; background-color:whitesmoke;") Debug

      div(style="height:1px; width:100%; background-color:#ddd; margin-top:6px;")

      div(style="margin-left:20px; margin-right:20px; margin-top:6px; font-weight:normal; font-size:15px; color:#666; display:block; line-height:1.1; overflow:visible;")
        div(style="display:flex; align-items:center; justify-content:flex-start; gap:25px; white-space:nowrap;")
          div(style="display:flex")
            div() USB:
            table(style="border-collapse:separate; border-spacing:15px 0;")
              tbody
                tr
                  td(style="text-align:right; padding:0;")
                    span {{ spaceUsbGb }} GB
                  td(style="text-align:right; padding:0;")
                    span {{ spaceUsbPct }}
          div(style="display:flex;")
            div() SRVR:
            table(style="border-collapse:separate; border-spacing:15px 0;")
              tbody
                tr
                  td(style="text-align:right; padding:0;")
                    span {{ spaceSrvrGb }} GB
                  td(style="text-align:right; padding:0;")
                    span {{ spaceSrvrPct }}

    #unaired(v-if="unaired" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
      div Show not aired yet
      
    #cookie-inputs(@click.stop v-if="!loading && ((isCookieRelatedError && !dismissCookieInputs) || showCookieInputs)" style="position:sticky; top:120px; zIndex:120; padding:15px 20px 15px 20px; margin-bottom:10px; background:#fff; border-radius:5px; border:1px solid #ddd;")
      div(style="margin-bottom:10px;")
        label(style="display:block; font-size:12px; font-weight:bold; margin-bottom:3px; color:#555;") IPTorrents cf_clearance:
        input(v-model="iptCfClearance" type="text" placeholder="Paste cf_clearance cookie value" style="width:100%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:3px; box-sizing:border-box;")
      div(style="margin-bottom:10px;")
        label(style="display:block; font-size:12px; font-weight:bold; margin-bottom:3px; color:#555;") TorrentLeech cf_clearance:
        input(v-model="tlCfClearance" type="text" placeholder="Paste cf_clearance cookie value" style="width:100%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:3px; box-sizing:border-box;")
      div(style="margin-top:10px;")
        button(@click.stop="saveCookies" :disabled="loading" style="padding:8px 20px; font-size:13px; font-weight:bold; cursor:pointer; border-radius:5px; background:#4CAF50; color:white; border:none; width:100%;") 
          | Save Cookies

    #debug-panel(@click.stop v-if="!loading && showDebug" style="position:sticky; top:120px; zIndex:119; padding:12px 16px; margin-bottom:10px; background:#fff; border-radius:5px; border:1px solid #ddd; font-weight:normal;")
      div(style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;")
        div(style="font-weight:bold; color:#444; font-size:12px;") Debug
        div(style="display:flex; gap:8px; align-items:center;")
          button(v-if="lastSearchUrl" @click.stop="copyDebugUrl" style="font-size:12px; cursor:pointer; border-radius:6px; padding:2px 8px; border:1px solid #bbb; background-color:whitesmoke;") Copy URL
          button(@click.stop="showDebug=false" style="font-size:12px; cursor:pointer; border-radius:6px; padding:2px 8px; border:1px solid #bbb; background-color:whitesmoke;") Close
      div(style="font-size:12px; color:#555; line-height:1.35; white-space:pre-wrap; overflow-wrap:anywhere;")
        div(v-if="debugCopyMsg" style="color:#2b6; margin-bottom:6px;") {{ debugCopyMsg }}
        div(v-if="lastSearchShow")
          span(style="font-weight:bold;") show:
          |  {{ lastSearchShow }}
        div(v-if="lastSearchNeeded")
          span(style="font-weight:bold;") needed:
          |  {{ lastSearchNeeded }}
        div(v-if="lastSearchUrl")
          span(style="font-weight:bold;") url:
          |  {{ lastSearchUrl }}
        div(v-if="lastApiCount !== null")
          span(style="font-weight:bold;") api count:
          |  {{ lastApiCount }}
        div(v-if="lastRawProviderCounts")
          span(style="font-weight:bold;") rawProviderCounts:
          |  {{ formatJsonInline(lastRawProviderCounts) }}
        div(v-if="lastReturnedProviderCounts")
          span(style="font-weight:bold;") returnedProviderCounts:
          |  {{ formatJsonInline(lastReturnedProviderCounts) }}
        div(v-if="lastWarningSummary")
          span(style="font-weight:bold;") warningSummary:
          |  {{ formatJsonInline(lastWarningSummary) }}

    

    #loading(v-if="!unaired && loading" style="text-align:center; color:#666; margin-top:50px; font-size:16px;")
      div Searching for torrents...
      
    #error(v-if="!unaired && error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px; white-space:pre-line; padding:0 20px;")
      div Error: {{ error }}
    #warning(v-if="!unaired && !error && providerWarning" style="text-align:center; color:#b36b00; margin-top:20px; font-size:14px; white-space:pre-line; padding:0 20px;")
      div {{ providerWarning }}
      
    #no-torrents-needed(v-if="!unaired && noTorrentsNeeded && !loading && !error" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
      div No torrents needed.
      
    #torrents-list(v-if="!unaired && !loading && !noTorrentsNeeded" style="padding:10px; font-size:14px; font-family:sans-serif; font-weight:normal;")
      div(v-if="!hasSearched && filteredTorrents.length === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
        div Click on Search to find torrents for {{ headerShowName }}.
      div(v-else-if="hasSearched && filteredTorrents.length === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
        div No torrents found.
      div(v-for="(torrent, index) in filteredTorrents" :key="getTorrentCardKey(torrent, index)" @click="handleTorrentClick($event, torrent)" @click.stop :style="getCardStyle(torrent)" @mouseenter="$event.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.15)'" @mouseleave="$event.currentTarget.style.boxShadow='none'")
        div(v-if="isClicked(torrent)" style="position:absolute; top:8px; right:8px; color:#4CAF50; font-size:20px; font-weight:bold;") ✓
        div(v-if="isDownloadedBefore(torrent)" :style="getDownloadedBeforeIconStyle(torrent)" title="Downloaded before") 🕘
        div(v-if="getDownloadStatus(torrent)" :title="getDownloadStatusTooltip(torrent)" style="position:absolute; bottom:8px; right:8px; font-size:11px; color:#666; max-width:70%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;") {{ getDownloadStatusLabel(torrent) }}
        div(v-if="SHOW_TITLE && torrent.raw" style="font-size:14px; font-weight:bold; color:#888; margin-bottom:4px; white-space:normal; overflow-wrap:anywhere; word-break:break-word; font-family:sans-serif;") {{ getDisplayTitleWithProvider(torrent) }}
        div(v-if="getTorrentWarnings(torrent).length > 0" style="font-size:11px; color:#a33; margin-bottom:4px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;")
          | Warnings: {{ formatTorrentWarnings(torrent) }}
        div(style="margin-top:8px; font-size:13px; font-family:sans-serif; color:#333;") 
          span(style="color:blue !important;") {{ getDisplaySeasonEpisode(torrent) }}
          span(style="color:rgba(0,0,0,0.50) !important;")
            | : {{ fmtSize(torrent.raw?.size) || torrent.raw?.size || 'N/A' }} | {{ torrent.raw?.seeds || 0 }} seeds
            span(v-if="torrent.raw?.provider" style="color:rgba(0,0,0,0.50) !important;") &nbsp;|&nbsp;{{ formatProvider(torrent.raw.provider) }}
            span(v-if="torrent.parsed?.resolution" style="color:rgba(0,0,0,0.50) !important;") &nbsp;|&nbsp;{{ torrent.parsed.resolution }}
            span(v-if="torrent.parsed?.group" style="color:rgba(0,0,0,0.50) !important;") &nbsp;|&nbsp;{{ formatGroup(torrent.parsed.group) }}

  #download-modal(v-if="showModal" @click.stop="showModal = false" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:10000;")
    #modal-content(@click.stop style="background:white; padding:30px; border-radius:10px; max-width:500px; box-shadow:0 4px 20px rgba(0,0,0,0.3);")
      div(style="font-size:16px; margin-bottom:20px; line-height:1.5;") Is it OK to download file 
        span(style="font-weight:bold;") {{ selectedTorrent?.raw?.title || 'Unknown' }}
        | ?
      div(style="display:flex; gap:10px; justify-content:flex-end;")
        button(@click.stop="cancelDownload" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; border:1px solid #ccc; background:white;") Cancel
        button(@click.stop="continueDownload" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; border:1px solid #ccc; background:white;") OK

  #error-modal(v-if="showErrorModal" @click.stop="closeErrorModal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:10000;")
    #modal-content(@click.stop style="background:white; padding:30px; border-radius:10px; max-width:520px; box-shadow:0 4px 20px rgba(0,0,0,0.3);")
      div(style="font-size:16px; margin-bottom:20px; line-height:1.5; white-space:pre-line;") {{ errorModalMsg }}
      div(style="display:flex; gap:10px; justify-content:flex-end;")
        button(@click.stop="closeErrorModal" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; border:1px solid #ccc; background:white;") OK

  #existing-delete-modal(v-if="showExistingDeleteModal" @click.stop="cancelExistingDelete" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:10000;")
    #modal-content(@click.stop style="background:white; padding:30px; border-radius:10px; max-width:520px; box-shadow:0 4px 20px rgba(0,0,0,0.3);")
      div(style="font-size:16px; margin-bottom:20px; line-height:1.5; white-space:pre-line;") {{ existingDeleteModalMsg }}
      div(style="display:flex; gap:10px; justify-content:flex-end;")
        button(@click.stop="cancelExistingDelete" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; border:1px solid #ccc; background:white;") Cancel
        button(@click.stop="confirmExistingDelete" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; border:1px solid #ccc; background:white;") Delete


</template>

<script>
import evtBus from '../evtBus.js';
import * as emby from '../emby.js';
import * as util from '../util.js';
import { config } from '../config.js';

export default {
  name: "Torrents",
  
  props: {
    simpleMode: {
      type: Boolean,
      default: false
    },
    activeShow: {
      type: Object,
      default: null
    },
    sizing: {
      type: Object,
      default: () => ({})
    }
  },

  data() {
    return {
      torrents: [],
      showName: '',
      loading: false,
      error: null,
      hasSearched: false,
      providerWarning: '',
      maxResults: 1000,  // Constant for maximum results to fetch
      iptCfClearance: '',
      tlCfClearance: '',
      currentShow: null,
      SHOW_TITLE: true,  // Show torrent title on card
      selectedTorrent: null,  // Currently selected torrent
      showModal: false,  // Show download confirmation modal
      showErrorModal: false,
      errorModalMsg: '',

      showExistingDeleteModal: false,
      existingDeleteModalMsg: '',
      existingDeleteWrapper: null,
      existingDeleteResolve: null,
      clickedTorrents: new Set(),  // Track which torrents have been clicked
      downloadedTorrents: new Set(),  // Track which torrents have been downloaded via Get button
      noTorrentsNeeded: false,  // Flag when needed array is empty
      showCookieInputs: false,  // Manual toggle for cookie input boxes
      dismissCookieInputs: false,
      unaired: false,

      lastNeeded: null,

      downloadedByHash: {},

      // Space display cells (2x2): rows USB/SRVR, cols GB/%.
      spaceUsbGb: '--',
      spaceUsbPct: '--%',
      spaceSrvrGb: '--',
      spaceSrvrPct: '--%',

      _didInitialScroll: false,

      // Debug: last search request/response metadata
      showDebug: false,
      lastSearchUrl: '',
      lastSearchShow: '',
      lastSearchNeeded: '',
      lastRawProviderCounts: null,
      lastReturnedProviderCounts: null,
      lastApiCount: null,
      lastWarningSummary: null,
      debugCopyMsg: '',

      // Download queue/state (avoid dropped requests + show per-torrent results)
      downloadQueue: [],
      downloadQueueRunning: false,
      downloadStatus: {}
    };
  },

  computed: {
    headerShowName() {
      return (
        this.showName ||
        this.currentShow?.Name ||
        this.activeShow?.Name ||
        ''
      );
    },
    filteredTorrents() {
      // Show all results (including 0-seed) so “dead” torrents are still visible.
      // Sort seeded torrents to the top, but push warning torrents to the bottom.
      const asNumber = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      const hasWarn = (t) => this.getTorrentWarnings(t).length > 0;

      return (Array.isArray(this.torrents) ? this.torrents : [])
        .slice()
        .sort((a, b) => {
          const wa = hasWarn(a) ? 1 : 0;
          const wb = hasWarn(b) ? 1 : 0;
          if (wa !== wb) return wa - wb;

          const sd = asNumber(b?.raw?.seeds) - asNumber(a?.raw?.seeds);
          if (sd !== 0) return sd;

          const ta = String(a?.raw?.title || a?.title || '');
          const tb = String(b?.raw?.title || b?.title || '');
          return ta.localeCompare(tb);
        });
    },
    trackerCounts() {
      const counts = {};
      this.torrents.forEach(torrent => {
        const provider = torrent.raw?.provider || 'Unknown';
        counts[provider] = (counts[provider] || 0) + 1;
      });
      return counts;
    },
    isCookieRelatedError() {
      // Also show for explicit cookie-related errors even if we got some results
      if (this.error) {
        const errorLower = this.error.toLowerCase();
        return errorLower.includes('cf_clearance') || 
               errorLower.includes('access denied') || 
               errorLower.includes('403') || 
               errorLower.includes('401') || 
               errorLower.includes('forbidden');
      }
      
      return false;
    }
  },

  mounted() {
    evtBus.on('paneChanged', this.onPaneChanged);
    evtBus.on('showTorrents', this.searchTorrents);
    evtBus.on('resetTorrentsPane', this.resetPane);
    evtBus.on('refreshSpaceAvail', this.onRefreshSpaceAvail);

    this.loadDownloadedHistory();

    // App-load refresh: populate space strings as soon as the component mounts.
    void this.updateSpaceAvail();

    // Establish an initial "bottom" baseline on app load.
    // v-show preserves scroll position even when hidden.
    void this.$nextTick(() => {
      this.scrollToBottom();
    });
  },

  unmounted() {
    evtBus.off('paneChanged', this.onPaneChanged);
    evtBus.off('showTorrents', this.searchTorrents);
    evtBus.off('resetTorrentsPane', this.resetPane);
    evtBus.off('refreshSpaceAvail', this.onRefreshSpaceAvail);
  },

  methods: {
    toggleDebug() {
      this.showDebug = !this.showDebug;
    },
    async copyDebugUrl() {
      const text = String(this.lastSearchUrl || '').trim();
      if (!text) return;

      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.left = '-9999px';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        this.debugCopyMsg = 'Copied URL to clipboard';
      } catch {
        this.debugCopyMsg = 'Copy failed (clipboard blocked)';
      }

      window.clearTimeout(this._debugCopyTimer);
      this._debugCopyTimer = window.setTimeout(() => {
        this.debugCopyMsg = '';
      }, 1500);
    },
    formatJsonInline(obj) {
      try {
        return JSON.stringify(obj);
      } catch {
        return String(obj);
      }
    },
    getTorrentWarnings(torrent) {
      const w = torrent?.warnings ?? torrent?.raw?.warnings;
      return Array.isArray(w) ? w : [];
    },
    formatTorrentWarnings(torrent) {
      const warnings = this.getTorrentWarnings(torrent);
      if (!warnings.length) return '';

      return warnings
        .map(w => {
          const code = String(w?.code || '').trim();
          const msg = String(w?.message || '').trim();
          if (code && msg && msg.toLowerCase() !== code.toLowerCase()) return `${code} (${msg})`;
          return code || msg || '';
        })
        .filter(Boolean)
        .join(', ');
    },
    fmtSize(bytesOrHumanString) {
      return util.fmtBytesSize(bytesOrHumanString);
    },
    handleScaledWheel(event) {
      if (!event) return;
      const el = event.currentTarget;
      if (!el) return;
      const dy = (event.deltaY || 0);
      const scaledDy = dy * 0.125;
      const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      el.scrollTop = Math.max(0, Math.min(max, (el.scrollTop || 0) + scaledDy));
    },

    onPaneChanged(pane) {
      if (pane === 'torrents') {
        // Keep space info fresh whenever Tor pane is shown.
        void this.updateSpaceAvail();
      }
    },

    onRefreshSpaceAvail() {
      void this.updateSpaceAvail();
    },
    openDetails() {
      const url = this.selectedTorrent?.detailUrl;
      if (url) window.open(url, '_blank');
    },

    showError(msg) {
      this.errorModalMsg = String(msg || '');
      this.showErrorModal = true;
    },

    closeErrorModal() {
      this.showErrorModal = false;
      this.errorModalMsg = '';
    },

    confirmExistingDownloads(msg, wrapper) {
      this.existingDeleteModalMsg = String(msg || '');
      this.existingDeleteWrapper = (wrapper && typeof wrapper === 'object') ? wrapper : null;
      this.showExistingDeleteModal = true;
      return new Promise((resolve) => {
        this.existingDeleteResolve = resolve;
      });
    },

    cancelExistingDelete() {
      this.showExistingDeleteModal = false;
      this.existingDeleteModalMsg = '';
      this.existingDeleteWrapper = null;
      const resolve = this.existingDeleteResolve;
      this.existingDeleteResolve = null;
      if (typeof resolve === 'function') resolve(false);
    },

    confirmExistingDelete() {
      this.showExistingDeleteModal = false;
      const resolve = this.existingDeleteResolve;
      this.existingDeleteResolve = null;
      if (typeof resolve === 'function') resolve(true);
    },

    async deleteProcids(wrapper) {
      const payload = (wrapper && typeof wrapper === 'object') ? wrapper : null;
      if (!payload) return false;

      const url = 'https://hahnca.com/tvproc/deleteProcids';
      let res;
      try {
        res = await this.fetchWithTimeout(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }, 60000);
      } catch (e) {
        this.showError(e?.message || String(e));
        return false;
      }

      if (!res?.ok) {
        let detail = '';
        try {
          const ct = (res?.headers?.get?.('content-type') || '').toLowerCase();
          if (ct.includes('application/json')) {
            const j = await res.json();
            detail = j?.error ? String(j.error) : (j?.message ? String(j.message) : JSON.stringify(j));
          } else {
            detail = await res.text();
          }
        } catch {
          // ignore
        }
        this.showError(detail || `HTTP ${res?.status || ''}: ${res?.statusText || 'delete failed'}`);
        return false;
      }

      return true;
    },
    getScroller() {
      return this.$refs.scroller || null;
    },

    scrollToBottom() {
      const el = this.getScroller();
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    },
    downloadHistoryKey() {
      return 'downloadedTorrentHashes';
    },

    downloadHistoryWindowMs() {
      return 60 * 24 * 60 * 60 * 1000;
    },

    loadDownloadedHistory() {
      let parsed = {};
      try {
        const raw = localStorage.getItem(this.downloadHistoryKey());
        if (raw) {
          const j = JSON.parse(raw);
          if (j && typeof j === 'object' && !Array.isArray(j)) parsed = j;
        }
      } catch {
        // ignore
      }
      this.downloadedByHash = parsed;
      this.pruneDownloadedHistory();
    },

    saveDownloadedHistory() {
      try {
        localStorage.setItem(this.downloadHistoryKey(), JSON.stringify(this.downloadedByHash || {}));
      } catch {
        // ignore
      }
    },

    pruneDownloadedHistory() {
      const now = Date.now();
      const cutoff = now - this.downloadHistoryWindowMs();
      const map = (this.downloadedByHash && typeof this.downloadedByHash === 'object') ? this.downloadedByHash : {};
      const next = {};
      for (const [k, ts] of Object.entries(map)) {
        const t = Number(ts);
        if (Number.isFinite(t) && t >= cutoff) next[k] = t;
      }
      const changed = Object.keys(next).length !== Object.keys(map).length;
      if (changed) this.downloadedByHash = next;
      if (changed) this.saveDownloadedHistory();
    },

    extractBtih(str) {
      const s = String(str || '');
      if (!s) return '';
      const m = /xt=urn:btih:([a-zA-Z0-9]+)/.exec(s) || /btih:([a-zA-Z0-9]+)/.exec(s);
      return m?.[1] ? String(m[1]).toLowerCase() : '';
    },

    getTorrentHash(torrent) {
      const direct = torrent?.raw?.infoHash || torrent?.raw?.info_hash || torrent?.raw?.hash || torrent?.hash;
      if (typeof direct === 'string' && direct) return direct.toLowerCase();

      const magnet = torrent?.raw?.magnet || torrent?.raw?.magnetLink || torrent?.raw?.link;
      if (typeof magnet === 'string' && magnet) {
        const h = this.extractBtih(magnet);
        if (h) return h;
      }
      return '';
    },

    buildTorrentUploadFilename(torrent, fallbackTitle) {
      // qBittorrent's "watched folder" can miss modified/overwritten files.
      // Ensure each upload writes a *new* file by suffixing a stable unique token.
      const baseIn = String(torrent?.raw?.filename || fallbackTitle || torrent?.raw?.title || torrent?.title || 'download').trim();
      const hash = this.getTorrentHash(torrent);
      const suffix = hash ? hash.slice(0, 10) : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

      // Windows-safe filename (server may run on Windows and write to disk).
      let base = baseIn
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/[\u0000-\u001f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Remove extension so we can control it.
      base = base.replace(/\.torrent$/i, '');
      if (!base) base = 'download';

      // Keep filenames reasonably short to avoid filesystem/path limits.
      const maxBaseLen = 150;
      if (base.length > maxBaseLen) base = base.slice(0, maxBaseLen).trim();

      return `${base}-${suffix}.torrent`;
    },

    getTorrentHistoryKey(torrent) {
      // Prefer hash; fall back to the title (as-is).
      const hash = this.getTorrentHash(torrent);
      if (hash) return hash;

      const title = torrent?.raw?.title || torrent?.title || '';
      const titleStr = typeof title === 'string' ? title : String(title || '');
      const provider = String(torrent?.raw?.provider || '').trim().toLowerCase();

      // Titles can collide across providers (IPT/TL). Include provider in the identity.
      return provider ? `${titleStr}::${provider}` : titleStr;
    },

    getTorrentHistoryKeys(torrent) {
      const keys = [];
      const add = (k) => {
        const s = String(k || '');
        if (!s) return;
        if (!keys.includes(s)) keys.push(s);
      };

      const hash = this.getTorrentHash(torrent);
      if (hash) add(hash);

      const titleRaw = torrent?.raw?.title || torrent?.title || '';
      const titleStr = typeof titleRaw === 'string' ? titleRaw : String(titleRaw || '');
      const titleTrim = titleStr.trim();
      const provider = String(torrent?.raw?.provider || '').trim().toLowerCase();

      // Legacy keys (historically stored as-is).
      if (provider) add(`${titleStr}::${provider}`);
      add(titleStr);

      // Normalized variants (fixes missing history icons when titles differ only by
      // punctuation/separators/case/whitespace or when provider field is missing).
      const norm = this.normalizeQbtNameForMatch(titleTrim);
      if (provider && norm) add(`${norm}::${provider}`);
      if (provider && titleTrim) add(`${titleTrim}::${provider}`);
      if (titleTrim) add(titleTrim);
      if (norm) add(norm);

      return keys;
    },

    getTorrentNowKey(torrent) {
      // Key used for "downloaded now" highlighting. Must disambiguate identical titles across providers.
      return this.getTorrentHistoryKey(torrent);
    },

    getTorrentCardKey(torrent, index) {
      // Stable key to prevent DOM reuse glitches when multiple providers return the same title.
      return String(torrent?.detailUrl || this.getTorrentNowKey(torrent) || index);
    },

    getDisplayTitleWithProvider(torrent) {
      const title = String(torrent?.raw?.title || torrent?.title || '').trim();
      const provider = String(torrent?.raw?.provider || '').trim();
      if (!provider) return title;
      return `${title} | ${this.formatProvider(provider)}`;
    },

    rememberDownloadedTorrent(torrent) {
      const keys = this.getTorrentHistoryKeys(torrent);
      if (!keys.length) return;
      const now = Date.now();
      const map = (this.downloadedByHash && typeof this.downloadedByHash === 'object') ? this.downloadedByHash : {};
      // Reassign for reliable reactivity.
      const next = { ...map };
      for (const k of keys) next[k] = now;
      this.downloadedByHash = next;
      this.pruneDownloadedHistory();
      this.saveDownloadedHistory();
    },

    isDownloadedBefore(torrent) {
      const keys = this.getTorrentHistoryKeys(torrent);
      if (!keys.length) return false;
      const cutoff = Date.now() - this.downloadHistoryWindowMs();
      for (const k of keys) {
        const ts = Number(this.downloadedByHash?.[k]);
        if (Number.isFinite(ts) && ts >= cutoff) return true;
      }
      return false;
    },

    getDownloadedBeforeIconStyle(torrent) {
      const right = this.isClicked(torrent) ? 32 : 8;
      return {
        position: 'absolute',
        top: '10px',
        right: `${right}px`,
        color: '#888',
        fontSize: '16px'
      };
    },
    resetPane() {
      this.selectedTorrent = null;
      this.showModal = false;
      this.clickedTorrents.clear();
      this.torrents = [];
      this.showName = '';
      this.loading = false;
      this.error = null;
      this.providerWarning = '';
      this.currentShow = null;
      this.noTorrentsNeeded = false;
      this.showCookieInputs = false;
      this.dismissCookieInputs = false;
      this.unaired = false;
      this.iptCfClearance = '';
      this.tlCfClearance = '';

      this._didInitialScroll = false;
    },

    handleClose() {
      // Do not reset pane state on close.
      this.$emit('close');
    },

    async getSpaceAvail() {
      const url = new URL(`${config.torrentsApiUrl}/api/space/avail`);
      const res = await fetch(url.toString());
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
          // ignore parse errors
        }
        throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
      }
      return res.json();
    },

    pctUsed(total, used) {
      const t = Number(total);
      const u = Number(used);
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return '--%';
      const pct = Math.ceil((u / t) * 100);
      return `${Math.max(0, Math.min(100, pct))}%`;
    },

    pctAvail(total, used) {
      const t = Number(total);
      const u = Number(used);
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return '--%';
      const avail = Math.max(0, t - u);
      const pct = Math.floor((avail / t) * 100);
      return `${Math.max(0, Math.min(100, pct))}%`;
    },

    fmtAvailGb(total, used) {
      const t = Number(total);
      const u = Number(used);
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return '--';
      const avail = Math.max(0, t - u);
      // df-style GB: df reports 1K-blocks; dividing by 1e6 yields “GB”.
      // Our API returns bytes, so bytes / 1_024_000_000 matches that convention.
      return String(Math.round(avail / 1_024_000_000));
    },

    async updateSpaceAvail() {
      try {
        const s = await this.getSpaceAvail();

        const hasUsb = Number.isFinite(Number(s?.usbSpaceTotal)) && Number.isFinite(Number(s?.usbSpaceUsed));
        const hasSrvr = Number.isFinite(Number(s?.mediaSpaceTotal)) && Number.isFinite(Number(s?.mediaSpaceUsed));
        if (!hasUsb && !hasSrvr) return;

        if (hasUsb) {
          this.spaceUsbPct = this.pctAvail(s?.usbSpaceTotal, s?.usbSpaceUsed);
          this.spaceUsbGb = this.fmtAvailGb(s?.usbSpaceTotal, s?.usbSpaceUsed);
        }
        if (hasSrvr) {
          this.spaceSrvrPct = this.pctAvail(s?.mediaSpaceTotal, s?.mediaSpaceUsed);
          this.spaceSrvrGb = this.fmtAvailGb(s?.mediaSpaceTotal, s?.mediaSpaceUsed);
        }
      } catch (e) {
        // On failure, show unknown placeholders, but don't clobber last-known-good values.
        const hasAnyDigits = (txt) => /\d/.test(String(txt || ''));
        if (!hasAnyDigits(this.spaceUsbGb)) this.spaceUsbGb = '???';
        if (!hasAnyDigits(this.spaceUsbPct)) this.spaceUsbPct = '???%';
        if (!hasAnyDigits(this.spaceSrvrGb)) this.spaceSrvrGb = '???';
        if (!hasAnyDigits(this.spaceSrvrPct)) this.spaceSrvrPct = '???%';
      }
    },


    saveCookies() {
      // Save only; do not start any torrent loading.
      const iptCf = this.extractCfClearance(this.iptCfClearance);
      const tlCf = this.extractCfClearance(this.tlCfClearance);

      // Also persist to local torrents server so Node/Playwright tools can use it.
      // Best-effort; ignore errors.
      try {
        void fetch(`${config.torrentsApiUrl}/api/cf_clearance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ipt_cf: iptCf || '',
            tl_cf: tlCf || '',
          }),
        });
      } catch {
        // ignore
      }

      // Always close the inputs when clicked, even if empty.
      this.showCookieInputs = false;
      this.dismissCookieInputs = true;

      // Don't retain potentially-stale values in UI state.
      this.iptCfClearance = '';
      this.tlCfClearance = '';
    },

    toggleCookieInputs() {
      this.dismissCookieInputs = false;
      this.showCookieInputs = !this.showCookieInputs;
    },

    handleMapButton() {
      const show = this.currentShow;
      if (show) {
        evtBus.emit('mapAction', { action: 'open', show });
      }
    },

    async searchTorrents(show) {
      // Reset state when switching shows
      this.torrents = [];
      this.error = null;
      this.hasSearched = false;
      this.selectedTorrent = null;
      this.clickedTorrents.clear();
      this.noTorrentsNeeded = false;
      this.providerWarning = '';
      this.loading = false;
      this.dismissCookieInputs = false;
      this.lastNeeded = null;
      this._didInitialScroll = false;

      // Kick off space fetch ASAP; don't wait for torrent searching.
      void this.updateSpaceAvail();

      this.unaired = !!show?.S1E1Unaired;
      if (this.unaired) {
        // Short-circuit: show only the unaired message
        this.currentShow = show;
        this.showName = show?.Name || '';
        return;
      }

      // (space fetch already started above)
      
      // Store the show for later use with Load button
      this.currentShow = show;
      if (show && show.Name) {
        this.showName = show.Name;
      }
      
      // Get series map and calculate needed episodes
      const needed = await this.calculateNeeded(show);
      this.lastNeeded = needed;
      
      // Check if needed array is truly empty (not 'loadall')
      if (needed.length === 0) {
        this.noTorrentsNeeded = true;
        return;
      }

      // Do not search automatically; wait for Search button.
    },

    async searchClick() {
      if ((!this.currentShow || !this.currentShow.Name) && this.activeShow?.Name) {
        this.currentShow = this.activeShow;
        this.showName = this.activeShow?.Name || this.showName;
      }

      if (!this.currentShow || !this.currentShow.Name) {
        this.error = 'No show selected';
        return;
      }

      if (this.unaired) {
        return;
      }

      this.noTorrentsNeeded = false;
      this.providerWarning = '';

      if (!Array.isArray(this.lastNeeded)) {
        try {
          this.lastNeeded = await this.calculateNeeded(this.currentShow);
        } catch {
          this.lastNeeded = [];
        }
      }

      if (Array.isArray(this.lastNeeded) && this.lastNeeded.length === 0) {
        this.noTorrentsNeeded = true;
        return;
      }

      this.hasSearched = true;
      await this.loadTorrents(this.lastNeeded || []);
    },

    async forceClick() {
      if ((!this.currentShow || !this.currentShow.Name) && this.activeShow?.Name) {
        this.currentShow = this.activeShow;
        this.showName = this.activeShow?.Name || this.showName;
      }

      if (!this.currentShow || !this.currentShow.Name) {
        this.error = 'No show selected';
        return;
      }
      if (this.unaired) return;

      this.noTorrentsNeeded = false;
      this.providerWarning = '';
      this.hasSearched = true;
      await this.loadTorrents(['force']);
    },

    async calculateNeeded(show) {
      const needed = [];
      
      // If not in Emby, return special marker
      if (!show || !show.Id || show.Id.startsWith('noemby-')) {
        return ['noemby'];
      }
      
      try {
        // Get series map (same way as list.vue does)
        const seriesMapIn = await emby.getSeriesMap(show);
        if (!seriesMapIn || seriesMapIn.length === 0) {
          return needed;
        }

        // (debug logging removed)
        
        // Build seriesMap object from array
        const seriesMap = util.buildSeriesMap(seriesMapIn);
        if (!seriesMap) {
          return needed;
        }


        
        // Scan for needed episodes
        let hasStartedWatching = false;
        
        // Check if ANY episode in the entire series has been watched
        const anyEpisodeWatched = Object.values(seriesMap).some(episodes =>
          Object.values(episodes).some(epiObj => epiObj.played)
        );
        
        // If nothing watched, start collecting from first episode with no file
        if (!anyEpisodeWatched) {
          hasStartedWatching = true;
        }
        
        for (const [seasonNumStr, episodes] of Object.entries(seriesMap)) {
          const seasonNum = parseInt(seasonNumStr);
          if (isNaN(seasonNum)) continue;
          
          // Check if season has any episodes with state
          const seasonHasState = Object.values(episodes).some(epiObj => {
            const { played, noFile, unaired, avail, deleted, error } = epiObj;
            return played || noFile || unaired || avail || deleted || error;
          });
          
          // Skip this entire season if no episodes have any state
          if (!seasonHasState) {
            continue;
          }
          
          const seasonNeeded = [];
          let allNeeded = true;
          let hasUnaired = false;
          let hasNoFile = false;
          
          // First pass: check if season has both unaired AND no file episodes
          for (const [episodeNumStr, epiObj] of Object.entries(episodes)) {
            const episodeNum = parseInt(episodeNumStr);
            if (isNaN(episodeNum)) continue;
            
            const { noFile, unaired } = epiObj;
            if (unaired) hasUnaired = true;
            if (noFile) hasNoFile = true;
          }
          
          // Determine if we should include individual episodes for this season
          const includeIndividualEpisodes = hasUnaired && hasNoFile;
          
          for (const [episodeNumStr, epiObj] of Object.entries(episodes)) {
            const episodeNum = parseInt(episodeNumStr);
            if (isNaN(episodeNum)) continue;
            
            const { played, noFile, unaired } = epiObj;
            
            // Stop if we hit an unaired episode (unless this season needs individual episodes)
            if (unaired) {
              // Process any accumulated season if any episodes were needed
              if (seasonNeeded.length > 0) {
                if (includeIndividualEpisodes) {
                  // Include all individual episodes for this season
                  seasonNeeded.forEach(ep => needed.push(ep));
                } else if (allNeeded) {
                  needed.push(`S${seasonNum.toString().padStart(2, '0')}`);
                } else {
                  needed.push(`S${seasonNum.toString().padStart(2, '0')}`);
                  seasonNeeded.forEach(ep => needed.push(ep));
                }
              }
              return needed; // Stop scanning
            }
            
            // Track if we've started watching
            if (played) {
              hasStartedWatching = true;
            }
            
            // Episode is needed if: started watching AND not played AND no file
            const isNeeded = hasStartedWatching && !played && noFile;
            
            if (isNeeded) {
              const epStr = `S${seasonNum.toString().padStart(2, '0')}E${episodeNum.toString().padStart(2, '0')}`;
              seasonNeeded.push(epStr);
            } else {
              allNeeded = false;
            }
          }
          
          // Add season if any episodes were needed
          if (seasonNeeded.length > 0 && hasStartedWatching) {
            if (includeIndividualEpisodes) {
              // Include all individual episodes (no season marker)
              seasonNeeded.forEach(ep => needed.push(ep));
            } else if (allNeeded) {
              // All episodes in season are needed - just add season
              needed.push(`S${seasonNum.toString().padStart(2, '0')}`);
            } else {
              // Some episodes needed - add season AND individual episodes
              needed.push(`S${seasonNum.toString().padStart(2, '0')}`);
              seasonNeeded.forEach(ep => needed.push(ep));
            }
          }
        }
        
      } catch (err) {
        // ignore
      }
      return needed;
    },

    extractCfClearance(input) {
      // Accept formats:
      // 1. cf_clearance:"value"
      // 2. cf_clearance: "value"
      // 3. "value"
      // 4. value
      if (!input) return '';
      
      const trimmed = input.trim();
      
      // Check for cf_clearance:"..." or cf_clearance: "..." format
      const match = trimmed.match(/^cf_clearance\s*:\s*"(.+)"$/);
      if (match) {
        return match[1];
      }
      
      // Check for quoted value
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
      }
      
      // Return as-is
      return trimmed;
    },

    async loadTorrents(needed = []) {
      if (!this.currentShow || !this.currentShow.Name) {
        this.error = 'No show selected';
        return;
      }

      this.loading = true;
      this.error = null;
      this.providerWarning = '';
      this.torrents = [];
      this.noTorrentsNeeded = false;
      this._didInitialScroll = false;

      // Reset debug metadata for this request
      this.lastRawProviderCounts = null;
      this.lastReturnedProviderCounts = null;
      this.lastApiCount = null;
      this.lastWarningSummary = null;

      try {
        // Some shows include trailing punctuation (e.g. "Can You Keep a Secret?")
        // that can hurt provider matching. For torrent searching, strip trailing ?/.
        const rawShowName = String(this.currentShow.Name || '').trim();
        const showNameForSearch = rawShowName.replace(/[?.]+\s*$/g, '').trim();

        let url = `${config.torrentsApiUrl}/api/search?show=${encodeURIComponent(showNameForSearch)}&limit=${this.maxResults}`;
        if (needed.length > 0) {
          url += `&needed=${encodeURIComponent(JSON.stringify(needed))}`;
        }

        // Debug info
        this.lastSearchUrl = url;
        this.lastSearchShow = showNameForSearch;
        this.lastSearchNeeded = Array.isArray(needed) ? JSON.stringify(needed) : String(needed);

        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Debug info from response
        this.lastApiCount = (typeof data?.count === 'number') ? data.count : null;
        this.lastWarningSummary = (data && typeof data.warningSummary === 'object') ? data.warningSummary : null;

        // Set torrents first; some server versions may omit rawProviderCounts.
        this.torrents = data.torrents || [];

        // (debug logging removed)

        // Provider hit counts.
        // Prefer backend-reported rawProviderCounts when present, but fall back to deriving counts from
        // returned torrents because some server versions omit rawProviderCounts.
        const counts = (data && typeof data.rawProviderCounts === 'object') ? (data.rawProviderCounts || {}) : {};
        this.lastRawProviderCounts = Object.keys(counts).length > 0 ? counts : null;

        const toCount = (v) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : 0;
        };

        const iptCountFromApi = toCount(
          counts.IpTorrents ?? counts.IPTorrents ?? counts.iptorrents ?? counts.ipt ?? counts.IPT ?? counts.Iptorrents ?? 0
        );
        const tlCountFromApi = toCount(
          counts.TorrentLeech ?? counts.torrentleech ?? counts.TL ?? counts.tl ?? counts.TorrentLeach ?? 0
        );

        let iptCount = iptCountFromApi;
        let tlCount = tlCountFromApi;

        // Fallback: infer from returned torrents if counts were not provided.
        if ((iptCount + tlCount) === 0 && Array.isArray(this.torrents) && this.torrents.length > 0) {
          for (const t of this.torrents) {
            const providerRaw = String(t?.raw?.provider || t?.provider || '').toLowerCase();
            if (!providerRaw) continue;
            if (providerRaw.includes('torrentleech') || providerRaw === 'tl') {
              tlCount += 1;
            } else if (providerRaw.includes('iptorrents') || providerRaw === 'ipt' || providerRaw.includes('ipt')) {
              iptCount += 1;
            }
          }

          // When we infer counts, populate the debug display so it's obvious what happened.
          this.lastRawProviderCounts = {
            inferred: true,
            IpTorrents: iptCount,
            TorrentLeech: tlCount,
          };
        }

        // If the backend reports raw provider hits but returns none, call it out explicitly.
        // This typically means results exist on IPT/TL but were filtered out server-side
        // (commonly because all hits have 0 seeds, or title parsing/matching rejected them).
        if (Array.isArray(this.torrents) && this.torrents.length === 0 && (iptCount > 0 || tlCount > 0)) {
          const parts = [];
          if (iptCount > 0) parts.push(`IPTorrents: ${iptCount}`);
          if (tlCount > 0) parts.push(`TorrentLeech: ${tlCount}`);
          this.providerWarning = `Providers reported hits (${parts.join(', ')}), but none were returned. This is usually because all hits were filtered out (often 0 seeds) or title matching failed. Try Force, or check the provider site directly.`;
        }

        // Returned-per-provider counts (what the user actually sees in the list).
        const inferProvider = (torrent) => {
          const providerRaw = String(torrent?.raw?.provider || torrent?.provider || '').toLowerCase();
          const detailUrlLower = String(torrent?.detailUrl || torrent?.raw?.desc || '').toLowerCase();
          if (providerRaw.includes('torrentleech') || detailUrlLower.includes('torrentleech') || providerRaw === 'tl') return 'torrentleech';
          if (providerRaw.includes('iptorrents') || detailUrlLower.includes('iptorrents') || providerRaw === 'ipt') return 'iptorrents';
          return providerRaw || 'unknown';
        };

        const returnedCounts = { iptorrents: 0, torrentleech: 0, unknown: 0 };
        if (Array.isArray(this.torrents)) {
          for (const t of this.torrents) {
            const p = inferProvider(t);
            if (p === 'iptorrents') returnedCounts.iptorrents += 1;
            else if (p === 'torrentleech') returnedCounts.torrentleech += 1;
            else returnedCounts.unknown += 1;
          }
        }
        this.lastReturnedProviderCounts = returnedCounts;

        // If exactly one provider returned results and the other returned none, show a cookie warning.
        const iptReturned = returnedCounts.iptorrents;
        const tlReturned = returnedCounts.torrentleech;
        const iptZero = iptReturned === 0;
        const tlZero = tlReturned === 0;
        const iptHas = iptReturned > 0;
        const tlHas = tlReturned > 0;

        if ((Array.isArray(this.torrents) && this.torrents.length > 0) && ((iptHas && tlZero) || (tlHas && iptZero))) {
          const missing = [];
          if (iptZero) missing.push('IPTorrents');
          if (tlZero) missing.push('TorrentLeech');
          const cookieWarning = `Warning: No results from ${missing.join(' and ')}. Check cookies for that provider.`;

          this.providerWarning = this.providerWarning
            ? `${this.providerWarning}\n\n${cookieWarning}`
            : cookieWarning;
        }

        await this.$nextTick();
        if (!this._didInitialScroll && Array.isArray(this.torrents) && this.torrents.length > 0) {
          this.scrollToBottom();
          this._didInitialScroll = true;
        }
      } catch (err) {
        // Handle both Error objects and rejected promise values
        const errorMessage = err?.message || err?.result || err?.error || (typeof err === 'string' ? err : JSON.stringify(err));
        this.error = errorMessage;
      } finally {
        this.loading = false;
      }
    },

    async forceLoadTorrents() {
      // Force load all torrents by sending 'force' marker
      await this.loadTorrents(['force']);
    },

    handleTorrentClick(event, torrent) {
      // Select the card
      this.selectedTorrent = torrent;

      const alreadyClicked = this.isClicked(torrent);
      // Add to clicked set
      this.clickedTorrents.add(torrent);

      // Only open the detail tab the first time (no auto-open if it already has a checkmark).
      const isAltClick = Boolean(event?.altKey);
      const isCtrlClick = Boolean(event?.ctrlKey || event?.metaKey);

      // Ctrl-click should behave like clicking the Get button.
      // Alt-click behaves like ctrl-click but forces download (bypass server-side "already downloaded" checks).
      if (isAltClick || isCtrlClick) {
        void this.enqueueDownload(torrent, { forceDownload: isAltClick });
        return;
      }

      if (!alreadyClicked && torrent.detailUrl) {
        window.open(torrent.detailUrl, '_blank');
      }
    },

    isClicked(torrent) {
      return this.clickedTorrents.has(torrent);
    },

    getCardStyle(torrent) {
      const isSelected = this.selectedTorrent === torrent;
      const isDownloaded = this.isDownloadedNow(torrent);
      const hasWarnings = this.getTorrentWarnings(torrent).length > 0;
      let bgColor = '#fff';
      if (isDownloaded) {
        bgColor = '#ffcccb';  // Light red for downloaded
      } else if (isSelected) {
        bgColor = '#fffacd';  // Light yellow for selected
      } else if (hasWarnings) {
        bgColor = '#fff0f0';  // Light red/pink for warnings
      }
      return {
        padding: '10px',
        background: bgColor,
        borderRadius: '5px',
        border: '1px solid #ddd',
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative'
      };
    },

    isDownloadedNow(torrent) {
      const key = this.getTorrentNowKey(torrent);
      if (!key) return false;
      return this.downloadedTorrents.has(key);
    },

    showDownloadModal() {
      this.showModal = true;
    },

    cancelDownload() {
      this.showModal = false;
      // Keep card selected
    },

    continueDownload() {
      // Keep the existing template bindings, but route through the queue.
      this.showModal = false;
      void this.enqueueDownload(this.selectedTorrent);
    },

    statusKeyForTorrent(torrent) {
      return this.getTorrentHistoryKey(torrent) || this.getTorrentCardKey(torrent, 0) || '';
    },

    getDownloadStatus(torrent) {
      const key = this.statusKeyForTorrent(torrent);
      if (!key) return null;
      return this.downloadStatus?.[key] || null;
    },

    getDownloadStatusLabel(torrent) {
      const st = this.getDownloadStatus(torrent);
      if (!st) return '';
      const s = String(st.status || '');
      if (s === 'queued') return 'Queued';
      if (s === 'sending') return 'Sending…';
      if (s === 'ok') return 'OK';
      if (s === 'warn') return 'Sent (verify pending)';
      if (s === 'error') return 'Error';
      return s;
    },

    getDownloadStatusTooltip(torrent) {
      const st = this.getDownloadStatus(torrent);
      if (!st) return '';
      const msg = String(st.message || '').trim();
      return msg ? `${this.getDownloadStatusLabel(torrent)}: ${msg}` : this.getDownloadStatusLabel(torrent);
    },

    setDownloadStatus(torrent, status, message) {
      const key = this.statusKeyForTorrent(torrent);
      if (!key) return;
      const next = {
        ...(this.downloadStatus && typeof this.downloadStatus === 'object' ? this.downloadStatus : {}),
        [key]: {
          status,
          message: message ? String(message) : '',
          ts: Date.now()
        }
      };
      this.downloadStatus = next;
    },

    async fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
      const ms = Math.max(0, Number(timeoutMs) || 0);
      if (!ms) return fetch(url, options);

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), ms);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(t);
      }
    },

    enqueueDownload(torrent, options = {}) {
      if (!torrent) return;

      const opts = (options && typeof options === 'object') ? options : {};
      const forceDownload = Boolean(opts.forceDownload);

      const key = this.statusKeyForTorrent(torrent);
      if (!key) return;

      const existing = this.downloadStatus?.[key]?.status;
      if (existing === 'queued' || existing === 'sending') return;

      this.downloadQueue.push({ torrent, key, forceDownload });
      this.setDownloadStatus(torrent, 'queued', '');
      void this.processDownloadQueue();
    },

    normalizeQbtNameForMatch(name) {
      let s = String(name || '').toLowerCase();
      if (!s) return '';
      // Drop the provider suffix we add in display titles.
      s = s.replace(/\s*\|\s*(tl|ipt)\s*$/i, '');
      // Normalize common separators.
      s = s.replace(/[\._\-]+/g, ' ');
      // Remove brackets/parentheses but keep the content.
      s = s.replace(/[\[\]\(\){}]/g, ' ');
      // Collapse whitespace.
      s = s.replace(/\s+/g, ' ').trim();
      return s;
    },

    

    async processDownloadQueue() {
      if (this.downloadQueueRunning) return;
      this.downloadQueueRunning = true;

      try {
        while (this.downloadQueue.length > 0) {
          const item = this.downloadQueue.shift();
          const torrent = item?.torrent;
          const forceDownload = Boolean(item?.forceDownload);
          if (!torrent) continue;

          this.setDownloadStatus(torrent, 'sending', '');
          const torrentTitle = String(torrent?.raw?.title || torrent?.title || 'Unknown');

          try {
            const result = await this.downloadTorrentInternal(torrent, { forceDownload });
            if (result?.ok) {
              this.setDownloadStatus(torrent, 'ok', result?.message || '');

              // Only mark "downloaded" after the server indicates success.
              this.rememberDownloadedTorrent(torrent);
            } else {
              const msg = result?.message || `Failed to add: ${torrentTitle}`;
              this.setDownloadStatus(torrent, 'error', msg);
            }
          } catch (err) {
            const msg = err?.message || String(err);
            this.setDownloadStatus(torrent, 'error', msg);
          }
        }
      } finally {
        this.downloadQueueRunning = false;
      }
    },

    async downloadTorrentInternal(torrent, options = {}) {
      // Mark as downloaded immediately to change card color ("now" highlighting)
      const nowKey = this.getTorrentNowKey(torrent);
      if (nowKey) {
        this.downloadedTorrents.add(nowKey);
      }

      const opts = (options && typeof options === 'object') ? options : {};
      const forceDownload = Boolean(opts.forceDownload);

      const torrentTitle = torrent?.raw?.title || 'Unknown';
      const isAlreadyInQbtMessage = (msg) => /qbit\s*torrent\s+already\s+downloaded/i.test(String(msg || ''));
      
      // Mark as downloaded immediately to change card color
      try {
        const providerRaw = String(torrent?.raw?.provider || '').toLowerCase();
        const detailUrl = String(torrent?.detailUrl || '');
        const detailUrlLower = detailUrl.toLowerCase();
        const provider =
          providerRaw.includes('torrentleech') || detailUrlLower.includes('torrentleech')
            ? 'torrentleech'
            : providerRaw.includes('iptorrents') || detailUrlLower.includes('iptorrents')
              ? 'iptorrents'
              : providerRaw || 'unknown';

        // Prefer /downloads if available.
        // torrents-server /downloads now returns a wrapper:
        // - existingTitles: array of titles (same as old raw array)
        // - existingProcids: matching procids
        // - errors/forced results are additional props
        const normalizeDownloadsWrapper = (payload) => {
          if (Array.isArray(payload)) {
            return { existingTitles: payload, existingProcids: [] };
          }
          if (!payload || typeof payload !== 'object') return null;

          const existingTitles = Array.isArray(payload.existingTitles)
            ? payload.existingTitles
            : (Array.isArray(payload.alreadyDownloaded)
              ? payload.alreadyDownloaded
              : (Array.isArray(payload.alreadyDownloadedTitles)
                ? payload.alreadyDownloadedTitles
                : (Array.isArray(payload.downloads)
                  ? payload.downloads
                  : (Array.isArray(payload.titles)
                    ? payload.titles
                    : (Array.isArray(payload.already) ? payload.already : [])))));

          const existingProcids = Array.isArray(payload.existingProcids)
            ? payload.existingProcids
            : (Array.isArray(payload.procids) ? payload.procids : []);

          return {
            ...payload,
            existingTitles,
            existingProcids
          };
        };

        const formatAlreadyDownloadedDialog = (titles) => {
          const unique = Array.from(
            new Set((Array.isArray(titles) ? titles : []).map(t => String(t || '').trim()).filter(Boolean))
          );
          return (
            'No torrents sent to qbitTorrent.  these files have already been downloaded\n\n' +
            unique.join('\n') +
            '\n\nDo you want to delete these files?'
          );
        };

        let downloadsRes = null;
        try {
          const downloadsUrl = `${config.torrentsApiUrl}/downloads`;

          const downloadsPayload = provider === 'torrentleech'
            ? { tl: { torrent }, ...(forceDownload ? { forceDownload: true } : {}) }
            : { torrent, ...(forceDownload ? { forceDownload: true } : {}) };

          let downloadsBody = '';
          try {
            downloadsBody = JSON.stringify(downloadsPayload);
          } catch (e) {
            console.log('downloads request JSON stringify failed', {
              error: e?.message || String(e)
            });
            throw e;
          }

          downloadsRes = await this.fetchWithTimeout(downloadsUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: downloadsBody
          }, 60000);
        } catch {
          downloadsRes = null;
        }

        if (downloadsRes && downloadsRes.ok) {
          const ct = (downloadsRes.headers.get('content-type') || '').toLowerCase();
          const payload = ct.includes('application/json')
            ? await downloadsRes.json().catch(() => null)
            : await downloadsRes.text().catch(() => '');

          const wrapper = normalizeDownloadsWrapper(payload);
          const alreadyTitles = wrapper?.existingTitles;
          if (Array.isArray(alreadyTitles) && alreadyTitles.length > 0) {
            const confirmed = await this.confirmExistingDownloads(
              formatAlreadyDownloadedDialog(alreadyTitles),
              wrapper
            );
            if (confirmed) {
              const ok = await this.deleteProcids(wrapper);
              if (!ok) {
                // deleteProcids already surfaced the error
              }
            }
            return { ok: true, message: 'Already downloaded' };
          }

          // If the endpoint returned a wrapper with success/result state, honor it.
          if (wrapper && typeof wrapper === 'object') {
            if (wrapper.success || wrapper.result === true || wrapper.ok === true) {
              return { ok: true, message: '' };
            }

            const errorMsg = wrapper.error || wrapper.message;
            if (errorMsg) {
              if (isAlreadyInQbtMessage(errorMsg)) {
                this.showError(`QbitTorrent already downloaded the torrent ${torrentTitle}`);
                return { ok: true, message: 'Already in qBittorrent' };
              }

              const isCloudflare = Boolean(payload && typeof payload === 'object' && (payload.isCloudflare || payload.stage === 'cloudflare')) ||
                /cloudflare|just a moment|checking your browser/i.test(String(errorMsg || ''));

              if (isCloudflare && provider === 'iptorrents') {
                const label = 'IPTorrents';
                const cookieBox = 'IPT';

                let popupBlocked = false;
                if (detailUrl) {
                  try {
                    const w = window.open(detailUrl, '_blank');
                    popupBlocked = !w;
                  } catch {
                    popupBlocked = true;
                  }
                }

                this.showError(
                  `${label} blocked the server request with a Cloudflare challenge page ("Just a moment...").\n\n` +
                  (detailUrl
                    ? (popupBlocked
                      ? 'Note: Browser blocked the popup tab.\n\n'
                      : 'Opened the detail page in a new tab.\n\n')
                    : '') +
                  'Try:\n' +
                  `- Complete any “verify you are human” step in the detail tab.\n` +
                  `- Copy the latest cf_clearance cookie into the ${cookieBox} box and Save, then retry.\n` +
                  '- If it still fails, Cloudflare is likely fingerprinting requests from this network/IP.\n\n' +
                  (detailUrl ? `Detail URL:\n${detailUrl}` : '')
                );
                return { ok: false, message: 'Cloudflare challenge blocked server request' };
              }

              this.showError(errorMsg);
              return { ok: false, message: String(errorMsg) };
            }
          }
          // Unknown successful payload shape; fall back to legacy endpoint.
        } else if (downloadsRes && downloadsRes.status !== 404) {
          let detail = '';
          try {
            const ct = downloadsRes.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              const j = await downloadsRes.json();
              detail = j?.error ? String(j.error) : (j?.message ? String(j.message) : JSON.stringify(j));
            } else {
              detail = await downloadsRes.text();
            }
          } catch {
            // ignore
          }

          if (isAlreadyInQbtMessage(detail)) {
            this.showError(`QbitTorrent already downloaded the torrent ${torrentTitle}`);
            return { ok: true, message: 'Already in qBittorrent' };
          }

          throw new Error(detail || `HTTP ${downloadsRes.status}: ${downloadsRes.statusText}`);
        }

        // Legacy server-side pipeline.
        const response = await this.fetchWithTimeout(`${config.torrentsApiUrl}/api/download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            torrent
          })
        }, 60000);
        
        if (!response.ok) {
          let detail = '';
          try {
            const ct = response.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              const j = await response.json();
              detail = j?.error ? String(j.error) : JSON.stringify(j);
            } else {
              detail = await response.text();
            }
          } catch {
            // ignore
          }
          throw new Error(detail || `HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Check if download was successful
        if (data.success || data.result === true) {
          return { ok: true, message: '' };
        } else {
          const errorMsg = data.error || data.message || 'Unknown error';
          const isCloudflare = Boolean(data && typeof data === 'object' && (data.isCloudflare || data.stage === 'cloudflare')) ||
            /cloudflare|just a moment|checking your browser/i.test(String(errorMsg || ''));

          if (isCloudflare && provider === 'iptorrents') {
            const label = 'IPTorrents';
            const cookieBox = 'IPT';

            let popupBlocked = false;
            if (detailUrl) {
              try {
                const w = window.open(detailUrl, '_blank');
                popupBlocked = !w;
              } catch {
                popupBlocked = true;
              }
            }

            this.showError(
              `${label} blocked the server request with a Cloudflare challenge page ("Just a moment...").\n\n` +
              (detailUrl
                ? (popupBlocked
                  ? 'Note: Browser blocked the popup tab.\n\n'
                  : 'Opened the detail page in a new tab.\n\n')
                : '') +
              'Try:\n' +
              `- Complete any “verify you are human” step in the detail tab.\n` +
              `- Copy the latest cf_clearance cookie into the ${cookieBox} box and Save, then retry.\n` +
              '- If it still fails, Cloudflare is likely fingerprinting requests from this network/IP.\n\n' +
              (detailUrl ? `Detail URL:\n${detailUrl}` : '')
            );
            return { ok: false, message: 'Cloudflare challenge blocked server request' };
          } else {
            this.showError(errorMsg);
            return { ok: false, message: String(errorMsg) };
          }
        }
      } catch (error) {
        const errorMsg = error.message || String(error);
        this.showError(errorMsg);
        return { ok: false, message: String(errorMsg) };
      }
    },

    formatSeasonEpisode(seasonEpisode) {
      if (!seasonEpisode) return '';
      // Convert S01E02 to 1/2 without leading zeros
      const match = seasonEpisode.match(/S(\d+)(?:E(\d+))?/);
      if (!match) return seasonEpisode;
      
      const season = parseInt(match[1], 10);
      const episode = match[2] ? parseInt(match[2], 10) : null;
      
      if (episode !== null) {
        return `${season}/${episode}`;
      } else {
        return String(season);
      }
    },

    getDisplaySeasonEpisode(torrent) {
      // Handle dummy torrents
      if (torrent.notorrent) {
        return this.formatSeasonEpisode(torrent.notorrent);
      }
      
      // Check if torrent has parsed data
      if (!torrent.parsed) {
        return torrent.title || '';
      }

      // If this torrent represents a season range, show "start...end"
      if (torrent.seasonRange && torrent.seasonRange.isRange) {
        const start = Number(torrent.seasonRange.startSeason);
        const end = Number(torrent.seasonRange.endSeason);
        if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
          return `${start}...${end}`;
        }
      }
      
      // Log what we're working with
      // console.log('Torrent display data:', {
      //   title: torrent.parsed.title,
      //   season: torrent.parsed.season,
      //   episode: torrent.parsed.episode,
      //   seasonEpisode: torrent.parsed.seasonEpisode,
      //   rawTitle: torrent.raw?.title
      // });
      
      // If seasonEpisode is already set, use it
      if (torrent.parsed.seasonEpisode) {
        return this.formatSeasonEpisode(torrent.parsed.seasonEpisode);
      }
      
      // Otherwise construct from parsed season/episode
      const season = torrent.parsed.season;
      const episode = torrent.parsed.episode;
      
      if (season !== undefined && season !== null) {
        let result = `S${String(season).padStart(2, '0')}`;
        if (episode !== undefined && episode !== null) {
          result += `E${String(episode).padStart(2, '0')}`;
        }
        return this.formatSeasonEpisode(result);
      }
      
      // Fallback to title if no season info
      return torrent.parsed.title || '';
    },

    formatProvider(provider) {
      if (!provider) return '';
      if (provider.toLowerCase() === 'iptorrents') return 'IPT';
      if (provider.toLowerCase() === 'torrentleech') return 'TL';
      return provider;
    },

    formatGroup(group) {
      if (!group) return '';
      return group.toLowerCase();
    }
  }
};
</script>

