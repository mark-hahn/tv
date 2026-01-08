<template lang="pug">

#all(
  :style="{ width:'100%', height:'97dvh', boxSizing:'border-box', padding:0, margin:0, display:'flex', flexDirection: showSideButtons ? 'row' : (isPortrait ? 'column' : 'row'), alignItems:'stretch' }"
)
  template(v-if="showSideButtons")
    //- Simple + portrait: full-height Buttons pane on the left.
    #simpleButtonsPane(:style="{ flex:'0 0 auto', height:'100%', overflow:'hidden', display:'flex', flexDirection:'column', backgroundColor:'#ccc' }")
      Buttons(
        style="width:105px; flex:1 1 auto;"
        :sizing="sideButtonsSizing"
        @button-click="onSideButtonsClick"
        @top-click="onSideButtonsTop"
      )

    //- Simple + portrait: Series/Map/etc above List to the right.
    #mainStack(:style="{ flex:'1 1 auto', minWidth:'0px', height:'100%', display:'flex', flexDirection:'column' }")
      //- In portrait, put the right-side pane (Series/Map/etc) above the List.
      #tabArea(:style="tabAreaStyle")
        #tabBar(:style="{ display:'flex', gap:(simpleMode ? '30px' : '0px'), padding:(simpleMode ? '6px 8px' : '6px 0px'), alignItems:'center', borderBottom:'1px solid #ddd', backgroundColor:'#fafafa', flex:'0 0 auto', flexWrap:'wrap' }")
          button(
            v-for="t in tabs"
            :key="t.key"
            @click.stop="selectTab(t.key)"
            :style="{ fontSize:'13px', cursor:'pointer', borderRadius:'7px', padding:'4px 10px', marginLeft:'4px', border:'1px solid #bbb', backgroundColor: (currentPane === t.key ? '#ddd' : 'whitesmoke') }"
          ) {{ t.label }}

        #tabBody(:style="{ flex:'1 1 auto', minHeight:'0px', position:'relative', width:'100%' }")
          Series(v-show="currentPane === 'series'" style="display:block; width:100%; height:100%;" :simpleMode="simpleMode" :sizing="activeSizing")
          Map(
            v-show="currentPane === 'map'"
            :mapShow="mapShow"
            :hideMapBottom="hideMapBottom"
            :seriesMapSeasons="seriesMapSeasons"
            :seriesMapEpis="seriesMapEpis"
            :seriesMap="seriesMap"
            :mapError="mapError"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            @reload-shows="triggerShowReload"
            @prune="handleMapAction('prune', $event)"
            @set-date="handleMapAction('date', $event)"
            @close="handleMapAction('close')"
            @show-actors="() => handleShowActors(false)"
            @episode-click="handleEpisodeClick"
            @season-delete="handleSeasonDelete"
          )
          Actors(
            v-show="currentPane === 'actors'"
            style="width:100%; height:100%;"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
          )
          Reel(
            v-if="!simpleMode"
            v-show="currentPane === 'reel'"
            style="width:100%; height:100%;"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :allShows="allShows"
            :active="currentPane === 'reel'"
          )
          Torrents(
            v-if="!simpleMode"
            v-show="currentPane === 'torrents'"
            style="width:100%; height:100%;"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :activeShow="currentShow"
          )

          Subs(
            v-if="!simpleMode"
            v-show="currentPane === 'subs'"
            style="width:100%; height:100%;"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :activeShow="currentShow"
          )

          Flex(
            v-if="!simpleMode"
            v-show="currentPane === 'flex'"
            style="width:100%; height:100%;"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
          )

          History(
            v-if="!simpleMode"
            v-show="currentPane === 'history'"
            style="width:100%; height:100%;"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
          )

          TvProc(
            v-if="!simpleMode"
            v-show="currentPane === 'tvproc'"
            style="width:100%; height:100%;"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
          )

          FilePane(
            v-if="!simpleMode"
            v-show="currentPane === 'file'"
            style="width:100%; height:100%;"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
          )

      //- Draggable divider between panes: vertical in landscape, horizontal in portrait.
      #paneDivider(
        @pointerdown.stop.prevent="startPaneResize"
        @pointermove.stop.prevent="onPaneResizeMove"
        @pointerup.stop.prevent="stopPaneResize"
        @pointercancel.stop.prevent="stopPaneResize"
        @lostpointercapture.stop.prevent="stopPaneResize"
        :style="paneDividerStyle"
        title="Drag to resize panes"
      )

      List(
        :style="listStyle"
        :simpleMode="simpleMode"
        :sizing="activeSizing"
        :hideButtonsPane="true"
        @show-map="handleShowMap"
        @hide-map="handleHideMap"
        @show-actors="handleShowActors"
        @show-torrents="handleShowTorrents"
        @all-shows="handleAllShows"
      )

  template(v-else)
    //- In portrait, put the right-side pane (Series/Map/etc) above the List.
    #tabArea(:style="tabAreaStyle")
      #tabBar(:style="{ display:'flex', gap:(simpleMode ? '30px' : '0px'), padding:(simpleMode ? '6px 8px' : '6px 0px'), alignItems:'center', borderBottom:'1px solid #ddd', backgroundColor:'#fafafa', flex:'0 0 auto', flexWrap:'wrap' }")
        button(
          v-for="t in tabs"
          :key="t.key"
          @click.stop="selectTab(t.key)"
          :style="{ fontSize:'13px', cursor:'pointer', borderRadius:'7px', padding:'4px 10px', marginLeft:'4px', border:'1px solid #bbb', backgroundColor: (currentPane === t.key ? '#ddd' : 'whitesmoke') }"
        ) {{ t.label }}

      #tabBody(:style="{ flex:'1 1 auto', minHeight:'0px', position:'relative', width:'100%' }")
        Series(v-show="currentPane === 'series'" style="display:block; width:100%; height:100%;" :simpleMode="simpleMode" :sizing="activeSizing")
        Map(
          v-show="currentPane === 'map'"
          :mapShow="mapShow"
          :hideMapBottom="hideMapBottom"
          :seriesMapSeasons="seriesMapSeasons"
          :seriesMapEpis="seriesMapEpis"
          :seriesMap="seriesMap"
          :mapError="mapError"
          :simpleMode="simpleMode"
          :sizing="activeSizing"
          @reload-shows="triggerShowReload"
          @prune="handleMapAction('prune', $event)"
          @set-date="handleMapAction('date', $event)"
          @close="handleMapAction('close')"
          @show-actors="() => handleShowActors(false)"
          @episode-click="handleEpisodeClick"
          @season-delete="handleSeasonDelete"
        )
        Actors(
          v-show="currentPane === 'actors'"
          style="width:100%; height:100%;"
          :simpleMode="simpleMode"
          :sizing="activeSizing"
        )
        Reel(
          v-if="!simpleMode"
          v-show="currentPane === 'reel'"
          style="width:100%; height:100%;"
          :simpleMode="simpleMode"
          :sizing="activeSizing"
          :allShows="allShows"
          :active="currentPane === 'reel'"
        )
        Torrents(
          v-if="!simpleMode"
          v-show="currentPane === 'torrents'"
          style="width:100%; height:100%;"
          :simpleMode="simpleMode"
          :sizing="activeSizing"
          :activeShow="currentShow"
        )

        Subs(
          v-if="!simpleMode"
          v-show="currentPane === 'subs'"
          style="width:100%; height:100%;"
          :simpleMode="simpleMode"
          :sizing="activeSizing"
          :activeShow="currentShow"
        )

        Flex(
          v-if="!simpleMode"
          v-show="currentPane === 'flex'"
          style="width:100%; height:100%;"
          :simpleMode="simpleMode"
          :sizing="activeSizing"
        )

        History(
          v-if="!simpleMode"
          v-show="currentPane === 'history'"
          style="width:100%; height:100%;"
          :simpleMode="simpleMode"
          :sizing="activeSizing"
        )

        TvProc(
          v-if="!simpleMode"
          v-show="currentPane === 'tvproc'"
          style="width:100%; height:100%;"
          :simpleMode="simpleMode"
          :sizing="activeSizing"
        )

        FilePane(
          v-if="!simpleMode"
          v-show="currentPane === 'file'"
          style="width:100%; height:100%;"
          :simpleMode="simpleMode"
          :sizing="activeSizing"
        )

    //- Draggable divider between panes: vertical in landscape, horizontal in portrait.
    #paneDivider(
      @pointerdown.stop.prevent="startPaneResize"
      @pointermove.stop.prevent="onPaneResizeMove"
      @pointerup.stop.prevent="stopPaneResize"
      @pointercancel.stop.prevent="stopPaneResize"
      @lostpointercapture.stop.prevent="stopPaneResize"
      :style="paneDividerStyle"
      title="Drag to resize panes"
    )

    List(
      :style="listStyle"
      :simpleMode="simpleMode"
      :sizing="activeSizing"
      @show-map="handleShowMap"
      @hide-map="handleHideMap"
      @show-actors="handleShowActors"
      @show-torrents="handleShowTorrents"
      @all-shows="handleAllShows"
    )

  //- TVDB mismatch detail modal (OK-only)
  #tvdbMismatchModal(
    v-if="tvdbMismatchOpen"
    @click.stop.prevent
    @pointerdown.stop.prevent
    style="position:fixed; inset:0; background-color:rgba(0,0,0,0.35); z-index:2000; display:flex; align-items:center; justify-content:center;"
  )
    #tvdbMismatchBox(
      @click.stop.prevent
      @pointerdown.stop.prevent
      style="background-color:white; border:2px solid black; border-radius:10px; padding:18px 22px; max-width:900px; width:calc(100% - 40px); max-height:85vh; overflow:auto;"
    )
      div(style="font-size:16px; font-weight:bold; margin-bottom:10px;") TVDB cache mismatch detected
      pre(style="margin:0; font-size:12px; white-space:pre-wrap; word-break:break-word;") {{ tvdbMismatchText }}
      div(style="display:flex; justify-content:flex-end; margin-top:12px;")
        button(
          @click.stop.prevent="closeTvdbMismatch"
          @pointerdown.stop.prevent
          style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px 12px; border:1px solid #bbb; background-color:whitesmoke;"
        ) OK
</template>

<script>
import List     from './list.vue';
import Series   from './series.vue';
import Map      from './map.vue';
import Actors   from './actors.vue';
import Buttons  from './buttons.vue';
import Reel     from './reel.vue';
import Torrents from './torrents.vue';
import Subs     from './subs.vue';
import Flex     from './flex.vue';
import History  from './history.vue';
import TvProc   from './tvproc.vue';
import FilePane from './file.vue';
import evtBus   from '../evtBus.js';
import * as tvdb from '../tvdb.js';
import { config } from '../config.js';

export default {
  name: "App",
  components: { List, Series, Map, Actors, Buttons, Reel, Torrents, Subs, Flex, History, TvProc, FilePane },
  data() { 
    return { 
      // Must be known before first render so non-simple panes never mount in simple mode.
      simpleMode: new URLSearchParams(window.location.search).has('simple'),
      currentPane: 'series', // 'series', 'map', 'actors', 'torrents', 'subs', 'flex', 'history', 'tvproc', or 'file'
      currentTvdbData: null,
      currentShow: null,
      _torrentsInitialized: false,
      _torrentsShowKey: null,
      _actorsInitialized: false,
      _actorsShowKey: null,
      mapShow: null,
      hideMapBottom: true,
      seriesMapSeasons: [],
      seriesMapEpis: [],
      seriesMap: {},
      mapError: '',
      allShows: [],
      _didRequestNotifications: false,

      tvdbMismatchOpen: false,
      tvdbMismatchText: '',

      _downActiveQbt: false,
      _downActiveDown: false,
      _downActive: false,
      _downInactiveTimer: null,
      _qbtPollTimer: null,
      _qbtPolling: false,
      // TABLET SIZING CONFIGURATION - SIMPLE MODE - Tweak these values
      sizing: {
        // List pane
        listWidth: '730px',           // narrower list pane
        
        // Series pane  
        seriesWidth: '450px',         // series pane width
        mapWidth: '450px',            // map pane width
        posterWidth: '180px',         // smaller poster
        posterHeight: '210px',
        seriesFontSize: '18px',       // smaller title
        seriesInfoFontSize: '15px',   // smaller info text
        seriesInfoWidth: '250px',     // narrower info box
        infoBoxLineHeight: '1.8',     // line spacing in info box (default: 1.2)
        remotesWidth: '210px',        // narrower remotes area
        remoteButtonPadding: '6px',   // smaller remote buttons
        remoteFontSize: '13px',
        watchButtonPadding: '8px 12px', // smaller watch buttons
        watchButtonFontSize: '13px',
        emailWidth: '170px',          // narrower email box
        overviewFontSize: '16px',     // overview text at bottom of series pane (default: 20px)
        
        // Buttons pane
        buttonHeight: '32px',         // button height (text will be vertically centered)
        buttonFontSize: '15px',
        buttonMarginBottom: '6px',
        buttonTopMargin: '0px',       // margin above top button
        buttonContainerPadding: '12px' // padding around entire button container (default: 5px with 0 bottom)
      },
      // TABLET SIZING CONFIGURATION - NON-SIMPLE MODE - Tweak these values
      sizingNonSimple: {
        // List pane
        listWidth: '900px',
        
        // Series pane  
        seriesWidth: '450px',
        mapWidth: '450px',
        posterWidth: '180px',
        posterHeight: '210px',
        seriesFontSize: '18px',
        seriesInfoFontSize: '15px',
        seriesInfoWidth: '250px',
        infoBoxLineHeight: '1.8',
        remotesWidth: '210px',
        remoteButtonPadding: '6px',
        remoteFontSize: '13px',
        watchButtonPadding: '8px 12px',
        watchButtonFontSize: '13px',
        emailWidth: '170px',
        overviewFontSize: '16px',
        
        // Buttons pane (not used in non-simple mode)
        buttonHeight: '32px',
        buttonFontSize: '15px',
        buttonMarginBottom: '6px',
        buttonTopMargin: '0px',
        buttonContainerPadding: '12px'
      },

      // Drag-resize state for List vs right-side panes
      windowW: window.innerWidth,
      windowH: window.innerHeight,
      tabAreaWidthOverridePx: null,
      tabAreaHeightOverridePx: null,
      paneResizeActive: false,
      paneResizeAxis: 'x',
      paneResizeStartX: 0,
      paneResizeStartY: 0,
      paneResizeStartTabW: 0,
      paneResizeStartTabH: 0,

      // Persisted split percentages (0..1). Stored separately for landscape vs portrait.
      splitTabWidthPct: null,
      splitTabHeightPct: null,
    } 
  },
  computed: {
    isPortrait() {
      return Number(this.windowH) > Number(this.windowW);
    },

    showSideButtons() {
      return !!(this.simpleMode && this.isPortrait);
    },

    sideButtonsSizing() {
      const scalePx = (val, scale) => {
        if (typeof val !== 'string') return val;
        const m = val.trim().match(/^([0-9]+(?:\.[0-9]+)?)px$/);
        if (!m) return val;
        const n = Math.round(Number(m[1]) * scale);
        return `${n}px`;
      };

      const scale = 0.75;
      const base = this.activeSizing || {};
      return {
        ...base,
        buttonHeight: scalePx(base.buttonHeight || '40px', scale),
        buttonFontSize: scalePx(base.buttonFontSize || '15px', scale),
        buttonMarginBottom: scalePx(base.buttonMarginBottom || '8px', scale),
        buttonTopMargin: scalePx(base.buttonTopMargin || '10px', scale),
        buttonContainerPadding: scalePx(base.buttonContainerPadding || '5px', scale),
      };
    },

    activeSizing() {
      const base = this.simpleMode ? this.sizing : this.sizingNonSimple;

      // List pane should flex; keep internal list content at 100% of its container.
      return { ...base, listWidth: '100%' };
    },

    tabAreaWidth() {
      if (typeof this.tabAreaWidthOverridePx === 'number' && Number.isFinite(this.tabAreaWidthOverridePx)) {
        return `${Math.max(0, this.tabAreaWidthOverridePx)}px`;
      }
      const base = this.simpleMode ? this.sizing : this.sizingNonSimple;
      const toPx = (val) => {
        if (typeof val === 'number' && Number.isFinite(val)) return val;
        if (typeof val !== 'string') return null;
        const m = val.trim().match(/^([0-9]+(?:\.[0-9]+)?)px$/);
        return m ? Number(m[1]) : null;
      };

      const seriesPx = toPx(base?.seriesWidth);
      const mapPx = toPx(base?.mapWidth);

      // If both are explicit px values, keep the old behavior: use the larger,
      // so switching tabs doesn't change the outer width.
      if (seriesPx != null && mapPx != null) {
        const tabW = Math.max(seriesPx, mapPx) || 450;
        return `${tabW}px`;
      }

      // Otherwise allow "variable" CSS widths (vw, %, auto, calc, etc.).
      // Prefer an explicit series width first, then map.
      return base?.seriesWidth || base?.mapWidth || '450px';
    },

    tabAreaHeight() {
      if (typeof this.tabAreaHeightOverridePx === 'number' && Number.isFinite(this.tabAreaHeightOverridePx)) {
        return `${Math.max(0, this.tabAreaHeightOverridePx)}px`;
      }
      // Default portrait split if no override: half the available height.
      return '50%';
    },

    tabAreaStyle() {
      if (this.isPortrait) {
        return { width: '100%', height: this.tabAreaHeight, flex: '0 0 auto', minWidth: '0px', minHeight: '0px', display: 'flex', flexDirection: 'column', marginRight: '0px', order: 0, boxSizing: 'border-box', paddingLeft: this.simpleMode ? '0px' : '10px' };
      }
      return { width: this.tabAreaWidth, height: '100%', flex: '0 0 auto', minWidth: '0px', display: 'flex', flexDirection: 'column', marginRight: '10px', order: 2, boxSizing: 'border-box', paddingLeft: this.simpleMode ? '0px' : '10px' };
    },

    listStyle() {
      if (this.isPortrait) {
        return { flex: '1 1 auto', minHeight: '0px', width: '100%', order: 2 };
      }
      return { flex: '1 1 auto', minWidth: '0px', order: 0 };
    },

    paneDividerStyle() {
      if (this.isPortrait) {
        return { height: '12px', width: '100%', cursor: 'row-resize', backgroundColor: '#ddd', flex: '0 0 auto', order: 1 };
      }
      return { width: '12px', cursor: 'col-resize', backgroundColor: '#ddd', flex: '0 0 auto', order: 1 };
    },

    tabs() {
      const allTabs = [
        { label: 'Series', key: 'series' },
        { label: 'Map', key: 'map' },
        { label: 'Actors', key: 'actors' },
        { label: 'Reel', key: 'reel' },
        { label: 'Tor', key: 'torrents' },
        { label: 'Flex', key: 'flex' },
        { label: 'Qbt', key: 'history' },
        { label: 'Down', key: 'tvproc' },
        { label: 'Subs', key: 'subs' },
        { label: 'Files', key: 'file' }
      ];

      if (!this.simpleMode) return allTabs;
      const allowed = new Set(['series', 'map', 'actors']);
      return allTabs.filter(t => allowed.has(t.key));
    }
  },
  unmounted() {
    evtBus.off('downActivePart', this.handleDownActivePart);
    evtBus.off('tvdb-mismatch', this.handleTvdbMismatch);
    if (this._onAppWindowResize) window.removeEventListener('resize', this._onAppWindowResize);
    this.stopQbtPolling();
    this.cancelDownInactiveTimer();
  },
  methods: {
    handleTvdbMismatch(payload) {
      if (this.simpleMode) return;

      if (payload && typeof payload === 'object') {
        const name = payload?.name != null ? String(payload.name) : '';
        const showId = payload?.showId != null ? String(payload.showId) : '';
        const tvdbId = payload?.tvdbId != null ? String(payload.tvdbId) : '';
        const existingShowId = payload?.existing?.showId != null ? String(payload.existing.showId) : '';
        const existingTvdbId = payload?.existing?.tvdbId != null ? String(payload.existing.tvdbId) : '';
        const existingDeleted = payload?.existing?.deleted != null ? String(payload.existing.deleted) : '';

        const lines = [];
        lines.push('What happened');
        lines.push('- A cached TVDB entry exists for this show name, but it does not match the currently loaded Emby show.');
        lines.push('- The client will rebuild/update the cache entry via getNewTvdb().');
        lines.push('');
        lines.push('Current show (from Emby)');
        lines.push(`- Show name key (show.Name): ${name}`);
        lines.push(`- Emby show Id (show.Id): ${showId}`);
        lines.push(`- TVDB series Id on show (show.TvdbId): ${tvdbId}`);
        lines.push('');
        lines.push('Existing cached entry (from server TVDB cache: allTvdb[show.Name])');
        lines.push(`- Cached showId (tvdb.showId): ${existingShowId}`);
        lines.push(`- Cached tvdbId (tvdb.tvdbId): ${existingTvdbId}`);
        if (existingDeleted) lines.push(`- Cached deleted flag/date (tvdb.deleted): ${existingDeleted}`);
        lines.push('');
        lines.push('Raw details');
        try {
          lines.push(JSON.stringify(payload, null, 2));
        } catch {
          lines.push(String(payload));
        }

        this.tvdbMismatchText = lines.join('\n');
      } else {
        this.tvdbMismatchText = String(payload);
      }
      this.tvdbMismatchOpen = true;
    },

    closeTvdbMismatch() {
      this.tvdbMismatchOpen = false;
    },

    triggerShowReload() {
      evtBus.emit('library-refresh-complete', { showReloadDialog: true });
    },
    onSideButtonsClick(activeButtons) {
      evtBus.emit('simpleModeButtonsClick', activeButtons);
    },

    onSideButtonsTop() {
      evtBus.emit('simpleModeButtonsTop');
    },
    loadSplitPrefs() {
      const readNum = (key) => {
        try {
          const raw = window.localStorage.getItem(key);
          if (raw == null) return null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        } catch {
          return null;
        }
      };

      const w = readNum('tv.split.tabWidthPct');
      const h = readNum('tv.split.tabHeightPct');
      this.splitTabWidthPct = (w != null && w > 0 && w < 1) ? w : null;
      this.splitTabHeightPct = (h != null && h > 0 && h < 1) ? h : null;
    },

    persistSplitPrefs() {
      const writeNum = (key, val) => {
        try {
          if (typeof val !== 'number' || !Number.isFinite(val)) return;
          window.localStorage.setItem(key, String(val));
        } catch {
          // ignore
        }
      };

      writeNum('tv.split.tabWidthPct', this.splitTabWidthPct);
      writeNum('tv.split.tabHeightPct', this.splitTabHeightPct);
    },

    applySplitPrefsToOverrides() {
      // Convert stored percentages into px overrides for the current container size.
      const root = this.$el;
      if (!root) return;

      const baseW = root.clientWidth || window.innerWidth;
      const baseH = root.clientHeight || window.innerHeight;

      if (this.isPortrait) {
        if (typeof this.splitTabHeightPct === 'number' && Number.isFinite(this.splitTabHeightPct)) {
          const desired = Math.round(this.splitTabHeightPct * baseH);
          const minTabH = 220;
          const maxTabH = Math.max(minTabH, Math.floor(baseH * 0.9));
          this.tabAreaHeightOverridePx = Math.max(minTabH, Math.min(maxTabH, desired));
        }
        return;
      }

      if (typeof this.splitTabWidthPct === 'number' && Number.isFinite(this.splitTabWidthPct)) {
        const desired = Math.round(this.splitTabWidthPct * baseW);
        const minTabW = 320;
        const maxTabW = Math.max(minTabW, Math.floor(baseW * 0.9));
        this.tabAreaWidthOverridePx = Math.max(minTabW, Math.min(maxTabW, desired));
      }
    },

    updateSplitPrefsFromDom() {
      const root = this.$el;
      const tab = root?.querySelector?.('#tabArea');
      if (!root || !tab) return;

      const baseW = root.clientWidth || window.innerWidth;
      const baseH = root.clientHeight || window.innerHeight;
      const rect = tab.getBoundingClientRect?.();
      if (!rect) return;

      if (this.isPortrait) {
        if (!baseH) return;
        const pct = rect.height / baseH;
        if (Number.isFinite(pct) && pct > 0 && pct < 1) {
          this.splitTabHeightPct = pct;
        }
      } else {
        if (!baseW) return;
        const pct = rect.width / baseW;
        if (Number.isFinite(pct) && pct > 0 && pct < 1) {
          this.splitTabWidthPct = pct;
        }
      }

      this.persistSplitPrefs();
    },

    startPaneResize(e) {
      if (!e) return;
      const divider = e.currentTarget;
      const tab = this.$el?.querySelector?.('#tabArea');
      if (!divider || !tab) return;

      this.paneResizeActive = true;

      const rect = tab.getBoundingClientRect?.();
      if (this.isPortrait) {
        // Measure current rendered height so drag works even if height is %.
        const h = rect && Number.isFinite(rect.height) ? rect.height : null;
        if (!h) {
          this.paneResizeActive = false;
          return;
        }
        this.paneResizeAxis = 'y';
        this.paneResizeStartY = Number(e.clientY) || 0;
        this.paneResizeStartTabH = h;
      } else {
        // Measure current rendered width so drag works even if width is vw/%.
        const w = rect && Number.isFinite(rect.width) ? rect.width : null;
        if (!w) {
          this.paneResizeActive = false;
          return;
        }
        this.paneResizeAxis = 'x';
        this.paneResizeStartX = Number(e.clientX) || 0;
        this.paneResizeStartTabW = w;
      }

      try {
        if (typeof divider.setPointerCapture === 'function' && e.pointerId != null) {
          divider.setPointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    },

    onPaneResizeMove(e) {
      if (!this.paneResizeActive) return;
      if (!e) return;

      if (this.paneResizeAxis === 'y') {
        const dy = (Number(e.clientY) || 0) - (Number(this.paneResizeStartY) || 0);
        // Drag down => divider down => tab area taller.
        const next = (Number(this.paneResizeStartTabH) || 0) + dy;
        const minTabH = 220;
        const maxTabH = Math.max(minTabH, Math.floor(window.innerHeight * 0.9));
        const clamped = Math.max(minTabH, Math.min(maxTabH, next));
        this.tabAreaHeightOverridePx = Math.round(clamped);
        return;
      }

      const dx = (Number(e.clientX) || 0) - (Number(this.paneResizeStartX) || 0);
      // Drag right => divider right => tab area smaller.
      const next = (Number(this.paneResizeStartTabW) || 0) - dx;

      const minTabW = 320;
      const maxTabW = Math.max(minTabW, Math.floor(window.innerWidth * 0.9));
      const clamped = Math.max(minTabW, Math.min(maxTabW, next));
      this.tabAreaWidthOverridePx = Math.round(clamped);
    },

    stopPaneResize() {
      this.paneResizeActive = false;
      // Save final split as a percentage for future sessions.
      this.updateSplitPrefsFromDom();
    },

    cancelDownInactiveTimer() {
      if (this._downInactiveTimer) {
        clearTimeout(this._downInactiveTimer);
        this._downInactiveTimer = null;
      }
    },

    requestSpaceAvailRefresh(reason = '') {
      if (this.simpleMode) return;
      evtBus.emit('refreshSpaceAvail', { reason: String(reason || '') });
    },

    recomputeDownActive() {
      const prev = !!this._downActive;
      const next = !!(this._downActiveQbt || this._downActiveDown);
      if (prev === next) return;
      this._downActive = next;

      if (next) {
        // Downloads became active again; cancel any pending restart.
        this.cancelDownInactiveTimer();
        return;
      }

      // Falling edge: true -> false. Restart only after 60s of sustained inactivity.
      this.cancelDownInactiveTimer();
      this._downInactiveTimer = setTimeout(() => {
        this._downInactiveTimer = null;
        if (this._downActiveQbt || this._downActiveDown) return;
        this.requestSpaceAvailRefresh('downActive idle 60s');
      }, 60000);
    },

    handleDownActivePart(payload) {
      const src = payload?.source;
      const active = !!payload?.active;
      if (src === 'tvproc') {
        this._downActiveDown = active;
        this.recomputeDownActive();
      }
    },

    async pollQbtActiveOnce() {
      try {
        const url = new URL(`${config.torrentsApiUrl}/api/qbt/info`);
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const torrents = await res.json();
        if (!Array.isArray(torrents)) return;

        const active = torrents.some(t => {
          const st = String(t?.state || '').trim().toLowerCase();
          return st === 'downloading';
        });

        if (active !== this._downActiveQbt) {
          this._downActiveQbt = active;
          this.recomputeDownActive();
        }
      } catch {
        // ignore
      }
    },

    scheduleNextQbtPoll(delayMs) {
      if (!this._qbtPolling) return;
      if (this._qbtPollTimer) {
        clearTimeout(this._qbtPollTimer);
        this._qbtPollTimer = null;
      }
      this._qbtPollTimer = setTimeout(async () => {
        if (!this._qbtPolling) return;
        await this.pollQbtActiveOnce();
        this.scheduleNextQbtPoll(5000);
      }, Math.max(0, Number(delayMs) || 0));
    },

    startQbtPolling() {
      if (this._qbtPolling || this.simpleMode) return;
      this._qbtPolling = true;
      this.scheduleNextQbtPoll(0);
    },

    stopQbtPolling() {
      this._qbtPolling = false;
      if (this._qbtPollTimer) {
        clearTimeout(this._qbtPollTimer);
        this._qbtPollTimer = null;
      }
    },
    requestNotificationsOnce() {
      try {
        if (this._didRequestNotifications) return;
        this._didRequestNotifications = true;
        if (typeof window === 'undefined') return;
        if (!('Notification' in window)) return;
        if (Notification.permission !== 'default') return;
        // Must be triggered by a user gesture (e.g., this tab click) to prompt in Firefox.
        void Notification.requestPermission();
      } catch {
        // ignore
      }
    },
    handleAllShows(shows) {
      this.allShows = Array.isArray(shows) ? shows : [];
    },
    selectTab(key) {
      const k = String(key || '');
      if (!k) return;

      // In simple mode, only Series/Map/Actors exist.
      if (this.simpleMode && !['series', 'map', 'actors'].includes(k)) {
        return;
      }

      if (k === 'series') {
        this.handleActorsClose();
        return;
      }

      if (k === 'map') {
        if (this.currentShow) {
          this.currentPane = 'map';
          evtBus.emit('paneChanged', this.currentPane);
          evtBus.emit('mapAction', { action: 'open', show: this.currentShow });
        } else {
          this.currentPane = 'map';
          evtBus.emit('paneChanged', this.currentPane);
        }
        return;
      }

      if (k === 'actors') {
        this.handleShowActors(false);
        return;
      }

      if (k === 'reel') {
        if (this.simpleMode) return;
        this.currentPane = 'reel';
        evtBus.emit('paneChanged', this.currentPane);
        return;
      }

      if (k === 'torrents') {
        if (this.currentShow) this.handleShowTorrents(this.currentShow);
        else {
          this.currentPane = 'torrents';
          evtBus.emit('paneChanged', this.currentPane);
        }
        return;
      }

      if (k === 'subs') {
        if (this.simpleMode) return;
        this.currentPane = 'subs';
        evtBus.emit('paneChanged', this.currentPane);
        return;
      }

      if (k === 'flex') {
        if (this.simpleMode) return;
        this.currentPane = 'flex';
        evtBus.emit('paneChanged', this.currentPane);
        return;
      }

      if (k === 'history') {
        this.handleShowHistory();
        return;
      }

      if (k === 'tvproc') {
        // Prompt for desktop notification permission (Firefox requires user gesture).
        this.requestNotificationsOnce();
        this.handleShowTvproc();
        return;
      }

      if (k === 'file') {
        if (this.simpleMode) return;
        this.currentPane = 'file';
        evtBus.emit('paneChanged', this.currentPane);
        return;
      }
    },
    handleShowMap(data) {
      this.mapShow = data.mapShow;
      this.hideMapBottom = data.hideMapBottom;
      this.seriesMapSeasons = data.seriesMapSeasons;
      this.seriesMapEpis = data.seriesMapEpis;
      this.seriesMap = data.seriesMap;
      this.mapError = data.mapError || '';

      // Let Series pane derive counts from the same map it shows.
      if (this.mapShow) {
        evtBus.emit('seriesMapUpdated', { show: this.mapShow, seriesMap: this.seriesMap });
      }

      // Only switch to map pane if noSwitch flag is not set
      if (!data.noSwitch) {
        this.currentPane = data.mapShow !== null ? 'map' : 'series';
        evtBus.emit('paneChanged', this.currentPane);
      }
    },
    handleHideMap() {
      this.currentPane = 'series';
      this.mapShow = null;
      evtBus.emit('paneChanged', this.currentPane);
    },
    handleShowActors(fromMap = false) {
      // If called from map click, show series pane instead
      if (fromMap) {
        this.currentPane = 'series';
        this.mapShow = null;
        evtBus.emit('paneChanged', this.currentPane);
        evtBus.emit('mapAction', { action: 'close', show: null });
      } else {
        const showKey = this.currentShow?.Id || this.currentShow?.Name || null;
        // Switching panes should not reset actors; only reset when show selection changes.
        if (this._actorsInitialized && this._actorsShowKey && showKey && this._actorsShowKey === showKey) {
          this.currentPane = 'actors';
          evtBus.emit('paneChanged', this.currentPane);
          return;
        }

        this.currentPane = 'actors';
        evtBus.emit('paneChanged', this.currentPane);
        // Emit event to actors component with current tvdbData and show
        evtBus.emit('showActors', { show: this.currentShow, tvdbData: this.currentTvdbData });
        this._actorsInitialized = true;
        this._actorsShowKey = showKey;
      }
    },
    handleActorsClose() {
      this.currentPane = 'series';
      this.mapShow = null;
      evtBus.emit('paneChanged', this.currentPane);
      // Clear mapShow in list component via event
      evtBus.emit('mapAction', { action: 'close', show: null });
    },
    handleShowTorrents(show) {
      if (this.simpleMode) return;
      const showKey = show?.Id || show?.Name || null;

      // Switching panes should not restart searching; only restart when show selection changes.
      if (this._torrentsInitialized && this._torrentsShowKey && showKey && this._torrentsShowKey === showKey) {
        this.currentPane = 'torrents';
        evtBus.emit('paneChanged', this.currentPane);
        return;
      }

      this.currentPane = 'torrents';
      evtBus.emit('paneChanged', this.currentPane);
      // Emit event to torrents component with show data
      evtBus.emit('showTorrents', show);
      this._torrentsInitialized = true;
      this._torrentsShowKey = showKey;
    },

    handleShowHistory() {
      if (this.simpleMode) return;
      this.currentPane = 'history';
      evtBus.emit('paneChanged', this.currentPane);
    },

    handleShowTvproc() {
      if (this.simpleMode) return;
      this.currentPane = 'tvproc';
      evtBus.emit('paneChanged', this.currentPane);
    },

    handleHistoryToTorrents() {
      // Do not reload/emit showTorrents when just switching panes.
      if (this._torrentsInitialized) {
        this.currentPane = 'torrents';
        evtBus.emit('paneChanged', this.currentPane);
        return;
      }

      // Fallback: if torrents was never initialized, open it with current show.
      if (this.currentShow) {
        this.handleShowTorrents(this.currentShow);
      } else {
        this.currentPane = 'torrents';
        evtBus.emit('paneChanged', this.currentPane);
      }
    },

    handleHistoryToSeries() {
      this.currentPane = 'series';
      this.mapShow = null;
      evtBus.emit('paneChanged', this.currentPane);
      evtBus.emit('mapAction', { action: 'close', show: null });
    },

    handleHistoryToMap() {
      if (this.currentShow) {
        evtBus.emit('mapAction', { action: 'open', show: this.currentShow });
      }
    },

    handleTvprocToTorrents() {
      if (this._torrentsInitialized) {
        this.currentPane = 'torrents';
        evtBus.emit('paneChanged', this.currentPane);
        return;
      }

      if (this.currentShow) {
        this.handleShowTorrents(this.currentShow);
      } else {
        this.currentPane = 'torrents';
        evtBus.emit('paneChanged', this.currentPane);
      }
    },

    handleTvprocToHistory() {
      this.currentPane = 'history';
      evtBus.emit('paneChanged', this.currentPane);
    },

    handleTvprocToSeries() {
      this.currentPane = 'series';
      this.mapShow = null;
      evtBus.emit('paneChanged', this.currentPane);
      evtBus.emit('mapAction', { action: 'close', show: null });
    },

    handleTvprocToMap() {
      if (this.currentShow) {
        evtBus.emit('mapAction', { action: 'open', show: this.currentShow });
      }
    },
    handleTorrentsClose() {
      this.currentPane = 'series';
      this.mapShow = null;
      evtBus.emit('paneChanged', this.currentPane);
      // Clear mapShow in list component via event
      evtBus.emit('mapAction', { action: 'close', show: null });
    },
    handleMapAction(action, show) {
      if (action === 'close') {
        this.handleHideMap();
      }
      evtBus.emit('mapAction', { action, show });
    },
    handleEpisodeClick(e, show, season, episode, setWatched = null) {
      evtBus.emit('episodeClick', {e, show, season, episode, setWatched});
    }
    ,
    handleSeasonDelete(e, show, season) {
      evtBus.emit('seasonDelete', { e, show, season });
    }
  },
  mounted() {
    this._onAppWindowResize = () => {
      this.windowW = window.innerWidth;
      this.windowH = window.innerHeight;
      // Keep px overrides in sync with stored percentages.
      if (!this.paneResizeActive) {
        this.applySplitPrefsToOverrides();
      }
    };
    window.addEventListener('resize', this._onAppWindowResize);
    this._onAppWindowResize();

    this.loadSplitPrefs();
    this.$nextTick(() => {
      this.applySplitPrefsToOverrides();
    });

    // Derive downActive and schedule deferred Tor restarts.
    evtBus.on('downActivePart', this.handleDownActivePart);
    evtBus.on('tvdb-mismatch', this.handleTvdbMismatch);
    this.startQbtPolling();

    // Refresh space display once on app load.
    this.requestSpaceAvailRefresh('app load');

    if (this.simpleMode && !['series', 'map', 'actors'].includes(this.currentPane)) {
      this.currentPane = 'series';
    }

    // Listen for pane navigation events
    evtBus.on('showActorsPane', () => {
      this.handleShowActors(false);
    });
    
    evtBus.on('showActorsPaneWithEpisode', (episodeInfo) => {
      this.handleShowActors(false);
      // Emit event to actors pane with episode info
      evtBus.emit('fillAndSelectEpisode', episodeInfo);
    });
    
    evtBus.on('showTorrentsPane', (show) => {
      this.handleShowTorrents(show);
    });

    // Map navigation is centralized through list.vue via mapAction('open')

    evtBus.on('showSeriesPane', () => {
      this.handleActorsClose();
    });
    
    // Close torrents or actors pane when a different show is selected
    evtBus.on('setUpSeries', (show) => {
      // Keep currentShow synced to the list selection immediately.
      // tvdbDataReady may arrive later; that's fine.
      this.currentShow = show;

      // If currently on Map, do not force-switch panes.
      // list.vue will separately update the map content.
      if (this.currentPane === 'map') {
        return;
      }

      const prevPane = this.currentPane;

      // New show selection should reset Actors state.
      evtBus.emit('resetActorsPane');
      this._actorsInitialized = false;
      this._actorsShowKey = null;

      // Clear stale TVDB data until the series pane publishes the new show data.
      this.currentTvdbData = null;

      // New show selection should allow torrents pane to reinitialize.
      this._torrentsInitialized = false;
      this._torrentsShowKey = null;

      // When currently viewing Actors, stay on Actors (do not bounce to Series).
      if (prevPane === 'actors') {
        // Trigger a refresh; tvdbData may be null initially and will be resent on tvdbDataReady.
        evtBus.emit('showActors', { show: this.currentShow, tvdbData: this.currentTvdbData });
        return;
      }

      // When currently viewing File, stay on File.
      // The File pane listens to setUpSeries and will refresh itself.
      if (prevPane === 'file') {
        return;
      }

      // When currently viewing Torrents, stay on Torrents.
      // A new show selection should restart torrent search for the new show.
      if (prevPane === 'torrents') {
        this.currentPane = 'torrents';
        evtBus.emit('paneChanged', this.currentPane);
        evtBus.emit('showTorrents', this.currentShow);
        this._torrentsInitialized = true;
        this._torrentsShowKey = this.currentShow?.Id || this.currentShow?.Name || null;
        return;
      }

      // When currently viewing Subs, stay on Subs.
      // Subs pane is driven by :activeShow and will update for the new show.
      if (prevPane === 'subs') {
        this.currentPane = 'subs';
        evtBus.emit('paneChanged', this.currentPane);
        return;
      }

      // Otherwise, return to the Series pane.
      this.currentPane = 'series';
      this.mapShow = null;
      evtBus.emit('paneChanged', this.currentPane);
    });
    
    // Listen for tvdbData updates from series pane
    evtBus.on('tvdbDataReady', (data) => {
      const incomingShow = data?.show || null;
      const incomingId = incomingShow?.Id != null ? String(incomingShow.Id) : '';
      const incomingName = incomingShow?.Name != null ? String(incomingShow.Name) : '';

      const currentId = this.currentShow?.Id != null ? String(this.currentShow.Id) : '';
      const currentName = this.currentShow?.Name != null ? String(this.currentShow.Name) : '';

      // Ignore late/stale tvdbDataReady events for a previously selected show.
      // setUpSeries is the source of truth for current selection.
      if (this.currentShow && incomingShow) {
        const sameId = incomingId && currentId && incomingId === currentId;
        const sameName = !incomingId && !currentId && incomingName && currentName && incomingName === currentName;
        if (!sameId && !sameName) return;
      }

      // Keep currentShow as-is (already set by setUpSeries). Only update TVDB data.
      this.currentTvdbData = data?.tvdbData ?? null;

      // If Actors pane is currently showing, refresh it with the newly loaded tvdbData.
      if (this.currentPane === 'actors') {
        const showKey = this.currentShow?.Id || this.currentShow?.Name || null;
        evtBus.emit('showActors', { show: this.currentShow, tvdbData: this.currentTvdbData });
        this._actorsInitialized = true;
        this._actorsShowKey = showKey;
      }
    });

    // Optional test has been silenced to avoid console noise
    // (Leave for manual debugging by uncommenting if needed)
    // (async () => {
    //   try {
    //     const testShow = { Name: 'Ghosts (US)' };
    //     const seriesMap = await tvdb.getSeriesMap(testShow);
    //     // console.log('tvdb.getSeriesMap test full for "Ghosts (US)":', seriesMap);
    //   } catch (err) {
    //     console.error('tvdb.getSeriesMap test failed:', err);
    //   }
    // })();
  },
}
</script>

<style>
html, body {
  width: 100%;
  height: 97dvh;
  margin: 0;
  padding: 0;
}

/* Force black text only in the right-side panes */
#series, #series *,
#map, #map *,
#actors, #actors *,
#torrents, #torrents *,
#history, #history *,
#tvproc, #tvproc * {
  color: #000 !important;
}

/* Force light-gray button backgrounds only in the right-side panes */
#series button,
#map button,
#actors button,
#torrents button,
.torrents-container button,
#history button,
#tvproc button {
  background-color: var(--btn-bg, whitesmoke) !important;
}
</style>
