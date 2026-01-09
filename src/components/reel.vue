<template lang="pug">

#reelPane(
  @click="handleBackgroundClick"
  :style="{ height:'100%', width:'100%', padding:'5px', margin:0, display:'flex', flexDirection:'row', overflowY:'hidden', overflowX:'hidden', maxWidth:'100%', boxSizing:'border-box', gap: '10px' }")

  #reelLeft(
    :style="{ flex: '0 0 125px', height: '100%', display: 'flex', flexDirection: 'column' }")
    reel-gallery(
      :style="{ flex: '1', minHeight: 0 }"
      :srchStr="srchStr"
      @select="handleGallerySelect")

  #reelRight(
    :style="{ flex: '1 1 0', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', gap: '0' }")
    
    #reelInfo(
      :style="{ padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '5px', fontSize: '14px', textTransform: 'uppercase' }")
      div(v-if="curTvdb" :style="{ fontWeight: 'bold', fontSize: '12px', marginBottom: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }") {{ galleryTitleLine }}
      div(v-if="curTvdb" :style="{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '10px' }")
        div(:style="{ flex: '1 1 auto', minWidth: 0, whiteSpace: 'normal', overflowWrap: 'anywhere', wordBreak: 'break-word' }") {{ infoLine }}
        button(
          @click="handleLoad"
          :style="{ height: '18px', margin: '0', marginLeft: '10px', marginRight: '20px', padding: '0 2px', lineHeight: '18px', fontSize: '12px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }") Get

    // keep zero gap between description and buttons
    #reelDescrButtons(:style="{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: '0' }")
      #reelDescr(
        :style="{ flex: '0 0 auto', height: '120px', padding: '10px', backgroundColor: '#f5f5f5', borderRadius: '5px', overflowY: 'auto', fontSize: '14px', lineHeight: '1.5' }"
        @wheel.stop.prevent="handleScaledWheel"
      )
        div(v-if="curTvdb") {{ curTvdb.overview }}
      
      #reelButtons(
        :style="{ display: 'flex', flexWrap: 'wrap', gap: '10px', padding: '10px', marginTop: '0' }")
        button(
          @click="handleNext"
          :style="{ height: '18px', margin: '0', padding: '0 2px', lineHeight: '18px', fontSize: '12px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }") Next

        span(v-if="hasAnyRemoteButton" :style="{ lineHeight: '18px', fontSize: '12px' }")  |

        button(
          v-if="imdbResult"
          @click="handleImdb"
          :style="{ height: '18px', margin: '0', padding: '0 2px', lineHeight: '18px', fontSize: '12px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }") {{ imdbButtonLabel }}
        button(
          v-if="googleResult"
          @click="handleGoogle"
          :style="{ height: '18px', margin: '0', padding: '0 2px', lineHeight: '18px', fontSize: '12px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }") Google
        button(
          v-if="wikiResult"
          @click="handleWiki"
          :style="{ height: '18px', margin: '0', padding: '0 2px', lineHeight: '18px', fontSize: '12px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }") Wiki
        button(
          v-if="officialResult"
          @click="handleOfficial"
          :style="{ height: '18px', margin: '0', padding: '0 2px', lineHeight: '18px', fontSize: '12px', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }") Official
    
    #reelTitles(
      ref="titlesPane"
      :style="{ flex: '1', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0' }"
      @wheel.stop.prevent="handleScaledWheel"
    )
      div(
        v-for="(item, idx) in parsedTitles"
        :key="idx"
        @click="selectTitle(idx)"
        :style="getTitleCardStyle(idx)")
        template(v-if="item.rejectStatus === 'msg'")
          div(:style="{ width: '100%', textAlign: 'center', color: 'rgba(0,0,0,0.6)' }") {{ item.titleString }}
        template(v-else-if="item.rejectStatus === 'ok'")
          div {{ item.titleString }}
        template(v-else)
          div(:style="{ display: 'flex' }")
            div(:style="{ width: '80px', flexShrink: 0, backgroundColor: '#ffcccc', padding: '5px' }") {{ item.rejectStatus }}
            div(:style="{ flex: 1, padding: '5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }") {{ item.titleString }}

</template>

<script>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import ReelGallery from './reel-gallery.vue';
import { config } from '../config.js';
import evtBus from '../evtBus.js';
import * as srvr from '../srvr.js';

export default {
  name: 'ReelPane',
  components: {
    ReelGallery
  },
  props: {
    active: {
      type: Boolean,
      default: false
    },
    allShows: {
      type: Array,
      default: () => ([])
    },
    sizing: {
      type: Object,
      default: () => ({})
    }
  },
  setup(props) {
    const srchStr = ref('friends');
    const curTitle = ref('');
    const curTvdb = ref(null);
    const getRemotesResults = ref([]);
    const _lastRemotesKey = ref('');
    const titleStrings = ref([]);
    const selectedTitleIdx = ref(-1);
    const titlesPane = ref(null);
    const _titlesPopulated = ref(false);
    const _didStartReel = ref(false);
    const _didInitialVisibleScroll = ref(false);

    const handleScaledWheel = (event) => {
      if (!event) return;
      const el = event.currentTarget;
      if (!el) return;
      const dy = (event.deltaY || 0);
      const scaledDy = dy * 0.125;
      const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      el.scrollTop = Math.max(0, Math.min(max, (el.scrollTop || 0) + scaledDy));
    };

    const NO_MORE_ENTRY = 'msg|-- no more titles --';

    const toTitleArray = (data) => {
      if (Array.isArray(data)) return data.map(String);
      if (data && typeof data === 'object') {
        const msg = data.errmsg || data.error || data.message || data.status;
        if (msg) return [`error|${String(msg)}`];
      }
      if (typeof data === 'string' && data.trim()) return [`error|${data.trim()}`];
      return [];
    };

    const scrollTitlesToBottom = async () => {
      await nextTick();
      if (titleStrings.value.length > 0) {
        selectTitle(titleStrings.value.length - 1);
      }
      await nextTick();
      if (titlesPane.value) {
        titlesPane.value.scrollTop = titlesPane.value.scrollHeight;
      }
    };

    const scrollTitlesPaneToBottom = async () => {
      await nextTick();
      if (titlesPane.value) {
        titlesPane.value.scrollTop = titlesPane.value.scrollHeight;
      }
    };

    const getAllShowNames = () => {
      const src = Array.isArray(props.allShows) ? props.allShows : [];
      const names = src
        .map((s) => {
          if (!s) return '';
          if (typeof s === 'string') return s;
          return String(s.Name || s.name || s.title || s.showName || s.seriesName || '');
        })
        .map((s) => s.trim())
        .filter(Boolean);
      return Array.from(new Set(names));
    };

    const startReelAndLoadTitles = async () => {
      try {
        const showTitles = getAllShowNames();
        let data;
        try {
          const res = await fetch(`${config.torrentsApiUrl}/api/startreel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ showTitles })
          });
          if (!res.ok) {
            const txt = await res.text();
            throw new Error(`HTTP ${res.status}: ${txt}`);
          }
          data = await res.json();
        } catch (e) {
          // Fallback for older server versions that only support GET /api/startreel
          const url = new URL(`${config.torrentsApiUrl}/api/startreel`);
          url.searchParams.set('showTitles', JSON.stringify(showTitles));
          const res2 = await fetch(url.toString());
          if (!res2.ok) {
            const txt2 = await res2.text();
            throw new Error(`HTTP ${res2.status}: ${txt2}`);
          }
          data = await res2.json();
        }

        titleStrings.value = toTitleArray(data);
        _titlesPopulated.value = true;
        _didStartReel.value = true;
        if (props.active) {
          await scrollTitlesToBottom();
        }
      } catch (e) {
        const msg = e?.message || String(e);
        console.log('startReel failed:', msg);
        titleStrings.value = [...titleStrings.value, `error|${msg}`];
        _titlesPopulated.value = true;
      }
    };

    const handleNext = async () => {
      try {
        // If the "-- no more titles --" message is showing, restart Reel (same as initial mount).
        // This refreshes the reelgood home page and reloads cached result titles.
        if (titleStrings.value.some((s) => String(s) === NO_MORE_ENTRY)) {
          await startReelAndLoadTitles();
          return;
        }

        const res = await fetch(`${config.torrentsApiUrl}/api/getreel`);
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt}`);
        }
        const data = await res.json();
        const added = toTitleArray(data);

        // If we get new entries, remove the "no more" sentinel.
        if (added.length > 0) {
          titleStrings.value = titleStrings.value.filter((s) => String(s) !== NO_MORE_ENTRY);
          titleStrings.value = [...titleStrings.value, ...added];
          await scrollTitlesToBottom();
        } else {
          // If none returned, ensure the sentinel exists (once).
          const hasNoMore = titleStrings.value.some((s) => String(s) === NO_MORE_ENTRY);
          if (!hasNoMore) {
            titleStrings.value = [...titleStrings.value, NO_MORE_ENTRY];
          } else {
            // Force a new array assignment so the UI updates consistently.
            titleStrings.value = [...titleStrings.value];
          }

          // Always scroll to the bottom even if the msg card already exists;
          // if we just added it, wait for it to render first.
          await scrollTitlesPaneToBottom();
        }
      } catch (e) {
        const msg = e?.message || String(e);
        console.log('getReel failed:', msg);
        titleStrings.value = [...titleStrings.value, `error|${msg}`];
        await scrollTitlesToBottom();
      }
    };

    const googleResult = computed(() => {
      const arr = Array.isArray(getRemotesResults.value) ? getRemotesResults.value : [];
      return arr.find((r) => r && r.name === 'Google' && r.url) || null;
    });

    const imdbResult = computed(() => {
      const arr = Array.isArray(getRemotesResults.value) ? getRemotesResults.value : [];
      return arr.find((r) => r && typeof r.name === 'string' && r.name.toUpperCase().startsWith('IMDB') && r.url) || null;
    });

    const wikiResult = computed(() => {
      const arr = Array.isArray(getRemotesResults.value) ? getRemotesResults.value : [];
      return arr.find((r) => r && r.name === 'Wikipedia' && r.url) || null;
    });

    const officialResult = computed(() => {
      const arr = Array.isArray(getRemotesResults.value) ? getRemotesResults.value : [];
      return arr.find((r) => r && r.name === 'Official Website' && r.url) || null;
    });

    const imdbButtonLabel = computed(() => {
      return imdbResult.value?.name || 'Imdb';
    });

    const openUrl = (url) => {
      const u = String(url || '').trim();
      if (!u) return;
      try {
        window.open(u, '_blank');
      } catch (e) {
        console.log('openUrl failed:', e?.message || String(e));
      }
    };

    const handleGoogle = () => {
      openUrl(googleResult.value?.url);
    };

    const handleImdb = () => {
      openUrl(imdbResult.value?.url);
    };

    const handleWiki = () => {
      openUrl(wikiResult.value?.url);
    };

    const handleOfficial = () => {
      openUrl(officialResult.value?.url);
    };

    const hasAnyRemoteButton = computed(() => {
      return !!(imdbResult.value || googleResult.value || wikiResult.value || officialResult.value);
    });

    const loadRemotesForTvdb = async (tvdb) => {
      if (!tvdb) {
        getRemotesResults.value = [];
        _lastRemotesKey.value = '';
        return;
      }

      const name = String(tvdb.name || '').trim();
      const tvdbId = String(tvdb.tvdb_id || '').trim();
      const key = tvdbId || name;
      if (!key) {
        getRemotesResults.value = [];
        _lastRemotesKey.value = '';
        return;
      }

      if (_lastRemotesKey.value === key) return;
      _lastRemotesKey.value = key;

      getRemotesResults.value = [];
      try {
        const params = {
          show: {
            Name: name,
            TvdbId: tvdbId
          },
          tvdbRemotes: tvdb.remote_ids,
          fast: true
        };
        const res = await srvr.getRemotesCmd(params);
        getRemotesResults.value = Array.isArray(res) ? res : [];
      } catch (e) {
        console.log('getRemotesCmd failed:', e?.message || String(e));
        getRemotesResults.value = [];
      }
    };

    const handleLoad = () => {
      const t = curTvdb.value;
      if (!t) return;

      const name = String(t.name || t.Name || '').trim();
      if (!name) return;

      // Route through the exact same flow used by clicking a card in #searchList.
      const srchChoice = {
        name,
        tvdbId: String(t.tvdbId || t.tvdb_id || '').trim(),
        overview: t.overview || t.overviewText || t.overview_txt || t.Overview || '',
        image: t.image || t.image_url || t.thumbnail || '',
        year: t.year || '',
        originalCountry: t.originalCountry || t.country || '',
        searchDtlTxt: t.searchDtlTxt || ''
      };
      evtBus.emit('reelSearchAction', srchChoice);
    };

    watch(() => props.active, async (isActive) => {
      if (!isActive) return;
      if (_didInitialVisibleScroll.value) return;
      if (!_titlesPopulated.value) return;
      _didInitialVisibleScroll.value = true;
      await scrollTitlesToBottom();
    });

    // Parse titleStrings into objects
    const parsedTitles = computed(() => {
      return titleStrings.value.map(str => {
        const parts = str.split('|');
        return {
          rejectStatus: parts[0],
          titleString: parts[1] || parts[0]
        };
      });
    });

    // Format info line from curTvdb
    const infoLine = computed(() => {
      if (!curTvdb.value) return '';
      const t = curTvdb.value;
      return `${t.year || ''} | ${t.country || ''} | ${t.primary_language || ''} | ${t.network || ''}`;
    });

    const galleryTitleLine = computed(() => {
      const t = curTvdb.value;
      if (!t) return '';
      return String(t.name || t.Name || t.seriesName || t.title || '').trim();
    });

    const handleBackgroundClick = (event) => {
      const target = event?.target;
      if (!(target instanceof Element)) return;

      // Ignore clicks on buttons/interactive controls.
      if (target.closest('button')) return;

      // Ignore clicks in the title card list.
      if (target.closest('#reelTitles')) return;

      // Ignore clicks in the left gallery (it has its own selection behavior).
      if (target.closest('#reelLeft')) return;

      const name = String(galleryTitleLine.value || curTitle.value || '').trim();
      if (!name) return;
      evtBus.emit('selectShowFromCardTitle', name);
    };

    // Get style for title card
    const getTitleCardStyle = (idx) => {
      const item = parsedTitles.value[idx];
      let backgroundColor = 'white';
      let cursor = 'pointer';
      
      if (idx === selectedTitleIdx.value) {
        backgroundColor = '#fffacd'; // light-yellow
      } else if (item.rejectStatus === 'msg') {
        backgroundColor = '#f5f5f5';
        cursor = 'default';
      } else if (item.rejectStatus === 'ok') {
        backgroundColor = '#90ee90'; // light-green
      }
      
      return {
        padding: '5px',
        cursor,
        fontSize: '14px',
        backgroundColor,
        border: '1px solid #808080',
        borderRadius: '3px',
        minHeight: '30px',
        display: 'flex',
        alignItems: 'center'
      };
    };

    // Handle gallery card selection
    const handleGallerySelect = (tvdb) => {
      curTvdb.value = tvdb;
    };

    watch(curTvdb, (val) => {
      void loadRemotesForTvdb(val);
    }, { deep: true });

    // Handle title selection
    const selectTitle = (idx) => {
      const item = parsedTitles.value[idx];
      if (item?.rejectStatus === 'msg') return;
      selectedTitleIdx.value = idx;
      const nextTitle = String(item?.titleString || '').trim();
      curTitle.value = nextTitle;

      const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (norm(nextTitle) !== norm(srchStr.value)) {
        srchStr.value = nextTitle;
      }
    };

    // Scroll to bottom when titleStrings changes
    watch(titleStrings, async () => {
      await nextTick();
      if (titlesPane.value) {
        titlesPane.value.scrollTop = titlesPane.value.scrollHeight;
      }

      // Log parsed title cards for debugging
      try {
        parsedTitles.value.forEach((it, i) => {
          void i;
          void it;
        });
      } catch (e) {
        void e;
      }

      // Select last item
      if (titleStrings.value.length > 0) {
        selectTitle(titleStrings.value.length - 1);
      }
    }, { deep: true });

    // Initialize with test data
    onMounted(() => {
      // Wait until allShows is available so startReel gets the full library.
      if (Array.isArray(props.allShows) && props.allShows.length > 0) {
        void startReelAndLoadTitles();
      }
    });

    watch(() => props.allShows, (val) => {
      if (_didStartReel.value) return;
      if (!Array.isArray(val) || val.length === 0) return;
      void startReelAndLoadTitles();
    }, { deep: true });

    return {
      sizing: props.sizing,
      srchStr,
      curTitle,
      curTvdb,
      getRemotesResults,
      googleResult,
      imdbResult,
      wikiResult,
      officialResult,
      imdbButtonLabel,
      hasAnyRemoteButton,
      titleStrings,
      selectedTitleIdx,
      parsedTitles,
      infoLine,
      galleryTitleLine,
      titlesPane,
      handleBackgroundClick,
      handleScaledWheel,
      getTitleCardStyle,
      handleGallerySelect,
      selectTitle,
      handleNext,
      handleLoad,
      handleGoogle,
      handleImdb,
      handleWiki,
      handleOfficial
    };
  }
};
</script>

<style scoped>
button {
  padding: 8px 16px;
  cursor: pointer;
  border: 1px solid #ccc;
  border-radius: 5px;
  background-color: white;
}

button:hover {
  background-color: #f0f0f0;
}
</style>
