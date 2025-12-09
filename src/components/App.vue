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
    :simpleMode="simpleMode"
    @prune="handleMapAction('prune', $event)"
    @set-date="handleMapAction('date', $event)"
    @close="handleMapAction('close')"
    @show-actors="handleShowActors"
    @episode-click="handleEpisodeClick"
  )
  Actors(
    v-show="currentPane === 'actors'"
    :simpleMode="simpleMode"
    :sizing="simpleMode ? sizing : sizingNonSimple"
    @close="handleActorsClose"
  )
  Torrents(
    v-show="currentPane === 'torrents'"
    :simpleMode="simpleMode"
    :sizing="simpleMode ? sizing : sizingNonSimple"
    @close="handleTorrentsClose"
  )
</template>

<script>
import List     from './list.vue';
import Series   from './series.vue';
import Map      from './map.vue';
import Actors   from './actors.vue';
import Torrents from './torrents.vue';
import evtBus   from '../evtBus.js';

export default {
  name: "App",
  components: { List, Series, Map, Actors, Torrents },
  data() { 
    return { 
      simpleMode: false,
      currentPane: 'series', // 'series', 'map', 'actors', or 'torrents'
      currentTvdbData: null,
      mapShow: null,
      hideMapBottom: true,
      seriesMapSeasons: [],
      seriesMapEpis: [],
      seriesMap: {},
      currentTvdbData: null,
      // TABLET SIZING CONFIGURATION - SIMPLE MODE - Tweak these values
      sizing: {
        // List pane
        listWidth: '730px',           // narrower list pane
        
        // Series pane  
        seriesWidth: '450px',         // series pane width
        posterWidth: '180px',         // smaller poster
        posterHeight: '210px',
        seriesFontSize: '18px',       // smaller title
        seriesInfoFontSize: '14px',   // smaller info text
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
        posterWidth: '180px',
        posterHeight: '210px',
        seriesFontSize: '18px',
        seriesInfoFontSize: '14px',
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
      this.currentPane = data.mapShow !== null ? 'map' : 'series';
      evtBus.emit('paneChanged', this.currentPane);
    },
    handleHideMap() {
      console.log('handleHideMap called, setting currentPane to series');
      this.currentPane = 'series';
      this.mapShow = null;
      evtBus.emit('paneChanged', this.currentPane);
    },
    handleShowActors() {
      this.currentPane = 'actors';
      evtBus.emit('paneChanged', this.currentPane);
      // Emit event to actors component with current tvdbData
      evtBus.emit('showActors', this.currentTvdbData);
    },
    handleActorsClose() {
      this.currentPane = 'series';
      this.mapShow = null;
      evtBus.emit('paneChanged', this.currentPane);
      // Clear mapShow in list component via event
      evtBus.emit('mapAction', { action: 'close', show: null });
    },
    handleShowTorrents(show) {
      this.currentPane = 'torrents';
      evtBus.emit('paneChanged', this.currentPane);
      // Emit event to torrents component with show data
      evtBus.emit('showTorrents', show);
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
      this.currentPane = 'actors';
    });
    
    evtBus.on('showTorrentsPane', (show) => {
      this.handleShowTorrents(show);
    });
    
    // Close torrents pane when a different show is selected
    evtBus.on('setUpSeries', (show) => {
      if (this.currentPane === 'torrents') {
        this.currentPane = 'series';
        evtBus.emit('paneChanged', this.currentPane);
      }
    });
    
    // Listen for tvdbData updates from series pane
    evtBus.on('tvdbDataReady', (tvdbData) => {
      this.currentTvdbData = tvdbData;
    });
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
</style>
