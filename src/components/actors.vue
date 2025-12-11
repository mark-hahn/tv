<template lang="pug">
#actors(@click="handleActorsClick" :style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }")

  #header(:style="{ fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'15px', display:'flex', flexDirection:'column', gap:'8px' }")
    div(style="display:flex; justify-content:space-between; align-items:center;")
      div(style="margin-left:20px;") {{ showName }}
      button(@click.stop="$emit('close')" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px;") Close
    div(style="display:flex; align-items:center; gap:8px; justify-content:flex-end; font-weight:normal;")
      label(style="font-size:14px;") Season
      input(v-model="seasonNum" @click.stop type="text" maxlength="2" style="width:30px; padding:2px 4px; font-size:14px; text-align:center; border:1px solid #ccc; border-radius:3px;")
      label(style="font-size:14px; margin-left:5px;") Episode
      input(v-model="episodeNum" @click.stop type="text" maxlength="2" style="width:30px; padding:2px 4px; font-size:14px; text-align:center; border:1px solid #ccc; border-radius:3px;")
      button(@click.stop style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px;") Select
      button(@click.stop style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px;") Clear
  
  #actors-grid(style="display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr)); gap:10px; padding:5px;")
    Actor(
      v-for="actor in actors"
      :key="actor.url"
      :actor="actor"
    )

  #no-actors(v-if="!actors || actors.length === 0"
             style="text-align:center; color:#999; margin-top:50px; font-size:16px;")
    div(style="margin-bottom:20px;") No cast information available
    div(style="font-size:14px; color:#666;") 
      | Server needs to fetch extended TVDB data with character information

</template>

<script>
import Actor from './actor.vue';
import evtBus from '../evtBus.js';

export default {
  name: "Actors",
  
  components: { Actor },

  props: {
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
      actors: [],
      showName: '',
      seasonNum: '',
      episodeNum: ''
    };
  },

  methods: {
    handleActorsClick() {
      // Click anywhere in actors pane to go back to series pane
      this.$emit('close');
    },

    updateActors(tvdbData) {
      if (!tvdbData) {
        this.actors = [];
        this.showName = '';
        return;
      }

      // Handle both formats: direct data or wrapped in response.data
      const data = tvdbData.response?.data || tvdbData;
      this.showName = data?.name || '';
      const characters = data?.characters;
      
      if (!characters || !Array.isArray(characters)) {
        this.actors = [];
        return;
      }

      // Extract relevant properties from simplified character data
      this.actors = characters
        .sort((a, b) => (a.sortOrder || 999) - (b.sortOrder || 999))
        .map(char => ({
          name: char.character,
          personName: char.actor,
          image: char.image,
          personImgURL: char.image, // Use same image for both
          url: char.tvdbUrl,
          sort: char.sortOrder,
          isFeatured: char.isFeatured
        }));
    }
  },

  mounted() {
    evtBus.on('showActors', (tvdbData) => {
      this.updateActors(tvdbData);
    });
    
    // Update actors when show changes
    evtBus.on('tvdbDataReady', (tvdbData) => {
      this.updateActors(tvdbData);
    });
  }
}
</script>
