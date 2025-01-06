<template lang="pug">

#all(style=`width:100%; height:95dvh; box-sizing: border-box;
            padding:0; margin:0; display:flex;`)
  List(style=`display:inline-block;`
      :showEpiNotSeries="showEpiNotSeries")
  Series( v-if="!showEpiNotSeries" style=`display:inline-block;`)
  Episode(v-if=" showEpiNotSeries" style=`display:inline-block;`)
</template>

<script>
import List    from './list.vue';
import Series  from './series.vue';
import Episode from './episode.vue';
import evtBus  from '../evtBus.js';

export default {
  name: "App",
  components: { List, Series, Episode },
  data() {
    return {
      showEpiNotSeries: false,
    }
  },
  mounted() {
    evtBus.on('showEpiNotSeries', (showEpiNotSeries) => {
      this.showEpiNotSeries = showEpiNotSeries;
    });
  },
}
</script>
