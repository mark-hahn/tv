<template lang="pug">
.subs-container(:style="{ height:'100%', width:'100%', display:'flex', justifyContent:'flex-start' }")
  #subs(
    ref="scroller"
    :style="{ height:'100%', width:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', boxSizing:'border-box', backgroundColor:'#fafafa' }"
    @wheel.stop.prevent="handleScaledWheel"
  )

    #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'10px', marginLeft:'0px', marginRight:'0px', marginTop:'-10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'0px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
      //- Row 1
      div(style="display:flex; justify-content:space-between; align-items:center;")
        div(style="margin-left:20px; display:flex; gap:10px; align-items:baseline;")
          div {{ headerShowName }}
          div(v-if="hasSearched && !loading && totalSubsCount > 0" style="font-size:12px; color:#666; font-weight:normal;") {{ validSubsCount }}/{{ totalSubsCount }}
        div(style="margin-left:auto;")

      //- Row 2 (all buttons centered)
      div(style="display:flex; justify-content:center; align-items:center; margin-top:6px;")
        div(style="display:flex; gap:8px; align-items:center;")
          div(v-if="libraryProgressText" style="align-self:center; font-size:12px; color:#555; white-space:nowrap; font-weight:normal; padding-right:8px;") {{ libraryProgressText }}
          button(@click.stop="startLibraryRefresh" :disabled="_libBusy" :style="getLibraryButtonStyle()") Library
          button(@click.stop="applyClick" :disabled="!applyEnabled" :style="getApplyButtonStyle()") Apply
          button(@click.stop="deleteClick" :disabled="!deleteEnabled" :style="getDelButtonStyle()") Del
          div(style="width:20px;")
          button(@click.stop="selectMode('search')" :style="getModeButtonStyle('search')") Search
          button(@click.stop="selectMode('season')" :style="getModeButtonStyle('season')") Season
          button(@click.stop="selectMode('episode')" :style="getModeButtonStyle('episode')") Episode
          button(@click.stop="selectMode('files')" :style="getModeButtonStyle('files')") Files
          button(v-if="viewMode === 'search'" @click.stop="scrollGroup(-1)" :disabled="!items || items.length === 0" style="font-size:12px; cursor:pointer; border-radius:7px; padding:4px 8px; border:1px solid #bbb; background-color:whitesmoke;") ▲
          button(v-if="viewMode === 'search'" @click.stop="scrollGroup(1)" :disabled="!items || items.length === 0" style="font-size:12px; cursor:pointer; border-radius:7px; padding:4px 8px; border:1px solid #bbb; background-color:whitesmoke;") ▼

      div(style="height:1px; width:100%; background-color:#ddd; margin-top:6px;")

    #loading(v-if="loading" style="text-align:center; color:#666; margin-top:50px; font-size:16px;")
      div Loading...

    #error(v-if="error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px; white-space:pre-line; padding:0 20px;")
      div Error: {{ error }}

    //- Apply failures modal
    div(v-if="showApplyFailuresModal" @click.self.stop="closeApplyFailuresModal" style="position:fixed; inset:0; z-index:1000; background:rgba(0,0,0,0.35); display:flex; align-items:flex-start; justify-content:center; padding-top:60px;")
      div(@click.stop style="background:#fff; border:1px solid #bbb; border-radius:8px; padding:12px; width:min(900px, 92vw); max-height:75vh; overflow:auto; box-sizing:border-box;")
        div(style="display:flex; justify-content:space-between; align-items:center; gap:12px;")
          div(style="font-weight:bold; font-size:14px;") Apply failures
          button(@click.stop="closeApplyFailuresModal" style="font-size:12px; cursor:pointer; border-radius:7px; padding:4px 8px; border:1px solid #bbb; background-color:whitesmoke;") Close
        div(style="height:1px; width:100%; background-color:#ddd; margin:8px 0;")
        div(v-if="!applyFailures || applyFailures.length === 0" style="font-size:12px; color:#666;") No failures.
        div(v-else style="font-size:12px; color:#333; white-space:pre-wrap; font-family:monospace;")
          div(v-for="(f, idx) in applyFailures" :key="idx" style="padding:4px 0; border-bottom:1px solid #eee;") {{ formatApplyFailure(f) }}

    #subs-list(v-if="!loading" style="padding:10px; font-size:14px; line-height:1.2;")
      div(v-if="!hasSearched && items.length === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
        div Press search to load subtitles.
      div(v-else-if="hasSearched && totalSubsCount === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
        div No subtitles found.
      template(v-for="(item, index) in items" :key="getItemCardKey(item)")
        div.se-divider(v-if="shouldShowSeDivider(index)" style="text-align:center; color:#888; font-family:monospace; margin:4px 0;") {{ getSeDividerText(index) }}
        div(@click="handleItemClick($event, item)" @click.stop :style="getCardStyle(item)" @mouseenter="$event.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.15)'" @mouseleave="$event.currentTarget.style.boxShadow='none'")
          div(v-if="viewMode === 'files' && isAppliedFile(item)" style="position:absolute; top:8px; left:8px; color:#4CAF50; font-size:14px; font-weight:bold;") ✓
          div(v-if="shouldShowClickedCheckmark && isClicked(item)" style="position:absolute; top:8px; right:8px; color:#4CAF50; font-size:20px; font-weight:bold;") ✓
          div(style="display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:12px; color:#333;")
            div(:style="{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, color: item?.lineColor || '#333' }") {{ item?.line1 || '' }}
            div(style="color:#666; white-space:nowrap;") {{ item?.uploader || '' }}
</template>

<script>
import parseTorrentTitle from 'parse-torrent-title';
import { subsSearch, applySubFiles, deleteSubFiles } from '../srvr.js';
import evtBus from '../evtBus.js';
import * as emby from '../emby.js';
import * as util from '../util.js';

export default {
  name: 'Subs',

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
      items: [],
      searchResults: [],
      showName: '',
      loading: false,
      error: null,
      hasSearched: false,
      viewMode: 'search',
      selectedCardKey: '',

      // Multi-select (Season/Episode/Files)
      selectedSeasonKeys: [],
      selectedEpisodeKeys: [],
      selectedFileKeys: [],
      _lastClickedKeyByMode: {},

      selectedSeason: null,
      selectedEpisode: null,
      clickedItemKeys: new Set(),
      currentShow: null,
      totalSubsCount: 0,
      validSubsCount: 0,

      applyInProgress: false,
      delInProgress: false,

      // Tracks file_ids successfully applied/deleted (server-reported) across sessions.
      _appliedFileIds: [],

      showApplyFailuresModal: false,
      applyFailures: [],

      _libBusy: false,
      _libTaskId: null,
      _libPollTimer: null,
      libraryProgressText: '',

      _lastSearchShowKey: '',
      _validEntries: [],
      _selectedEpisodeBySeason: {},
      _selectedFileKeyBySeasonEpisode: {},

      _seriesMapObj: null,
      _seriesMapLoading: false,

      // Monotonic tokens to prevent stale async updates when switching shows quickly.
      _searchToken: 0,
      _seriesMapToken: 0
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

    shouldShowClickedCheckmark() {
      return this.viewMode === 'files';
    },

    applyEnabled() {
      return this.actionEnabled;
    },

    deleteEnabled() {
      return this.actionEnabled;
    },

    actionEnabled() {
      const show = this.currentShow || this.activeShow;
      if (!show) return false;
      if (!this.hasSearched) return false;
      if (this.loading) return false;
      if (this.applyInProgress || this.delInProgress) return false;
      return this.buildFileIdObjsPayload().length > 0;
    }
  },

  watch: {
    activeShow: {
      immediate: true,
      handler(newShow, oldShow) {
        const newKey = this.getShowKey(newShow);
        const oldKey = this.getShowKey(oldShow);
        this.currentShow = newShow || null;
        // Cancel any in-flight async work from the previous show.
        this._searchToken++;
        this._seriesMapToken++;

        // Treat any actual show change as requiring a state reset.
        // Keys can be missing/empty during rapid filtering, but we still must not
        // keep displaying previous results.
        if (newShow !== oldShow && (newKey !== oldKey || newKey || oldKey)) {
          this.resetSearchState();
          void this.ensureSeriesMapLoaded();
          void this.ensureSearched();
        }
      }
    }
  },

  mounted() {
    this.loadAppliedFileIdsFromStorage();
    void this.ensureSeriesMapLoaded();
    void this.ensureSearched();
  },

  methods: {
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },
    resetSearchState() {
      this.items = [];
      this.searchResults = [];
      this.error = null;
      this.loading = false;
      this.hasSearched = false;
      this.applyInProgress = false;
      this.delInProgress = false;
      this.showApplyFailuresModal = false;
      this.applyFailures = [];
      this.selectedCardKey = '';

      this.selectedSeasonKeys = [];
      this.selectedEpisodeKeys = [];
      this.selectedFileKeys = [];
      this._lastClickedKeyByMode = {};

      this.selectedSeason = null;
      this.selectedEpisode = null;
      this.clickedItemKeys = new Set();
      this.totalSubsCount = 0;
      this.validSubsCount = 0;
      this._validEntries = [];
      this._selectedEpisodeBySeason = {};
      this._selectedFileKeyBySeasonEpisode = {};

      this._seriesMapObj = null;
      this._seriesMapLoading = false;
    },

    async ensureSeriesMapLoaded() {
      const show = this.currentShow || this.activeShow;
      if (!show) return;
      if (this._seriesMapObj) return;
      if (this._seriesMapLoading) return;
      const token = ++this._seriesMapToken;
      this._seriesMapLoading = true;
      try {
        const seriesMapIn = await emby.getSeriesMap(show);
        if (token !== this._seriesMapToken) return;
        const seriesMapObj = util.buildSeriesMap(seriesMapIn);
        if (token !== this._seriesMapToken) return;
        this._seriesMapObj = seriesMapObj || null;
      } catch {
        this._seriesMapObj = null;
      } finally {
        if (token !== this._seriesMapToken) return;
        this._seriesMapLoading = false;
        // If user is in Season/Episode modes, rebuild using map now.
        if (this.hasSearched) this.rebuildVisibleItems();
      }
    },

    getShowKey(show) {
      if (!show) return '';
      const id = show?.Id != null ? String(show.Id) : '';
      const name = show?.Name != null ? String(show.Name) : '';
      const imdbDigits = (() => {
        const imdb = show?.ProviderIds?.Imdb || show?.ProviderIds?.imdb || show?.ProviderIds?.IMDb || show?.ProviderIds?.IMDB;
        if (!imdb) return '';
        const raw = String(imdb).trim();
        const digits = raw.toLowerCase().startsWith('tt') ? raw.slice(2) : raw;
        const digitsOnly = digits.replace(/\D/g, '');
        const normalized = digitsOnly.replace(/^0+/, '');
        return normalized || digitsOnly;
      })();
      return id || imdbDigits || name;
    },

    getModeButtonStyle(mode) {
      const active = this.viewMode === mode;
      return {
        fontSize: '12px',
        cursor: 'pointer',
        borderRadius: '7px',
        padding: '4px 8px',
        border: '1px solid #bbb',
        backgroundColor: active ? '#ddd' : 'whitesmoke'
      };
    },

    getLibraryButtonStyle() {
      const enabled = !this._libBusy;
      return {
        fontSize: '12px',
        cursor: enabled ? 'pointer' : 'not-allowed',
        borderRadius: '7px',
        padding: '4px 8px',
        border: '1px solid #bbb',
        backgroundColor: 'whitesmoke',
        color: '#000'
      };
    },

    getApplyButtonStyle() {
      const enabled = this.applyEnabled;
      const applying = !!this.applyInProgress;
      return {
        fontSize: '12px',
        cursor: enabled ? 'pointer' : 'not-allowed',
        borderRadius: '7px',
        padding: '4px 8px',
        border: '1px solid #bbb',
        backgroundColor: applying ? '#ffd6d6' : (enabled ? 'whitesmoke' : '#eee'),
        color: applying ? '#a00' : (enabled ? '#000' : '#777')
      };
    },

    getDelButtonStyle() {
      const enabled = this.deleteEnabled;
      return {
        fontSize: '12px',
        cursor: enabled ? 'pointer' : 'not-allowed',
        borderRadius: '7px',
        padding: '4px 8px',
        border: '1px solid #bbb',
        backgroundColor: enabled ? 'whitesmoke' : '#eee',
        color: enabled ? '#000' : '#777'
      };
    },

    async startLibraryRefresh() {
      if (this._libBusy) return;

      this.stopLibraryPolling();
      this.libraryProgressText = '';
      this._libTaskId = null;
      this._libBusy = true;

      let res = null;
      try {
        res = await emby.refreshLib();
      } catch (e) {
        this._libBusy = false;
        this.libraryProgressText = 'error';
        return;
      }

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

    stopLibraryPolling() {
      if (this._libPollTimer) {
        clearTimeout(this._libPollTimer);
        this._libPollTimer = null;
      }
    },

    async pollLibraryStatus() {
      if (!this._libTaskId) {
        this._libBusy = false;
        return;
      }

      let res = null;
      try {
        res = await emby.taskStatus(this._libTaskId);
      } catch (e) {
        this._libBusy = false;
        this._libTaskId = null;
        this.libraryProgressText = 'error';
        return;
      }
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
        this.libraryProgressText = '100%';
        evtBus.emit('library-refresh-complete');
      } else if (res?.status) {
        this.libraryProgressText = String(res.status);
      }
    },

    async selectMode(mode) {
      this.viewMode = mode;
      await this.ensureSearched();
      this.rebuildVisibleItems();
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

    getItemCardKey(item) {
      // All cards should have a stable non-empty key.
      return String(item?.key || item?.id || '');
    },

    handleItemClick(_event, item) {
      const event = _event || {};
      const key = this.getItemCardKey(item);
      this.clickedItemKeys.add(key);

      // Search mode: show all subs like before with no selection.
      if (this.viewMode === 'search') {
        if (item?.season != null) this.selectedSeason = Number(item.season);
        if (item?.episode != null) this.selectedEpisode = Number(item.episode);
        return;
      }

      const isCtrl = !!(event.ctrlKey || event.metaKey);
      const isShift = !!event.shiftKey;

      // Maintain "primary" selection for existing navigation/memory logic.
      this.selectedCardKey = key;

      if (this.viewMode === 'season') {
        this.selectedSeason = item?.season != null ? Number(item.season) : null;
        this.selectedEpisode = null;
      }

      if (this.viewMode === 'episode') {
        this.selectedSeason = item?.season != null ? Number(item.season) : (this.selectedSeason != null ? this.selectedSeason : null);
        this.selectedEpisode = item?.episode != null ? Number(item.episode) : null;
        if (this.selectedSeason != null && this.selectedEpisode != null) {
          this._selectedEpisodeBySeason[String(this.selectedSeason)] = this.selectedEpisode;
        }
      }

      if (this.viewMode === 'files') {
        if (item?.season != null) this.selectedSeason = Number(item.season);
        if (item?.episode != null) this.selectedEpisode = Number(item.episode);
      }

      // Multi-select handling (Season/Episode/Files).
      const mode = this.viewMode;
      const sel = this.getSelectionKeys(mode);

      if (isShift) {
        const anchorKey = this.getRangeAnchorKey(mode, key, sel);
        const rangeKeys = this.getRangeKeysBetween(anchorKey, key);
        // Shift-click extends selection; it should never remove existing selections.
        const newSel = Array.from(new Set([...(sel || []), ...rangeKeys]));
        this.setSelectionKeys(mode, newSel);
      } else if (isCtrl) {
        const idx = sel.indexOf(key);
        if (idx >= 0) {
          const next = sel.slice();
          next.splice(idx, 1);
          this.setSelectionKeys(mode, next);
        } else {
          this.setSelectionKeys(mode, [...sel, key]);
        }
      } else {
        this.setSelectionKeys(mode, [key]);
      }

      this._lastClickedKeyByMode[mode] = key;

      // Prevent shift-click text selection in the UI.
      if (isShift) {
        try {
          const selection = window.getSelection ? window.getSelection() : null;
          if (selection && typeof selection.removeAllRanges === 'function') selection.removeAllRanges();
        } catch {
          // ignore
        }
        try {
          if (typeof event.preventDefault === 'function') event.preventDefault();
        } catch {
          // ignore
        }
      }

      if (this.viewMode === 'files') {
        const s = this.selectedSeason;
        const e = this.selectedEpisode;
        if (s != null && e != null && key) {
          this._selectedFileKeyBySeasonEpisode[`${s}-${e}`] = key;
        }
      }

      // Prune dependent selections.
      if (mode === 'season') {
        this.pruneEpisodeSelectionsToSelectedSeasons();
        this.pruneFileSelectionsToSelectedEpisodes();
      }
      if (mode === 'episode') {
        this.pruneFileSelectionsToSelectedEpisodes();
      }
    },

    parseSeasonKey(key) {
      const m = /^season-(\d+)$/.exec(String(key || ''));
      return m ? Number(m[1]) : null;
    },

    parseEpisodeKey(key) {
      const m = /^episode-(\d+)-(\d+)$/.exec(String(key || ''));
      if (!m) return { season: null, episode: null };
      return { season: Number(m[1]), episode: Number(m[2]) };
    },

    getSelectedSeasonNums() {
      const out = [];
      for (const k of (Array.isArray(this.selectedSeasonKeys) ? this.selectedSeasonKeys : [])) {
        const s = this.parseSeasonKey(k);
        if (Number.isFinite(s)) out.push(s);
      }
      out.sort((a, b) => a - b);
      return out;
    },

    getSelectedEpisodePairs() {
      const out = [];
      for (const k of (Array.isArray(this.selectedEpisodeKeys) ? this.selectedEpisodeKeys : [])) {
        const { season, episode } = this.parseEpisodeKey(k);
        if (Number.isFinite(season) && Number.isFinite(episode)) out.push({ season, episode });
      }
      out.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
      return out;
    },

    buildBySeasonIndex(validEntries) {
      const bySeason = new Map();
      for (const it of (Array.isArray(validEntries) ? validEntries : [])) {
        const s = it?.season;
        const e = it?.episode;
        if (s == null || e == null) continue;
        if (!bySeason.has(s)) bySeason.set(s, new Map());
        const seasonMap = bySeason.get(s);
        if (!seasonMap.has(e)) seasonMap.set(e, []);
        seasonMap.get(e).push(it);
      }
      return bySeason;
    },

    getMapSeasonNums(mapObj) {
      if (!mapObj || typeof mapObj !== 'object') return [];
      return Object.keys(mapObj)
        .map(k => Number(k))
        .filter(n => Number.isFinite(n))
        .sort((a, b) => a - b);
    },

    getMapEpisodeNums(mapObj, season) {
      if (!mapObj || typeof mapObj !== 'object' || season == null) return [];
      const seasonObj = mapObj[String(season)];
      if (!seasonObj || typeof seasonObj !== 'object') return [];
      return Object.keys(seasonObj)
        .map(k => Number(k))
        .filter(n => Number.isFinite(n))
        .sort((a, b) => a - b);
    },

    computeEpisodeCardsForSelectedSeasons(selectedSeasons, bySeason, mapObj) {
      const seasons = Array.isArray(selectedSeasons) ? selectedSeasons.filter(n => Number.isFinite(n)) : [];
      const out = [];
      for (const s of seasons) {
        const mapEps = this.getMapEpisodeNums(mapObj, s);
        const seasonMap = bySeason?.get(s) || null;
        const eps = mapEps.length ? mapEps : (seasonMap ? Array.from(seasonMap.keys()).sort((a, b) => a - b) : []);
        for (const e of eps) {
          const fileCount = (seasonMap && Array.isArray(seasonMap.get(e))) ? seasonMap.get(e).length : 0;
          const sStr = String(s).padStart(2, '0');
          const eStr = String(e).padStart(2, '0');
          const missing = fileCount === 0;
          out.push({
            key: `episode-${s}-${e}`,
            season: s,
            episode: e,
            fileCount,
            line1: missing
              ? `S${sStr}E${eStr} subs missing`
              : `S${sStr}E${eStr} | ${fileCount} files`,
            missing,
            lineColor: missing ? '#a00' : '#333',
            uploader: ''
          });
        }
      }
      return out;
    },

    computeFileCardsForSelectedEpisodes(selectedPairs, bySeason) {
      const pairs = Array.isArray(selectedPairs) ? selectedPairs : [];
      const fileCards = [];
      for (const p of pairs) {
        const s = p?.season;
        const e = p?.episode;
        if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
        const seasonMap = bySeason?.get(s) || null;
        const entries = (seasonMap && Array.isArray(seasonMap.get(e))) ? [...seasonMap.get(e)] : [];
        for (const v of entries) {
          const files = v?.entry?.attributes?.files;
          if (!Array.isArray(files) || !files.length) continue;
          for (const f of files) {
            const card = this.buildFileCardItem(v, f);
            if (card) fileCards.push(card);
          }
        }
      }

      fileCards.sort((a, b) => {
        const sA = a?.season != null ? Number(a.season) : Number.POSITIVE_INFINITY;
        const sB = b?.season != null ? Number(b.season) : Number.POSITIVE_INFINITY;
        if (sA !== sB) return sA - sB;
        const eA = a?.episode != null ? Number(a.episode) : Number.POSITIVE_INFINITY;
        const eB = b?.episode != null ? Number(b.episode) : Number.POSITIVE_INFINITY;
        if (eA !== eB) return eA - eB;

        const pA = (a.uploader || '').trim();
        const pB = (b.uploader || '').trim();
        const pAEmpty = !pA;
        const pBEmpty = !pB;
        if (pAEmpty !== pBEmpty) return pAEmpty ? 1 : -1;
        const pCmp = pA.localeCompare(pB, undefined, { sensitivity: 'base' });
        if (pCmp !== 0) return pCmp;

        const lA = (a.line1 || '').trim();
        const lB = (b.line1 || '').trim();
        return lA.localeCompare(lB, undefined, { sensitivity: 'base' });
      });

      return fileCards;
    },

    pruneEpisodeSelectionsToSelectedSeasons() {
      const selectedSeasons = new Set(this.getSelectedSeasonNums());
      if (!selectedSeasons.size) {
        this.selectedEpisodeKeys = [];
        return;
      }
      const keep = [];
      for (const k of (Array.isArray(this.selectedEpisodeKeys) ? this.selectedEpisodeKeys : [])) {
        const { season } = this.parseEpisodeKey(k);
        if (Number.isFinite(season) && selectedSeasons.has(season)) keep.push(k);
      }

      const validEntries = Array.isArray(this._validEntries) ? this._validEntries : [];
      const bySeason = this.buildBySeasonIndex(validEntries);
      const mapObj = this._seriesMapObj && typeof this._seriesMapObj === 'object' ? this._seriesMapObj : null;
      const episodeCards = this.computeEpisodeCardsForSelectedSeasons(Array.from(selectedSeasons).sort((a, b) => a - b), bySeason, mapObj);
      const allowedKeys = new Set(episodeCards.map(c => c.key));
      const pruned = keep.filter(k => allowedKeys.has(k));
      if (pruned.length) {
        this.selectedEpisodeKeys = pruned;
        return;
      }
      // If prune removes all selections, select the top card.
      this.selectedEpisodeKeys = episodeCards.length ? [episodeCards[0].key] : [];
    },

    pruneFileSelectionsToSelectedEpisodes() {
      const pairs = this.getSelectedEpisodePairs();
      if (!pairs.length) {
        this.selectedFileKeys = [];
        return;
      }
      const validEntries = Array.isArray(this._validEntries) ? this._validEntries : [];
      const bySeason = this.buildBySeasonIndex(validEntries);
      const fileCards = this.computeFileCardsForSelectedEpisodes(pairs, bySeason);
      const allowedKeys = new Set(fileCards.map(c => c.key));
      const existing = Array.isArray(this.selectedFileKeys) ? this.selectedFileKeys : [];
      const pruned = existing.filter(k => allowedKeys.has(k));
      if (pruned.length) {
        this.selectedFileKeys = pruned;
        return;
      }
      // If prune removes all selections, select the top card.
      this.selectedFileKeys = fileCards.length ? [fileCards[0].key] : [];
    },

    getSelectionKeys(mode) {
      if (mode === 'season') return Array.isArray(this.selectedSeasonKeys) ? this.selectedSeasonKeys : [];
      if (mode === 'episode') return Array.isArray(this.selectedEpisodeKeys) ? this.selectedEpisodeKeys : [];
      if (mode === 'files') return Array.isArray(this.selectedFileKeys) ? this.selectedFileKeys : [];
      return [];
    },

    setSelectionKeys(mode, keys) {
      const next = Array.isArray(keys) ? keys.filter(Boolean) : [];
      if (mode === 'season') this.selectedSeasonKeys = next;
      if (mode === 'episode') this.selectedEpisodeKeys = next;
      if (mode === 'files') this.selectedFileKeys = next;
    },

    getRangeAnchorKey(mode, clickedKey, selectedKeys) {
      const last = this._lastClickedKeyByMode?.[mode];
      if (last) return last;
      const sel = Array.isArray(selectedKeys) ? selectedKeys : [];
      if (sel.length === 1) return sel[0];
      return clickedKey;
    },

    getRangeKeysBetween(anchorKey, clickedKey) {
      const list = Array.isArray(this.items) ? this.items : [];
      const keys = list.map(it => this.getItemCardKey(it)).filter(Boolean);
      const a = keys.indexOf(String(anchorKey || ''));
      const b = keys.indexOf(String(clickedKey || ''));
      if (a < 0 || b < 0) return [String(clickedKey || '')].filter(Boolean);
      const start = Math.min(a, b);
      const end = Math.max(a, b);
      return keys.slice(start, end + 1);
    },

    isClicked(item) {
      return this.clickedItemKeys.has(this.getItemCardKey(item));
    },

    getCardStyle(item) {
      if (this.viewMode === 'search') {
        return {
          padding: '8px',
          background: '#fff',
          borderRadius: '5px',
          border: '1px solid #ddd',
          cursor: 'pointer',
          transition: 'all 0.2s',
          position: 'relative'
        };
      }

      const key = this.getItemCardKey(item);
      const selectedKeys = new Set(this.getSelectionKeys(this.viewMode));
      const isSelected = key && selectedKeys.has(key);
      let bgColor = item?.missing ? '#ffd6d6' : '#fff';
      if (isSelected) {
        bgColor = '#fffacd';
      }
      return {
        padding: '8px',
        background: bgColor,
        borderRadius: '5px',
        border: '1px solid #ddd',
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative',
        userSelect: 'none'
      };
    },

    getShowImdbId() {
      const show = this.currentShow || this.activeShow;
      const imdb = show?.ProviderIds?.Imdb || show?.ProviderIds?.imdb || show?.ProviderIds?.IMDb || show?.ProviderIds?.IMDB;
      if (!imdb) return '';
      const raw = String(imdb).trim();
      const digits = raw.toLowerCase().startsWith('tt') ? raw.slice(2) : raw;
      const digitsOnly = digits.replace(/\D/g, '');
      const normalized = digitsOnly.replace(/^0+/, '');
      return normalized || digitsOnly;
    },

    getCurrentShowName() {
      const show = this.currentShow || this.activeShow;
      const name = show?.Name != null ? String(show.Name) : '';
      return name || '';
    },

    buildFileIdObjsFromValidEntries(validEntries) {
      const showName = this.getCurrentShowName();
      if (!showName) return [];
      const out = [];
      const seen = new Set();
      for (const v of (Array.isArray(validEntries) ? validEntries : [])) {
        const season = v?.season != null ? Number(v.season) : null;
        const episode = v?.episode != null ? Number(v.episode) : null;
        if (!Number.isFinite(season) || !Number.isFinite(episode)) continue;
        const files = v?.entry?.attributes?.files;
        if (!Array.isArray(files) || !files.length) continue;
        for (const f of files) {
          const fileId = f?.file_id;
          if (fileId == null) continue;
          const key = `${fileId}-${season}-${episode}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            file_id: Number(fileId),
            showName,
            season,
            episode,
          });
        }
      }
      return out;
    },

    buildFileIdObjsPayload() {
      const validEntries = Array.isArray(this._validEntries) ? this._validEntries : [];
      if (this.viewMode === 'search') {
        return this.buildFileIdObjsFromValidEntries(validEntries);
      }

      if (this.viewMode === 'season') {
        const selected = new Set(this.selectedSeasonKeys || []);
        const seasons = new Set(
          (Array.isArray(this.items) ? this.items : [])
            .filter(it => selected.has(this.getItemCardKey(it)))
            .map(it => (it?.season != null ? Number(it.season) : null))
            .filter(n => Number.isFinite(n))
        );
        return this.buildFileIdObjsFromValidEntries(validEntries.filter(v => seasons.has(v?.season)));
      }

      if (this.viewMode === 'episode') {
        const selected = new Set(this.selectedEpisodeKeys || []);
        const pairs = new Set(
          (Array.isArray(this.items) ? this.items : [])
            .filter(it => selected.has(this.getItemCardKey(it)))
            .map(it => {
              const s = it?.season != null ? Number(it.season) : null;
              const e = it?.episode != null ? Number(it.episode) : null;
              if (!Number.isFinite(s) || !Number.isFinite(e)) return '';
              return `${s}-${e}`;
            })
            .filter(Boolean)
        );
        return this.buildFileIdObjsFromValidEntries(validEntries.filter(v => pairs.has(`${v?.season}-${v?.episode}`)));
      }

      if (this.viewMode === 'files') {
        const showName = this.getCurrentShowName();
        if (!showName) return [];
        const selected = new Set(this.selectedFileKeys || []);
        const out = [];
        const seen = new Set();
        for (const it of (Array.isArray(this.items) ? this.items : [])) {
          if (!selected.has(this.getItemCardKey(it))) continue;
          const fileId = it?.file_id;
          const season = it?.season;
          const episode = it?.episode;
          if (fileId == null || season == null || episode == null) continue;
          const key = `${fileId}-${season}-${episode}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ file_id: Number(fileId), showName, season: Number(season), episode: Number(episode) });
        }
        return out;
      }

      return [];
    },

    async applyClick() {
      if (this.applyInProgress) return;
      await this.ensureSearched();
      const payload = this.buildFileIdObjsPayload();
      if (!payload.length) return;
      this.error = null;
      this.applyInProgress = true;
      try {
        const timeoutMs = 120000;
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`applySubFiles: timed out after ${timeoutMs / 1000}s`)), timeoutMs);
        });

        const res = await Promise.race([applySubFiles(payload), timeoutPromise]);

        if (res && typeof res === 'object' && Array.isArray(res.applied)) {
          this.recordAppliedFileIds(res.applied);
        }

        // If server returns a partial-success object, show failures in a modal.
        if (res && typeof res === 'object' && res.ok && Array.isArray(res.failures)) {
          this.applyFailures = res.failures;
          this.showApplyFailuresModal = res.failures.length > 0;
        } else if (res && typeof res === 'object' && typeof res.error === 'string') {
          this.error = res.error;
        }
      } catch (e) {
        const msg = (() => {
          if (!e) return '';
          if (typeof e === 'string') return e;
          if (typeof e === 'object' && typeof e.error === 'string') return e.error;
          if (typeof e.message === 'string') return e.message;
          try {
            return JSON.stringify(e);
          } catch {
            return String(e);
          }
        })();
        this.error = msg;
      } finally {
        this.applyInProgress = false;
      }
    },

    async deleteClick() {
      if (this.delInProgress) return;
      await this.ensureSearched();
      const payload = this.buildFileIdObjsPayload();
      if (!payload.length) return;
      this.error = null;
      this.delInProgress = true;
      try {
        const timeoutMs = 120000;
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`deleteSubFiles: timed out after ${timeoutMs / 1000}s`)), timeoutMs);
        });
        const res = await Promise.race([deleteSubFiles(payload), timeoutPromise]);
        if (res && typeof res === 'object' && Array.isArray(res.applied)) {
          this.recordAppliedFileIds(res.applied);
        }
        if (res && typeof res === 'object' && typeof res.error === 'string') {
          this.error = res.error;
        }
      } catch (e) {
        const msg = (() => {
          if (!e) return '';
          if (typeof e === 'string') return e;
          if (typeof e === 'object' && typeof e.error === 'string') return e.error;
          if (typeof e.message === 'string') return e.message;
          try {
            return JSON.stringify(e);
          } catch {
            return String(e);
          }
        })();
        this.error = msg;
      } finally {
        this.delInProgress = false;
      }
    },

    closeApplyFailuresModal() {
      this.showApplyFailuresModal = false;
    },

    getAppliedFileIdsStorageKey() {
      return 'tv-series-subs-applied-file-ids';
    },

    loadAppliedFileIdsFromStorage() {
      try {
        const raw = localStorage.getItem(this.getAppliedFileIdsStorageKey());
        if (!raw) {
          this._appliedFileIds = [];
          return;
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
          this._appliedFileIds = [];
          return;
        }
        const out = [];
        const seen = new Set();
        for (const v of parsed) {
          const n = Number(v);
          if (!Number.isFinite(n)) continue;
          if (seen.has(n)) continue;
          seen.add(n);
          out.push(n);
        }
        if (out.length > 1000) out.splice(0, out.length - 1000);
        this._appliedFileIds = out;
      } catch {
        this._appliedFileIds = [];
      }
    },

    saveAppliedFileIdsToStorage() {
      try {
        const arr = Array.isArray(this._appliedFileIds) ? this._appliedFileIds : [];
        localStorage.setItem(this.getAppliedFileIdsStorageKey(), JSON.stringify(arr));
      } catch {
        // ignore
      }
    },

    recordAppliedFileIds(fileIds) {
      const current = Array.isArray(this._appliedFileIds) ? this._appliedFileIds.slice() : [];
      const seen = new Set(current);
      for (const v of (Array.isArray(fileIds) ? fileIds : [])) {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        if (seen.has(n)) continue;
        seen.add(n);
        current.push(n);
      }
      if (current.length > 1000) current.splice(0, current.length - 1000);
      this._appliedFileIds = current;
      this.saveAppliedFileIdsToStorage();
    },

    isAppliedFile(item) {
      const fileId = item?.file_id;
      if (fileId == null) return false;
      const n = Number(fileId);
      if (!Number.isFinite(n)) return false;
      const arr = Array.isArray(this._appliedFileIds) ? this._appliedFileIds : [];
      // Keep array for ordered storage; check membership via linear scan (max 1000).
      return arr.includes(n);
    },

    formatApplyFailure(f) {
      if (f == null) return '';
      if (typeof f === 'string') return f;
      if (typeof f === 'object') {
        const fileId = f.file_id != null ? String(f.file_id) : '';
        const showName = f.showName != null ? String(f.showName) : '';
        const season = f.season != null ? String(f.season) : '';
        const episode = f.episode != null ? String(f.episode) : '';
        const reason = f.reason != null
          ? String(f.reason)
          : (f.error != null ? String(f.error) : (f.message != null ? String(f.message) : ''));

        const parts = [
          `file_id=${fileId || '?'}`,
          `showName=${showName || '?'}`,
          `season=${season || '?'}`,
          `episode=${episode || '?'}`,
          `reason=${reason || '?'}`,
        ];
        return parts.join(' | ');
      }
      return String(f);
    },

    parseSeasonEpisodeFromText(text) {
      const raw = String(text || '').trim();
      if (!raw) return { season: null, episode: null };

      let bestSeason = null;
      let bestEpisode = null;

      let parsed = null;
      try {
        const parser = parseTorrentTitle?.parse
          ? parseTorrentTitle.parse
          : (typeof parseTorrentTitle === 'function' ? parseTorrentTitle : null);
        parsed = parser ? parser(raw) : null;
      } catch {
        parsed = null;
      }

      const season = parsed?.season != null ? Number(parsed.season) : null;
      const episode = parsed?.episode != null ? Number(parsed.episode) : null;

      const normalizedSeason = Number.isFinite(season) ? season : null;
      const normalizedEpisode = Number.isFinite(episode) ? episode : null;
      if (normalizedSeason != null) bestSeason = normalizedSeason;
      if (normalizedEpisode != null) bestEpisode = normalizedEpisode;
      if (bestSeason != null && bestEpisode != null) {
        return { season: bestSeason, episode: bestEpisode };
      }

      // Prefer explicit patterns first.
      let m = raw.match(/\bS(\d{1,2})\s*E(\d{1,2})\b/i);
      if (m) {
        const s = Number(m[1]);
        const e = Number(m[2]);
        return {
          season: Number.isFinite(s) ? s : null,
          episode: Number.isFinite(e) ? e : null,
        };
      }

      m = raw.match(/\b(\d{1,2})\s*[xX]\s*(\d{1,2})\b/);
      if (m) {
        const s = Number(m[1]);
        const e = Number(m[2]);
        return {
          season: Number.isFinite(s) ? s : null,
          episode: Number.isFinite(e) ? e : null,
        };
      }

      // OpenSubtitles sometimes uses "Episode 109" meaning S01E09 (or S11E09, etc).
      // Interpret 3-4 digits as season + 2-digit episode.
      m = raw.match(/\bEpisode\s+(\d{3,4})\b/i);
      if (m) {
        const token = String(m[1]);
        const len = token.length;
        const seasonPart = len === 3 ? token.slice(0, 1) : token.slice(0, 2);
        const episodePart = token.slice(len - 2);
        const s = Number(seasonPart);
        const e = Number(episodePart);
        return {
          season: Number.isFinite(s) ? s : null,
          episode: Number.isFinite(e) ? e : null,
        };
      }

      // Fallback parsing for compact formats like "803" (S08E03) or "1103" (S11E03)
      // that sometimes appear in OpenSubtitles strings.
      const compactMatches = raw.matchAll(/(?:^|[^0-9])(\d{3,4})(?:[^0-9]|$)/g);
      for (const cm of compactMatches) {
        const token = cm?.[1] ? String(cm[1]) : '';
        if (!token) continue;
        const len = token.length;
        const seasonPart = len === 3 ? token.slice(0, 1) : token.slice(0, 2);
        const episodePart = token.slice(len - 2);
        const s = Number(seasonPart);
        const e = Number(episodePart);
        if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
        if (s <= 0 || s > 60) continue;
        if (e <= 0 || e > 99) continue;
        return { season: s, episode: e };
      }

      return { season: bestSeason, episode: bestEpisode };
    },

    parseSeasonEpisodeFromEntry(entry) {
      const candidates = [];
      const release = entry?.attributes?.release;
      if (release) candidates.push(release);

      const url = entry?.attributes?.url;
      if (url) candidates.push(url);

      const files = entry?.attributes?.files;
      if (Array.isArray(files)) {
        for (const f of files) {
          const name = f?.file_name;
          if (name) candidates.push(name);
        }
      }

      let bestSeason = null;
      let bestEpisode = null;
      for (const c of candidates) {
        const se = this.parseSeasonEpisodeFromText(c);
        if (bestSeason == null && se?.season != null) bestSeason = se.season;
        if (bestEpisode == null && se?.episode != null) bestEpisode = se.episode;
        if (bestSeason != null && bestEpisode != null) break;
      }

      // Final fallback: concatenate all available text and retry parsing.
      // This catches cases where S and E are split across fields.
      if ((bestSeason == null || bestEpisode == null) && candidates.length) {
        const combined = candidates.join(' ');
        const se = this.parseSeasonEpisodeFromText(combined);
        if (bestSeason == null && se?.season != null) bestSeason = se.season;
        if (bestEpisode == null && se?.episode != null) bestEpisode = se.episode;
      }

      return { season: bestSeason, episode: bestEpisode };
    },

    buildCardItemFromResult(entry) {
      const id = entry?.id != null ? String(entry.id) : '';
      const release = entry?.attributes?.release != null ? String(entry.attributes.release) : '';
      let uploader = entry?.attributes?.uploader?.name != null ? String(entry.attributes.uploader.name) : '';
      if (uploader && uploader.trim().toLowerCase() === 'anonymous') uploader = '';
      const aiTranslated = entry?.attributes?.ai_translated;
      const machineTranslated = entry?.attributes?.machine_translated;

      const { season, episode } = this.parseSeasonEpisodeFromEntry(entry);

      const sStr = season != null ? String(season).padStart(2, '0') : '??';
      const eStr = episode != null ? String(episode).padStart(2, '0') : '??';

      const line1 = `S${sStr}E${eStr} ${release}`.trim();

      const parts = [];
      if (aiTranslated) parts.push(String(aiTranslated));
      if (machineTranslated) parts.push(String(machineTranslated));
      const line2 = parts.length ? `     ${parts.join(' ')}` : '';

      return {
        key: id ? `sub-${id}` : (release ? `sub-${release}` : ''),
        line1,
        line2,
        uploader,
        season,
        episode,
        raw: entry,
      };
    },

    buildFileCardItem(validEntry, fileObj) {
      const fileId = fileObj?.file_id;
      const season = validEntry?.season;
      const episode = validEntry?.episode;
      const entry = validEntry?.entry;
      if (fileId == null || season == null || episode == null || !entry) return null;

      const release = entry?.attributes?.release != null ? String(entry.attributes.release) : '';
      let uploader = entry?.attributes?.uploader?.name != null ? String(entry.attributes.uploader.name) : '';
      if (uploader && uploader.trim().toLowerCase() === 'anonymous') uploader = '';

      const sStr = String(Number(season)).padStart(2, '0');
      const eStr = String(Number(episode)).padStart(2, '0');
      const line1 = `S${sStr}E${eStr} ${release}`.trim();

      return {
        key: `file-${fileId}`,
        file_id: Number(fileId),
        season: Number(season),
        episode: Number(episode),
        uploader,
        line1,
        line2: '',
        raw: entry,
      };
    },

    shouldShowSeDivider(index) {
      if (this.viewMode !== 'search') return false;
      if (index === 0) return true;
      if (index < 0) return false;
      const prev = this.items[index - 1];
      const cur = this.items[index];
      if (!prev || !cur) return false;
      return prev.season !== cur.season || prev.episode !== cur.episode;
    },

    getSeDividerText(index) {
      const item = this.items[index];
      if (!item) return '================';
      const sStr = item.season != null ? String(item.season).padStart(2, '0') : '??';
      const eStr = item.episode != null ? String(item.episode).padStart(2, '0') : '??';
      return `======== S${sStr}E${eStr} ========`;
    },

    scrollGroup(direction) {
      const scroller = this.$refs?.scroller;
      if (!scroller) return;

      const dividers = Array.from(scroller.querySelectorAll('.se-divider'));
      if (!dividers.length) return;

      const header = scroller.querySelector('#header');
      const headerOffset = header ? (header.offsetHeight || 0) : 0;

      // "Anchor" is the y-position just under the sticky header.
      // Use this and each divider's offsetTop to find the next/previous group.
      const eps = 2;
      const nearThreshold = 30;
      const anchor = (scroller.scrollTop || 0) + headerOffset + 4;
      const tops = dividers.map(el => el.offsetTop || 0);

      // Find the divider currently aligned under the header (if any).
      let alignedIndex = -1;
      let alignedDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < tops.length; i++) {
        const dist = Math.abs(tops[i] - anchor);
        if (dist <= nearThreshold && dist < alignedDist) {
          alignedDist = dist;
          alignedIndex = i;
        }
      }

      // Find the last divider above the anchor (for aligning on Up).
      let aboveIndex = -1;
      for (let i = 0; i < tops.length; i++) {
        if (tops[i] <= anchor + eps) aboveIndex = i;
        else break;
      }

      let targetIndex = 0;
      if (direction > 0) {
        // Down: if a divider is already aligned, move to the next group; otherwise go to the next divider below.
        if (alignedIndex >= 0) {
          targetIndex = Math.min(dividers.length - 1, alignedIndex + 1);
        } else {
          const nextIndex = tops.findIndex(t => t > anchor + eps);
          targetIndex = nextIndex >= 0 ? nextIndex : (dividers.length - 1);
        }
      } else {
        // Up: if a divider is aligned, move to previous group; otherwise align the current group (don't skip).
        if (alignedIndex >= 0) {
          targetIndex = Math.max(0, alignedIndex - 1);
        } else {
          targetIndex = aboveIndex >= 0 ? aboveIndex : 0;
        }
      }

      const target = dividers[targetIndex];
      if (!target) return;
      const targetTop = Math.max(0, (target.offsetTop || 0) - headerOffset - 4);
      scroller.scrollTo({ top: targetTop, behavior: 'smooth' });
    },

    async fetchSubsPage(imdbIdDigits, page) {
      try {
        // WebSocket RPC to tv-series-srvr (no local proxy)
        return await subsSearch({ imdb_id: imdbIdDigits, page });
      } catch (e) {
        const msg = (() => {
          if (!e) return '';
          if (typeof e === 'string') return e;
          if (typeof e === 'object' && typeof e.error === 'string') return e.error;
          if (typeof e.message === 'string') return e.message;
          try {
            return JSON.stringify(e);
          } catch {
            return String(e);
          }
        })();
        throw new Error(msg);
      }
    },

    async fetchSubsPageWithRetry(imdbIdDigits, page) {
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          return await this.fetchSubsPage(imdbIdDigits, page);
        } catch (e) {
          lastErr = e;
          await this.sleep(250 * (attempt + 1) * (attempt + 1));
        }
      }
      throw lastErr;
    },

    rebuildVisibleItems() {
      const validEntries = Array.isArray(this._validEntries) ? this._validEntries : [];

      const containsKey = (arr, key) => {
        if (!key) return false;
        if (!Array.isArray(arr) || !arr.length) return false;
        for (let i = 0; i < arr.length; i++) {
          if (this.getItemCardKey(arr[i]) === key) return true;
        }
        return false;
      };

      const bySeason = this.buildBySeasonIndex(validEntries);

      const seasonNums = Array.from(bySeason.keys()).sort((a, b) => a - b);

      // Prefer series map seasons/episodes when available.
      const mapObj = this._seriesMapObj && typeof this._seriesMapObj === 'object' ? this._seriesMapObj : null;
      const mapSeasonNums = this.getMapSeasonNums(mapObj);

      const pickFirstSeason = () => {
        const list = mapSeasonNums.length ? mapSeasonNums : seasonNums;
        if (this.selectedSeason != null) {
          if (mapSeasonNums.length && list.includes(this.selectedSeason)) return this.selectedSeason;
          if (!mapSeasonNums.length && bySeason.has(this.selectedSeason)) return this.selectedSeason;
        }
        return list.length ? list[0] : null;
      };
      const pickFirstEpisode = (season) => {
        if (season == null) return null;
        const mapEps = this.getMapEpisodeNums(mapObj, season);
        if (mapEps.length) {
          if (this.selectedEpisode != null && mapEps.includes(this.selectedEpisode)) return this.selectedEpisode;
          return mapEps[0];
        }
        const seasonMap = bySeason.get(season);
        const eps = seasonMap ? Array.from(seasonMap.keys()).sort((a, b) => a - b) : [];
        if (this.selectedEpisode != null && seasonMap && seasonMap.has(this.selectedEpisode)) return this.selectedEpisode;
        return eps.length ? eps[0] : null;
      };

      if (this.viewMode === 'season') {
        const seasons = mapSeasonNums.length ? mapSeasonNums : seasonNums;
        const seasonCards = seasons.map((s) => {
          const mapEps = this.getMapEpisodeNums(mapObj, s);
          const episodeCount = mapEps.length ? mapEps.length : Array.from((bySeason.get(s) || new Map()).keys()).length;
          const hasAnySubs = bySeason.has(s);
          const missing = !hasAnySubs;
          const seasonMap = bySeason.get(s) || null;
          let fileCount = 0;
          if (seasonMap && typeof seasonMap === 'object') {
            for (const arr of seasonMap.values()) {
              if (Array.isArray(arr)) fileCount += arr.length;
            }
          }
          return {
            key: `season-${s}`,
            season: s,
            episodeCount,
            fileCount,
            line1: missing
              ? `Season ${s} subs missing`
              : `Season ${s} | ${episodeCount} Episodes | ${fileCount} Files`,
            missing,
            lineColor: missing ? '#a00' : '#333',
            uploader: ''
          };
        });
        this.items = seasonCards;

        // Keep multi-selection if possible; otherwise pick top card.
        const allowed = new Set(seasonCards.map(c => c.key));
        const existing = Array.isArray(this.selectedSeasonKeys) ? this.selectedSeasonKeys : [];
        const pruned = existing.filter(k => allowed.has(k));
        if (pruned.length) {
          this.selectedSeasonKeys = pruned;
        } else {
          const s0 = pickFirstSeason();
          this.selectedSeasonKeys = (s0 != null) ? [`season-${s0}`] : [];
        }
        const primaryKey = this._lastClickedKeyByMode?.season && allowed.has(this._lastClickedKeyByMode.season)
          ? this._lastClickedKeyByMode.season
          : (this.selectedSeasonKeys[0] || '');
        this.selectedCardKey = primaryKey;
        const primarySeason = this.parseSeasonKey(primaryKey);
        if (primarySeason != null) this.selectedSeason = primarySeason;
        return;
      }

      if (this.viewMode === 'episode') {
        const selectedSeasons = this.getSelectedSeasonNums();
        const seasonsToShow = selectedSeasons.length ? selectedSeasons : [pickFirstSeason()].filter(v => v != null);
        const episodeCards = this.computeEpisodeCardsForSelectedSeasons(seasonsToShow, bySeason, mapObj);
        this.items = episodeCards;

        const allowed = new Set(episodeCards.map(c => c.key));
        const existing = Array.isArray(this.selectedEpisodeKeys) ? this.selectedEpisodeKeys : [];
        const pruned = existing.filter(k => allowed.has(k));
        if (pruned.length) {
          this.selectedEpisodeKeys = pruned;
        } else {
          this.selectedEpisodeKeys = episodeCards.length ? [episodeCards[0].key] : [];
        }

        const primaryKey = this._lastClickedKeyByMode?.episode && allowed.has(this._lastClickedKeyByMode.episode)
          ? this._lastClickedKeyByMode.episode
          : (this.selectedEpisodeKeys[0] || '');
        this.selectedCardKey = primaryKey;
        const { season: ps, episode: pe } = this.parseEpisodeKey(primaryKey);
        if (ps != null) this.selectedSeason = ps;
        if (pe != null) this.selectedEpisode = pe;
        return;
      }

      if (this.viewMode === 'files') {
        let pairs = this.getSelectedEpisodePairs();
        if (!pairs.length) {
          const selectedSeasons = this.getSelectedSeasonNums();
          const s0 = selectedSeasons.length ? selectedSeasons[0] : pickFirstSeason();
          const e0 = s0 != null ? pickFirstEpisode(s0) : null;
          if (s0 != null && e0 != null) pairs = [{ season: s0, episode: e0 }];
          this.selectedEpisodeKeys = (s0 != null && e0 != null) ? [`episode-${s0}-${e0}`] : [];
        }

        const fileCards = this.computeFileCardsForSelectedEpisodes(pairs, bySeason);
        this.items = fileCards;

        const allowed = new Set(fileCards.map(c => c.key));
        const existing = Array.isArray(this.selectedFileKeys) ? this.selectedFileKeys : [];
        const pruned = existing.filter(k => allowed.has(k));
        if (pruned.length) {
          this.selectedFileKeys = pruned;
        } else {
          this.selectedFileKeys = fileCards.length ? [fileCards[0].key] : [];
        }

        const primaryKey = this._lastClickedKeyByMode?.files && allowed.has(this._lastClickedKeyByMode.files)
          ? this._lastClickedKeyByMode.files
          : (this.selectedFileKeys[0] || '');
        this.selectedCardKey = primaryKey;
        const primaryItem = Array.isArray(fileCards) ? fileCards.find(it => it.key === primaryKey) : null;
        if (primaryItem?.season != null) this.selectedSeason = Number(primaryItem.season);
        if (primaryItem?.episode != null) this.selectedEpisode = Number(primaryItem.episode);
        return;
      }

      // search (default)
      const allFileItems = validEntries
        .slice()
        .sort((a, b) => {
          const sA = a.season != null ? a.season : Number.POSITIVE_INFINITY;
          const sB = b.season != null ? b.season : Number.POSITIVE_INFINITY;
          if (sA !== sB) return sA - sB;
          const eA = a.episode != null ? a.episode : Number.POSITIVE_INFINITY;
          const eB = b.episode != null ? b.episode : Number.POSITIVE_INFINITY;
          if (eA !== eB) return eA - eB;
          const uA = (a.uploader || '').trim();
          const uB = (b.uploader || '').trim();
          const uAEmpty = !uA;
          const uBEmpty = !uB;
          if (uAEmpty !== uBEmpty) return uAEmpty ? 1 : -1;
          const uCmp = uA.localeCompare(uB, undefined, { sensitivity: 'base' });
          if (uCmp !== 0) return uCmp;
          const rA = (a.release || '').trim();
          const rB = (b.release || '').trim();
          return rA.localeCompare(rB, undefined, { sensitivity: 'base' });
        })
        .map(x => this.buildCardItemFromResult(x.entry));

      this.items = allFileItems;
      // Search mode shows no selection.
      this.selectedCardKey = '';
    },

    async ensureSearched() {
      const showKey = this.getShowKey(this.currentShow || this.activeShow);
      if (!showKey) return;
      if (this.hasSearched && this._lastSearchShowKey === showKey) {
        this.rebuildVisibleItems();
        return;
      }
      await this.searchClick();
    },

    async searchClick() {
      // Whenever a search is done, switch mode to Search.
      this.viewMode = 'search';

      const token = ++this._searchToken;

      this.loading = true;
      this.error = null;
      this.hasSearched = true;
      this.items = [];
      this.searchResults = [];
      this.selectedCardKey = '';
      this.clickedItemKeys = new Set();
      this.totalSubsCount = 0;
      this.validSubsCount = 0;
      this._validEntries = [];

      // Reset selection memory on any new search.
      this.selectedSeason = null;
      this.selectedEpisode = null;
      this._selectedEpisodeBySeason = {};
      this._selectedFileKeyBySeasonEpisode = {};

      try {
        const showKey = this.getShowKey(this.currentShow || this.activeShow);
        this._lastSearchShowKey = showKey;

        // If user switched shows right as we started, abort.
        if (token !== this._searchToken) return;

        const imdbIdDigits = this.getShowImdbId();
        if (!imdbIdDigits) {
          this.error = 'No imdb id found for selected show';
          return;
        }

        const failedPages = [];

        const first = await this.fetchSubsPageWithRetry(imdbIdDigits, 1);
        if (token !== this._searchToken) return;
        const totalPages = Number(first?.total_pages ?? 0);
        const totalCount = Number(first?.total_count ?? 0);
        const perPage = Number(first?.per_page ?? 0);

        if (!totalPages || totalPages === 0) {
          // No subtitles found.
          return;
        }

        const pagesToLoad = (perPage > 0 && totalCount > perPage) ? totalPages : 1;
        const allData = Array.isArray(first?.data) ? [...first.data] : [];

        for (let p = 2; p <= pagesToLoad; p++) {
          try {
            const next = await this.fetchSubsPageWithRetry(imdbIdDigits, p);
            if (token !== this._searchToken) return;
            if (Array.isArray(next?.data)) allData.push(...next.data);
          } catch (e) {
            failedPages.push(p);
          }
        }

        const filtered = allData.filter(d => {
          if (!d || typeof d !== 'object') return false;
          if (d.type !== 'subtitle') return false;
          if (d.attributes?.language !== 'en') return false;
          const ft = d.attributes?.feature_details?.feature_type;
          if (ft !== 'Tvshow' && ft !== 'Episode') return false;
          return true;
        });

        const sortable = filtered.map(entry => {
          const release = entry?.attributes?.release != null ? String(entry.attributes.release) : '';
          let uploader = entry?.attributes?.uploader?.name != null ? String(entry.attributes.uploader.name) : '';
          if (uploader && uploader.trim().toLowerCase() === 'anonymous') uploader = '';
          const { season, episode } = this.parseSeasonEpisodeFromEntry(entry);
          return { entry, release, uploader, season, episode };
        });

        this.totalSubsCount = sortable.length;
        const validOnly = sortable.filter(x => x.season != null && x.episode != null);
        this.validSubsCount = validOnly.length;

        this.searchResults = validOnly.map(x => x.entry);

        this._validEntries = validOnly;
        // Default selected season/episode for Season/Episode/Files views: choose earliest S/E.
        if (validOnly.length) {
          let minSeason = null;
          let minEpisode = null;
          for (const it of validOnly) {
            const s = it?.season != null ? Number(it.season) : null;
            const e = it?.episode != null ? Number(it.episode) : null;
            if (!Number.isFinite(s) || !Number.isFinite(e)) continue;
            if (minSeason == null || s < minSeason || (s === minSeason && e < minEpisode)) {
              minSeason = s;
              minEpisode = e;
            }
          }
          if (minSeason != null) this.selectedSeason = minSeason;
          if (minEpisode != null) this.selectedEpisode = minEpisode;
          if (minSeason != null && minEpisode != null) {
            this._selectedEpisodeBySeason[String(minSeason)] = minEpisode;
          }
        }

        this.rebuildVisibleItems();

        if (failedPages.length) {
          this.error = `Warning: some pages failed to load (${failedPages.join(', ')}). Showing partial results.`;
        }
      } catch (err) {
        if (token !== this._searchToken) return;
        const raw = err?.message || (typeof err === 'string' ? err : (() => {
          try {
            return JSON.stringify(err);
          } catch {
            return String(err);
          }
        })());

        // If server returned a JSON string like {"error":"..."}, show the nested error.
        let msg = raw;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
            msg = parsed.error;
          }
        } catch {
          // ignore
        }

        this.error = msg;
      } finally {
        if (token !== this._searchToken) return;
        this.loading = false;
      }
    }
  }
};
</script>
