<template lang="pug">
#torrents(@click.stop :style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }")

  #header(style="font-size:20px; font-weight:bold; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center;")
    div(style="margin-left:20px;") {{ showName }} Torrents
    div(style="display:flex; gap:8px;")
      button(v-if="!loading && torrents.length > 0" @click.stop="restart" style="font-size:15px; cursor:pointer; border-radius:7px; padding:4px 12px; background:#ff9800; color:white; border:none;") Restart
      button(@click.stop="$emit('close')" style="font-size:15px; cursor:pointer; border-radius:7px; padding:4px 12px;") Close

  #cookie-inputs(v-if="!loading && (error || torrents.length === 0)" style="padding:15px 20px; margin-bottom:10px; background:#fff; border-radius:5px; border:1px solid #ddd;")
    div(style="margin-bottom:10px;")
      label(style="display:block; font-size:12px; font-weight:bold; margin-bottom:3px; color:#555;") IPTorrents cf_clearance:
      input(v-model="iptCfClearance" type="text" placeholder="Paste cf_clearance cookie value" style="width:100%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:3px; box-sizing:border-box;")
    div(style="margin-bottom:10px;")
      label(style="display:block; font-size:12px; font-weight:bold; margin-bottom:3px; color:#555;") TorrentLeech cf_clearance:
      input(v-model="tlCfClearance" type="text" placeholder="Paste cf_clearance cookie value" style="width:100%; padding:6px; font-size:12px; border:1px solid #ccc; border-radius:3px; box-sizing:border-box;")
    div(style="margin-top:10px;")
      button(@click.stop="loadTorrents" :disabled="loading" style="padding:8px 20px; font-size:13px; font-weight:bold; cursor:pointer; border-radius:5px; background:#4CAF50; color:white; border:none; width:100%;") 
        | {{ loading ? 'Loading...' : 'Load Torrents' }}

  #tracker-counts(v-if="!loading && !error && torrents.length > 0" style="padding:5px 20px; margin-bottom:10px; font-size:13px; color:#555; background:#f0f0f0; border-radius:4px;")
    span(v-for="(count, tracker) in trackerCounts" :key="tracker" style="margin-right:20px;")
      strong {{ tracker }}:
      |  {{ count }} result{{ count !== 1 ? 's' : '' }}

  #loading(v-if="loading" style="text-align:center; color:#666; margin-top:50px; font-size:16px;")
    div Searching for torrents...
    
  #error(v-if="error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px;")
    div Error: {{ error }}
    
  #torrents-list(v-if="!loading && !error" style="padding:10px; font-size:14px; line-height:1.6;")
    div(v-if="torrents.length === 0" style="text-align:center; color:#999; margin-top:50px;")
      div No torrents found
    div(v-for="(torrent, index) in torrents" :key="index" @click.stop="handleTorrentClick(torrent)" style="margin-bottom:15px; padding:10px; background:#fff; border-radius:5px; border:1px solid #ddd; cursor:pointer;" @mouseenter="$event.currentTarget.style.background='#f5f5f5'" @mouseleave="$event.currentTarget.style.background='#fff'")
      div(style="font-weight:bold; margin-bottom:5px; color:#333;") {{ torrent.title }}
      div(style="font-size:12px; color:#666; margin-bottom:3px;")
        span(style="margin-right:15px;") 📁 {{ torrent.size }}
        span(style="margin-right:15px;") ⬆️ {{ torrent.seeds }} seeds
        span(style="margin-right:15px;") ⬇️ {{ torrent.peers }} peers
        span(v-if="torrent.provider") 🌐 {{ torrent.provider }}
      div(v-if="torrent.tags && torrent.tags.length" style="font-size:11px; color:#888; margin-top:3px;")
        span(v-for="tag in torrent.tags" :key="tag" style="background:#e8f4f8; padding:2px 6px; margin-right:5px; border-radius:3px;") {{ tag }}

</template>

<script>
import evtBus from '../evtBus.js';
import { setTorrents, getTorrent } from '../srvr.js';

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
      maxResults: 100,  // Constant for maximum results to fetch
      iptCfClearance: '',
      tlCfClearance: '',
      currentShow: null
    };
  },

  computed: {
    trackerCounts() {
      const counts = {};
      this.torrents.forEach(torrent => {
        const provider = torrent.provider || 'Unknown';
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
    restart() {
      this.torrents = [];
      this.error = null;
      this.iptCfClearance = '';
      this.tlCfClearance = '';
    },

    searchTorrents(show) {
      // Reset state when switching shows
      this.torrents = [];
      this.error = null;
      
      // Store the show for later use with Load button
      this.currentShow = show;
      if (show && show.Name) {
        this.showName = show.Name;
      }
      
      // Automatically try to load torrents with saved cookies
      this.loadTorrents();
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

    async loadTorrents() {
      if (!this.currentShow || !this.currentShow.Name) {
        this.error = 'No show selected';
        return;
      }

      this.loading = true;
      this.error = null;
      this.torrents = [];

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

        let url = `https://localhost:3001/api/search?show=${encodeURIComponent(this.currentShow.Name)}&limit=${this.maxResults}`;
        
        if (iptCf) {
          url += `&ipt_cf=${encodeURIComponent(iptCf)}`;
        }
        if (tlCf) {
          url += `&tl_cf=${encodeURIComponent(tlCf)}`;
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
        
        // Send torrents to remote server via WebSocket
        const result = await setTorrents(data.torrents || []);
        
        // Check for error in response
        if (result.error) {
          this.error = result.error;
          this.torrents = [];
          return;
        }
        
        this.torrents = result.torrents || [];
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

    async handleTorrentClick(torrent) {
      if (!torrent.torrentId) {
        console.error('Torrent missing torrentId');
        return;
      }

      try {
        const result = await getTorrent(torrent.torrentId);
        
        // Check for error in response
        if (result.error) {
          this.error = result.error;
          return;
        }
        
        // Handle the full torrent data
        console.log('Full torrent data:', result);
        // TODO: Show torrent details in UI or trigger download
      } catch (err) {
        console.error('getTorrent error:', err);
        const errorMessage = err?.message || err?.result || err?.error || (typeof err === 'string' ? err : JSON.stringify(err));
        this.error = errorMessage;
      }
    }
  }
};
</script>
