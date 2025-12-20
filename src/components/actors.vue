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
    normPersonName(v) {
      return String(v || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
    },

    hasAnyImage(actor) {
      return Boolean(actor?.image || actor?.personImgURL);
    },

    mergeTmdbTvdbActors(tmdbIn, tvdbIn) {
      const tmdb = Array.isArray(tmdbIn) ? [...tmdbIn] : [];
      const tvdb = Array.isArray(tvdbIn) ? [...tvdbIn] : [];
      const output = [];

      console.log('tmdb list size:', tmdb.length);
      console.log('tvdb list size:', tvdb.length);

      // Sort both lists by normalized person name so duplicates align
      tmdb.sort((a, b) => {
        const nameA = this.normPersonName(a?.personName || a?.name);
        const nameB = this.normPersonName(b?.personName || b?.name);
        return nameA.localeCompare(nameB);
      });
      tvdb.sort((a, b) => {
        const nameA = this.normPersonName(a?.personName || a?.name);
        const nameB = this.normPersonName(b?.personName || b?.name);
        return nameA.localeCompare(nameB);
      });

      while (true) {
        console.log('----- beginning of loop -----');

        if (tmdb.length === 0) {
          console.log('tmdb list is empty: append entire tvdb list to output and exit loop');
          tvdb.forEach(actor => {
            actor.source = actor.source || 'tvdb';
            actor.actorSort = actor.sort;
          });
          output.push(...tvdb);
          break;
        }
        if (tvdb.length === 0) {
          console.log('tvdb list is empty: append entire tmdb list to output and exit loop');
          tmdb.forEach(actor => {
            actor.source = actor.source || 'tmdb';
          });
          output.push(...tmdb);
          break;
        }

        const t0 = tmdb[0];
        const v0 = tvdb[0];
        const tName = this.normPersonName(t0?.personName || t0?.name);
        const vName = this.normPersonName(v0?.personName || v0?.name);
        
        console.log('compare first tmdb actor to first tvdb actor:', { tmdb: t0?.personName || t0?.name, tvdb: v0?.personName || v0?.name });

        const duplicate = tName && vName && tName === vName;
        if (duplicate) {
          const tHasImage = this.hasAnyImage(t0);
          const vHasImage = this.hasAnyImage(v0);

          if (tHasImage !== vHasImage) {
            if (tHasImage) {
              console.log('duplicate names and tmdb has image and tvdb doesn\'t: remove tvdb from its list and move tmdb to output');
              tvdb.shift();
              const actor = tmdb.shift();
              actor.source = actor.source || 'tmdb';
              output.push(actor);
            } else {
              console.log('duplicate names and tvdb has image and tmdb doesn\'t: remove tmdb from its list and move tvdb to output');
              tmdb.shift();
              const actor = tvdb.shift();
              actor.source = actor.source || 'tvdb';
              actor.actorSort = actor.sort;
              output.push(actor);
            }
          } else {
            // Both have image or both don't have image
            console.log('duplicate names and both have image: remove tmdb from list and move tvdb to output');
            tmdb.shift();
            const actor = tvdb.shift();
            actor.source = actor.source || 'tvdb';
            actor.actorSort = actor.sort;
            output.push(actor);
          }
        } else {
          // Not duplicate - names don't match, move the one that comes first alphabetically
          if (tName < vName) {
            console.log('not duplicate: tmdb name comes first alphabetically, move tmdb to output');
            const actor = tmdb.shift();
            actor.source = actor.source || 'tmdb';
            output.push(actor);
          } else {
            console.log('not duplicate: tvdb name comes first alphabetically, move tvdb to output');
            const actor = tvdb.shift();
            actor.source = actor.source || 'tvdb';
            actor.actorSort = actor.sort;
            output.push(actor);
          }
        }
      }

      console.log('tmdb list should be empty:', tmdb.length);
      console.log('output list size:', output.length);
      
      // Final sort: TVDB actors first (sorted by actorSort ascending), then TMDB actors (sorted by actorEpiCount descending)
      output.sort((a, b) => {
        const aSource = a.source || 'unknown';
        const bSource = b.source || 'unknown';
        
        // TVDB comes before TMDB
        if (aSource === 'tvdb' && bSource === 'tmdb') return -1;
        if (aSource === 'tmdb' && bSource === 'tvdb') return 1;
        
        // Both from same source
        if (aSource === 'tvdb' && bSource === 'tvdb') {
          // Sort TVDB by actorSort ascending
          const aSort = a.actorSort || a.sort || 0;
          const bSort = b.actorSort || b.sort || 0;
          return aSort - bSort;
        }
        
        if (aSource === 'tmdb' && bSource === 'tmdb') {
          // Sort TMDB by actorEpiCount descending
          const aCount = a.actorEpiCount || 0;
          const bCount = b.actorEpiCount || 0;
          return bCount - aCount;
        }
        
        return 0;
      });
      
      console.log('Final sorted output:', output.map(a => ({ name: a.personName, source: a.source, sort: a.actorSort || a.sort, epiCount: a.actorEpiCount })));
      
      return output;
    },

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
      
      // Load guests from TMDB
      let tmdbList = [];
      try {
        const params = {
          showName: this.showName,
          year: null,
          season: season,
          episode: episode
        };
        
        const guestActors = await srvr.getTmdb(params);
        
        if (Array.isArray(guestActors) && guestActors.length) {
          tmdbList = guestActors.map(actor => {
            const imageUrl = actor.profile_path 
              ? `https://image.tmdb.org/t/p/w185${actor.profile_path}`
              : null;
            
            return {
              name: actor.character,
              personName: actor.name,
              image: imageUrl,
              personImgURL: imageUrl,
              url: null,
              sort: actor.order,
              isFeatured: false
            };
          });
        }
      } catch (error) {
        console.log('TMDB guests fetch error:', error.message || String(error));
      }
      
      // Load guests from TVDB
      let tvdbList = [];
      try {
        const tvdbGuests = await tvdb.getEpisodeGuests(this.showName, season, episode);
        if (Array.isArray(tvdbGuests) && tvdbGuests.length) {
          tvdbList = tvdbGuests;
        }
      } catch (error) {
        console.log('TVDB guests fetch error:', error.message || String(error));
      }
      
      // Merge TMDB and TVDB guest lists
      this.actors = this.mergeTmdbTvdbActors(tmdbList, tvdbList);
      
      if (this.actors.length === 0) {
        this.errorMessage = 'No guest stars found';
      }
      
      // Mark that we're showing episode actors
      this.showingEpisodeActors = true;
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

    async updateActors(data) {
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
      this.showName = actualData?.name || this.currentShow?.Name || '';
      
      console.log('Current show object:', this.currentShow);
      console.log('Show ProviderIds:', this.currentShow?.ProviderIds);
      console.log('Show IMDB ID:', this.currentShow?.ProviderIds?.IMDB);
      
      const characters = actualData?.characters;

      // Load actors from TVDB into a tvdb list
      let tvdbList = [];
      if (Array.isArray(characters) && characters.length) {
        tvdbList = characters.map(char => ({
          name: char.character,
          personName: char.actor,
          image: char.image,
          personImgURL: char.image,
          url: char.tvdbUrl,
          sort: char.sortOrder,
          isFeatured: char.isFeatured
        }));
      }

      // Load actors from TMDB into a tmdb list
      let tmdbList = [];
      console.log('Attempting to fetch TMDB series cast for:', this.showName);
      try {
        // First, get series metadata to extract the series ID
        const seriesParams = {
          showName: this.showName,
          year: null
        };
        
        // If we have IMDB ID, add it to the request
        if (this.currentShow?.ProviderIds?.IMDB) {
          seriesParams.imdbId = this.currentShow.ProviderIds.IMDB;
          console.log('Using IMDB ID:', seriesParams.imdbId);
        }
        
        console.log('TMDB series metadata request:', JSON.stringify(seriesParams));
        const seriesData = await srvr.getTmdb(seriesParams);
        console.log('TMDB series response type:', typeof seriesData);
        console.log('TMDB series response:', seriesData);
        
        // Check if we got series metadata with an ID
        if (seriesData && typeof seriesData === 'object' && seriesData.id) {
          const seriesId = seriesData.id;
          console.log('Got TMDB series ID:', seriesId, '- attempting to fetch aggregate_credits');
          
          // Try to get aggregate_credits using the series ID
          // TMDB API: /tv/{series_id}/aggregate_credits returns all cast across all seasons
          const creditsParams = {
            seriesId: seriesId,
            credits: true
          };
          
          // Also include IMDB ID if available, in case server supports that route
          if (this.currentShow?.ProviderIds?.IMDB) {
            creditsParams.imdbId = this.currentShow.ProviderIds.IMDB;
          }
          
          console.log('TMDB aggregate_credits request:', JSON.stringify(creditsParams));
          const creditsData = await srvr.getTmdb(creditsParams);
          console.log('TMDB credits response type:', typeof creditsData);
          console.log('TMDB credits response:', creditsData);
          
          // Check if we got cast array
          let castArray = null;
          if (Array.isArray(creditsData)) {
            castArray = creditsData;
          } else if (creditsData && Array.isArray(creditsData.cast)) {
            castArray = creditsData.cast;
          }
          
          if (castArray && castArray.length) {
            console.log('Successfully got', castArray.length, 'cast members from aggregate_credits');
            
            // Filter to only include series regulars (actors who appeared in multiple episodes)
            // Use binary search to find the minimum episode threshold that gives us < 10 regulars
            const TARGET_MAX_REGULARS = 10;
            
            // Find the max episode count in the data
            const maxEpisodeCount = Math.max(...castArray.map(a => a.total_episode_count || 0));
            console.log('Max episode count in cast:', maxEpisodeCount);
            
            let low = 1;
            let high = maxEpisodeCount;
            let bestThreshold = 1;
            
            while (low <= high) {
              const mid = Math.floor((low + high) / 2);
              const count = castArray.filter(a => (a.total_episode_count || 0) >= mid).length;
              
              console.log(`Testing threshold ${mid}: ${count} regulars`);
              
              if (count < TARGET_MAX_REGULARS) {
                // Too few, need to lower threshold
                bestThreshold = mid;
                high = mid - 1;
              } else {
                // Too many or exact, need to raise threshold
                low = mid + 1;
              }
            }
            
            console.log('Binary search complete. Using threshold:', bestThreshold);
            
            const regularsOnly = castArray.filter(actor => {
              const episodeCount = actor.total_episode_count || 0;
              return episodeCount >= bestThreshold;
            });
            
            console.log('Filtered to', regularsOnly.length, 'series regulars (appeared in', bestThreshold, '+ episodes)');
            
            tmdbList = regularsOnly.map(actor => {
              const imageUrl = actor.profile_path 
                ? `https://image.tmdb.org/t/p/w185${actor.profile_path}`
                : null;
              
              return {
                name: actor.character || actor.roles?.[0]?.character,
                personName: actor.name,
                image: imageUrl,
                personImgURL: imageUrl,
                url: null,
                sort: actor.order,
                isFeatured: false,
                source: 'tmdb',
                actorEpiCount: actor.total_episode_count || 0
              };
            });
          } else {
            console.log('aggregate_credits request did not return cast array');
            console.log('ERROR: Websocket server getTmdb does not support series-level cast requests');
            console.log('The server needs to implement: /tv/{series_id}/aggregate_credits endpoint');
          }
        } else {
          console.log('Did not get series metadata with ID');
        }
      } catch (error) {
        console.log('TMDB fetch error:', error.message || String(error));
      }
      console.log('Final TMDB list size for merge:', tmdbList.length);

      // Merge TMDB and TVDB lists
      this.actors = this.mergeTmdbTvdbActors(tmdbList, tvdbList);
      
      // Cache series actors for restore
      this.seriesActors = [...this.actors];
      this.isGuestMode = false;
      this.showingEpisodeActors = false;
    }
  },

  mounted() {
    this._onShowActors = async (data) => {
      await this.updateActors(data);

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
