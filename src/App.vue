<template lang="pug">

#all(style=`width:100%; height:95dvh; box-sizing: border-box;
            padding:0; margin:0; display:flex;`)
  List()
  Meta()

</template>

<script>
import List from './components/list.vue';
import Meta from './components/meta.vue';

export default {
  name: "App",
  components: { List, Meta },
}
</script>
