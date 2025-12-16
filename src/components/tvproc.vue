<template lang="pug">

#tvproc(:style="{ height:'100%', padding:'5px', margin:0, display:'flex', flexDirection:'column', overflow:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box', backgroundColor:'#fafafa', fontWeight:'bold' }")

  #header(:style="{ position:'sticky', top:'0px', zIndex:100, backgroundColor:'#fafafa', paddingTop:'5px', paddingLeft:'5px', paddingRight:'5px', paddingBottom:'5px', marginLeft:'0px', marginRight:'0px', marginTop:'0px', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'0px', display:'flex', flexDirection:'column', alignItems:'stretch' }")
    div(style="display:flex; justify-content:space-between; align-items:center;")
      div(style="margin-left:20px;") TV Proc
      div(style="display:flex; gap:10px; margin-right:20px; justify-content:flex-end;")
        button(@click.stop="$emit('torrents')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Torrents
        button(@click.stop="$emit('status')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Status
        button(@click.stop="$emit('history')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") History
        button(@click.stop="$emit('series')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Series
        button(@click.stop="$emit('map')" style="font-size:15px; cursor:pointer; margin-top:3px; max-height:24px; border-radius:7px;") Map

  div(v-if="error" style="text-align:center; color:#c00; margin-top:50px; font-size:16px; white-space:pre-line; padding:0 20px;")
    div Error: {{ error }}

  pre(v-else :style="{ flex:'1 1 auto', margin:'0px', padding:'10px', overflowY:'auto', overflowX:'auto', background:'#fff', border:'1px solid #ddd', borderRadius:'5px', fontFamily:'monospace', fontSize:'14px', fontWeight:'normal', whiteSpace:'pre' }") {{ logText }}

</template>

<script>
import evtBus from '../evtBus.js';
import { config } from '../config.js';

export default {
  name: 'TvProc',

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
      logText: '',
      error: null
    };
  },

  mounted() {
    evtBus.on('paneChanged', this.onPaneChanged);
  },

  unmounted() {
    evtBus.off('paneChanged', this.onPaneChanged);
    this.logText = '';
    this.error = null;
  },

  methods: {
    onPaneChanged(pane) {
      if (pane === 'tvproc') {
        void this.loadLog();
      }
    },

    async loadLog() {
      this.error = null;
      try {
        const res = await fetch(`${config.torrentsApiUrl}/api/tvproc`);
        if (!res.ok) {
          let detail = '';
          try {
            const ct = res.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
              const j = await res.json();
              detail = j?.error ? String(j.error) : JSON.stringify(j);
            } else {
              detail = await res.text();
            }
          } catch {
            // ignore
          }
          throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
        }
        this.logText = await res.text();
      } catch (e) {
        this.error = e?.message || String(e);
      }
    }
  }
};
</script>
