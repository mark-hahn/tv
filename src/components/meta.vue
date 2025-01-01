<template lang="pug">

#meta(style=`height:95dvh;
                 padding:0; margin:0; display:flex;`)
  div(style=`border:0.5px solid gray;`) name: {{show.Name}}
  #poster()
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
      const show   = this.show;
      let showPath = show.Path;
      
      const srvrImages = 
         ['/poster.jpg', '/landscape.jpg', '/clearlogo.png'];
      let embyImages = [];
      if(!show.Id.startsWith('noemby-')) {
        embyImages = [
            `https://hahnca.com:8920/emby/Items/${show.Id}` +
              `/Images/Primary?tag=${show.ImageTags.Primary}`               +
              `&keepAnimation=true&quality=90`,
            `https://hahnca.com:8920/emby/Items/${show.Id}` +
              `/Images/Backdrop/0?`+
              `tag=${show.BackdropImageTags[0]}&quality=70`
          ];
      }

      let srvrPath;
      let imgIdx;

      const img = new Image();
      img.style.maxWidth  = "300px"; 
      img.style.maxHeight = "400px"; 
      
      const trySrvrImg = () => {
        img.src = 'https://hahnca.com/tv/' +
                     encodeURI(srvrPath) + srvrImages[imgIdx]; 
        console.log('Meta: trying srvr img:',  img.src);
      };
      const tryEmbyImg = () => {
        img.src = embyImages[imgIdx-srvrImages.length]; 
        console.log('Meta: trying emby img:',  img.src);
      }

      if(showPath) {
        srvrPath = showPath.split('/').pop();
        imgIdx = 0;
        trySrvrImg();
      }
      else {
        imgIdx = srvrImages.length - 1;
        tryEmbyImg();
      }

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
