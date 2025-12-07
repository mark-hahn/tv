<template lang="pug">
#map(@click="handleMapClick" style="height:100%; padding:5px; margin:0; display:flex; flex-direction:column; background-color:#ffe; overflow-y:auto; flex:1;")

  div(style="margin:0 5px; display:flex; justify-content:flex-start; align-items:center;")
    div(v-if="!simpleMode && !mapShow?.Id?.startsWith('noemby-')" style="display:flex; gap:5px; margin-right:20px;")
      button(@click.stop="$emit('prune', mapShow)"
              style="margin:5px;")            Prune
      button(@click.stop="$emit('set-date', mapShow)"
              style="margin:5px;")            Set Date
    div(style="font-size:20px; margin:0 20px 0 0; font-weight:bold;")
      | {{mapShow?.Name}}

  div(v-if="!hideMapBottom")
    div(v-if="mapShow?.Id?.startsWith('noemby-')"
        style="font-weight:bold; color:red; font-size:18px; text-align:center; margin:20px;")
      | Not In Emby
    
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
        td(@click="handleSeasonClick($event, season)"
           :style="{ fontWeight:'bold', width:'10px', textAlign:'center', cursor: simpleMode ? 'default' : 'pointer' }")
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

  data() {
    return {
      seasonStates: {} // Track original state for each season
    };
  },

  emits: ['prune', 'set-date', 'close', 'episode-click'],

  methods: {
    handleMapClick(event) {
      event.stopPropagation();
      this.$emit('close');
    },
    handleEpisodeClick(event, mapShow, season, episode) {
      if (this.simpleMode) {
        // Don't stop propagation - let it bubble up to handleMapClick
        return;
      }
      event.stopPropagation(); // Prevent map click handler from closing the map
      this.$emit('episode-click', event, mapShow, season, episode);
    },
    handleSeasonClick(event, season) {
      if (this.simpleMode) return;
      event.stopPropagation();
      
      const seasonEpisodes = this.seriesMap[season];
      if (!seasonEpisodes) return;

      // Initialize season state tracking if needed (save original state only once)
      if (!this.seasonStates[season]) {
        const episodeStates = {};
        Object.keys(seasonEpisodes).forEach(episodeNum => {
          const episode = seasonEpisodes[episodeNum];
          if (episode && !episode.unaired && !episode.deleted) {
            episodeStates[episodeNum] = episode.played || false;
          }
        });
        
        this.seasonStates[season] = {
          original: { ...episodeStates },
          currentState: 0 // 0=original, 1=all on, 2=all off
        };
      }

      const state = this.seasonStates[season];

      // Determine next state based on current state
      let targetState;
      if (state.currentState === 0) {
        targetState = 1; // First click: all watched
      } else if (state.currentState === 1) {
        targetState = 2; // Second click: all unwatched
      } else {
        targetState = 0; // Third click: restore original
      }

      state.currentState = targetState;

      // Apply the target state
      Object.keys(state.original).forEach(episodeNum => {
        let setWatched;
        if (targetState === 0) {
          setWatched = state.original[episodeNum];
        } else if (targetState === 1) {
          setWatched = true;
        } else {
          setWatched = false;
        }
        this.$emit('episode-click', event, this.mapShow, season, parseInt(episodeNum), setWatched);
      });
    }
  }
};
</script>

<style scoped>
tr:nth-child(even) {
  background-color: #f4f4f4;
}
</style>
