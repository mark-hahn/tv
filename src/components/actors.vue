<template lang="pug">
#actors(@click.stop :style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }")

  #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'15px', marginLeft:'-10px', marginRight:'-10px', marginTop:'-10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'15px', display:'flex', flexDirection:'column', gap:'8px' }")
    div(style="display:flex; justify-content:space-between; align-items:center;")
      div(style="margin-left:20px; margin-right:10px; flex:1; min-width:0; white-space:normal; overflow-wrap:anywhere; word-break:break-word;") {{ showName }}
      div(style="display:flex; gap:12px; align-items:center; margin-right:20px; flex-shrink:0;")
        button(@click.stop="$emit('series')" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px;") Series
        button(@click.stop="handleMapButton" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px; min-width:60px;") Map

    div(v-if="!simpleMode" style="display:grid; grid-template-columns:auto 1fr auto; align-items:center; margin-right:20px; margin-left:20px; font-weight:normal;")
      div(style="font-size:18px; font-weight:bold; justify-self:start;") {{ modeLabel }}
      div(style="display:flex; gap:12px; align-items:center; justify-self:center;")
        button(@click.stop="handleLeftArrow" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px; margin-right:5px;") ◄
        button(@click.stop="handleRightArrow" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px;") ►
      button(@click.stop="$emit('torrents')" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px; justify-self:end;") Torrents

    div(v-else style="display:flex; justify-content:space-between; align-items:center; margin-right:20px; margin-left:20px; font-weight:normal;")
      div(style="font-size:18px; font-weight:bold;") {{ modeLabel }}
      div(style="display:flex; gap:12px; align-items:center;")
        button(@click.stop="handleLeftArrow" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px; margin-right:5px;") ◄
        button(@click.stop="handleRightArrow" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px;") ►
    div(style="display:flex; align-items:center; gap:12px; justify-content:flex-end; margin-right:20px; font-weight:normal;")
      button(@click.stop="handleRegularClick" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px; min-width:80px;") Regulars
      button(@click.stop="handleGuestClick" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px; min-width:80px;") Guests
      label(style="font-size:14px; margin-left:10px;") Season
      input(v-model="seasonNum" @click.stop @keydown.enter.prevent="handleGuestClick" type="text" maxlength="2" style="width:30px; padding:2px 4px; font-size:14px; text-align:center; border:1px solid #ccc; border-radius:3px;")
      label(style="font-size:14px; margin-left:5px;") Episode
      input(v-model="episodeNum" @click.stop @keydown.enter.prevent="handleGuestClick" type="text" maxlength="2" style="width:30px; padding:2px 4px; font-size:14px; text-align:center; border:1px solid #ccc; border-radius:3px;")
  
  #error-message(v-if="errorMessage"
                 style="text-align:center; color:red; margin-top:50px; font-size:16px;")
    div {{ errorMessage }}
  
  #actors-grid(v-else style="display:grid; grid-template-columns:repeat(auto-fill, minmax(110px, 1fr)); gap:10px; padding:5px;")
    Actor(
      v-for="actor in actors"
      :key="actor.url"
      :actor="actor"
    )

  #no-actors(v-if="!errorMessage && !isGuestMode && showName && actors.length === 0"
             style="text-align:center; color:#999; margin-top:50px; font-size:16px;")
    div(style="margin-bottom:20px;") No cast information available
    div(style="font-size:14px; color:#666;") 
      | Server needs to fetch extended TVDB data with character information

</template>

<script>
import Actor from './actor.vue';
import evtBus from '../evtBus.js';
import * as emby from '../emby.js';
import * as util from '../util.js';
import * as srvr from '../srvr.js';

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
      isGuestMode: false,
      showingEpisodeActors: false // Track if we're showing episode actors
    };
  },

  computed: {
    modeLabel() {
      return this.isGuestMode ? 'Guest Stars' : 'Series Regulars';
    }
  },

  methods: {
    resetPane() {
      this.actors = [];
      this.seriesActors = [];
      this.showName = '';
      this.currentShow = null;
      this.seasonNum = '';
      this.episodeNum = '';
      this.errorMessage = '';
      this.isGuestMode = false;
      this.showingEpisodeActors = false;
    },
    handleMapButton() {
      const show = this.currentShow;
      if (show) {
        evtBus.emit('mapAction', { action: 'open', show });
      }
    },

    async handleGuestClick() {
      this.errorMessage = '';
      this.isGuestMode = true;
      
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
      
      // Call getTmdb to get guest actor list
      try {
        const params = {
          showName: this.showName,
          year: null,
          season: season,
          episode: episode
        };
        
        const guestActors = await srvr.getTmdb(params);
        
        if (!guestActors || guestActors.length === 0) {
          this.errorMessage = 'No guest stars found';
          this.actors = [];
          this.showingEpisodeActors = true;
          return;
        }
        
        // Replace actors list with guest stars from TMDB
        this.actors = guestActors
          .map(actor => {
            // Build full image URL from profile_path
            const imageUrl = actor.profile_path 
              ? `https://image.tmdb.org/t/p/w185${actor.profile_path}`
              : null;
            
            return {
              name: actor.character, // Character name
              personName: actor.name, // Actor name
              image: imageUrl,
              personImgURL: imageUrl,
              url: null, // No URL from TMDB data
              sort: actor.order,
              isFeatured: false,
              hasImage: !!imageUrl
            };
          })
          .sort((a, b) => {
            // Major sort: has image (true before false)
            if (a.hasImage !== b.hasImage) {
              return b.hasImage - a.hasImage; // true (1) before false (0)
            }
            // Minor sort: by order
            return a.sort - b.sort;
          });
        
        // Mark that we're showing episode actors
        this.showingEpisodeActors = true;
      } catch (error) {
        this.errorMessage = error.message || 'Episode not found';
      }
    },

    handleRegularClick() {
      this.errorMessage = '';
      this.isGuestMode = false;
      this.showingEpisodeActors = false;
      // Restore series actors
      this.actors = [...this.seriesActors];
    },

    async handleLeftArrow() {
      if (!this.currentShow) return;

      // Arrow navigation always moves through episodes; if in regular mode, switch to guest mode.
      if (!this.isGuestMode) this.isGuestMode = true;

      if (!this.seasonNum || !this.episodeNum) {
        await this.prefillEpisodeInputs();
      }
      if (!this.seasonNum || !this.episodeNum) return;

      try {
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
          await this.handleGuestClick();
        }
      } catch (error) {
        // Silently ignore errors
      }
    },

    async handleRightArrow() {
      if (!this.currentShow) return;

      // Arrow navigation always moves through episodes; if in regular mode, switch to guest mode.
      if (!this.isGuestMode) this.isGuestMode = true;

      if (!this.seasonNum || !this.episodeNum) {
        await this.prefillEpisodeInputs();
      }
      if (!this.seasonNum || !this.episodeNum) return;

      try {
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
          await this.handleGuestClick();
        }
      } catch (error) {
        // Silently ignore errors
      }
    },

    async prefillEpisodeInputs() {
      // Strategy 1: Check if currently playing show matches selected show
      try {
        const devices = await srvr.getDevices();
        
        // Find a device playing the current show (prioritize chromecast)
        let playingDevice = devices.find(d => d.deviceName === 'chromecast' && d.showName === this.showName);
        if (!playingDevice) {
          playingDevice = devices.find(d => d.showName === this.showName);
        }
        
        if (playingDevice && playingDevice.seasonNumber && playingDevice.episodeNumber) {
          this.seasonNum = String(playingDevice.seasonNumber);
          this.episodeNum = String(playingDevice.episodeNumber);
          return;
        }
      } catch (error) {
        // Continue to strategy 2
      }
      
      // Strategy 2: Use seriesMap to find first unwatched episode
      try {
        if (!this.currentShow) {
          return;
        }
        
        const seriesMapIn = await emby.getSeriesMap(this.currentShow);
        
        if (!seriesMapIn || seriesMapIn.length === 0) {
          return; // Leave empty (strategy 3)
        }
        
        const seriesMap = util.buildSeriesMap(seriesMapIn);
        
        if (!seriesMap) {
          return; // Leave empty (strategy 3)
        }
        
        // Find first episode that is available and not played
        const seasons = Object.keys(seriesMap).sort((a, b) => Number(a) - Number(b));
        
        for (const seasonNum of seasons) {
          const episodes = seriesMap[seasonNum];
          const episodeNums = Object.keys(episodes).sort((a, b) => Number(a) - Number(b));
          
          for (const episodeNum of episodeNums) {
            const epiObj = episodes[episodeNum];
            
            if (epiObj.avail && !epiObj.played) {
              this.seasonNum = seasonNum;
              this.episodeNum = episodeNum;
              return;
            }
          }
        }
        
        // If no unwatched episode found, leave empty (strategy 3)
      } catch (error) {
        // Leave empty (strategy 3)
      }
    },

    updateActors(data) {
      if (!data) {
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
      this.isGuestMode = false;
      this.showingEpisodeActors = false;
    }
  },

  mounted() {
    evtBus.on('showActors', (data) => {
      this.updateActors(data);
      
      // Reset to series actors view
      this.isGuestMode = false;
      this.showingEpisodeActors = false;
      this.errorMessage = '';
      
      // Pre-fill episode inputs after actors are loaded
      void this.$nextTick(async () => {
        await this.prefillEpisodeInputs();
      });
    });
    
    evtBus.on('fillAndSelectEpisode', (episodeInfo) => {
      // Fill the input boxes
      this.seasonNum = String(episodeInfo.seasonNumber);
      this.episodeNum = String(episodeInfo.episodeNumber);
      // Do not auto-load guest actors; guest mode only when Guest is clicked.
    });

    evtBus.on('resetActorsPane', this.resetPane);
  },

  unmounted() {
    evtBus.off('resetActorsPane', this.resetPane);
  }
}
</script>
