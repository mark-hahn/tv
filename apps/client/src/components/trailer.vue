<template lang="pug">
#trailer(
  @click.stop
  :style="{ height:'100%', width:'100%', padding:'10px', boxSizing:'border-box', overflowY:'auto', backgroundColor:'#fafafa', position:'relative' }"
)
  div(v-if="err" style="color:red; margin:10px; border:1px solid red; padding:10px;")
    b Error:
    pre {{ err }}

  div(v-if="!showName" style="padding:20px; text-align:center; color:#666;") No show selected.
  
  template(v-else)
    div(:style="{ fontWeight:'bold', fontSize:'24px', marginBottom:'15px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }")
      span {{ showName }}

    //- content wrapper to allow refresh
    div(v-if="!trailers || trailers.length === 0" style="padding:20px; text-align:center; color:#666;") No trailers found.

    div(v-else-if="showContent" style="display:flex; flex-direction:column; gap:20px;")
      div(v-for="(t, idx) in trailers" :key="t.id || t.url" style="background:white; padding:10px; border:1px solid #ccc; border-radius:5px;")
        div(:style="{ fontWeight:'bold', marginBottom:'5px' }") {{ t.name ? t.name.replace(/Trailer/gi, '').trim() : '' }}
        
        template(v-if="getYoutubeId(t.url)")
          div(:id="'yt-player-' + idx")
        
        template(v-else-if="isVideoFile(t.url)")
          video(
            controls
            ref="htmlVideos"
            width="100%"
            style="max-width:560px;"
            :src="t.url"
            :data-url="t.url"
          )
        
        div(v-else)
          a(:href="t.url" target="_blank") {{ t.url }}

</template>

<script>
import evtBus from '../evtBus.js';
import { nextTick } from 'vue';

export default {
  name: "Trailer",
  props: {
    simpleMode: { type: Boolean, default: false },
    active:     { type: Boolean, default: false },
  },
  data() {
    return {
      showName: '',
      trailers: [],
      err: '',
      showContent: true, // Controls rendering of video list

      previewMode: false,
      previewAddBusy: false,
      previewSrchChoice: null,
      
      // State tracking
      ytPlayers: new Map(), // idx -> YT.Player
      savedTimes: new Map(), // key -> seconds
      lastPlayingKey: null, // "yt-idx" or "html-url"

      lastPlayingKey: null, // "yt-idx" or "html-url"
    }
  },
  watch: {
    active(val) {
      if (!val) {
        // Tab hidden: Save state and destroy
        this.saveState();
        this.showContent = false;
      } else {
        // Tab shown: Re-render and restore
        this.showContent = true;
        nextTick(() => {
          this.initPlayers(); // Re-init YT players
          this.restoreState();
        });
      }
    },
    trailers() {
      // If trailers change while active, init players
      if (this.active && this.showContent) {
        nextTick(() => this.initPlayers());
      }
    }
  },
  errorCaptured(err, vm, info) {
    this.err = `${err.toString()}\nInfo: ${info}`;
    return false; // prevent error from bubbling up further
  },
  methods: {
    onPreviewMode(active) {
      this.previewMode = !!active;
      if (!this.previewMode) {
        this.previewSrchChoice = null;
        this.previewAddBusy = false;
      }
    },

    onPreviewSrchChoice(srchChoice) {
      this.previewSrchChoice = srchChoice || null;
    },

    addShowFromPreview() {
      if (!this.previewSrchChoice) return;
      if (this.previewAddBusy) return;
      this.previewAddBusy = true;
      evtBus.emit('addPreviewShow', { srchChoice: this.previewSrchChoice, fromPreview: true });
    },

    onAddPreviewShowDone() {
      this.previewAddBusy = false;
    },

    exitPreview() {
      evtBus.emit('exitPreviewMode');
    },

    saveState() {
      // Save HTML5
      if (this.$refs.htmlVideos) {
        // refs might be single element or array or absent
        const vids = Array.isArray(this.$refs.htmlVideos) ? this.$refs.htmlVideos : [this.$refs.htmlVideos];
        vids.forEach(v => {
          if (!v) return;
          const url = v.getAttribute('data-url');
          if (url && !v.paused) {
            this.savedTimes.set('html-' + url, v.currentTime);
            this.lastPlayingKey = 'html-' + url;
          }
        });
      }

      // Save YT
      this.ytPlayers.forEach((player, idx) => {
        try {
          if (player && player.getPlayerState && player.getPlayerState() === 1) { // 1 = playing
            const time = player.getCurrentTime();
            this.savedTimes.set('yt-' + idx, time);
            this.lastPlayingKey = 'yt-' + idx;
          } else {
            // Also save paused state position just in case? No, only resume what was playing.
          }
          // Destroy player instance to clean up
          player.destroy();
        } catch(e) { /* ignore */ }
      });
      this.ytPlayers.clear();
    },

    restoreState() {
      // Restore HTML5
      if (this.$refs.htmlVideos) {
        const vids = Array.isArray(this.$refs.htmlVideos) ? this.$refs.htmlVideos : [this.$refs.htmlVideos];
        vids.forEach(v => {
           if (!v) return;
           const url = v.getAttribute('data-url');
           const key = 'html-' + url;
           if (key === this.lastPlayingKey && this.savedTimes.has(key)) {
             v.currentTime = this.savedTimes.get(key);
             v.play().catch(e => console.log('Resume blocked', e));
           }
        });
      }


      // YT restoration happens optionally in onPlayerReady or via initialization params
    },

    initPlayers() {
      if (!window.YT || !window.YT.Player) return; // Wait for API
      
      this.trailers.forEach((t, idx) => {
        const ytid = this.getYoutubeId(t.url);
        if (ytid) {
          const divId = 'yt-player-' + idx;
          const key = 'yt-' + idx;
          // Check if we need to resume this one
          const shouldPlay = (key === this.lastPlayingKey);
          const startSeconds = shouldPlay ? (this.savedTimes.get(key) || 0) : 0;
          
          try {
             // If player already exists (shouldn't happen with v-if), destroy it (handled in saveState usually)
             if (document.getElementById(divId)) {
                
                const player = new window.YT.Player(divId, {
                  height: '315',
                  width: '100%',
                  videoId: ytid,
                  playerVars: {
                    'playsinline': 1,
                    'start': Math.floor(startSeconds),
                    'autoplay': shouldPlay ? 1 : 0,
                    'origin': window.location.origin
                  },
                });
                this.ytPlayers.set(idx, player);
                
                // Style fix for the iframe generated by YT API
                // It replaces the div, but might miss some styles or attributes.
                // We can style the container or just let it be.
             }
          } catch(e) { console.error('YT init error', e); }
        }
      });
    },

    loadYoutubeApi() {
      if (window.YT && window.YT.Player) {
        return;
      }
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      
      window.onYouTubeIframeAPIReady = () => {
         if (this.active && this.showContent) {
           this.initPlayers();
         }
      };
    },

    getOrigin() {
      return window.location.origin;
    },
    getYoutubeId(url) {
      if (!url) return null;
      try {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
      } catch (e) {
        return null;
      }
    },
    isVideoFile(url) {
       if (!url) return false;
       return /\.(mp4|webm|ogg|mov)$/i.test(url);
    },
    onSetUpSeries(show) {
      this.err = '';
      this.showName = show?.Name || '';
      this.trailers = [];
      this.savedTimes.clear();
      this.lastPlayingKey = null;
      this.showContent = true; // Reset
    },
    onTvdbDataReady(data) {
      this.err = '';
      if (this.showName && data?.show?.Name !== this.showName) return;

      const tvdbData = data?.tvdbData;
      if (tvdbData && Array.isArray(tvdbData.trailers)) {
        this.trailers = tvdbData.trailers;
      } else {
        this.trailers = [];
      }
      // trailers watcher will handle init
    }
  },
  mounted() {
    this.loadYoutubeApi(); // Start loading API
    evtBus.on('setUpSeries', this.onSetUpSeries);
    evtBus.on('tvdbDataReady', this.onTvdbDataReady);

    evtBus.on('previewMode', this.onPreviewMode);
    evtBus.on('previewSrchChoice', this.onPreviewSrchChoice);
    evtBus.on('addPreviewShowDone', this.onAddPreviewShowDone);
  },
  unmounted() {
    evtBus.off('setUpSeries', this.onSetUpSeries);
    evtBus.off('tvdbDataReady', this.onTvdbDataReady);

    evtBus.off('previewMode', this.onPreviewMode);
    evtBus.off('previewSrchChoice', this.onPreviewSrchChoice);
    evtBus.off('addPreviewShowDone', this.onAddPreviewShowDone);
  }
}
</script>
