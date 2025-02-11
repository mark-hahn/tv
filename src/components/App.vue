<template lang="pug">

#all(style=`width:100%; height:95dvh; box-sizing: border-box;
            padding:0; margin:0; display:flex;`)
  List(style=`display:inline-block;`)
  Series(style=`display:inline-block;`)
</template>

<script>
import List    from './list.vue';
import Series  from './series.vue';

export default {
  name: "App",
  components: { List, Series },
  data() { return { } },
  mounted() { },
}
</script>
