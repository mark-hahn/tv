<template lang="pug">
#actors(@click="handleActorsClick" :style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }")

  #header(:style="{ fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'15px', display:'flex', flexDirection:'column', gap:'18px' }")
    div(style="display:flex; justify-content:space-between; align-items:center;")
      div(style="margin-left:20px;") {{ showName }}
      div(style="display:flex; gap:15px; align-items:center;")
        button(v-if="seasonNum && episodeNum" @click.stop="handleLeftArrow" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px;") ◄
        button(v-if="seasonNum && episodeNum" @click.stop="handleRightArrow" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px; margin-right:10px;") ►
        button(@click.stop="$emit('close')" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px;") Close
    div(style="display:flex; align-items:center; gap:8px; justify-content:flex-end; font-weight:normal;")
      label(style="font-size:14px; margin-left:auto;") Season
      input(v-model="seasonNum" @click.stop @keyup.enter="handleSelectClick" type="text" maxlength="2" style="width:30px; padding:2px 4px; font-size:14px; text-align:center; border:1px solid #ccc; border-radius:3px;")
      label(style="font-size:14px; margin-left:5px;") Episode
      input(v-model="episodeNum" @click.stop @keyup.enter="handleSelectClick" type="text" maxlength="2" style="width:30px; padding:2px 4px; font-size:14px; text-align:center; border:1px solid #ccc; border-radius:3px;")
      button(@click.stop="handleSelectClick" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px;") Select
      button(@click.stop="handleClearClick" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px;") Clear
  
  #error-message(v-if="errorMessage"
                 style="text-align:center; color:red; margin-top:50px; font-size:16px;")
    div {{ errorMessage }}
  
  #actors-grid(v-else style="display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr)); gap:10px; padding:5px;")
    Actor(
      v-for="actor in actors"
      :key="actor.url"
      :actor="actor"
    )

  #no-actors(v-if="!errorMessage && !showingEpisodeActors && showName && actors.length === 0"
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
      seriesActors: [], // Cache of original series actors
      showName: '',
      currentShow: null, // Store full show object for getSeriesMap
      seasonNum: '',
      episodeNum: '',
      errorMessage: '',
      showingEpisodeActors: false // Track if we're showing episode actors
    };
  },

  methods: {
    handleActorsClick() {
      // Click anywhere in actors pane to go back to series pane
      this.$emit('close');
    },

    async handleSelectClick() {
      this.errorMessage = '';
      
      // If input boxes are empty, auto-fill from map first
      if (!this.seasonNum || !this.episodeNum) {
        await this.prefillEpisodeInputs();
        
        // Check if prefill worked
        if (!this.seasonNum || !this.episodeNum) {
          this.errorMessage = 'No unwatched episodes found';
          return;
        }
      }
      
      const season = parseInt(this.seasonNum);
      const episode = parseInt(this.episodeNum);
      
      if (isNaN(season) || isNaN(episode)) {
        this.errorMessage = 'Invalid season or episode';
        return;
      }
      
      // Import and call getEpisode
      try {
        const tvdb = await import('../tvdb.js');
        const episodeData = await tvdb.getEpisode(this.showName, season, episode);
        
        if (!episodeData) {
          this.errorMessage = 'Episode not found';
          return;
        }
        
        // Log to debug image paths
        console.log('Episode data:', episodeData);
        
        // Get Guest Star characters
        const characters = episodeData.characters || [];
        console.log('All characters:', characters);
        const guestStars = characters.filter(char => char.peopleType === 'Guest Star');
        console.log('Guest stars:', guestStars);
        
        if (guestStars.length === 0) {
          this.errorMessage = 'No guest stars found';
          this.actors = [];
          this.showingEpisodeActors = true;
          return;
        }
        
        // Replace actors list with guest stars
        this.actors = guestStars
          .map(char => {
            // Build full image URL from relative path
            const imageUrl = char.personImgURL 
              ? `https://artworks.thetvdb.com${char.personImgURL}`
              : null;
            
            return {
              name: null, // Don't show character name for episode actors
              personName: char.personName,
              image: imageUrl,
              personImgURL: imageUrl,
              url: char.url,
              sort: char.sortOrder,
              isFeatured: char.isFeatured,
              hasImage: !!imageUrl
            };
          })
          .sort((a, b) => {
            // Major sort: has image (true before false)
            if (a.hasImage !== b.hasImage) {
              return b.hasImage - a.hasImage; // true (1) before false (0)
            }
            // Minor sort: isFeatured (true before false)
            if (a.isFeatured !== b.isFeatured) {
              return b.isFeatured - a.isFeatured; // true (1) before false (0)
            }
            return 0;
          });
        
        // Mark that we're showing episode actors
        this.showingEpisodeActors = true;
      } catch (error) {
        console.error('Error fetching episode:', error);
        this.errorMessage = 'Episode not found';
      }
    },

    handleClearClick() {
      this.seasonNum = '';
      this.episodeNum = '';
      this.errorMessage = '';
      this.showingEpisodeActors = false;
      // Restore series actors
      this.actors = [...this.seriesActors];
    },

    async handleLeftArrow() {
      if (!this.currentShow || !this.seasonNum || !this.episodeNum) {
        return;
      }

      try {
        const emby = await import('../emby.js');
        const util = await import('../util.js');
        
        const seriesMapIn = await emby.getSeriesMap(this.currentShow);
        if (!seriesMapIn || seriesMapIn.length === 0) {
          return;
        }
        
        const seriesMap = util.buildSeriesMap(seriesMapIn);
        if (!seriesMap) {
          return;
        }
        
        // Build flat list of all episodes in order
        const allEpisodes = [];
        const seasons = Object.keys(seriesMap).sort((a, b) => Number(a) - Number(b));
        
        for (const seasonNum of seasons) {
          const episodes = seriesMap[seasonNum];
          const episodeNums = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
          
          for (const episodeNum of episodeNums) {
            allEpisodes.push({ season: seasonNum, episode: episodeNum });
          }
        }
        
        // Find current episode index
        const currentIndex = allEpisodes.findIndex(
          ep => ep.season === this.seasonNum && ep.episode === this.episodeNum
        );
        
        if (currentIndex > 0) {
          // Go to previous episode
          const prevEpisode = allEpisodes[currentIndex - 1];
          this.seasonNum = prevEpisode.season;
          this.episodeNum = prevEpisode.episode;
          await this.handleSelectClick();
        }
      } catch (error) {
        console.error('handleLeftArrow error:', error);
      }
    },

    async handleRightArrow() {
      if (!this.currentShow || !this.seasonNum || !this.episodeNum) {
        return;
      }

      try {
        const emby = await import('../emby.js');
        const util = await import('../util.js');
        
        const seriesMapIn = await emby.getSeriesMap(this.currentShow);
        if (!seriesMapIn || seriesMapIn.length === 0) {
          return;
        }
        
        const seriesMap = util.buildSeriesMap(seriesMapIn);
        if (!seriesMap) {
          return;
        }
        
        // Build flat list of all episodes in order
        const allEpisodes = [];
        const seasons = Object.keys(seriesMap).sort((a, b) => Number(a) - Number(b));
        
        for (const seasonNum of seasons) {
          const episodes = seriesMap[seasonNum];
          const episodeNums = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
          
          for (const episodeNum of episodeNums) {
            allEpisodes.push({ season: seasonNum, episode: episodeNum });
          }
        }
        
        // Find current episode index
        const currentIndex = allEpisodes.findIndex(
          ep => ep.season === this.seasonNum && ep.episode === this.episodeNum
        );
        
        if (currentIndex >= 0 && currentIndex < allEpisodes.length - 1) {
          // Go to next episode
          const nextEpisode = allEpisodes[currentIndex + 1];
          this.seasonNum = nextEpisode.season;
          this.episodeNum = nextEpisode.episode;
          await this.handleSelectClick();
        }
      } catch (error) {
        console.error('handleRightArrow error:', error);
      }
    },

    async prefillEpisodeInputs() {
      console.log('prefillEpisodeInputs: Starting for show:', this.showName);
      
      // Strategy 1: Check if currently playing show matches selected show
      // TODO: Need to implement checking currently playing show from hdrtop.vue
      // For now, skip to strategy 2
      
      // Strategy 2: Use seriesMap to find first unwatched episode
      try {
        if (!this.currentShow) {
          console.log('prefillEpisodeInputs: No currentShow object available');
          return;
        }
        
        const emby = await import('../emby.js');
        const util = await import('../util.js');
        
        console.log('prefillEpisodeInputs: Fetching seriesMap for show:', this.currentShow.Name);
        const seriesMapIn = await emby.getSeriesMap(this.currentShow);
        console.log('prefillEpisodeInputs: seriesMapIn:', seriesMapIn);
        
        if (!seriesMapIn || seriesMapIn.length === 0) {
          console.log('prefillEpisodeInputs: No seriesMapIn data, leaving empty');
          return; // Leave empty (strategy 3)
        }
        
        const seriesMap = util.buildSeriesMap(seriesMapIn);
        console.log('prefillEpisodeInputs: seriesMap:', seriesMap);
        
        if (!seriesMap) {
          console.log('prefillEpisodeInputs: buildSeriesMap returned null, leaving empty');
          return; // Leave empty (strategy 3)
        }
        
        // Find first episode that is available and not played
        const seasons = Object.keys(seriesMap).sort((a, b) => Number(a) - Number(b));
        console.log('prefillEpisodeInputs: Seasons:', seasons);
        
        for (const seasonNum of seasons) {
          const episodes = seriesMap[seasonNum];
          const episodeNums = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
          console.log(`prefillEpisodeInputs: Season ${seasonNum}, episodes:`, episodeNums);
          
          for (const episodeNum of episodeNums) {
            const epiObj = episodes[episodeNum];
            console.log(`prefillEpisodeInputs: S${seasonNum}E${episodeNum}:`, { avail: epiObj.avail, played: epiObj.played });
            
            if (epiObj.avail && !epiObj.played) {
              console.log(`prefillEpisodeInputs: Found unwatched episode S${seasonNum}E${episodeNum}`);
              this.seasonNum = seasonNum;
              this.episodeNum = episodeNum;
              return;
            }
          }
        }
        
        console.log('prefillEpisodeInputs: No unwatched episode found, leaving empty');
        // If no unwatched episode found, leave empty (strategy 3)
      } catch (error) {
        console.error('prefillEpisodeInputs: Error:', error);
        // Leave empty (strategy 3)
      }
    },

    updateActors(data) {
      console.log('actors.vue: updateActors called with:', data);
      
      if (!data) {
        console.log('actors.vue: updateActors - no data');
        this.actors = [];
        this.showName = '';
        this.currentShow = null;
        return;
      }

      // Extract show and tvdbData from the data object
      const tvdbData = data.tvdbData || data;
      this.currentShow = data.show || null;
      
      // Handle both formats: direct data or wrapped in response.data
      const actualData = tvdbData.response?.data || tvdbData;
      this.showName = actualData?.name || '';
      console.log('actors.vue: updateActors - showName set to:', this.showName, 'currentShow:', this.currentShow);
      
      const characters = actualData?.characters;
      
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
      
      // Cache series actors for restore
      this.seriesActors = [...this.actors];
      this.showingEpisodeActors = false;
    }
  },

  mounted() {
    console.log('actors.vue: mounted');
    
    evtBus.on('showActors', (tvdbData) => {
      console.log('actors.vue: showActors event received, tvdbData:', tvdbData);
      this.updateActors(tvdbData);
      // Pre-fill episode inputs after actors are loaded
      this.$nextTick(() => {
        console.log('actors.vue: $nextTick - calling prefillEpisodeInputs');
        this.prefillEpisodeInputs();
      });
    });
  }
}
</script>
