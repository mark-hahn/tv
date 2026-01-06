<template lang="pug">
.subs-container(:style="{ height:'100%', width:'100%', display:'flex', justifyContent:'flex-start' }")
  #subs(
    ref="scroller"
    :style="{ height:'100%', width:'100%', padding:'10px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', boxSizing:'border-box', backgroundColor:'#fafafa' }"
    @wheel.stop.prevent="handleScaledWheel"
  )

    #header(:style="{ position:'sticky', top:'-10px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'15px', paddingLeft:'10px', paddingRight:'10px', paddingBottom:'10px', marginLeft:'0px', marginRight:'0px', marginTop:'-10px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'0px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
      div(style="display:flex; justify-content:space-between; align-items:center;")
        div(style="margin-left:20px;") {{ headerShowName }}
        div(style="display:flex; gap:8px; margin-left:auto;")
          button(v-if="selectedTorrent" @click.stop="continueDownload" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px; border:1px solid #bbb; background-color:whitesmoke;") Get
          button(v-if="selectedTorrent" @click.stop="openDetails" style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px; border:1px solid #bbb; background-color:whitesmoke;") Tab
          //- Search button exists but intentionally not wired for now.
          button(style="font-size:13px; cursor:pointer; border-radius:7px; padding:4px; border:1px solid #bbb; background-color:whitesmoke;") Search

      div(style="height:1px; width:100%; background-color:#ddd; margin-top:6px;")

    #unaired(v-if="unaired" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
      div Show not aired yet

    #loading(v-if="!unaired && loading" style="text-align:center; color:#666; margin-top:50px; font-size:16px;")
      div Searching for torrents...

    #error(v-if="!unaired && error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px; white-space:pre-line; padding:0 20px;")
      div Error: {{ error }}
    #warning(v-if="!unaired && !error && providerWarning" style="text-align:center; color:#b36b00; margin-top:20px; font-size:14px; white-space:pre-line; padding:0 20px;")
      div {{ providerWarning }}

    #no-torrents-needed(v-if="!unaired && noTorrentsNeeded && !loading && !error" style="text-align:center; color:#666; margin-top:50px; font-size:18px;")
      div No torrents needed.

    #subs-list(v-if="!unaired && !loading && !noTorrentsNeeded" style="padding:10px; font-size:14px; line-height:1.2;")
      div(v-if="!hasSearched && filteredTorrents.length === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
        div Click on Search to find torrents for {{ headerShowName }}.
      div(v-else-if="hasSearched && filteredTorrents.length === 0 && !error" style="text-align:center; color:#999; margin-top:50px;")
        div No torrents found.
      div(v-for="(torrent, index) in filteredTorrents" :key="getTorrentCardKey(torrent, index)" @click="handleTorrentClick($event, torrent)" @click.stop :style="getCardStyle(torrent)" @mouseenter="$event.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.15)'" @mouseleave="$event.currentTarget.style.boxShadow='none'")
        div(v-if="isClicked(torrent)" style="position:absolute; top:8px; right:8px; color:#4CAF50; font-size:20px; font-weight:bold;") ✓
        div(v-if="SHOW_TITLE && torrent.raw" style="font-size:13px; font-weight:bold; color:#888; margin-bottom:4px; white-space:normal; overflow-wrap:anywhere; word-break:break-word;") {{ getDisplayTitleWithProvider(torrent) }}
        div(style="font-size:12px; color:#333;")
          strong {{ getDisplaySeasonEpisode(torrent) }}
          | : {{ fmtSize(torrent.raw?.size) || torrent.raw?.size || 'N/A' }} | {{ torrent.raw?.seeds || 0 }} seeds
          span(v-if="torrent.raw?.provider") | {{ formatProvider(torrent.raw.provider) }}
          span(v-if="torrent.parsed?.resolution") | {{ torrent.parsed.resolution }}
          span(v-if="torrent.parsed?.group") | {{ formatGroup(torrent.parsed.group) }}
</template>

<script>
import * as util from '../util.js';

export default {
  name: 'Subs',

  props: {
    simpleMode: {
      type: Boolean,
      default: false
    },
    activeShow: {
      type: Object,
      default: null
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
      hasSearched: false,
      providerWarning: '',
      selectedTorrent: null,
      SHOW_TITLE: true,
      clickedTorrents: new Set(),
      downloadedTorrents: new Set(),
      noTorrentsNeeded: false,
      unaired: false
    };
  },

  computed: {
    headerShowName() {
      return (
        this.showName ||
        this.activeShow?.Name ||
        ''
      );
    },
    filteredTorrents() {
      return this.torrents.filter(torrent => {
        const seeds = Number(torrent.raw?.seeds);
        return seeds > 0;
      });
    }
  },

  methods: {
    fmtSize(bytesOrHumanString) {
      return util.fmtBytesSize(bytesOrHumanString);
    },

    handleScaledWheel(event) {
      if (!event) return;
      const el = event.currentTarget;
      if (!el) return;
      const dy = (event.deltaY || 0);
      const scaledDy = dy * 0.125;
      const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      el.scrollTop = Math.max(0, Math.min(max, (el.scrollTop || 0) + scaledDy));
    },

    getTorrentCardKey(torrent, index) {
      return String(torrent?.detailUrl || torrent?.raw?.title || index);
    },

    getDisplayTitleWithProvider(torrent) {
      const title = String(torrent?.raw?.title || torrent?.title || '').trim();
      const provider = String(torrent?.raw?.provider || '').trim();
      if (!provider) return title;
      return `${title} | ${this.formatProvider(provider)}`;
    },

    handleTorrentClick(_event, torrent) {
      this.selectedTorrent = torrent;
      this.clickedTorrents.add(torrent);
    },

    isClicked(torrent) {
      return this.clickedTorrents.has(torrent);
    },

    getCardStyle(torrent) {
      const isSelected = this.selectedTorrent === torrent;
      let bgColor = '#fff';
      if (isSelected) {
        bgColor = '#fffacd';
      }
      return {
        padding: '8px',
        background: bgColor,
        borderRadius: '5px',
        border: '1px solid #ddd',
        cursor: 'pointer',
        transition: 'all 0.2s',
        position: 'relative'
      };
    },

    openDetails() {
      const url = this.selectedTorrent?.detailUrl;
      if (url) window.open(url, '_blank');
    },

    continueDownload() {
      // Intentionally not implemented yet.
    },

    formatSeasonEpisode(seasonEpisode) {
      const seasonEpisodeStr = String(seasonEpisode || '').trim();
      if (!seasonEpisodeStr) return '';
      const match = seasonEpisodeStr.match(/S(\d+)(?:E(\d+))?/);
      if (!match) return seasonEpisodeStr;
      const season = parseInt(match[1], 10);
      const episode = match[2] ? parseInt(match[2], 10) : null;
      if (episode !== null) return `${season}/${episode}`;
      return String(season);
    },

    getDisplaySeasonEpisode(torrent) {
      if (torrent?.notorrent) {
        return this.formatSeasonEpisode(torrent.notorrent);
      }
      if (!torrent?.parsed) {
        return torrent?.title || '';
      }
      if (torrent.seasonRange && torrent.seasonRange.isRange) {
        const start = Number(torrent.seasonRange.startSeason);
        const end = Number(torrent.seasonRange.endSeason);
        if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
          return `${start}...${end}`;
        }
      }
      if (torrent.parsed.seasonEpisode) {
        return this.formatSeasonEpisode(torrent.parsed.seasonEpisode);
      }
      const season = torrent.parsed.season;
      const episode = torrent.parsed.episode;
      if (season !== undefined && season !== null) {
        let result = `S${String(season).padStart(2, '0')}`;
        if (episode !== undefined && episode !== null) {
          result += `E${String(episode).padStart(2, '0')}`;
        }
        return this.formatSeasonEpisode(result);
      }
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
      return String(group).toLowerCase();
    }
  }
};
</script>
