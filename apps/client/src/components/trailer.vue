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
          template(v-if="ytActiveIdx === idx")
            iframe(
              :src="getYoutubeEmbedSrc(getYoutubeId(t.url))"
              style="max-width:560px; width:100%; aspect-ratio:16/9; border:0; border-radius:4px;"
              allow="autoplay; encrypted-media; picture-in-picture"
              allowfullscreen
              loading="lazy"
              referrerpolicy="strict-origin-when-cross-origin"
            )
          template(v-else)
            div(
              @click.stop="activateYoutube(idx)"
              style="max-width:560px; width:100%; cursor:pointer; position:relative;"
            )
              img(
                :src="getYoutubeThumb(getYoutubeId(t.url))"
                style="width:100%; display:block; border-radius:4px;"
                alt="YouTube trailer thumbnail"
              )
              div(
                style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.15);"
              )
                div(style="display:flex; flex-direction:column; align-items:center; gap:6px;")
                  div(
                    style="width:72px; height:48px; border-radius:12px; background:rgba(0,0,0,0.65); display:flex; align-items:center; justify-content:center;"
                  )
                    span(style="color:white; font-size:22px; margin-left:3px;") ►
                  div(style="color:white; background:rgba(0,0,0,0.65); padding:4px 10px; border-radius:999px; font-size:12px; letter-spacing:0.2px;")
                    | click to play
        
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
      savedTimes: new Map(), // key -> seconds
      lastPlayingKey: null, // "yt-idx" or "html-url"

      // Only instantiate a YT player when requested (keeps console noise + network chatter down)
      ytActiveIdx: null,
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

      // Stop YT playback by removing iframe.
      this.ytActiveIdx = null;
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

      // YT restore is intentionally not supported without the iframe API.
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
    getYoutubeEmbedSrc(ytid) {
      if (!ytid) return '';
      // Use the privacy-enhanced domain.
      return `https://www.youtube-nocookie.com/embed/${ytid}?playsinline=1&autoplay=1&rel=0&modestbranding=1`;
    },
    getYoutubeThumb(ytid) {
      if (!ytid) return '';
      return `https://i.ytimg.com/vi/${ytid}/hqdefault.jpg`;
    },
    activateYoutube(idx) {
      this.ytActiveIdx = idx;
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
      this.ytActiveIdx = null;
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
