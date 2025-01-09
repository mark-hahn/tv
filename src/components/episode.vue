<template lang="pug">

#episode(style=`height:95dvh; padding:0; margin:0; 
              display:flex; flex-direction:column;
              padding:5px;`)

  #top(style=`display:flex; flex-direction:row`)
    #topLeft(style=`display:flex; flex-direction:column;
                    text-align:center;`) 
      #poster()
      #dates(style=`font-size:18px; min-height:24px;
                    margin-top:10px; font-weight:bold;`)
        | {{dates}}
      #seasons(@click="openMap(show)"
                style=`cursor:pointer; 
                       font-size:20px; min-height:24px;
                       font-weight:bold; font-color:gray;
                       text-align:center;`)
        | {{seasonsTxt}}
    #topRight(style=`display:flex; flex-direction:column`)
      #overview(style=`font-size:20px; padding:10px;`)
        | {{show.Overview}}        
</template>

<script>
import evtBus    from '../evtBus.js';
import * as tvdb from "../tvdb.js";
import * as emby from "../emby.js";

export default {
  name: "Episode",

  data() {
    return {
      show: {Name:''},
    }
  },
  
  methods: {
    openMap(show) {
      console.log('Series: openMap:', show);
      evtBus.emit('openMap', show);
    },

    async remoteClick(remote) {
      console.log('Series: remoteClick:', {remote});
      const url = remote.url;
      if(url) 
        openedTab = window.open(url, 'tv-series');
      //- else if(openedTab) {
      //-   window.close(openedTab);
      //-   openedTab = null;
      //- }
    },

    async setPoster() {
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
        // console.log('Series: trying srvr img:',  img.src);
      }
      const tryEmbyImg = () => {
        img.src = embyImages[imgIdx-srvrImages.length]; 
        // console.log('Series: trying emby img:',  img.src);
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
        // console.log('Series showing img:',  img.src);
        document.getElementById('poster').replaceChildren(img);
      };
      img.onerror = () => {
        // console.log('Series no img:', img.src);
        if(++imgIdx < srvrImages.length) {
          trySrvrImg();
        }
        else if(++imgIdx < srvrImages.length + 
                           embyImages.length) {
          tryEmbyImg();
        }
        else {
          img.src = 'https://hahnca.com/tv/no-image-icon-23485.png'; 
          // console.log( `Series default img: ` + img.src);
          return;
        }
      };
    },
  },

  /////////////////  MOUNTED  /////////////////

  mounted() {
    evtBus.on('setUpEpisode', async (show) => { 
      console.log('Episode: setUpEpisode:', show.Name);
      this.show = show;
      await this.setPoster();
    });
  },
}

</script>
