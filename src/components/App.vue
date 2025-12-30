<template lang="pug">

#all(style="width:100%; height:97dvh; box-sizing: border-box; padding:0; margin:0; display:flex;")
  List(
    style="flex:1 1 auto; min-width:0px;" 
    :simpleMode="simpleMode"
    :sizing="activeSizing"
    @show-map="handleShowMap"
    @hide-map="handleHideMap"
    @show-actors="handleShowActors"
    @show-torrents="handleShowTorrents"
    @all-shows="handleAllShows"
  )

  //- Draggable divider between List and right-side panes
  #paneDivider(
    @pointerdown.stop.prevent="startPaneResize"
    @pointermove.stop.prevent="onPaneResizeMove"
    @pointerup.stop.prevent="stopPaneResize"
    @pointercancel.stop.prevent="stopPaneResize"
    @lostpointercapture.stop.prevent="stopPaneResize"
    :style="{ width: '6px', cursor: 'col-resize', backgroundColor: '#ddd', flex: '0 0 auto' }"
    title="Drag to resize panes"
  )

  #tabArea(:style="{ width: tabAreaWidth, flex:'0 0 auto', minWidth:'0px', display:'flex', flexDirection:'column', height:'100%', marginRight:'10px' }")
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
        @prune="handleMapAction('prune', $event)"
        @set-date="handleMapAction('date', $event)"
        @close="handleMapAction('close')"
        @show-actors="() => handleShowActors(false)"
        @episode-click="handleEpisodeClick"
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
</template>

<script>
import List     from './list.vue';
import Series   from './series.vue';
import Map      from './map.vue';
import Actors   from './actors.vue';
import Reel     from './reel.vue';
import Torrents from './torrents.vue';
import Flex     from './flex.vue';
import History  from './history.vue';
import TvProc   from './tvproc.vue';
import evtBus   from '../evtBus.js';
import * as tvdb from '../tvdb.js';
import { config } from '../config.js';

export default {
  name: "App",
  components: { List, Series, Map, Actors, Reel, Torrents, Flex, History, TvProc },
  data() { 
    return { 
      // Must be known before first render so non-simple panes never mount in simple mode.
      simpleMode: new URLSearchParams(window.location.search).has('simple'),
      currentPane: 'series', // 'series', 'map', 'actors', 'torrents', 'flex', 'history', or 'tvproc'
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
      tabAreaWidthOverridePx: null,
      paneResizeActive: false,
      paneResizeStartX: 0,
      paneResizeStartTabW: 0,
    } 
  },
  computed: {
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
    tabs() {
      const allTabs = [
        { label: 'Series', key: 'series' },
        { label: 'Map', key: 'map' },
        { label: 'Actors', key: 'actors' },
        { label: 'Reel', key: 'reel' },
        { label: 'Tor', key: 'torrents' },
        { label: 'Flex', key: 'flex' },
        { label: 'Qbt', key: 'history' },
        { label: 'Down', key: 'tvproc' }
      ];

      if (!this.simpleMode) return allTabs;
      const allowed = new Set(['series', 'map', 'actors']);
      return allTabs.filter(t => allowed.has(t.key));
    }
  },
  unmounted() {
    evtBus.off('downActivePart', this.handleDownActivePart);
    this.stopQbtPolling();
    this.cancelDownInactiveTimer();
  },
  methods: {
    startPaneResize(e) {
      if (!e) return;
      const divider = e.currentTarget;
      const tab = this.$el?.querySelector?.('#tabArea');
      if (!divider || !tab) return;

      // Measure current rendered width so drag works even if the width is vw/%.
      const rect = tab.getBoundingClientRect?.();
      const w = rect && Number.isFinite(rect.width) ? rect.width : null;
      if (!w) return;

      this.paneResizeActive = true;
      this.paneResizeStartX = Number(e.clientX) || 0;
      this.paneResizeStartTabW = w;

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
  },
  mounted() {
    // Derive downActive and schedule deferred Tor restarts.
    evtBus.on('downActivePart', this.handleDownActivePart);
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

      // Otherwise, return to the Series pane.
      this.currentPane = 'series';
      this.mapShow = null;
      evtBus.emit('paneChanged', this.currentPane);

      // Only reset torrents UI when torrents pane was open.
      if (prevPane === 'torrents') {
        evtBus.emit('resetTorrentsPane');
      }
    });
    
    // Listen for tvdbData updates from series pane
    evtBus.on('tvdbDataReady', (data) => {
      this.currentShow = data.show;
      this.currentTvdbData = data.tvdbData;

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
  background-color: whitesmoke !important;
}
</style>
