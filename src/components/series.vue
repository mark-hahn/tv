<template lang="pug">

#series(style=`height:95dvh; padding:0; margin:0; 
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
      #nextup(v-if="nextUpTxt.length > 0"
             @click="openMap(show)"
              style=`cursor:pointer; 
                      font-size:20px; min-height:24px;
                      font-weight:bold; font-color:gray;
                      text-align:center; margin-top:5px;`)
        | {{nextUpTxt}}
    #topRight(style=`display:flex; flex-direction:column`)
      #remotes(style=`width:200px; margin-left:20px;
                      display:flex; flex-direction:column;`) 
        div(style=`text-align:center; font-weight:bold;
                   margin-bottom:20px; font-size:20px;`) {{show.Name}}
        div(v-if="showSpinner")
          img(src="../../loading.gif"
              style=`width:100px; height:100px;
                     position:relative; top:20px; left:45px;`)
        #watchButton(v-if="watchButtonTxt.length > 0" 
            @click="watchButtonClick(show)"
            style=`margin:3px 10px; padding:10px; 
                   background-color:white; text-align:center;
                   border: 1px solid black; font-weight:bold;
                   cursor:default;`)
          | {{watchButtonTxt}}
        div( v-if="showRemotes" 
            v-for="remote in remotes"
            @click="remoteClick(remote)"
            style=`margin:3px 10px; padding:10px; 
                   background-color:white; text-align:center;
                   border: 1px solid black; font-weight:bold;
                   cursor:default;`)
          | {{remote.name}}

  #bot(style=`font-size:20px; padding:10px;`) {{show.Overview}}

</template>

<script>
import evtBus    from '../evtBus.js';
import * as tvdb from "../tvdb.js";
import * as emby from "../emby.js";

export default {
  name: "Series",

  data() {
    return {
      show: {Name:''},
      dates: '',
      remoteShowName: '',
      remotes: [],
      seasonsTxt: '',
      showSpinner: false,
      showRemotes: false,
      nextUpTxt: '',
      watchButtonTxt: '',
      episodeId: ''
    }
  },
  
  methods: {
    openMap(show) {
      // console.log('Series: openMap:', show);
      evtBus.emit('openMap', show);
    },

    async remoteClick(remote) {
      console.log('Series: remoteClick:', {remote});
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

    async setDates() {
      const show = this.show;
      const tvdbData = await tvdb.getTvdbData(show);
      if(!tvdbData) {
        console.error('Series: setDates: no tvdbData:', show);
        this.dates = '';
        return;
      }
      const {firstAired, lastAired, status} = tvdbData;
      this.dates = firstAired + ' -- ' + lastAired 
                      + ' (' + status + ')';
    },

    async setSeasonsTxt() {
      this.seasonsTxt = ``;
      const show = this.show;
      const {seasonCount, episodeCount, watchedCount} = 
                await emby.getEpisodeCounts(show);
      let seasonsTxt = '';
      switch (seasonCount) {
        case 0:  
          seasonsTxt = '';
          console.error('setSeasonsTxt no seasonCount', show.Name);
          break;
        case 1:  
          seasonsTxt = `1 Season`;
          break;
        default: 
          seasonsTxt = `${seasonCount} Seasons`;
      }
      const watchedTxt = (watchedCount == episodeCount) 
              ? ' (All Watched)' 
              :` (${watchedCount}/${episodeCount} Watched)`;
      this.seasonsTxt = seasonsTxt + watchedTxt
    },

    async setRemotes() {
      this.remoteShowName  = this.show.Name;
      this.showSpinner     = false;
      this.showRemotes     = false;
      let  delayingSpinner = true;
      this.remotes         = [];
      setTimeout(() => {
        if(delayingSpinner)
          this.showSpinner = true;
        delayingSpinner = false;
      }, 1000);
      try {
        const remCached = await tvdb.getRemotes(this.show);
        if (!remCached) {
          console.error('setRemotes: getRemotes null:', this.show.Name);
          return;
        }
        const [remotes] = remCached;
        this.remotes     = remotes;
        this.showSpinner = false;
        this.showRemotes = true;
        delayingSpinner  = false;
      } catch(err) {
        console.error('setRemotes:', err);
      }
    },

    async setNextWatch() {
      const fmtSE = (season, episode) => {
        return `S${(''+season) .padStart(2, "0")} ` +
               `E${(''+episode).padStart(2, "0")}`;
      }
      this.nextUpTxt      = '';
      this.watchButtonTxt = '';
      const watching = await emby.getCurrentlyWatching();
      if(watching === null) {
        const afterWatched = await emby.afterLastWatched(this.show.Id);
        const status = afterWatched.status;
        let seasonNumber, episodeNumber, episodeId;
        if(status !== 'allWatched') {
          ({seasonNumber, episodeNumber, episodeId} = afterWatched);
        }
        switch(status) {
          case 'ok': // next avail & haveFile
            this.episodeId = episodeId;
            this.watchButtonTxt = 
                    `Play ${fmtSE(seasonNumber, episodeNumber)}`;
            break;
          case 'missing':   // next avail & !haveFile
            this.nextUpTxt = 
                `Next Up: ${fmtSE(seasonNumber, episodeNumber)}` +
                              ' (File Missing)';
            break;
        }
      }
      else {
        this.watchButtonTxt = 'Stop';
      }
    },

    async watchButtonClick(show) {
      await emby.startStopRoku(show, this.episodeId);
      setTimeout(async () => {
        await this.setNextWatch();
      }, 1000);
    },
  },

  /////////////////  MOUNTED  /////////////////

  mounted() {
    evtBus.on('setUpSeries', async (show) => { 
      this.show = show;
      await this.setPoster();
      await this.setDates();
      await this.setRemotes();
      await this.setSeasonsTxt();
      await this.setNextWatch();
    });
    // evtBus.on('setNextWatch', async () => { 
    //   console.log('Series setNextWatch:', this.show.Name);
    //   await setNextWatch();
    // });
  },
}

</script>
