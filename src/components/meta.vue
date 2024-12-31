<template lang="pug">

#meta(style=`height:95dvh;
                 padding:0; margin:0; display:flex;`)
  div(style=`border:0.5px solid gray;`) name: {{show.Name}}
  #poster(style=`width:250px; height:500px;`)
</template>

<script>
import evtBus from '../evtBus.js';

export default {
  name: "Meta",
  data() {
    return {
      show: {Name:'<No Show Selected>'},
    }
  },
  
  methods: {
    setPoster() {
      const show = this.show;
      const srvrPath = show.Path.split('/').pop();
      const srvrImages = 
              ['/poster.jpg', '/landscape.jpg', '/clearlogo.png'];
      const embyImages = [
        `https://hahnca.com:8920/emby/Items/${show.Id}` +
          `/Images/Primary?maxHeight=802&maxWidth=534&` +
          `tag=${show.ImageTags.Primary}`               +
          `&keepAnimation=true&quality=90`,
        `https://hahnca.com:8920/emby/Items/${show.Id}` +
        `/Images/Backdrop/0?tag=${show.BackdropImageTags[0]}` +
        `&maxWidth=2560&quality=70`
      ];
      const img = new Image();
      let imgIdx = 0;
      const trySrvrImg = () => {
        img.src = 'https://hahnca.com/tv/' +
                     encodeURI(srvrPath) + srvrImages[imgIdx]; 
        console.log('Meta: trying srvr img:',  img.src);
      };
      const tryEmbyImg = () => {
        img.src = embyImages[imgIdx-srvrImages.length]; 
        console.log('Meta: trying emby img:',  img.src);
      }
      trySrvrImg();
      img.onload = () => {
        console.log('Meta showing img:',  img.src);
        document.getElementById('poster').replaceChildren(img);
      };
      img.onerror = () => {
        // console.log('Meta no img:', img.src);
        if(++imgIdx < srvrImages.length) {
          trySrvrImg();
        }
        else if(++imgIdx < srvrImages.length + 
                           embyImages.length) {
          tryEmbyImg();
        }
        else {
          img.src = 'https://hahnca.com/tv/no-image.png'; 
          console.log( `Meta default img: ` + img.src);
          return;
        }
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
