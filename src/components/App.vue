<template lang="pug">

#all(style="width:100%; height:97dvh; box-sizing: border-box; padding:0; margin:0; display:flex;")
  List(
    style="display:inline-block;" 
    :simpleMode="simpleMode"
    :sizing="simpleMode ? sizing : sizingNonSimple"
    @show-map="handleShowMap"
    @hide-map="handleHideMap"
    @show-actors="handleShowActors"
    @show-torrents="handleShowTorrents"
  )
  #tabArea(:style="{ flex:'1 1 auto', minWidth:'0px', display:'flex', flexDirection:'column', height:'100%' }")
    #tabBar(:style="{ display:'flex', gap:'6px', padding:'6px 8px', alignItems:'center', borderBottom:'1px solid #ddd', backgroundColor:'#fafafa', flex:'0 0 auto', flexWrap:'wrap' }")
      button(
        v-for="t in tabs"
        :key="t.key"
        @click.stop="selectTab(t.key)"
        :style="{ fontSize:'13px', cursor:'pointer', borderRadius:'7px', padding:'4px 10px', border:'1px solid #bbb', backgroundColor: (currentPane === t.key ? '#ddd' : 'whitesmoke') }"
      ) {{ t.label }}

    #tabBody(:style="{ flex:'1 1 auto', minHeight:'0px', position:'relative' }")
      Series(v-show="currentPane === 'series'" style="display:inline-block;" :simpleMode="simpleMode" :sizing="simpleMode ? sizing : sizingNonSimple")
      Map(
        v-show="currentPane === 'map'"
        :mapShow="mapShow"
        :hideMapBottom="hideMapBottom"
        :seriesMapSeasons="seriesMapSeasons"
        :seriesMapEpis="seriesMapEpis"
        :seriesMap="seriesMap"
        :mapError="mapError"
        :simpleMode="simpleMode"
        :sizing="simpleMode ? sizing : sizingNonSimple"
        @prune="handleMapAction('prune', $event)"
        @set-date="handleMapAction('date', $event)"
        @close="handleMapAction('close')"
        @show-actors="() => handleShowActors(false)"
        @episode-click="handleEpisodeClick"
      )
      Actors(
        v-show="currentPane === 'actors'"
        :simpleMode="simpleMode"
        :sizing="simpleMode ? sizing : sizingNonSimple"
      )
      Torrents(
        v-if="!simpleMode"
        v-show="currentPane === 'torrents'"
        :simpleMode="simpleMode"
        :sizing="simpleMode ? sizing : sizingNonSimple"
        :activeShow="currentShow"
      )

      DlStatus(
        v-if="!simpleMode"
        v-show="currentPane === 'dlstatus'"
        :simpleMode="simpleMode"
        :sizing="simpleMode ? sizing : sizingNonSimple"
      )

      History(
        v-if="!simpleMode"
        v-show="currentPane === 'history'"
        :simpleMode="simpleMode"
        :sizing="simpleMode ? sizing : sizingNonSimple"
      )

      TvProc(
        v-if="!simpleMode"
        v-show="currentPane === 'tvproc'"
        :simpleMode="simpleMode"
        :sizing="simpleMode ? sizing : sizingNonSimple"
      )
</template>

<script>
import List     from './list.vue';
import Series   from './series.vue';
import Map      from './map.vue';
import Actors   from './actors.vue';
import Torrents from './torrents.vue';
import DlStatus from './dlstatus.vue';
import History  from './history.vue';
import TvProc   from './tvproc.vue';
import evtBus   from '../evtBus.js';
import * as tvdb from '../tvdb.js';

export default {
  name: "App",
  components: { List, Series, Map, Actors, Torrents, DlStatus, History, TvProc },
  data() { 
    return { 
      // Must be known before first render so non-simple panes never mount in simple mode.
      simpleMode: new URLSearchParams(window.location.search).has('simple'),
      currentPane: 'series', // 'series', 'map', 'actors', 'torrents', 'dlstatus', 'history', or 'tvproc'
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
      }
    } 
  },
  computed: {
    tabs() {
      const allTabs = [
        { label: 'Series', key: 'series' },
        { label: 'Map', key: 'map' },
        { label: 'Actors', key: 'actors' },
        { label: 'Tor', key: 'torrents' },
        { label: 'Down', key: 'dlstatus' },
        { label: 'Qbt', key: 'history' },
        { label: 'Proc', key: 'tvproc' }
      ];

      if (!this.simpleMode) return allTabs;
      const allowed = new Set(['series', 'map', 'actors']);
      return allTabs.filter(t => allowed.has(t.key));
    }
  },
  methods: {
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

      if (k === 'torrents') {
        if (this.currentShow) this.handleShowTorrents(this.currentShow);
        else {
          this.currentPane = 'torrents';
          evtBus.emit('paneChanged', this.currentPane);
        }
        return;
      }

      if (k === 'dlstatus') {
        this.handleShowStatus();
        return;
      }

      if (k === 'history') {
        this.handleShowHistory();
        return;
      }

      if (k === 'tvproc') {
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
      console.log('Map pane opened - seriesMap:', this.seriesMap, 'error:', this.mapError);
      this.currentPane = data.mapShow !== null ? 'map' : 'series';
      evtBus.emit('paneChanged', this.currentPane);
    },
    handleHideMap() {
      console.log('handleHideMap called, setting currentPane to series');
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

    handleShowStatus() {
      if (this.simpleMode) return;
      this.currentPane = 'dlstatus';
      evtBus.emit('paneChanged', this.currentPane);
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

    handleStatusToTorrents() {
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

    handleStatusToSeries() {
      this.currentPane = 'series';
      this.mapShow = null;
      evtBus.emit('paneChanged', this.currentPane);
      evtBus.emit('mapAction', { action: 'close', show: null });
    },

    handleStatusToMap() {
      if (this.currentShow) {
        evtBus.emit('mapAction', { action: 'open', show: this.currentShow });
      }
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

    handleHistoryToStatus() {
      this.currentPane = 'dlstatus';
      evtBus.emit('paneChanged', this.currentPane);
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

    handleTvprocToStatus() {
      this.currentPane = 'dlstatus';
      evtBus.emit('paneChanged', this.currentPane);
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
      // If map is not currently showing, always return to the Series pane.
      if (this.currentPane !== 'map') {
        const prevPane = this.currentPane;
        this.currentPane = 'series';
        this.mapShow = null;
        evtBus.emit('paneChanged', this.currentPane);

        // Reset actors pane only when show selection changes.
        evtBus.emit('resetActorsPane');
        this._actorsInitialized = false;
        this._actorsShowKey = null;

        // Only reset torrents; status pane should never reset.
        if (prevPane === 'torrents') {
          evtBus.emit('resetTorrentsPane');
        }

        // New show selection should allow torrents pane to reinitialize.
        this._torrentsInitialized = false;
        this._torrentsShowKey = null;
      }
    });
    
    // Listen for tvdbData updates from series pane
    evtBus.on('tvdbDataReady', (data) => {
      this.currentShow = data.show;
      this.currentTvdbData = data.tvdbData;
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
#dlstatus, #dlstatus *,
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
#dlstatus button,
#history button,
#tvproc button {
  background-color: whitesmoke !important;
}
</style>
