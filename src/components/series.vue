<template lang="pug">

#series(style=`height:95dvh; padding:0; margin:0; 
              display:flex; flex-direction:column;
              padding:5px;`)

  #hdr(style=`display:flex; justify-content:space-between; 
              font-weight:bold; font-size:25px;
              margin-bottom:20px; max-width:495px;`)
    div(style=`margin-left:20px; max-width:450px`) {{show.Name}}
    div(v-if="deletedTxt !== ''" style=`display:flex;`)
      div(style=`font-weight:bold; color:red; 
                  font-size:18px; max-height:24px;
                  margin-top:4px; margin-right:10px;`) {{deletedTxt}}
      button(@click="hideClick"
              style=`font-size:15px; max-height:24px;`) Hide
    div(v-else style=`display:flex;`)
      div(v-if="notInEmby" 
          style=`font-weight:bold; color:red; 
                  font-size:18px; margin-top:4px;
                  max-height:24px;`) Not in Emby
      button(@click="deleteClick"
              style=`font-size:15px; 
                    margin-left:20px; margin-top:3px;
                    max-height:24px;`) Delete

  #body(style=`display:flex;`)
    #topLeft(@click="openMap(show)"
              style=`display:flex; flex-direction:column;
                     text-align:center;`) 
      #poster()
      #dates(v-html="dates"
             v-if="dates.length > 0"
             style=`font-size:18px; min-height:24px;
                    margin-top:10px; font-weight:bold;
                    text-align:left;`)
      #seasons(v-html="seasonsTxt"
               v-if="seasonsTxt.length > 0"
               style=`cursor:pointer; 
                      font-size:18px; min-height:24px;
                      font-weight:bold; font-color:gray;
                      text-align:left;`)
      #cntrylang(v-if="cntryLangTxt.length > 0"
                 v-html="cntryLangTxt"
                 style=`cursor:pointer; 
                        font-size:18px; min-height:24px;
                        font-weight:bold; font-color:gray;
                        text-align:left;`)
      #nextup(v-if="nextUpTxt.length > 0"
              v-html="nextUpTxt"
              style=`cursor:pointer; 
                      font-size:18px; min-height:24px;
                      font-weight:bold; font-color:gray;
                      text-align:left; margin-top:5px;`)
    #topRight(style=`display:flex; flex-direction:column`)
      #remotes(style=`width:200px; margin-left:20px;
                      display:flex; flex-direction:column;`) 
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
import * as srvr from "../srvr.js";

let windowId = null;
let windowLabel = Math.random();

export default {
  name: "Series",

  data() {
    return {
      show: {Name:''},
      dates: '',
      remoteShowName: '',
      remotes: [],
      seasonsTxt: '',
      cntryLangTxt: '',
      showSpinner: false,
      showRemotes: false,
      nextUpTxt: '',
      watchButtonTxt: '',
      episodeId: '',
      deletedTxt: '',
      notInEmby: false,
    }
  },
  
  methods: {
    openMap(show) {
      if(show.Id.startsWith('noemby-')) return;
      // console.log('Series: openMap:', show);
      evtBus.emit('openMap', show);
    },

    async deleteClick() {
      console.log('Series, deleteClick:', this.show.Name);
      evtBus.emit('deleteShow', this.show);
    },

    async hideClick() {
      //- console.log('Series, hideClick:', this.show.Name);
      evtBus.emit('deleteRow', this.show);
    },

    async remoteClick(remote) {
      console.log('Series: remoteClick:', {remote});
      const url = remote.url;
      if(!url) return
      if(windowId !== null) {
        setTimeout(() => {
          windowId.close();
          windowId = null;
        }, 500);
      }
      setTimeout(()=> {
        windowId = window.open(url, windowLabel);
      }, 1000);
    },

    async setDeleted(tvdbShowData) {
      const deleted = !!tvdbShowData.deleted;
      //- console.log('series, setDeleted:', {deleted, noEmby})
      if(deleted) this.deletedTxt = 'Deleted ' + 
                       tvdbShowData.deleted;
      else        this.deletedTxt = '';
      this.notInEmby  = this.show.Id.startsWith('noemby-');
    },

    async setPoster(tvdbShowData) {
      const img = new Image();
      img.style.maxWidth  = "300px"; 
      img.style.maxHeight = "400px"; 
      if(!tvdbShowData) {
        console.error('setPoster: tvdbShowData missing');
        img.src = './question-mark.png';
        return;
      }
      if(tvdbShowData.image) {
        img.src = tvdbShowData.image;
      } else {
        console.error('image missing from tvdbShowData',
                       tvdbShowData.name);
        img.src = './question-mark.png';
      }
      document.getElementById('poster').replaceChildren(img);
    },

    async setDates(tvdbShowData) {
      const show = this.show;
      const {firstAired, lastAired, status} = tvdbShowData;
      this.dates = ' &nbsp; ' + firstAired + 
                    '&nbsp; ' + lastAired +
                   ' &nbsp; ' + status;
    },

    async setSeasonsTxt(tvdbShowData) {
      this.seasonsTxt = ``;
      if(this.show.Id.startsWith('noemby-')) return;
      const show = this.show;
      const {seasonCount, episodeCount, 
             watchedCount} = tvdbShowData;
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
      const watchedTxt = (episodeCount > 0  &&
                          watchedCount == episodeCount) 
              ? ' &nbsp; All Watched' 
              :`  &nbsp; ${watchedCount}/${episodeCount} Watched`;
      if(!seasonsTxt) return;
      this.seasonsTxt = ' &nbsp; ' + seasonsTxt + watchedTxt;
    },

    async setCntryLangTxt(tvdbShowData) {
      this.cntryLangTxt = ``;
      let {originalCountry, originalLanguage, 
           averageRuntime,
           originalNetwork} = tvdbShowData;
           
      if(originalCountry == 'gbr') originalCountry = 'UK';

      const longNets = ['Amazon', 'Paramount+'];
      longNets.forEach((net) => {
        if(originalNetwork.includes(net))
          originalNetwork = net;
      });
      originalNetwork = originalNetwork.substr(0, 10);

      this.cntryLangTxt = 
        ` &nbsp; ${originalCountry.toUpperCase()} / ` +
                `${originalLanguage.toUpperCase()}`   +
        ` &nbsp; ${originalNetwork}`    +
        ` &nbsp; ${averageRuntime 
                  ? ' ' + averageRuntime + ' mins'
                  : ''}` 
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
                ` &nbsp; Next Up: ${fmtSE(seasonNumber, episodeNumber)}` +
                              ' &nbsp; File Missing';
            break;
          case 'unaired':   // next avail & !haveFile
            this.nextUpTxt = 
                ` &nbsp; Next Up: ${fmtSE(seasonNumber, episodeNumber)}` +
                              ' &nbsp; Unaired';
            break;
        }
      }
      else {
        this.watchButtonTxt = 'Stop';
      }
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
      const tvdbShowData = await tvdb.getTvdbData(show);
      await this.setDeleted(tvdbShowData);
      await this.setPoster(tvdbShowData);
      await this.setDates(tvdbShowData);
      await this.setSeasonsTxt(tvdbShowData);
      await this.setCntryLangTxt(tvdbShowData);
      await this.setNextWatch();
      await this.setRemotes();
    });
  },
}

</script>
