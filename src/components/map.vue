<template lang="pug">
#map(@click="handleMapClick" style="height:100%; padding:5px; margin:0; display:flex; flex-direction:column; background-color:#ffe; overflow-y:auto; flex:1;")

  div(style="margin:0 5px; display:flex; justify-content:flex-start; align-items:center;")
    div(v-if="!simpleMode" style="display:flex; gap:5px; margin-right:20px;")
      button(@click="$emit('prune', mapShow)"
              style="margin:5px;")            Prune
      button(@click="$emit('set-date', mapShow)"
              style="margin:5px;")            Set Date
    div(style="font-size:20px; margin:0 20px 0 0; font-weight:bold;")
      | {{mapShow?.Name}}

  div(v-if="!hideMapBottom")
    div(v-if="mapShow?.WatchGap || mapShow?.FileGap  || mapShow?.WaitStr?.length"
        style="display:flex; justify-content:space-around; color:red; margin: 0 10px; 4px 10px;")

      div(v-if="mapShow?.WatchGap" 
          style="display:inline-block;")
        | {{"Watch Gap"}}

      div(v-if="mapShow?.FileGap"
          style="display:inline-block; margin 3px 10px")
        | {{"Missing File"}}

      div(v-if="mapShow?.Waiting" 
          style="display:inline-block; margin 3px 10px")
        | {{'Waiting ' + mapShow?.WaitStr}}

    table(style="padding:0 5px; font-size:16px" )
     tbody
      tr(style="font-weight:bold;")
        td
        td(v-for="episode in seriesMapEpis" 
          style="text-align:center;"
          key="episode") {{episode}}
      tr(v-for="season in seriesMapSeasons" key="season"
                style="outline:thin solid;")
        td(style="font-weight:bold; width:10px; text-align:center;")
          | {{season}}

        td(v-for="episode in seriesMapEpis" key="series+'.'+episode" 
            @click="handleEpisodeClick($event, mapShow, season, episode)"
            :style="{cursor:'default', padding:'0 4px', textAlign:'center', border:'1px solid #ccc', backgroundColor: (seriesMap[season]?.[episode]?.error) ? 'yellow': (seriesMap[season]?.[episode]?.noFile) ? '#faa' : 'white'}")
          span(v-if="seriesMap?.[season]?.[episode]?.played")  w
          span(v-if="seriesMap?.[season]?.[episode]?.avail")   +
          span(v-if="seriesMap?.[season]?.[episode]?.noFile")  -
          span(v-if="seriesMap?.[season]?.[episode]?.unaired") u
          span(v-if="seriesMap?.[season]?.[episode]?.deleted") d
</template>

<script>
export default {
  name: "Map",

  props: {
    mapShow: {
      type: Object,
      default: null
    },
    hideMapBottom: {
      type: Boolean,
      default: true
    },
    seriesMapSeasons: {
      type: Array,
      default: () => []
    },
    seriesMapEpis: {
      type: Array,
      default: () => []
    },
    seriesMap: {
      type: Object,
      default: () => ({})
    },
    simpleMode: {
      type: Boolean,
      default: false
    }
  },

  emits: ['prune', 'set-date', 'close', 'episode-click'],

  methods: {
    handleMapClick(event) {
      if (this.simpleMode) {
        event.stopPropagation();
        this.$emit('close');
      }
    },
    handleEpisodeClick(event, mapShow, season, episode) {
      if (this.simpleMode) {
        // Don't stop propagation - let it bubble up to handleMapClick
        return;
      }
      this.$emit('episode-click', event, mapShow, season, episode);
    }
  }
};
</script>

<style scoped>
tr:nth-child(even) {
  background-color: #f4f4f4;
}
</style>
