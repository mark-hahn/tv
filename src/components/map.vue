<template lang="pug">
#map(@click="handleMapClick" :style="{ height:'100%', padding:'5px', margin:0, display:'flex', flexDirection:'column', backgroundColor:'#ffe', overflowY:'auto', overflowX:'auto', maxWidth:'100%', width: sizing.mapWidth || '450px', boxSizing:'border-box' }")

  div(v-if="!hideMapBottom")
    div(style="margin:0 5px; display:flex; justify-content:space-between; align-items:center;")
      div(:style="{ marginLeft:'20px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px' }")
        | {{mapShow?.Name}}
      div(v-if="!simpleMode && !mapShow?.Id?.startsWith('noemby-')" style="display:flex; gap:5px; flex-shrink:0;")
        button(@click.stop="$emit('prune', mapShow)" style="font-size:15px; cursor:pointer; margin:5px; max-height:24px; border-radius:7px;") Prune
        button(@click.stop="$emit('torrents', mapShow)" style="font-size:15px; cursor:pointer; margin:5px; max-height:24px; border-radius:7px;") Torrents
        button(@click.stop="$emit('series', mapShow)" style="font-size:15px; cursor:pointer; margin:5px; max-height:24px; border-radius:7px;") Series
        button(@click.stop="$emit('actors', mapShow)" style="font-size:15px; cursor:pointer; margin:5px; max-height:24px; border-radius:7px;") Actors

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

    table(style="padding:0 5px; font-size:16px; margin-top:10px;" )
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
    },
    sizing: {
      type: Object,
      default: () => ({})
    }
  },

  data() {
    return {
      seasonStates: {} // Track original state for each season
    };
  },

  emits: ['prune', 'set-date', 'close', 'episode-click', 'show-actors'],

  methods: {
    handleMapClick(event) {
      event.stopPropagation();
      // Instead of closing, emit show-actors to rotate to actors pane
      this.$emit('show-actors');
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
