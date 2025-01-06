<template lang="pug">

#all(style=`width:100%; height:95dvh; box-sizing: border-box;
            padding:0; margin:0; display:flex;`)
  List(style=`display:inline-block;`)
  Series(v-if="!showEpiNotMeta" style=`display:inline-block;`)
  Episode( v-if=" showEpiNotMeta" style=`display:inline-block;`)

</template>

<script>
import List   from './list.vue';
import Series   from './series.vue';
import Episode    from './episode.vue';
import evtBus from '../evtBus.js';

export default {
  name: "App",
  components: { List, Series, Episode },
  data() {
    return {
      showEpiNotMeta: false,
    }
  },
  mounted() {
    evtBus.on('showEpiNotMeta', (showEpiNotMeta) => {
      this.showEpiNotMeta = showEpiNotMeta;
    });
  },
}
</script>
