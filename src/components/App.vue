<template lang="pug">

#all(style="width:100%; height:100dvh; box-sizing: border-box; padding:0; margin:0; display:flex;")
  List(
    style="display:inline-block;" 
    :simpleMode="simpleMode"
    :sizing="sizing"
    @show-map="handleShowMap"
    @hide-map="handleHideMap"
  )
  Series(v-show="!showMap" style="display:inline-block;" :simpleMode="simpleMode" :sizing="sizing")
  Map(
    v-show="showMap"
    :mapShow="mapShow"
    :hideMapBottom="hideMapBottom"
    :seriesMapSeasons="seriesMapSeasons"
    :seriesMapEpis="seriesMapEpis"
    :seriesMap="seriesMap"
    :simpleMode="simpleMode"
    @prune="handleMapAction('prune', $event)"
    @set-date="handleMapAction('date', $event)"
    @close="handleMapAction('close')"
    @episode-click="handleEpisodeClick"
  )
</template>

<script>
import List    from './list.vue';
import Series  from './series.vue';
import Map     from './map.vue';
import evtBus  from '../evtBus.js';

export default {
  name: "App",
  components: { List, Series, Map },
  data() { 
    return { 
      simpleMode: false,
      showMap: false,
      mapShow: null,
      hideMapBottom: true,
      seriesMapSeasons: [],
      seriesMapEpis: [],
      seriesMap: {},
      // TABLET SIZING CONFIGURATION - Tweak these values
      sizing: {
        // List pane
        listWidth: '750px',           // narrower list pane
        
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
      this.showMap = data.mapShow !== null;
    },
    handleHideMap() {
      console.log('handleHideMap called, setting showMap to false');
      this.showMap = false;
      this.mapShow = null;
    },
    handleMapAction(action, show) {
      if (action === 'close') {
        this.handleHideMap();
      }
      evtBus.emit('mapAction', { action, show });
    },
    handleEpisodeClick(e, show, season, episode) {
      evtBus.emit('episodeClick', { e, show, season, episode });
    }
  },
  mounted() {
    const urlParams = new URLSearchParams(window.location.search);
    this.simpleMode = urlParams.has('simple');
  },
}
</script>

<style>
html, body {
  width: 100%;
  height: 100dvh;
  margin: 0;
  padding: 0;
}
</style>
