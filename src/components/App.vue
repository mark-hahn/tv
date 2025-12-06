<template lang="pug">

#all(style="width:100%; height:95dvh; box-sizing: border-box; padding:0; margin:0; display:flex;")
  List(
    style="display:inline-block;" 
    :simpleMode="simpleMode"
    @show-map="handleShowMap"
    @hide-map="handleHideMap"
  )
  Series(v-if="!showMap" style="display:inline-block;")
  Map(
    v-if="showMap"
    :mapShow="mapShow"
    :hideMapBottom="hideMapBottom"
    :seriesMapSeasons="seriesMapSeasons"
    :seriesMapEpis="seriesMapEpis"
    :seriesMap="seriesMap"
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
      seriesMap: {}
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
      this.showMap = false;
      this.mapShow = null;
    },
    handleMapAction(action, show) {
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
