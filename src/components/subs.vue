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
          button(@click.stop="searchClick" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px; border:1px solid #bbb; background-color:whitesmoke;") Search

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
      div(v-for="(item, index) in items" :key="getItemCardKey(item, index)" @click="handleItemClick($event, item)" @click.stop :style="getCardStyle(item)" @mouseenter="$event.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.15)'" @mouseleave="$event.currentTarget.style.boxShadow='none'")
        div(v-if="isClicked(item)" style="position:absolute; top:8px; right:8px; color:#4CAF50; font-size:20px; font-weight:bold;") ✓
        div(style="font-size:12px; color:#333;")
          div
            strong {{ item?.line1 || '' }}
          div(v-if="item?.line2" style="white-space:pre;") {{ item.line2 }}
</template>

<script>
import parseTorrentTitle from 'parse-torrent-title';
import { config } from '../config.js';

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
      selectedItem: null,
      clickedItems: new Set(),
      currentShow: null,
      totalSubsCount: 0,
      validSubsCount: 0
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
    }
  },

  watch: {
    activeShow: {
      immediate: true,
      handler(newShow, oldShow) {
        const newName = newShow?.Name || '';
        const oldName = oldShow?.Name || '';
        this.currentShow = newShow || null;
        if (newName && newName !== oldName) {
          this.resetSearchState();
        }
      }
    }
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
      this.selectedItem = null;
      this.clickedItems = new Set();
      this.totalSubsCount = 0;
      this.validSubsCount = 0;
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

    getItemCardKey(item, index) {
      return String(item?.key || item?.id || index);
    },

    handleItemClick(_event, item) {
      this.selectedItem = item;
      this.clickedItems.add(item);
    },

    isClicked(item) {
      return this.clickedItems.has(item);
    },

    getCardStyle(item) {
      const isSelected = this.selectedItem === item;
      let bgColor = '#fff';
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
      const uploader = entry?.attributes?.uploader?.name != null ? String(entry.attributes.uploader.name) : '';
      const aiTranslated = entry?.attributes?.ai_translated;
      const machineTranslated = entry?.attributes?.machine_translated;

      const { season, episode } = this.parseSeasonEpisodeFromEntry(entry);

      const sStr = season != null ? String(season).padStart(2, '0') : '??';
      const eStr = episode != null ? String(episode).padStart(2, '0') : '??';

      const line1 = `S${sStr}E${eStr} ${release}`.trim();

      const parts = [];
      if (uploader) parts.push(uploader);
      if (aiTranslated) parts.push(String(aiTranslated));
      if (machineTranslated) parts.push(String(machineTranslated));
      const line2 = parts.length ? `     ${parts.join(' ')}` : '';

      return {
        key: id || release,
        line1,
        line2,
        raw: entry,
      };
    },

    async fetchSubsPage(imdbIdDigits, page) {
      const url = `${config.torrentsApiUrl}/api/subs/search?imdb_id=${encodeURIComponent(imdbIdDigits)}&page=${encodeURIComponent(String(page))}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        const txt = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}${txt ? `\n${txt}` : ''}`);
      }
      return await resp.json();
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

    async searchClick() {
      this.loading = true;
      this.error = null;
      this.hasSearched = true;
      this.items = [];
      this.searchResults = [];
      this.selectedItem = null;
      this.clickedItems = new Set();
      this.totalSubsCount = 0;
      this.validSubsCount = 0;

      try {
        const imdbIdDigits = this.getShowImdbId();
        console.log('[subs] show ProviderIds + imdb', (this.currentShow || this.activeShow)?.ProviderIds, 'digits', imdbIdDigits);
        if (!imdbIdDigits) {
          this.error = 'No imdb id found for selected show';
          return;
        }

        const failedPages = [];

        const first = await this.fetchSubsPageWithRetry(imdbIdDigits, 1);
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
            if (Array.isArray(next?.data)) allData.push(...next.data);
          } catch (e) {
            failedPages.push(p);
            console.warn('[subs] page fetch failed', { page: p, error: e?.message || String(e) });
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
          const uploader = entry?.attributes?.uploader?.name != null ? String(entry.attributes.uploader.name) : '';
          const { season, episode } = this.parseSeasonEpisodeFromEntry(entry);
          return { entry, release, uploader, season, episode };
        });

        sortable.sort((a, b) => {
          const sA = a.season != null ? a.season : Number.POSITIVE_INFINITY;
          const sB = b.season != null ? b.season : Number.POSITIVE_INFINITY;
          if (sA !== sB) return sA - sB;

          const eA = a.episode != null ? a.episode : Number.POSITIVE_INFINITY;
          const eB = b.episode != null ? b.episode : Number.POSITIVE_INFINITY;
          if (eA !== eB) return eA - eB;

          const uA = (a.uploader || '').trim();
          const uB = (b.uploader || '').trim();
          const uCmp = uA.localeCompare(uB, undefined, { sensitivity: 'base' });
          if (uCmp !== 0) return uCmp;

          const rA = (a.release || '').trim();
          const rB = (b.release || '').trim();
          return rA.localeCompare(rB, undefined, { sensitivity: 'base' });
        });

        this.totalSubsCount = sortable.length;
        const validOnly = sortable.filter(x => x.season != null && x.episode != null);
        this.validSubsCount = validOnly.length;

        const unknownSeEp = sortable.filter(x => x.season == null || x.episode == null).slice(0, 10);
        if (unknownSeEp.length) {
          console.log(
            '[subs] first 10 with unknown S/E',
            unknownSeEp.map(x => ({
              season: x.season,
              episode: x.episode,
              release: x.release,
              uploader: x.uploader,
              url: x.entry?.attributes?.url,
              files: Array.isArray(x.entry?.attributes?.files)
                ? x.entry.attributes.files.map(f => f?.file_name).filter(Boolean).slice(0, 3)
                : []
            }))
          );
        }

        this.searchResults = validOnly.map(x => x.entry);
        if (this.searchResults.length > 0) {
          console.log('[subs] first searchResult', this.searchResults[0]);
        }

        this.items = validOnly.map(x => this.buildCardItemFromResult(x.entry));

        if (failedPages.length) {
          this.error = `Warning: some pages failed to load (${failedPages.join(', ')}). Showing partial results.`;
        }
      } catch (err) {
        const msg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
        this.error = msg;
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>
