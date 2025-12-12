<template lang="pug">
.torrents-container(@click="handleClose" :style="{ height:'100%', width:'100%', display:'flex', justifyContent:'flex-start' }")
  #torrents(@click="handleClose" :style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }")

    #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'15px', marginLeft:'-10px', marginRight:'-10px', marginTop:'-10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'15px', display:'flex', justifyContent:'space-between', alignItems:'center' }")
      div(style="margin-left:20px;") {{ showName }}
      div(style="display:flex; gap:10px; margin-right:20px;")
        button(v-if="selectedTorrent" @click.stop="showDownloadModal" style="font-size:15px; cursor:pointer; border-radius:7px; padding:4px 12px; background:#4CAF50; color:white; border:none;") Download
        button(v-if="noTorrentsNeeded" @click.stop="forceLoadTorrents" style="font-size:15px; cursor:pointer; border-radius:7px; padding:4px 12px; background:#2196F3; color:white; border:none;") Force
        button(@click.stop="handleClose" style="font-size:15px; cursor:pointer; border-radius:7px; padding:4px 12px;") Close

    #cookie-inputs(@click.stop v-if="!loading && !noTorrentsNeeded && (error || torrents.length === 0)" style="position:sticky; top:0; zIndex:50; padding:15px 20px 15px 20px; margin-bottom:10px; background:#fff; border-radius:5px; border:1px solid #ddd;")
      div(style="margin-bottom:10px;")
        label(style="display:block; font-size:12px; font-weight:bold; margin-bottom:3px; color:#555;") IPTorrents cf_clearance:
        input(v-model="iptCfClearance" type="text" placeholder="Paste cf_clearance cookie value" style="width:100%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:3px; box-sizing:border-box;")
      div(style="margin-bottom:10px;")
        label(style="display:block; font-size:12px; font-weight:bold; margin-bottom:3px; color:#555;") TorrentLeech cf_clearance:
        input(v-model="tlCfClearance" type="text" placeholder="Paste cf_clearance cookie value" style="width:100%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:3px; box-sizing:border-box;")
      div(style="margin-top:10px;")
        button(@click.stop="loadTorrents" :disabled="loading" style="padding:8px 20px; font-size:13px; font-weight:bold; cursor:pointer; border-radius:5px; background:#4CAF50; color:white; border:none; width:100%;") 
          | {{ loading ? 'Loading...' : 'Load Torrents' }}

    #tracker-counts(v-if="!loading && !error && torrents.length > 0" style="position:sticky; top:0; zIndex:50; padding:5px 20px 10px 20px; margin-bottom:10px; font-size:13px; color:#555; background:#f0f0f0; border-radius:4px;")
      span(v-for="(count, tracker) in trackerCounts" :key="tracker" style="margin-right:20px;")
        strong {{ tracker }}:
        |  {{ count }} result{{ count !== 1 ? 's' : '' }}

    #loading(v-if="loading" style="text-align:center; color:#666; margin-top:50px; font-size:16px;")
      div Searching for torrents...
      
    #error(v-if="error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px;")
      div Error: {{ error }}
      
    #no-torrents-needed(v-if="noTorrentsNeeded && !loading && !error" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
      div No torrents needed.
      
    #torrents-list(v-if="!loading && !error && !noTorrentsNeeded" style="padding:10px; font-size:14px; line-height:1.6;")
      div(v-if="torrents.length === 0" style="text-align:center; color:#999; margin-top:50px;")
        div No torrents found
      div(v-for="(torrent, index) in torrents" :key="index" @click="handleTorrentClick($event, torrent)" @click.stop :style="getCardStyle(torrent)" @mouseenter="$event.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.15)'" @mouseleave="$event.currentTarget.style.boxShadow='none'")
        div(v-if="isClicked(torrent)" style="position:absolute; top:8px; right:8px; color:#4CAF50; font-size:20px; font-weight:bold;") ✓
        div(v-if="SHOW_TITLE && torrent.raw" style="font-size:12px; color:#888; margin-bottom:4px;") {{ torrent.raw.title }}
        div(style="font-size:18px; color:#333;") 
          strong {{ getDisplaySeasonEpisode(torrent) }}
          | : {{ torrent.raw?.size || 'N/A' }}, {{ torrent.raw?.seeds || 0 }} seeds<span v-if="torrent.raw?.provider">, {{ formatProvider(torrent.raw.provider) }}</span><span v-if="torrent.parsed?.resolution">, {{ torrent.parsed.resolution }}</span><span v-if="torrent.parsed?.group">, {{ formatGroup(torrent.parsed.group) }}</span>

  #download-modal(v-if="showModal" @click.stop="showModal = false" style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:10000;")
    #modal-content(@click.stop style="background:white; padding:30px; border-radius:10px; max-width:500px; box-shadow:0 4px 20px rgba(0,0,0,0.3);")
      div(style="font-size:16px; margin-bottom:20px; line-height:1.5;") Do you want to download the torrent 
        strong {{ selectedTorrent?.raw?.title || 'Unknown' }}
        |  and send it to USB for qBittorrent to download?
      div(style="display:flex; gap:10px; justify-content:flex-end;")
        button(@click.stop="cancelDownload" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; border:1px solid #ccc; background:white;") Cancel
        button(@click.stop="continueDownload" style="padding:8px 20px; font-size:14px; cursor:pointer; border-radius:5px; background:#4CAF50; color:white; border:none;") Continue

</template>

<script>
import evtBus from '../evtBus.js';
import * as emby from '../emby.js';
import * as util from '../util.js';
import { config } from '../config.js';

export default {
  name: "Torrents",
  
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
      torrents: [],
      showName: '',
      loading: false,
      error: null,
      maxResults: 1000,  // Constant for maximum results to fetch
      iptCfClearance: '',
      tlCfClearance: '',
      currentShow: null,
      SHOW_TITLE: true,  // Show torrent title on card
      selectedTorrent: null,  // Currently selected torrent
      showModal: false,  // Show download confirmation modal
      clickedTorrents: new Set(),  // Track which torrents have been clicked
      noTorrentsNeeded: false  // Flag when needed array is empty
    };
  },

  computed: {
    trackerCounts() {
      const counts = {};
      this.torrents.forEach(torrent => {
        const provider = torrent.raw?.provider || 'Unknown';
        counts[provider] = (counts[provider] || 0) + 1;
      });
      return counts;
    }
  },

  mounted() {
    evtBus.on('showTorrents', this.searchTorrents);
  },

  unmounted() {
    evtBus.off('showTorrents', this.searchTorrents);
  },

  methods: {
    handleClose() {
      this.selectedTorrent = null;
      this.showModal = false;
      this.clickedTorrents.clear();
      this.$emit('close');
    },

    async searchTorrents(show) {
      // Reset state when switching shows
      this.torrents = [];
      this.error = null;
      this.selectedTorrent = null;
      this.clickedTorrents.clear();
      this.noTorrentsNeeded = false;
      
      // Store the show for later use with Load button
      this.currentShow = show;
      if (show && show.Name) {
        this.showName = show.Name;
      }
      
      // Get series map and calculate needed episodes
      const needed = await this.calculateNeeded(show);
      
      // Check if needed array is truly empty (not 'loadall')
      if (needed.length === 0) {
        this.noTorrentsNeeded = true;
        return;
      }
      
      // Automatically try to load torrents with saved cookies
      await this.loadTorrents(needed);
    },

    async calculateNeeded(show) {
      const needed = [];
      
      // If not in Emby, return special marker
      if (!show || !show.Id || show.Id.startsWith('noemby-')) {
        return ['noemby'];
      }
      
      try {
        // Get series map (same way as list.vue does)
        const seriesMapIn = await emby.getSeriesMap(show);
        if (!seriesMapIn || seriesMapIn.length === 0) {
          return needed;
        }
        
        // Build seriesMap object from array
        const seriesMap = util.buildSeriesMap(seriesMapIn);
        if (!seriesMap) {
          return needed;
        }

        console.log('Series map for', show.Name, seriesMap);
        
        // Scan for needed episodes
        let hasStartedWatching = false;
        
        // Check if ANY episode in the entire series has been watched
        const anyEpisodeWatched = Object.values(seriesMap).some(episodes =>
          Object.values(episodes).some(epiObj => epiObj.played)
        );
        
        // If nothing watched, start collecting from first episode with no file
        if (!anyEpisodeWatched) {
          hasStartedWatching = true;
        }
        
        for (const [seasonNumStr, episodes] of Object.entries(seriesMap)) {
          const seasonNum = parseInt(seasonNumStr);
          if (isNaN(seasonNum)) continue;
          
          // Check if season has any episodes with state
          const seasonHasState = Object.values(episodes).some(epiObj => {
            const { played, noFile, unaired, avail, deleted, error } = epiObj;
            return played || noFile || unaired || avail || deleted || error;
          });
          
          // Skip this entire season if no episodes have any state
          if (!seasonHasState) {
            continue;
          }
          
          const seasonNeeded = [];
          let allNeeded = true;
          
          for (const [episodeNumStr, epiObj] of Object.entries(episodes)) {
            const episodeNum = parseInt(episodeNumStr);
            if (isNaN(episodeNum)) continue;
            
            const { played, noFile, unaired } = epiObj;
            
            // Stop if we hit an unaired episode
            if (unaired) {
              // Process any accumulated season if any episodes were needed
              if (seasonNeeded.length > 0) {
                if (allNeeded) {
                  needed.push(`S${seasonNum.toString().padStart(2, '0')}`);
                } else {
                  needed.push(`S${seasonNum.toString().padStart(2, '0')}`);
                  seasonNeeded.forEach(ep => needed.push(ep));
                }
              }
              return needed; // Stop scanning
            }
            
            // Track if we've started watching
            if (played) {
              hasStartedWatching = true;
            }
            
            // Episode is needed if: started watching AND not played AND no file
            const isNeeded = hasStartedWatching && !played && noFile;
            
            if (isNeeded) {
              const epStr = `S${seasonNum.toString().padStart(2, '0')}E${episodeNum.toString().padStart(2, '0')}`;
              seasonNeeded.push(epStr);
            } else {
              allNeeded = false;
            }
          }
          
          // Add season if any episodes were needed
          if (seasonNeeded.length > 0 && hasStartedWatching) {
            if (allNeeded) {
              // All episodes in season are needed - just add season
              needed.push(`S${seasonNum.toString().padStart(2, '0')}`);
            } else {
              // Some episodes needed - add season AND individual episodes
              needed.push(`S${seasonNum.toString().padStart(2, '0')}`);
              seasonNeeded.forEach(ep => needed.push(ep));
            }
          }
        }
        
      } catch (err) {
        console.error('Error calculating needed episodes:', err);
      }
      console.log('Needed episodes for', show.Name, needed);
      return needed;
    },

    extractCfClearance(input) {
      // Accept formats:
      // 1. cf_clearance:"value"
      // 2. cf_clearance: "value"
      // 3. "value"
      // 4. value
      if (!input) return '';
      
      const trimmed = input.trim();
      
      // Check for cf_clearance:"..." or cf_clearance: "..." format
      const match = trimmed.match(/^cf_clearance\s*:\s*"(.+)"$/);
      if (match) {
        return match[1];
      }
      
      // Check for quoted value
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
      }
      
      // Return as-is
      return trimmed;
    },

    async loadTorrents(needed = []) {
      if (!this.currentShow || !this.currentShow.Name) {
        this.error = 'No show selected';
        return;
      }

      this.loading = true;
      this.error = null;
      this.torrents = [];
      this.noTorrentsNeeded = false;

      try {
        // Extract cf_clearance cookies from input or use saved values
        let iptCf = this.extractCfClearance(this.iptCfClearance);
        let tlCf = this.extractCfClearance(this.tlCfClearance);
        
        // If input fields are empty, try to use saved values
        if (!iptCf) {
          const saved = localStorage.getItem('iptCfClearance');
          if (saved) {
            iptCf = this.extractCfClearance(saved);
          }
        } else {
          // Save new value
          localStorage.setItem('iptCfClearance', this.iptCfClearance);
        }
        
        if (!tlCf) {
          const saved = localStorage.getItem('tlCfClearance');
          if (saved) {
            tlCf = this.extractCfClearance(saved);
          }
        } else {
          // Save new value
          localStorage.setItem('tlCfClearance', this.tlCfClearance);
        }

        let url = `${config.torrentsApiUrl}/api/search?show=${encodeURIComponent(this.currentShow.Name)}&limit=${this.maxResults}`;
        
        if (iptCf) {
          url += `&ipt_cf=${encodeURIComponent(iptCf)}`;
        }
        if (tlCf) {
          url += `&tl_cf=${encodeURIComponent(tlCf)}`;
        }
        if (needed.length > 0) {
          url += `&needed=${encodeURIComponent(JSON.stringify(needed))}`;
        }

        const response = await fetch(url);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        // Check if we got no results and no cookies were provided
        if ((!data.torrents || data.torrents.length === 0) && !iptCf && !tlCf) {
          this.error = 'No results found. cf_clearance cookies may be needed.';
          this.torrents = [];
          return;
        }
        
        this.torrents = data.torrents || [];
      } catch (err) {
        console.error('Torrent search error:', err);
        
        // Handle both Error objects and rejected promise values
        const errorMessage = err?.message || err?.result || err?.error || (typeof err === 'string' ? err : JSON.stringify(err));
        
        // Check if it's likely a cookie issue
        if (errorMessage.includes('403') || errorMessage.includes('401') || errorMessage.includes('Forbidden')) {
          this.error = 'Access denied. Please provide cf_clearance cookies.';
        } else {
          this.error = errorMessage;
        }
      } finally {
        this.loading = false;
      }
    },

    async forceLoadTorrents() {
      // Force load all torrents by sending 'force' marker
      await this.loadTorrents(['force']);
    },

    handleTorrentClick(event, torrent) {
      // Select the card
      this.selectedTorrent = torrent;
      
      // Add to clicked set
      this.clickedTorrents.add(torrent);
      
      // Open detail page in new tab
      if (torrent.detailUrl) {
        window.open(torrent.detailUrl, '_blank');
      }
    },

    isClicked(torrent) {
      return this.clickedTorrents.has(torrent);
    },

    getCardStyle(torrent) {
      const isSelected = this.selectedTorrent === torrent;
      return {
        marginBottom: '10px',
        padding: '8px',
        background: isSelected ? '#fffacd' : '#fff',
        borderRadius: '5px',
        border: '1px solid #ddd',
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative'
      };
    },

    showDownloadModal() {
      this.showModal = true;
    },

    cancelDownload() {
      this.showModal = false;
      // Keep card selected
    },

    async continueDownload() {
      this.showModal = false;
      
      if (!this.selectedTorrent) {
        console.log('No torrent selected');
        return;
      }
      
      const torrentTitle = this.selectedTorrent.raw?.title || 'Unknown';
      console.log('Attempting to download torrent:', this.selectedTorrent);
      
      try {
        // Get cf_clearance cookies from localStorage
        const cfClearance = {
          iptorrents: localStorage.getItem('cf_clearance_iptorrents') || '',
          torrentleech: localStorage.getItem('cf_clearance_torrentleech') || ''
        };
        
        const response = await fetch(`${config.torrentsApiUrl}/api/download`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            torrent: this.selectedTorrent,
            cfClearance: cfClearance
          })
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Download result:', data);
        
        // Check if download was successful
        if (data.success || data.result === true) {
          alert(`Downloaded ${torrentTitle}`);
        } else {
          const errorMsg = data.error || data.message || 'Unknown error';
          alert(`Download failed for ${torrentTitle}, ${errorMsg}`);
        }
      } catch (error) {
        console.error('Download error:', error);
        const errorMsg = error.message || String(error);
        alert(`Download failed for ${torrentTitle}, ${errorMsg}`);
      }
    },

    formatSeasonEpisode(seasonEpisode) {
      if (!seasonEpisode) return '';
      // Convert S01E02 to 1/2, or S01 to 1
      const match = seasonEpisode.match(/S(\d+)(?:E(\d+))?/);
      if (!match) return seasonEpisode;
      
      const season = parseInt(match[1], 10);
      const episode = match[2] ? parseInt(match[2], 10) : null;
      
      if (episode !== null) {
        return `${season}/${episode}`;
      } else {
        return String(season);
      }
    },

    getDisplaySeasonEpisode(torrent) {
      // Handle dummy torrents
      if (torrent.notorrent) {
        return this.formatSeasonEpisode(torrent.notorrent);
      }
      
      // Check if torrent has parsed data
      if (!torrent.parsed) {
        console.log('No parsed data for torrent:', torrent);
        return torrent.title || '';
      }
      
      // Log what we're working with
      // console.log('Torrent display data:', {
      //   title: torrent.parsed.title,
      //   season: torrent.parsed.season,
      //   episode: torrent.parsed.episode,
      //   seasonEpisode: torrent.parsed.seasonEpisode,
      //   rawTitle: torrent.raw?.title
      // });
      
      // If seasonEpisode is already set, use it
      if (torrent.parsed.seasonEpisode) {
        return this.formatSeasonEpisode(torrent.parsed.seasonEpisode);
      }
      
      // Otherwise construct from parsed season/episode
      const season = torrent.parsed.season;
      const episode = torrent.parsed.episode;
      
      if (season !== undefined && season !== null) {
        let result = `S${String(season).padStart(2, '0')}`;
        if (episode !== undefined && episode !== null) {
          result += `E${String(episode).padStart(2, '0')}`;
        }
        return this.formatSeasonEpisode(result);
      }
      
      // Fallback to title if no season info
      console.log('Falling back to title:', torrent.parsed.title);
      return torrent.parsed.title || '';
    },

    formatProvider(provider) {
      if (!provider) return '';
      if (provider.toLowerCase() === 'iptorrents') return 'IPT';
      if (provider.toLowerCase() === 'torrentleech') return 'TL';
      return provider;
    },

    formatGroup(group) {
      if (!group) return '';
      return group.toLowerCase();
    }
  }
};
</script>

