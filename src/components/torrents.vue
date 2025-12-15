<template lang="pug">
.torrents-container(@click="handleClose" :style="{ height:'100%', width:'100%', display:'flex', justifyContent:'flex-start' }")
  #torrents(@click="handleClose" :style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }")

    #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'15px', marginLeft:'-10px', marginRight:'-10px', marginTop:'-10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'15px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
      div(style="display:flex; justify-content:space-between; align-items:center;")
        div(style="margin-left:20px;") {{ showName }}
        div(style="display:flex; gap:10px; margin-right:20px;")
          button(v-if="selectedTorrent" @click.stop="showDownloadModal" style="font-size:15px; cursor:pointer; border-radius:7px; padding:4px 12px; background:#4CAF50; color:white; border:none;") Download
          button(v-if="noTorrentsNeeded" @click.stop="forceLoadTorrents" style="font-size:15px; cursor:pointer; border-radius:7px; padding:4px 12px; background:#2196F3; color:white; border:none;") Force
          button(@click.stop="toggleCookieInputs" style="font-size:15px; cursor:pointer; border-radius:7px; padding:4px 12px;") Cookies
          button(@click.stop="$emit('series')" style="font-size:15px; cursor:pointer; border-radius:7px; padding:4px 12px;") Series
          button(@click.stop="handleMapButton" style="font-size:15px; cursor:pointer; border-radius:7px; padding:4px 12px;") Map

      div(v-if="_qbtPolling && !_qbtSawTorrent" style="margin-left:20px; margin-right:20px; margin-top:6px; font-weight:normal; font-size:14px; color:#666; display:block; line-height:1.2;") Waiting for download to start ...
      div(style="margin-left:20px; margin-right:20px; margin-top:14px; font-weight:normal; font-size:16px; color:#666; display:block; visibility:visible; opacity:1; line-height:1.1; white-space:nowrap; overflow:visible;") {{ spaceAvailText }}
      div(style="margin-left:20px; margin-right:20px; margin-top:2px; font-weight:normal; font-size:16px; color:#666; display:block; visibility:visible; opacity:1; line-height:1.1; white-space:nowrap; overflow:visible;") {{ spaceAvailGbText }}

    #cookie-inputs(@click.stop v-if="!loading && !noTorrentsNeeded && (isCookieRelatedError || showCookieInputs)" style="position:sticky; top:0; zIndex:50; padding:15px 20px 15px 20px; margin-bottom:10px; background:#fff; border-radius:5px; border:1px solid #ddd;")
      
    #unaired(v-if="unaired" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
      div Show not aired yet
      
    #cookie-inputs(@click.stop v-if="!unaired && !loading && !noTorrentsNeeded && (isCookieRelatedError || showCookieInputs)" style="position:sticky; top:0; zIndex:50; padding:15px 20px 15px 20px; margin-bottom:10px; background:#fff; border-radius:5px; border:1px solid #ddd;")
      div(style="margin-bottom:10px;")
        label(style="display:block; font-size:12px; font-weight:bold; margin-bottom:3px; color:#555;") IPTorrents cf_clearance:
        input(v-model="iptCfClearance" type="text" placeholder="Paste cf_clearance cookie value" style="width:100%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:3px; box-sizing:border-box;")
      div(style="margin-bottom:10px;")
        label(style="display:block; font-size:12px; font-weight:bold; margin-bottom:3px; color:#555;") TorrentLeech cf_clearance:
        input(v-model="tlCfClearance" type="text" placeholder="Paste cf_clearance cookie value" style="width:100%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:3px; box-sizing:border-box;")
      div(style="margin-top:10px;")
        button(@click.stop="loadTorrents" :disabled="loading" style="padding:8px 20px; font-size:13px; font-weight:bold; cursor:pointer; border-radius:5px; background:#4CAF50; color:white; border:none; width:100%;") 
          | {{ loading ? 'Loading...' : 'Load Torrents' }}

    

    #loading(v-if="!unaired && loading" style="text-align:center; color:#666; margin-top:50px; font-size:16px;")
      div Searching for torrents...
      
    #error(v-if="!unaired && error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px; white-space:pre-line; padding:0 20px;")
      div Error: {{ error }}
    #warning(v-if="!unaired && !error && providerWarning" style="text-align:center; color:#b36b00; margin-top:20px; font-size:14px; white-space:pre-line; padding:0 20px;")
      div {{ providerWarning }}
      
    #no-torrents-needed(v-if="!unaired && noTorrentsNeeded && !loading && !error" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
      div No torrents needed.
      
    #torrents-list(v-if="!unaired && !loading && !noTorrentsNeeded" style="padding:10px; font-size:14px; line-height:1.6;")
      pre(v-if="qbtPollText && !(_qbtPolling && !_qbtSawTorrent)" style="margin:0 0 10px 0; padding:10px; background:#fff; border:1px solid #ddd; border-radius:5px; white-space:pre; overflow-x:auto;") {{ qbtPollText }}
      template(v-if="!_qbtSawTorrent")
        div(v-if="torrents.length === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
          div No torrents found
        div(v-for="(torrent, index) in torrents" :key="index" @click="handleTorrentClick($event, torrent)" @click.stop :style="getCardStyle(torrent)" @mouseenter="$event.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.15)'" @mouseleave="$event.currentTarget.style.boxShadow='none'")
          div(v-if="isClicked(torrent)" style="position:absolute; top:8px; right:8px; color:#4CAF50; font-size:20px; font-weight:bold;") ✓
          div(v-if="SHOW_TITLE && torrent.raw" style="font-size:12px; color:#888; margin-bottom:4px;") {{ torrent.raw.title }}
          div(style="font-size:18px; color:#333;") 
            strong {{ getDisplaySeasonEpisode(torrent) }}
            | : {{ torrent.raw?.size || 'N/A' }}, {{ torrent.raw?.seeds || 0 }} seeds<span v-if="torrent.raw?.provider">, {{ formatProvider(torrent.raw.provider) }}</span><span v-if="torrent.parsed?.resolution">, {{ torrent.parsed.resolution }}</span><span v-if="torrent.parsed?.group">, {{ formatGroup(torrent.parsed.group) }}</span>

  #download-modal(v-if="showModal" @click.stop="showModal = false" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:10000;")
    #modal-content(@click.stop style="background:white; padding:30px; border-radius:10px; max-width:500px; box-shadow:0 4px 20px rgba(0,0,0,0.3);")
      div(style="font-size:16px; margin-bottom:20px; line-height:1.5;") Do you want to download the torrent 
        strong {{ selectedTorrent?.raw?.title || 'Unknown' }}
        |  and send it to USB for qBittorrent to download?
      div(style="display:flex; gap:10px; justify-content:flex-end;")
        button(@click.stop="cancelDownload" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; border:1px solid #ccc; background:white;") Cancel
        button(@click.stop="continueDownload" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; background:#4CAF50; color:white; border:none;") Continue

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
      providerWarning: '',
      maxResults: 1000,  // Constant for maximum results to fetch
      iptCfClearance: '',
      tlCfClearance: '',
      currentShow: null,
      SHOW_TITLE: true,  // Show torrent title on card
      selectedTorrent: null,  // Currently selected torrent
      showModal: false,  // Show download confirmation modal
      clickedTorrents: new Set(),  // Track which torrents have been clicked
      noTorrentsNeeded: false,  // Flag when needed array is empty
      showCookieInputs: false,  // Manual toggle for cookie input boxes
      unaired: false,

      qbtPollText: '',
      _qbtPolling: false,
      _qbtStopPolling: false,
      _qbtSawTorrent: false,
      _qbtLastTorrent: null,
      _qbtSpeedHistory: [],

      spaceAvailText: 'Space Used, Seed Box: --%, Server: --%',
      spaceAvailGbText: 'Available, Seed Box: -- GB, Server: -- GB'
    };
  },

  computed: {
    trackerCounts() {
      const counts = {};
      this.torrents.forEach(torrent => {
        const provider = torrent.raw?.provider || 'Unknown';
        counts[provider] = (counts[provider] || 0) + 1;
      });
      return counts;
    },
    isCookieRelatedError() {
      // Always show cookie inputs when there are no torrents (likely auth issue)
      if (this.torrents.length === 0) return true;
      
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
    evtBus.on('showTorrents', this.searchTorrents);
  },

  unmounted() {
    evtBus.off('showTorrents', this.searchTorrents);
    this.stopQbtPolling();
  },

  methods: {
    handleClose() {
      this.selectedTorrent = null;
      this.showModal = false;
      this.clickedTorrents.clear();
      this.stopQbtPolling();
      this.qbtPollText = '';
      this._qbtSawTorrent = false;
      this._qbtLastTorrent = null;
      this.spaceAvailText = 'Space Used, Seed Box: --%, Server: --%';
      this.spaceAvailGbText = 'Available, Seed Box: -- GB, Server: -- GB';
      this.$emit('close');
    },

    stopQbtPolling() {
      this._qbtStopPolling = true;
      this._qbtPolling = false;
    },

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },

    pacificHms(epochSeconds) {
      const n = Number(epochSeconds);
      if (!Number.isFinite(n) || n <= 0) return epochSeconds;
      const d = new Date(n * 1000);
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).formatToParts(d);
      const get = (t) => parts.find(p => p.type === t)?.value;
      return `${get('hour')}:${get('minute')}:${get('second')}`;
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

    fmtSizeParts(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n)) return null;
      const b = Math.max(0, n);
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let v = b;
      let i = 0;
      while (v >= 1000 && i < units.length - 1) {
        v /= 1000;
        i += 1;
      }
      return { value: v, unit: units[i] };
    },

    fmtSpeedMbits(bytesPerSec) {
      const n = Number(bytesPerSec);
      if (!Number.isFinite(n)) return String(bytesPerSec);
      const gbitPerSec = (Math.max(0, n) * 8) / 1_000_000_000;
      return `${gbitPerSec.toFixed(3)} gb/sec`;
    },

    fmtDurationMmSs(seconds) {
      const n = Number(seconds);
      if (!Number.isFinite(n) || n < 0) return String(seconds);
      const s = Math.floor(n);
      const mm = Math.floor(s / 60);
      const ss = s % 60;
      return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    },

    fmtPercent(progress) {
      const n = Number(progress);
      if (!Number.isFinite(n)) return String(progress);
      return `${Math.round(n * 100)}%`;
    },

    computeEtaTime(t) {
      const etaSec = Number(t?.eta);
      if (!Number.isFinite(etaSec) || etaSec < 0) return String(t?.eta);
      const base = Math.floor(Date.now() / 1000);
      return this.pacificHms(base + etaSec);
    },

    getAvgSpeedBytesPerSec() {
      const xs = Array.isArray(this._qbtSpeedHistory) ? this._qbtSpeedHistory : [];
      if (xs.length === 0) return undefined;
      const sum = xs.reduce((acc, v) => acc + v, 0);
      return sum / xs.length;
    },

    fmtDownloadedOfSize(downloadedBytes, sizeBytes) {
      const size = this.fmtSizeParts(sizeBytes);
      if (!size) return String(downloadedBytes);
      const nDownloaded = Number(downloadedBytes);
      if (!Number.isFinite(nDownloaded)) return String(downloadedBytes);

      const divisorByUnit = {
        B: 1,
        KB: 1_000,
        MB: 1_000_000,
        GB: 1_000_000_000,
        TB: 1_000_000_000_000
      };
      const div = divisorByUnit[size.unit] || 1;
      const downloadedInUnit = Math.max(0, nDownloaded) / div;

      if (size.unit === 'B') {
        return `${Math.round(downloadedInUnit)} of ${Math.round(size.value)} ${size.unit}`;
      }
      return `${downloadedInUnit.toFixed(1)} of ${size.value.toFixed(1)} ${size.unit}`;
    },

    formatQbtTorrentState(t) {
      const props = [
        ['name', 'string'],
        ['state', 'string'],
        ['downloaded', 'downloaded_of_size'],
        ['progress', 'percent'],
        ['seeds', 'integer'],
        ['speed', 'speed'],
        ['time_active', 'duration'],
        ['added_on', 'date'],
        ['time_remaining', 'duration_padded'],
        ['eta', 'date']
      ];

      const maxKeyLen = Math.max(...props.map(([k]) => k.length));
      const lines = [];

      for (const [key, kind] of props) {
        let value;
        if (key === 'time_remaining') {
          value = t?.eta;
        } else if (key === 'speed') {
          value = this.getAvgSpeedBytesPerSec();
        } else if (key === 'seeds') {
          value = t?.num_seeds;
        } else if (key === 'eta') {
          value = this.computeEtaTime(t);
        } else if (key === 'downloaded') {
          value = this.fmtDownloadedOfSize(t?.downloaded, t?.size);
        } else {
          value = t?.[key];
        }

        let shown;
        switch (kind) {
          case 'size':
            shown = this.fmtSize(value);
            break;
          case 'speed':
            shown = this.fmtSpeedMbits(value);
            break;
          case 'duration':
            shown = this.fmtDurationMmSs(value);
            break;
          case 'duration_padded': {
            const mmss = this.fmtDurationMmSs(value);
            shown = `   ${mmss}`;
            break;
          }
          case 'percent':
            shown = this.fmtPercent(value);
            break;
          case 'date':
            shown = this.pacificHms(value);
            break;
          case 'downloaded_of_size':
            shown = value;
            break;
          default:
            shown = value;
        }

        const shownText = (shown === undefined || shown === null) ? '' : String(shown);
        const pad = ' '.repeat((maxKeyLen - key.length) + 2);
        lines.push(`${key}:${pad}${shownText}`);
      }

      return lines.join('\n');
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
        const usbPercent = this.pctUsed(s?.usbSpaceTotal, s?.usbSpaceUsed);
        const srvrPercent = this.pctUsed(s?.mediaSpaceTotal, s?.mediaSpaceUsed);
        this.spaceAvailText = `Space Used, Seed Box: ${usbPercent}, Server: ${srvrPercent}`;

        const usbGb = this.fmtAvailGb(s?.usbSpaceTotal, s?.usbSpaceUsed);
        const srvrGb = this.fmtAvailGb(s?.mediaSpaceTotal, s?.mediaSpaceUsed);
        this.spaceAvailGbText = `Available, Seed Box: ${usbGb} GB, Server: ${srvrGb} GB`;
      } catch (e) {
        console.error('spaceAvail fetch error:', e);
      }
    },

    async startQbtPollingAfterDownloadApproved() {
      this.stopQbtPolling();
      this._qbtStopPolling = false;
      this._qbtSawTorrent = false;
      this._qbtLastTorrent = null;
      this._qbtSpeedHistory = [];
      this._qbtPolling = true;
      this.qbtPollText = 'Waiting for download to start ...';

      while (!this._qbtStopPolling) {
        let torrents;
        try {
          torrents = await this.getQbtInfo({ filter: 'downloading' });
        } catch (e) {
          // Keep showing last good state; do not stop polling on transient fetch errors.
          console.error('getQbtInfo polling error:', e);
          await this.sleep(1000);
          continue;
        }

        const first = Array.isArray(torrents) ? torrents[0] : undefined;
        if (!first) {
          if (this._qbtSawTorrent) {
            // After we have shown a torrent, an empty result means downloading has stopped.
            if (this._qbtLastTorrent) {
              const doneTorrent = { ...this._qbtLastTorrent, amount_left: 0, state: 'finished', eta: 0 };
              this.qbtPollText = this.formatQbtTorrentState(doneTorrent);
              this._qbtLastTorrent = doneTorrent;
            }
            this.updateSpaceAvail();
            this._qbtStopPolling = true;
            this._qbtPolling = false;
            break;
          }
          this.qbtPollText = 'Waiting for download to start ...';
        } else {
          this._qbtSawTorrent = true;
          this._qbtLastTorrent = first;

          const s = Number(first?.dlspeed);
          if (Number.isFinite(s) && s >= 0) {
            this._qbtSpeedHistory.push(s);
            if (this._qbtSpeedHistory.length > 5) {
              this._qbtSpeedHistory.splice(0, this._qbtSpeedHistory.length - 5);
            }
          }

          this.qbtPollText = this.formatQbtTorrentState(first);
        }

        await this.sleep(1000);
      }
    },

    toggleCookieInputs() {
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
      this.selectedTorrent = null;
      this.clickedTorrents.clear();
      this.noTorrentsNeeded = false;
      this.providerWarning = '';
      this.loading = false;
      this.stopQbtPolling();
      this.qbtPollText = '';
      this._qbtSawTorrent = false;
      this._qbtLastTorrent = null;
      this.spaceAvailText = 'Space Used, Seed Box: --%, Server: --%';
      this.spaceAvailGbText = 'Available, Seed Box: -- GB, Server: -- GB';

      // Kick off space fetch ASAP; don't wait for torrent searching.
      this.updateSpaceAvail();

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
      
      // Check if needed array is truly empty (not 'loadall')
      if (needed.length === 0) {
        this.noTorrentsNeeded = true;
        return;
      }
      
      // Automatically try to load torrents with saved cookies
      await this.loadTorrents(needed);
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

        console.log('Series map for', show.Name, seriesMap);
        
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
          
          for (const [episodeNumStr, epiObj] of Object.entries(episodes)) {
            const episodeNum = parseInt(episodeNumStr);
            if (isNaN(episodeNum)) continue;
            
            const { played, noFile, unaired } = epiObj;
            
            // Stop if we hit an unaired episode
            if (unaired) {
              // Process any accumulated season if any episodes were needed
              if (seasonNeeded.length > 0) {
                if (allNeeded) {
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
            if (allNeeded) {
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
        console.error('Error calculating needed episodes:', err);
      }
      console.log('Needed episodes for', show.Name, needed);
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

        // If both providers returned 0, treat as no results (show inputs via computed)
        if ((iptCount === 0 || iptCount === undefined) && (tlCount === 0 || tlCount === undefined)) {
          console.log('Cookie input shown: Both providers returned 0');
          this.providerWarning = '';
          this.error = `No torrents found for "${this.currentShow.Name}"`;
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
      } catch (err) {
        console.error('Torrent search error:', err);
        
        // Handle both Error objects and rejected promise values
        const errorMessage = err?.message || err?.result || err?.error || (typeof err === 'string' ? err : JSON.stringify(err));
        
        console.log('Cookie input shown: Error occurred -', errorMessage);
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
      
      // Add to clicked set
      this.clickedTorrents.add(torrent);
      
      // Open detail page in new tab
      if (torrent.detailUrl) {
        window.open(torrent.detailUrl, '_blank');
      }
    },

    isClicked(torrent) {
      return this.clickedTorrents.has(torrent);
    },

    getCardStyle(torrent) {
      const isSelected = this.selectedTorrent === torrent;
      return {
        marginBottom: '10px',
        padding: '8px',
        background: isSelected ? '#fffacd' : '#fff',
        borderRadius: '5px',
        border: '1px solid #ddd',
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative'
      };
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
      
      if (!this.selectedTorrent) {
        console.log('No torrent selected');
        return;
      }
      
      const torrentTitle = this.selectedTorrent.raw?.title || 'Unknown';
      console.log('Attempting to download torrent:', this.selectedTorrent);
      
      try {
        // Get cf_clearance cookies from localStorage
        const cfClearance = {
          iptorrents: localStorage.getItem('cf_clearance_iptorrents') || '',
          torrentleech: localStorage.getItem('cf_clearance_torrentleech') || ''
        };
        
        const response = await fetch(`${config.torrentsApiUrl}/api/download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            torrent: this.selectedTorrent,
            cfClearance: cfClearance
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Download result:', data);
        
        // Check if download was successful
        if (data.success || data.result === true) {
          this.startQbtPollingAfterDownloadApproved();
        } else {
          const errorMsg = data.error || data.message || 'Unknown error';
          alert(`Download failed for ${torrentTitle}, ${errorMsg}`);
        }
      } catch (error) {
        console.error('Download error:', error);
        const errorMsg = error.message || String(error);
        alert(`Download failed for ${torrentTitle}, ${errorMsg}`);
      }
    },

    formatSeasonEpisode(seasonEpisode) {
      if (!seasonEpisode) return '';
      // Convert S01E02 to 1/2, or S01 to 1
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
        console.log('No parsed data for torrent:', torrent);
        return torrent.title || '';
      }

      // If this torrent represents a season range, show "start-end"
      if (torrent.seasonRange && torrent.seasonRange.isRange) {
        const start = Number(torrent.seasonRange.startSeason);
        const end = Number(torrent.seasonRange.endSeason);
        if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
          return `${start}-${end}`;
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
      console.log('Falling back to title:', torrent.parsed.title);
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

