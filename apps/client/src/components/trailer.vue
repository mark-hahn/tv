<template lang="pug">
#trailer(
  @click.stop
  :style="{ height:'100%', width:'100%', padding:'10px', boxSizing:'border-box', overflowY:'auto', backgroundColor:'#fafafa' }"
)
  div(v-if="err" style="color:red; margin:10px; border:1px solid red; padding:10px;")
    b Error:
    pre {{ err }}

  div(v-if="!showName" style="padding:20px; text-align:center; color:#666;") No show selected.
  
  template(v-else)
    div(:style="{ fontWeight:'bold', fontSize:'24px', marginBottom:'15px' }") {{ showName }}

    //- removed v-if !active to keep state
    div(v-if="!trailers || trailers.length === 0" style="padding:20px; text-align:center; color:#666;") No trailers found.

    div(v-else style="display:flex; flex-direction:column; gap:20px;")
      div(v-for="t in trailers" :key="t.id || t.url" style="background:white; padding:10px; border:1px solid #ccc; border-radius:5px;")
        div(:style="{ fontWeight:'bold', marginBottom:'5px' }") {{ t.name }}
        
        template(v-if="getYoutubeId(t.url)")
          iframe(
            width="100%"
            height="315"
            :src="`https://www.youtube.com/embed/${getYoutubeId(t.url)}?enablejsapi=1&origin=${getOrigin()}&rel=0&modestbranding=1`"
            frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            style="max-width:560px;"
          )
        
        template(v-else-if="isVideoFile(t.url)")
          video(
            controls
            width="100%"
            style="max-width:560px;"
            :src="t.url"
          )
        
        div(v-else)
          a(:href="t.url" target="_blank") {{ t.url }}

</template>

<script>
import evtBus from '../evtBus.js';

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
      videoStates: new Map(),
      playingIframes: new Set(),
      resumeIframes: new Set()
    }
  },
  watch: {
    active(val) {
      if (val) this.resumePlayback();
      else this.pausePlayback();
    }
  },
  errorCaptured(err, vm, info) {
    this.err = `${err.toString()}\nInfo: ${info}`;
    return false; // prevent error from bubbling up further
  },
  methods: {
    pausePlayback() {
      if (!this.$el) return;
      // Pause HTML5 videos
      const videos = this.$el.querySelectorAll('video');
      videos.forEach(v => {
        if (!v.paused) {
          this.videoStates.set(v, true);
          v.pause();
        } else {
          this.videoStates.set(v, false);
        }
      });
      
      // Snapshot currently playing iframes for resume
      this.resumeIframes = new Set(this.playingIframes);
      
      // Pause YouTube videos
      const iframes = this.$el.querySelectorAll('iframe');
      iframes.forEach(f => {
         // Pause blindly
         f.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: '' }), '*');
      });
    },
    resumePlayback() {
      if (!this.$el) return;
      // Resume HTML5 videos
      const videos = this.$el.querySelectorAll('video');
      videos.forEach(v => {
        if (this.videoStates.get(v)) {
          v.play().catch(e => console.log('Resume prevented:', e));
        }
      });

      // Resume YouTube videos with a slight delay to ensure tab is ready
      setTimeout(() => {
        this.resumeIframes.forEach(source => {
          try {
            source.postMessage(JSON.stringify({ event: 'command', func: 'playVideo', args: [] }), '*');
          } catch(e) { console.warn('Failed to resume iframe', e); }
        });
        this.resumeIframes.clear();
      }, 100);
    },
    handleMessage(event) {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        // console.log('YT Msg:', data);
        if (data && data.event === 'onStateChange') {
           // Handle different shapes of info
           let state = undefined;
           if (typeof data.info === 'number') state = data.info;
           else if (data.info && typeof data.info.playerState === 'number') state = data.info.playerState;

           if (state === 1) { // Playing
             this.playingIframes.add(event.source);
           } else if (state === 2 || state === 0) { // Paused or Ended
             this.playingIframes.delete(event.source);
           }
        }
      } catch (e) {
        // ignore
      }
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
      this.videoStates.clear();
      this.playingIframes.clear();
      this.resumeIframes.clear();
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
    }
  },
  mounted() {
    this.msgHandler = this.handleMessage.bind(this);
    window.addEventListener('message', this.msgHandler);
    evtBus.on('setUpSeries', this.onSetUpSeries);
    evtBus.on('tvdbDataReady', this.onTvdbDataReady);
  },
  unmounted() {
    window.removeEventListener('message', this.msgHandler);
    evtBus.off('setUpSeries', this.onSetUpSeries);
    evtBus.off('tvdbDataReady', this.onTvdbDataReady);
  }
}
</script>
