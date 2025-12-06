<template lang="pug">

#all(style="width:100%; height:95dvh; box-sizing: border-box; padding:0; margin:0; display:flex;")
  List(style="display:inline-block;" :simpleMode="simpleMode")
  Series(style="display:inline-block;")
</template>

<script>
import List    from './list.vue';
import Series  from './series.vue';

export default {
  name: "App",
  components: { List, Series },
  data() { 
    return { 
      simpleMode: false
    } 
  },
  mounted() {
    const urlParams = new URLSearchParams(window.location.search);
    this.simpleMode = urlParams.has('simple');
  },
}
</script>
