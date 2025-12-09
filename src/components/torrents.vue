<template lang="pug">
#torrents(@click.stop :style="{ height:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa' }")

  #header(style="font-size:20px; font-weight:bold; margin-bottom:15px; display:flex; justify-content:space-between; align-items:center;")
    div(style="margin-left:20px;") {{ showName }} Torrents
    button(@click.stop="$emit('close')" style="font-size:15px; cursor:pointer; border-radius:7px; padding:4px 12px;") Close

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
    div(v-for="(torrent, index) in torrents" :key="index" style="margin-bottom:15px; padding:10px; background:#fff; border-radius:5px; border:1px solid #ddd;")
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
      error: null
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
    async searchTorrents(show) {
      if (!show || !show.Name) {
        this.error = 'No show selected';
        return;
      }

      this.showName = show.Name;
      this.loading = true;
      this.error = null;
      this.torrents = [];

      try {
        const response = await fetch(`http://localhost:3001/api/search?show=${encodeURIComponent(show.Name)}`);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        this.torrents = data.torrents || [];
      } catch (err) {
        console.error('Torrent search error:', err);
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>
