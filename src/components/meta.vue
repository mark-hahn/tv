<template lang="pug">

#meta(style=`width:40%; height:95dvh;
                 padding:0; margin:0; display:flex;`)
  div(style=`border:0.5px solid gray;`) {{show}}

</template>

<script>
const imgNames = ['clearlogo', 'landscape', 'poster'];
const imgUrl = (show, imgName) =>
        `https://hahnca.com/tv/${encodeURI(show.Name)}/${imgName}`
//- console.log(imgUrl({Name: 'Dollface'}, 'clearlogo.png'));

export default {
  name: "Meta",
  components: {},
  inject: ['evtBus'],

  data() {
    return {
      show: '<No Show Selected>',
    }
  },
  
  methods: {
  
    mounted() {
      this.evtBus.on('showSelected', (show) => { 
        console.log('Meta: showSelected:', show);
        this.show = show;
      });
    }

  },
};
</script>
