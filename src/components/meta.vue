<template lang="pug">

#meta(style="height:95dvh; padding:0; margin:0; display:flex;")
  div(style="border:0.5px solid gray;") name: {{show.Name}}
  #poster()
</template>

<script>
import evtBus from '../evtBus.js';

const images = ['/poster.jpg', '/landscape.jpg', '/clearlogo.png'];

export default {
  name: "Meta",
  data() {
    return {
      show: {Name:'<No Show Selected>'},
    }
  },
  
  methods: {
    setPoster() {
      const img = new Image();
      let imgIdx = 0;
      const tryImg = () => {
        console.log('Meta: trying img:',  images[imgIdx]);
        img.src = 'https://hahnca.com/tv/' +
              encodeURI(this.show.Name) + images[imgIdx]; 
      };
      tryImg();
      img.onload = () => {
        console.log('Meta: showing img:',  images[imgIdx]);
        document.getElementById('poster').replaceChildren(img);
      };
      img.onerror = () => {
        console.log('Meta: no img:',  images[imgIdx]);
        if(++imgIdx == images.length) {
          console.log('Meta: no image found');
          return;
        }
        tryImg();
      };
    },
  },

  mounted() {
    evtBus.on('showSelected', (show) => { 
      console.log('Meta: showSelected:', show.Name);
      this.show = show;
      this.setPoster();
    });
  },
    
};
</script>
