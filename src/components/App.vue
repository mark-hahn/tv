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
    @show-actors="() => handleShowActors(true)"
    @series="handleActorsClose"
    @actors="() => handleShowActors(false)"
    @torrents="() => handleShowTorrents(mapShow)"
    @episode-click="handleEpisodeClick"
  )
  Actors(
    v-show="currentPane === 'actors'"
    :simpleMode="simpleMode"
    :sizing="simpleMode ? sizing : sizingNonSimple"
    @close="handleActorsClose"
    @series="handleActorsClose"
    @map="() => { if (currentShow) { evtBus.emit('mapAction', { action: 'open', show: currentShow }); } }"
  )
  Torrents(
    v-show="currentPane === 'torrents'"
    :simpleMode="simpleMode"
    :sizing="simpleMode ? sizing : sizingNonSimple"
    :activeShow="currentShow"
    @close="handleTorrentsClose"
    @series="handleTorrentsClose"
    @map="() => { if (currentShow) { evtBus.emit('mapAction', { action: 'open', show: currentShow }); } }"
    @status="handleShowStatus"
    @history="handleShowHistory"
  )

  DlStatus(
    v-show="currentPane === 'dlstatus'"
    :simpleMode="simpleMode"
    :sizing="simpleMode ? sizing : sizingNonSimple"
    @torrents="handleStatusToTorrents"
    @series="handleStatusToSeries"
    @map="handleStatusToMap"
    @history="handleShowHistory"
  )

  History(
    v-show="currentPane === 'history'"
    :simpleMode="simpleMode"
    :sizing="simpleMode ? sizing : sizingNonSimple"
    @torrents="handleHistoryToTorrents"
    @status="handleHistoryToStatus"
    @series="handleHistoryToSeries"
    @map="handleHistoryToMap"
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
import evtBus   from '../evtBus.js';
import * as tvdb from '../tvdb.js';

export default {
  name: "App",
  components: { List, Series, Map, Actors, Torrents, DlStatus, History },
  data() { 
    return { 
      simpleMode: false,
      currentPane: 'series', // 'series', 'map', 'actors', 'torrents', 'dlstatus', or 'history'
      currentTvdbData: null,
      currentShow: null,
      _torrentsInitialized: false,
      _torrentsShowKey: null,
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
  methods: {
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
        this.currentPane = 'actors';
        evtBus.emit('paneChanged', this.currentPane);
        // Emit event to actors component with current tvdbData and show
        evtBus.emit('showActors', { show: this.currentShow, tvdbData: this.currentTvdbData });
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
      this.currentPane = 'dlstatus';
      evtBus.emit('paneChanged', this.currentPane);
    },

    handleShowHistory() {
      this.currentPane = 'history';
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
    const urlParams = new URLSearchParams(window.location.search);
    this.simpleMode = urlParams.has('simple');
    
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
      if (this.currentPane === 'torrents' || this.currentPane === 'dlstatus') {
        const prevPane = this.currentPane;
        this.currentPane = 'series';
        evtBus.emit('paneChanged', this.currentPane);
        // Only reset torrents; status pane should never reset.
        if (prevPane === 'torrents') {
          evtBus.emit('resetTorrentsPane');
        }
        this._torrentsInitialized = false;
        this._torrentsShowKey = null;
        return;
      }

      if (this.currentPane === 'actors') {
        this.currentPane = 'series';
        evtBus.emit('paneChanged', this.currentPane);
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
#history, #history * {
  color: #000 !important;
}
</style>
