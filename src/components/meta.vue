<template lang="pug">

#meta(style=`height:95dvh; padding:0; margin:0; 
              display:flex; flex-direction:column;
              padding:5px;`)

  #top(style=`display:flex; flex-direction:row`)
    #topLeft(style=`display:flex; flex-direction:column;
                    text-align:center;`) 
      #poster()
      #dates(style=`font-size:18px; min-height:24px;
                    margin:10px; font-weight:bold;`)
        | {{dates}}
    #topRight(style=`display:flex; flex-direction:column`)
      #remotes(style=`width:200px; margin-left:20px;
                      display:flex; flex-direction:column;`) 
        div(style=`text-align:center; font-weight:bold;
                   margin-bottom:20px; font-size:20px;`) {{show.Name}}
        div( v-if="remotes[0] !== 1" 
            v-for="remote in remotes"
            @click="remoteClick(remote)"
            style=`margin:3px 10px; padding:10px; 
                   background-color:white; text-align:center;
                   border: 1px solid black; font-weight:bold;
                   cursor:default;`)
          | {{remote.name}}
        div(v-if="remotes[0] === 1")
          img(src="../../loading.gif"
              style=`width:100px; height:100px;
                     position:relative; top:20px; left:45px;`)

  #bot(style=`font-size:20px; padding:10px;`) {{show.Overview}}

</template>

<script>
import evtBus from '../evtBus.js';
import * as urls from "../urls.js";
import * as tvdb from "../tvdb.js";

export default {
  name: "Meta",
  data() {
    return {
      show: {Name:''},
      dates: '',
      remoteShowName: '',
      remotes: [],
    }
  },
  
  methods: {

    async remoteClick(remote) {
      console.log('Meta: remoteClick:', {remote});
      const url = remote.url;
      if(url) window.open(url, 'tv-series');
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
        // console.log('Meta: trying srvr img:',  img.src);
      };
      const tryEmbyImg = () => {
        img.src = embyImages[imgIdx-srvrImages.length]; 
        // console.log('Meta: trying emby img:',  img.src);
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
        // console.log('Meta showing img:',  img.src);
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
          img.src = 'https://hahnca.com/tv/no-image-icon-23485.png'; 
          // console.log( `Meta default img: ` + img.src);
          return;
        }
      };
    },

    async setDates() {
      const fmt = (date) => {
        if(!date) return '';
        const d = new Date(date);
        return (d.getMonth()+1) + '/' +
                d.getDate() + '/'     + 
                d.getFullYear();
      };
      const show = this.show;
      const tvdbData = 
          await tvdb.getTvdbData(show);
      if(!tvdbData) {
        console.error('Meta: setDates: no tvdbData:', show);
        this.dates = '';
        return;
      }
      const {firstAired, lastAired, status} = tvdbData;
      this.dates = fmt(firstAired) + ' -- ' + 
                    fmt(lastAired) + ' (' + status + ')';
    },

    async setRemotes() {
      this.remoteShowName = this.show.Name;
      try {
        this.remotes    = [1];
        const [remotes] = await tvdb.getRemotes(this.show);
        if(!remotes) this.remotes = [];
        else         this.remotes = remotes;
      } catch(err) {
        console.error('setRemotes:', err);
      }
    },
  },

  async mounted() {
    evtBus.on('showSelected', async (show) => { 
      this.remotes[0] = 1;
      console.log('Meta: showSelected:', show.Name);
      this.show = show;
      await this.setPoster();
      await this.setDates();
      await this.setRemotes();
    });
  },
    
};

</script>
