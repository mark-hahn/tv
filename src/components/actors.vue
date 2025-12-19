<template lang="pug">
#actors(@click.stop :style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }")

  #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'15px', marginLeft:'-10px', marginRight:'-10px', marginTop:'-10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', display:'flex', flexDirection:'column', gap:'8px' }")
    div(style="width:100%; display:flex; flex-direction:column; gap:8px;")
      //- Top row: show name (fills), mode label, arrows.
      div(style="width:100%; display:flex; align-items:center; justify-content:space-between;")
        div(style="margin-left:20px; margin-right:10px; flex:1 1 auto; min-width:0; white-space:normal; overflow-wrap:anywhere; word-break:break-word;") {{ showName }}
        div(style="flex:0 0 auto; width:75px; text-align:right; font-size:18px; font-weight:bold; white-space:nowrap;") {{ modeLabel }}
        div(style="margin-left:20px; margin-right:15px; flex:0 0 auto; display:flex; align-items:center; gap:12px; font-weight:normal;")
          button(@click.stop="handleLeftArrow" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px; margin-right:5px;") ◄
          button(@click.stop="handleRightArrow" style="font-size:13px; cursor:pointer; border-radius:5px; padding:2px 8px;") ►

      //- Bottom row: buttons and inputs only.
      div(style="width:100%; display:flex; align-items:center; justify-content:flex-start; gap:12px; margin-right:20px; margin-left:20px; font-weight:normal;")
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
import * as tvdb from '../tvdb.js';
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
      showingEpisodeActors: false, // Track if we're showing episode actors
      _seriesMapInForArrows: null,
      _seriesMapInForArrowsShowKey: null,
      _seriesMapInForArrowsPromise: null,
      _onShowActors: null,
      _onFillAndSelectEpisode: null,
      _onResetActorsPane: null
    };
  },

  computed: {
    modeLabel() {
      return this.isGuestMode ? 'Guests' : 'Regulars';
    }
  },

  methods: {
    normPosIntStr(v) {
      const n = parseInt(String(v ?? '').trim(), 10);
      if (!Number.isFinite(n) || n <= 0) return '';
      return String(n);
    },

    ensureEpisodeInputs() {
      if (!String(this.seasonNum || '').trim()) this.seasonNum = '1';
      if (!String(this.episodeNum || '').trim()) this.episodeNum = '1';
    },

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

      this._seriesMapInForArrows = null;
      this._seriesMapInForArrowsShowKey = null;
      this._seriesMapInForArrowsPromise = null;
    },

    prefetchSeriesMapForArrows() {
      const show = this.currentShow;
      if (!show) return;
      const showKey = show?.Id || show?.Name || null;
      if (!showKey) return;

      // Only prefetch for noemby shows to avoid extra load.
      if (!String(show?.Id || '').startsWith('noemby-')) return;

      if (this._seriesMapInForArrowsShowKey === showKey && (this._seriesMapInForArrows || this._seriesMapInForArrowsPromise)) {
        return;
      }

      this._seriesMapInForArrowsShowKey = showKey;
      this._seriesMapInForArrows = null;
      this._seriesMapInForArrowsPromise = (async () => {
        try {
          const in2 = await tvdb.getSeriesMap(show);
          if (this._seriesMapInForArrowsShowKey === showKey) {
            this._seriesMapInForArrows = Array.isArray(in2) ? in2 : [];
          }
        } catch {
          if (this._seriesMapInForArrowsShowKey === showKey) {
            this._seriesMapInForArrows = [];
          }
        } finally {
          if (this._seriesMapInForArrowsShowKey === showKey) {
            this._seriesMapInForArrowsPromise = null;
          }
        }
      })();
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

    async getSeriesMapInForArrows(show) {
      if (!show) return [];
      const showKey = show?.Id || show?.Name || null;

      // Use cached/prefetched TVDB map for noemby.
      if (String(show?.Id || '').startsWith('noemby-') && showKey && this._seriesMapInForArrowsShowKey === showKey) {
        if (Array.isArray(this._seriesMapInForArrows) && this._seriesMapInForArrows.length) {
          return this._seriesMapInForArrows;
        }
        if (this._seriesMapInForArrowsPromise) {
          await this._seriesMapInForArrowsPromise;
          if (Array.isArray(this._seriesMapInForArrows) && this._seriesMapInForArrows.length) {
            return this._seriesMapInForArrows;
          }
        }
      }
      // Prefer Emby when available, but for noemby (and other failures),
      // fall back to TVDB (same strategy as map pane).
      try {
        const in1 = await emby.getSeriesMap(show);
        if (in1 && in1.length) return in1;
      } catch {
        // ignore
      }
      try {
        const in2 = await tvdb.getSeriesMap(show);
        if (in2 && in2.length) return in2;
      } catch {
        // ignore
      }
      return [];
    },

    async handleLeftArrow() {
      if (!this.currentShow) return;

      // Arrow navigation always moves through episodes; if in regular mode, switch to guest mode.
      if (!this.isGuestMode) this.isGuestMode = true;

      if (!this.seasonNum || !this.episodeNum) {
        await this.prefillEpisodeInputs();
      }
      this.ensureEpisodeInputs();
      this.seasonNum = this.normPosIntStr(this.seasonNum);
      this.episodeNum = this.normPosIntStr(this.episodeNum);
      if (!this.seasonNum || !this.episodeNum) return;

      try {
        const seriesMapIn = await this.getSeriesMapInForArrows(this.currentShow);
        if (!seriesMapIn || seriesMapIn.length === 0) {
          // Last-resort fallback: decrement episode.
          const curS = Number(this.seasonNum);
          const curE = Number(this.episodeNum);
          if (!Number.isFinite(curS) || !Number.isFinite(curE)) return;
          if (curS <= 1 && curE <= 1) return;
          if (curE > 1) this.episodeNum = String(curE - 1);
          else {
            this.seasonNum = String(Math.max(1, curS - 1));
            this.episodeNum = '1';
          }
          await this.handleGuestClick();
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
        const curS = Number(this.seasonNum);
        const curE = Number(this.episodeNum);
        const currentIndex = allEpisodes.findIndex(
          (ep) => Number(ep.season) === curS && Number(ep.episode) === curE
        );
        
        if (currentIndex > 0) {
          // Go to previous episode
          const prevEpisode = allEpisodes[currentIndex - 1];
          this.seasonNum = this.normPosIntStr(prevEpisode.season);
          this.episodeNum = this.normPosIntStr(prevEpisode.episode);
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
      this.ensureEpisodeInputs();
      this.seasonNum = this.normPosIntStr(this.seasonNum);
      this.episodeNum = this.normPosIntStr(this.episodeNum);
      if (!this.seasonNum || !this.episodeNum) return;

      try {
        const seriesMapIn = await this.getSeriesMapInForArrows(this.currentShow);
        if (!seriesMapIn || seriesMapIn.length === 0) {
          // Last-resort fallback: increment episode.
          const curS = Number(this.seasonNum);
          const curE = Number(this.episodeNum);
          if (!Number.isFinite(curS) || !Number.isFinite(curE)) return;
          this.seasonNum = String(curS);
          this.episodeNum = String(Math.min(99, curE + 1));
          await this.handleGuestClick();
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
        const curS = Number(this.seasonNum);
        const curE = Number(this.episodeNum);
        const currentIndex = allEpisodes.findIndex(
          (ep) => Number(ep.season) === curS && Number(ep.episode) === curE
        );
        
        if (currentIndex >= 0 && currentIndex < allEpisodes.length - 1) {
          // Go to next episode
          const nextEpisode = allEpisodes[currentIndex + 1];
          this.seasonNum = this.normPosIntStr(nextEpisode.season);
          this.episodeNum = this.normPosIntStr(nextEpisode.episode);
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
        // If no "first available + not played" episode exists, default to S1E1.
        if (!String(this.seasonNum || '').trim() && !String(this.episodeNum || '').trim()) {
          this.seasonNum = '1';
          this.episodeNum = '1';
        }
      } catch (error) {
        // Fall back to S1E1 if we couldn't compute a better default.
        if (this.currentShow && !String(this.seasonNum || '').trim() && !String(this.episodeNum || '').trim()) {
          this.seasonNum = '1';
          this.episodeNum = '1';
        }
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
    this._onShowActors = (data) => {
      this.updateActors(data);

      // For noemby shows, start loading the series map immediately so
      // arrow navigation doesn't wait on TVDB later.
      this.prefetchSeriesMapForArrows();

      // Reset to series actors view
      this.isGuestMode = false;
      this.showingEpisodeActors = false;
      this.errorMessage = '';

      // Pre-fill episode inputs after actors are loaded
      void this.$nextTick(async () => {
        await this.prefillEpisodeInputs();

        // Guard: if inputs are still empty after pane load, force S1/E1.
        this.ensureEpisodeInputs();
      });
    };
    evtBus.on('showActors', this._onShowActors);

    this._onFillAndSelectEpisode = (episodeInfo) => {
      // Fill the input boxes
      this.seasonNum = String(episodeInfo.seasonNumber);
      this.episodeNum = String(episodeInfo.episodeNumber);
      // Do not auto-load guest actors; guest mode only when Guest is clicked.
    };
    evtBus.on('fillAndSelectEpisode', this._onFillAndSelectEpisode);

    this._onResetActorsPane = this.resetPane;
    evtBus.on('resetActorsPane', this._onResetActorsPane);
  },

  unmounted() {
    if (this._onShowActors) evtBus.off('showActors', this._onShowActors);
    if (this._onFillAndSelectEpisode) evtBus.off('fillAndSelectEpisode', this._onFillAndSelectEpisode);
    if (this._onResetActorsPane) evtBus.off('resetActorsPane', this._onResetActorsPane);
  }
}
</script>
