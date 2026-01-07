<template lang="pug">
.subs-container(:style="{ height:'100%', width:'100%', display:'flex', justifyContent:'flex-start' }")
  #subs(
    ref="scroller"
    :style="{ height:'100%', width:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', boxSizing:'border-box', backgroundColor:'#fafafa' }"
    @wheel.stop.prevent="handleScaledWheel"
  )

    #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'10px', marginLeft:'0px', marginRight:'0px', marginTop:'-10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'0px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
      div(style="display:flex; justify-content:space-between; align-items:center;")
        div(style="margin-left:20px; display:flex; gap:10px; align-items:baseline;")
          div {{ headerShowName }}
          div(v-if="hasSearched && !loading && totalSubsCount > 0" style="font-size:12px; color:#666; font-weight:normal;") {{ validSubsCount }}/{{ totalSubsCount }}
        div(style="display:flex; gap:8px; margin-left:auto;")
          button(@click.stop="selectMode('search')" :style="getModeButtonStyle('search')") Search
          button(@click.stop="selectMode('season')" :style="getModeButtonStyle('season')") Season
          button(@click.stop="selectMode('episode')" :style="getModeButtonStyle('episode')") Episode
          button(@click.stop="selectMode('files')" :style="getModeButtonStyle('files')") Files
          button(@click.stop="applyClick" :disabled="!applyEnabled" :style="getApplyButtonStyle()") Apply
          button(v-if="viewMode === 'search'" @click.stop="scrollGroup(-1)" :disabled="!items || items.length === 0" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 8px; border:1px solid #bbb; background-color:whitesmoke;") ▲
          button(v-if="viewMode === 'search'" @click.stop="scrollGroup(1)" :disabled="!items || items.length === 0" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 8px; border:1px solid #bbb; background-color:whitesmoke;") ▼

      div(style="height:1px; width:100%; background-color:#ddd; margin-top:6px;")

    #loading(v-if="loading" style="text-align:center; color:#666; margin-top:50px; font-size:16px;")
      div Loading...

    #error(v-if="error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px; white-space:pre-line; padding:0 20px;")
      div Error: {{ error }}

    #subs-list(v-if="!loading" style="padding:10px; font-size:14px; line-height:1.2;")
      div(v-if="!hasSearched && items.length === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
        div Press search to load subtitles.
      div(v-else-if="hasSearched && totalSubsCount === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
        div No subtitles found.
      template(v-for="(item, index) in items" :key="getItemCardKey(item)")
        div.se-divider(v-if="shouldShowSeDivider(index)" style="text-align:center; color:#888; font-family:monospace; margin:4px 0;") {{ getSeDividerText(index) }}
        div(@click="handleItemClick($event, item)" @click.stop :style="getCardStyle(item)" @mouseenter="$event.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.15)'" @mouseleave="$event.currentTarget.style.boxShadow='none'")
          div(v-if="shouldShowClickedCheckmark && isClicked(item)" style="position:absolute; top:8px; right:8px; color:#4CAF50; font-size:20px; font-weight:bold;") ✓
          div(style="display:flex; justify-content:space-between; align-items:center; gap:10px; font-size:12px; color:#333;")
            div(:style="{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, color: item?.lineColor || '#333' }") {{ item?.line1 || '' }}
            div(style="color:#666; white-space:nowrap;") {{ item?.uploader || '' }}
</template>

<script>
import parseTorrentTitle from 'parse-torrent-title';
import { subsSearch, applySubFiles } from '../srvr.js';
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
      selectedSeason: null,
      selectedEpisode: null,
      clickedItemKeys: new Set(),
      currentShow: null,
      totalSubsCount: 0,
      validSubsCount: 0,

      applyInProgress: false,

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
      const show = this.currentShow || this.activeShow;
      if (!show) return false;
      if (!this.hasSearched) return false;
      if (this.loading) return false;

      const validEntries = Array.isArray(this._validEntries) ? this._validEntries : [];
      if (this.viewMode === 'search') return validEntries.length > 0;

      if (this.viewMode === 'season') {
        const s = this.selectedSeason;
        if (s == null) return false;
        return validEntries.some(v => v?.season === s);
      }

      if (this.viewMode === 'episode') {
        const s = this.selectedSeason;
        const e = this.selectedEpisode;
        if (s == null || e == null) return false;
        return validEntries.some(v => v?.season === s && v?.episode === e);
      }

      if (this.viewMode === 'files') {
        if (!this.selectedCardKey) return false;
        return Array.isArray(this.items) && this.items.some(it => this.getItemCardKey(it) === this.selectedCardKey && it?.file_id != null);
      }

      return false;
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
      this.selectedCardKey = '';
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
        fontSize: '13px',
        cursor: 'pointer',
        borderRadius: '7px',
        padding: '4px 8px',
        border: '1px solid #bbb',
        backgroundColor: active ? '#ddd' : 'whitesmoke'
      };
    },

    getApplyButtonStyle() {
      const enabled = this.applyEnabled;
      const applying = !!this.applyInProgress;
      return {
        fontSize: '13px',
        cursor: enabled ? 'pointer' : 'not-allowed',
        borderRadius: '7px',
        padding: '4px 8px',
        border: '1px solid #bbb',
        backgroundColor: applying ? '#ffd6d6' : (enabled ? 'whitesmoke' : '#eee'),
        color: applying ? '#a00' : (enabled ? '#000' : '#777')
      };
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
      const key = this.getItemCardKey(item);
      this.clickedItemKeys.add(key);

      // Search mode: show all subs like before with no selection.
      if (this.viewMode !== 'search') {
        this.selectedCardKey = key;
      }

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

      if (this.viewMode === 'search' || this.viewMode === 'files') {
        if (item?.season != null) this.selectedSeason = Number(item.season);
        if (item?.episode != null) this.selectedEpisode = Number(item.episode);
      }

      if (this.viewMode === 'files') {
        const s = this.selectedSeason;
        const e = this.selectedEpisode;
        if (s != null && e != null && key) {
          this._selectedFileKeyBySeasonEpisode[`${s}-${e}`] = key;
        }
      }
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

      const isSelected = this.selectedCardKey && this.selectedCardKey === this.getItemCardKey(item);
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
        position: 'relative'
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

    buildApplyPayload() {
      const validEntries = Array.isArray(this._validEntries) ? this._validEntries : [];
      if (this.viewMode === 'search') {
        return this.buildFileIdObjsFromValidEntries(validEntries);
      }

      if (this.viewMode === 'season') {
        const s = this.selectedSeason;
        return this.buildFileIdObjsFromValidEntries(validEntries.filter(v => v?.season === s));
      }

      if (this.viewMode === 'episode') {
        const s = this.selectedSeason;
        const e = this.selectedEpisode;
        return this.buildFileIdObjsFromValidEntries(validEntries.filter(v => v?.season === s && v?.episode === e));
      }

      if (this.viewMode === 'files') {
        const sel = Array.isArray(this.items) ? this.items.find(it => this.getItemCardKey(it) === this.selectedCardKey) : null;
        const showName = this.getCurrentShowName();
        if (!sel || !showName) return [];
        const fileId = sel?.file_id;
        const season = sel?.season;
        const episode = sel?.episode;
        if (fileId == null || season == null || episode == null) return [];
        return [{ file_id: Number(fileId), showName, season: Number(season), episode: Number(episode) }];
      }

      return [];
    },

    async applyClick() {
      await this.ensureSearched();
      const payload = this.buildApplyPayload();
      if (!payload.length) return;
      this.error = null;
      this.applyInProgress = true;
      try {
        const res = await applySubFiles(payload);
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
        this.applyInProgress = false;
      }
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

      const bySeason = new Map();
      for (const it of validEntries) {
        const s = it.season;
        const e = it.episode;
        if (s == null || e == null) continue;
        if (!bySeason.has(s)) bySeason.set(s, new Map());
        const seasonMap = bySeason.get(s);
        if (!seasonMap.has(e)) seasonMap.set(e, []);
        seasonMap.get(e).push(it);
      }

      const seasonNums = Array.from(bySeason.keys()).sort((a, b) => a - b);

      // Prefer series map seasons/episodes when available.
      const mapObj = this._seriesMapObj && typeof this._seriesMapObj === 'object' ? this._seriesMapObj : null;
      const mapSeasonNums = mapObj
        ? Object.keys(mapObj)
            .map(k => Number(k))
            .filter(n => Number.isFinite(n))
            .sort((a, b) => a - b)
        : [];

      const getMapEpisodeNums = (season) => {
        if (!mapObj || season == null) return [];
        const seasonObj = mapObj[String(season)];
        if (!seasonObj || typeof seasonObj !== 'object') return [];
        return Object.keys(seasonObj)
          .map(k => Number(k))
          .filter(n => Number.isFinite(n))
          .sort((a, b) => a - b);
      };

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
        const mapEps = getMapEpisodeNums(season);
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
          const mapEps = getMapEpisodeNums(s);
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

        const s0 = pickFirstSeason();
        if (s0 != null) this.selectedSeason = s0;
        const defaultKey = s0 != null ? `season-${s0}` : '';
        if (!this.selectedCardKey || !containsKey(seasonCards, this.selectedCardKey)) {
          this.selectedCardKey = defaultKey;
        }
        return;
      }

      if (this.viewMode === 'episode') {
        const s = pickFirstSeason();
        this.selectedSeason = s;
        const seasonMap = s != null ? bySeason.get(s) : null;
        const eps = (() => {
          const mapEps = getMapEpisodeNums(s);
          if (mapEps.length) return mapEps;
          return seasonMap ? Array.from(seasonMap.keys()).sort((a, b) => a - b) : [];
        })();

        const remembered = s != null ? this._selectedEpisodeBySeason[String(s)] : null;
        const rememberedNum = remembered != null ? Number(remembered) : null;
        const rememberedEpisode = (Number.isFinite(rememberedNum) && eps.includes(rememberedNum)) ? rememberedNum : null;
        if (rememberedEpisode != null) this.selectedEpisode = rememberedEpisode;

        const episodeCards = eps.map((e) => {
          const fileCount = (seasonMap && Array.isArray(seasonMap.get(e))) ? seasonMap.get(e).length : 0;
          const sStr = s != null ? String(s).padStart(2, '0') : '??';
          const eStr = e != null ? String(e).padStart(2, '0') : '??';
          const missing = fileCount === 0;
          return {
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
          };
        });
        this.items = episodeCards;

        const e0 = rememberedEpisode != null ? rememberedEpisode : pickFirstEpisode(s);
        if (e0 != null) this.selectedEpisode = e0;
        const defaultKey = (s != null && e0 != null) ? `episode-${s}-${e0}` : '';
        if (!this.selectedCardKey || !containsKey(episodeCards, this.selectedCardKey)) {
          this.selectedCardKey = defaultKey;
        }
        return;
      }

      if (this.viewMode === 'files') {
        const s = pickFirstSeason();
        const rememberedEpisode = s != null ? this._selectedEpisodeBySeason[String(s)] : null;
        const seasonMap0 = s != null ? bySeason.get(s) : null;
        this.selectedSeason = s;

        const eps = (() => {
          const mapEps = getMapEpisodeNums(s);
          if (mapEps.length) return mapEps;
          return seasonMap0 ? Array.from(seasonMap0.keys()).sort((a, b) => a - b) : [];
        })();

        const rememberedNum = rememberedEpisode != null ? Number(rememberedEpisode) : null;
        const rememberedOk = Number.isFinite(rememberedNum) && eps.includes(rememberedNum);
        if (rememberedOk) this.selectedEpisode = rememberedNum;

        const e = rememberedOk ? rememberedNum : pickFirstEpisode(s);
        this.selectedEpisode = e;
        const seasonMap = s != null ? bySeason.get(s) : null;
        const entries = (seasonMap && e != null && Array.isArray(seasonMap.get(e))) ? [...seasonMap.get(e)] : [];

        // Flatten into per-file cards (OpenSubtitles attributes.files[]).
        const fileCards = [];
        for (const v of entries) {
          const files = v?.entry?.attributes?.files;
          if (!Array.isArray(files) || !files.length) continue;
          for (const f of files) {
            const card = this.buildFileCardItem(v, f);
            if (card) fileCards.push(card);
          }
        }

        fileCards.sort((a, b) => {
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

        this.items = fileCards;
        const seKey = (s != null && e != null) ? `${s}-${e}` : '';
        const rememberedFileKey = seKey ? this._selectedFileKeyBySeasonEpisode[seKey] : '';
        if (rememberedFileKey && containsKey(this.items, rememberedFileKey)) {
          this.selectedCardKey = rememberedFileKey;
        } else if (!this.selectedCardKey || !containsKey(this.items, this.selectedCardKey)) {
          this.selectedCardKey = this.items.length ? this.getItemCardKey(this.items[0]) : '';
        }
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
