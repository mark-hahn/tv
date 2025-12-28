<template lang="pug">
.torrents-container(:style="{ height:'100%', width:'100%', display:'flex', justifyContent:'flex-start' }")
  #torrents(
    ref="scroller"
    :style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }"
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

    

    #loading(v-if="!unaired && loading" style="text-align:center; color:#666; margin-top:50px; font-size:16px;")
      div Searching for torrents...
      
    #error(v-if="!unaired && error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px; white-space:pre-line; padding:0 20px;")
      div Error: {{ error }}
    #warning(v-if="!unaired && !error && providerWarning" style="text-align:center; color:#b36b00; margin-top:20px; font-size:14px; white-space:pre-line; padding:0 20px;")
      div {{ providerWarning }}
      
    #no-torrents-needed(v-if="!unaired && noTorrentsNeeded && !loading && !error" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
      div No torrents needed.
      
    #torrents-list(v-if="!unaired && !loading && !noTorrentsNeeded" style="padding:10px; font-size:14px; line-height:1.2;")
      div(v-if="!hasSearched && filteredTorrents.length === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
        div Click on Search to find torrents for {{ headerShowName }}.
      div(v-else-if="hasSearched && filteredTorrents.length === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
        div No torrents found.
      div(v-for="(torrent, index) in filteredTorrents" :key="getTorrentCardKey(torrent, index)" @click="handleTorrentClick($event, torrent)" @click.stop :style="getCardStyle(torrent)" @mouseenter="$event.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.15)'" @mouseleave="$event.currentTarget.style.boxShadow='none'")
        div(v-if="isClicked(torrent)" style="position:absolute; top:8px; right:8px; color:#4CAF50; font-size:20px; font-weight:bold;") ✓
        div(v-if="isDownloadedBefore(torrent)" :style="getDownloadedBeforeIconStyle(torrent)" title="Downloaded before") 🕘
        div(v-if="SHOW_TITLE && torrent.raw" style="font-size:13px; font-weight:bold; color:#888; margin-bottom:4px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;") {{ getDisplayTitleWithProvider(torrent) }}
        div(style="font-size:12px; color:#333;") 
          strong {{ getDisplaySeasonEpisode(torrent) }}
          | : {{ torrent.raw?.size || 'N/A' }} | {{ torrent.raw?.seeds || 0 }} seeds<span v-if="torrent.raw?.provider"> | {{ formatProvider(torrent.raw.provider) }}</span><span v-if="torrent.parsed?.resolution"> | {{ torrent.parsed.resolution }}</span><span v-if="torrent.parsed?.group"> | {{ formatGroup(torrent.parsed.group) }}</span>

  #download-modal(v-if="showModal" @click.stop="showModal = false" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:10000;")
    #modal-content(@click.stop style="background:white; padding:30px; border-radius:10px; max-width:500px; box-shadow:0 4px 20px rgba(0,0,0,0.3);")
      div(style="font-size:16px; margin-bottom:20px; line-height:1.5;") Is it OK to download file 
        strong {{ selectedTorrent?.raw?.title || 'Unknown' }}
        | ?
      div(style="display:flex; gap:10px; justify-content:flex-end;")
        button(@click.stop="cancelDownload" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; border:1px solid #ccc; background:white;") Cancel
        button(@click.stop="continueDownload" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; border:1px solid #ccc; background:white;") OK

  #error-modal(v-if="showErrorModal" @click.stop="closeErrorModal" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:10000;")
    #modal-content(@click.stop style="background:white; padding:30px; border-radius:10px; max-width:520px; box-shadow:0 4px 20px rgba(0,0,0,0.3);")
      div(style="font-size:16px; margin-bottom:20px; line-height:1.5; white-space:pre-line;") {{ errorModalMsg }}
      div(style="display:flex; gap:10px; justify-content:flex-end;")
        button(@click.stop="closeErrorModal" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; border:1px solid #ccc; background:white;") OK


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

      _didInitialScroll: false
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
      return this.torrents.filter(torrent => {
        const seeds = Number(torrent.raw?.seeds);
        return seeds > 0;
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
      const key = this.getTorrentHistoryKey(torrent);
      if (!key) return;
      const now = Date.now();
      const map = (this.downloadedByHash && typeof this.downloadedByHash === 'object') ? this.downloadedByHash : {};
      // Reassign for reliable reactivity.
      this.downloadedByHash = { ...map, [key]: now };
      this.pruneDownloadedHistory();
      this.saveDownloadedHistory();
    },

    isDownloadedBefore(torrent) {
      const key = this.getTorrentHistoryKey(torrent);
      if (!key) return false;
      const ts = Number(this.downloadedByHash?.[key]);
      if (!Number.isFinite(ts)) return false;
      return ts >= (Date.now() - this.downloadHistoryWindowMs());
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

      if (iptCf) {
        localStorage.setItem('iptCfClearance', this.iptCfClearance);
      }
      if (tlCf) {
        localStorage.setItem('tlCfClearance', this.tlCfClearance);
      }

      // Always close the inputs when clicked, even if empty.
      this.showCookieInputs = false;
      this.dismissCookieInputs = true;
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

      try {
        // Extract cf_clearance cookies from input or use saved values
        let iptCf = this.extractCfClearance(this.iptCfClearance);
        let tlCf = this.extractCfClearance(this.tlCfClearance);
        
        // If input fields are empty, try to use saved values
        if (!iptCf) {
          const saved = localStorage.getItem('iptCfClearance');
          if (saved) {
            iptCf = this.extractCfClearance(saved);
          }
        } else {
          // Save new value
          localStorage.setItem('iptCfClearance', this.iptCfClearance);
        }
        
        if (!tlCf) {
          const saved = localStorage.getItem('tlCfClearance');
          if (saved) {
            tlCf = this.extractCfClearance(saved);
          }
        } else {
          // Save new value
          localStorage.setItem('tlCfClearance', this.tlCfClearance);
        }

        let url = `${config.torrentsApiUrl}/api/search?show=${encodeURIComponent(this.currentShow.Name)}&limit=${this.maxResults}`;
        
        if (iptCf) {
          url += `&ipt_cf=${encodeURIComponent(iptCf)}`;
        }
        if (tlCf) {
          url += `&tl_cf=${encodeURIComponent(tlCf)}`;
        }
        if (needed.length > 0) {
          url += `&needed=${encodeURIComponent(JSON.stringify(needed))}`;
        }

        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Simple number-returned checks
        const counts = data.rawProviderCounts || {};
        const iptCount = (counts.IpTorrents ?? counts.iptorrents ?? 0);
        const tlCount = (counts.TorrentLeech ?? counts.torrentleech ?? 0);

        // If both providers returned 0, treat as no results
        if ((iptCount === 0 || iptCount === undefined) && (tlCount === 0 || tlCount === undefined)) {
          this.providerWarning = '';
          this.error = null;
          this.torrents = [];
          return;
        }

        // If exactly one provider returned results and the other returned 0, show a warning
        const iptZero = iptCount === 0 || iptCount === undefined;
        const tlZero = tlCount === 0 || tlCount === undefined;
        const iptHas = !iptZero;
        const tlHas = !tlZero;
        // Only warn when we have some torrents overall
        if (((iptHas && tlZero) || (tlHas && iptZero)) && (data.torrents && data.torrents.length > 0)) {
          const missing = [];
          if (iptZero) missing.push('IPTorrents');
          if (tlZero) missing.push('TorrentLeech');
          this.providerWarning = `Warning: No results from ${missing.join(' and ')}. Check cookies for that provider.`;
        }

        // Finally, set torrents
        this.torrents = data.torrents || [];

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
      let bgColor = '#fff';
      if (isDownloaded) {
        bgColor = '#ffcccb';  // Light red for downloaded
      } else if (isSelected) {
        bgColor = '#fffacd';  // Light yellow for selected
      }
      return {
        padding: '8px',
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

    async continueDownload() {
      this.showModal = false;
      
      const torrent = this.selectedTorrent;
      if (!torrent) {
        return;
      }
      
      // Mark as downloaded immediately to change card color
      const nowKey = this.getTorrentNowKey(torrent);
      if (nowKey) {
        this.downloadedTorrents.add(nowKey);
      }
      
      const torrentTitle = torrent.raw?.title || 'Unknown';
      
      try {
        // Get cf_clearance cookies from localStorage.
        // Note: the UI stores these under iptCfClearance/tlCfClearance.
        // Keep backward-compatible fallbacks for older keys.
        const iptCfRaw =
          this.iptCfClearance ||
          localStorage.getItem('iptCfClearance') ||
          localStorage.getItem('cf_clearance_iptorrents') ||
          '';
        const tlCfRaw =
          this.tlCfClearance ||
          localStorage.getItem('tlCfClearance') ||
          localStorage.getItem('cf_clearance_torrentleech') ||
          '';

        const cfClearance = {
          iptorrents: this.extractCfClearance(iptCfRaw),
          torrentleech: this.extractCfClearance(tlCfRaw)
        };
        
        const response = await fetch(`${config.torrentsApiUrl}/api/download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            torrent,
            cfClearance: cfClearance
          })
        });
        
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
          // Success
          this.rememberDownloadedTorrent(torrent);
        } else {
          const errorMsg = data.error || data.message || 'Unknown error';
          const isCloudflare = Boolean(data && typeof data === 'object' && (data.isCloudflare || data.stage === 'cloudflare')) ||
            /cloudflare|just a moment|checking your browser/i.test(String(errorMsg || ''));

          const providerRaw = String(torrent?.raw?.provider || '').toLowerCase();
          const detailUrl = String(torrent?.detailUrl || '');
          const detailUrlLower = detailUrl.toLowerCase();
          const provider =
            providerRaw.includes('torrentleech') || detailUrlLower.includes('torrentleech')
              ? 'torrentleech'
              : providerRaw.includes('iptorrents') || detailUrlLower.includes('iptorrents')
                ? 'iptorrents'
                : providerRaw || 'unknown';

          if (isCloudflare && (provider === 'torrentleech' || provider === 'iptorrents')) {
            const label = provider === 'torrentleech' ? 'TorrentLeech' : 'IPTorrents';
            const cookieBox = provider === 'torrentleech' ? 'TL' : 'IPT';

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
          } else {
            this.showError(errorMsg);
          }
        }
      } catch (error) {
        const errorMsg = error.message || String(error);
        this.showError(errorMsg);
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

