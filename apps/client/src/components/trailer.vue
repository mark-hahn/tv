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

    //- Only render video content if the tab is active to stop playback when hidden
    div(v-if="!active")
      div(style="color:#999; font-style:italic;") (Tab not active)

    div(v-else-if="!trailers || trailers.length === 0" style="padding:20px; text-align:center; color:#666;") No trailers found.

    div(v-else style="display:flex; flex-direction:column; gap:20px;")
      div(v-for="t in trailers" :key="t.id || t.url" style="background:white; padding:10px; border:1px solid #ccc; border-radius:5px;")
        div(:style="{ fontWeight:'bold', marginBottom:'5px' }") {{ t.name }}
        
        template(v-if="getYoutubeId(t.url)")
          iframe(
            width="100%"
            height="315"
            :src="`https://www.youtube.com/embed/${getYoutubeId(t.url)}`"
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
      err: ''
    }
  },
  errorCaptured(err, vm, info) {
    this.err = `${err.toString()}\nInfo: ${info}`;
    return false; // prevent error from bubbling up further
  },
  methods: {
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
    evtBus.on('setUpSeries', this.onSetUpSeries);
    evtBus.on('tvdbDataReady', this.onTvdbDataReady);
  },
  unmounted() {
    evtBus.off('setUpSeries', this.onSetUpSeries);
    evtBus.off('tvdbDataReady', this.onTvdbDataReady);
  }
}
</script>
