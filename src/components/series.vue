<template lang="pug">

#series(@click="handleSeriesClick" :style="{ height:'100%', padding:'5px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', overflowX:'hidden', maxWidth:'100%', width: sizing.seriesWidth || 'auto', boxSizing:'border-box' }")

  #hdr(v-if="showHdr"
       :style="{ display:'flex', justifyContent:'space-between', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'2px' }")
    div(style="margin-left:20px; flex:1;") {{show.Name}}
    
    div(v-if="simpleMode" style="display:flex; gap:4px;")
      textarea(
              v-model="emailText"
              @click.stop
              rows="1"
              placeholder="Email Mark"
              :style="{ width: sizing.emailWidth || '200px', padding:'5px', fontSize:'14px', border:'1.5px solid black', backgroundColor:'#eee', resize:'none' }")
      
      div(v-if="notInEmby" 
          style="font-weight:bold; color:red; font-size:18px; margin-top:4px; max-height:24px; white-space:nowrap;") Not In Emby
    
    div(v-if="!simpleMode && notInEmby" 
        style="font-weight:bold; color:red; font-size:18px; margin-top:4px; max-height:24px;") Not In Emby
                
    div(v-if="show?.Reject" 
        style="font-weight:bold; color:red; font-size:18px; margin-top:4px; max-height:24px;") Banned From Download
                
    button(v-if="!simpleMode && !notInEmby"
            @click.stop="torrentsClick"
            style="font-size:15px; cursor:pointer; margin-left:20px; margin-top:3px; max-height:24px; border-radius: 7px;") Torrents
    button(v-if="!simpleMode"
            @click.stop="deleteClick"
            style="font-size:15px; cursor:pointer; margin-left:10px; margin-top:3px; max-height:24px; border-radius: 7px;") Delete
  #body(style="display:flex; cursor:pointer;")
    #topLeft(@click.stop="handleBodyClick"
              style="display:flex; flex-direction:column; text-align:center;") 
      #poster(style="margin-left:30px;")  
    #topRight(style="display:flex; flex-direction:column; width:300px; margin-left:10px;")
      #infoBox(@click.stop="handleBodyClick"
                :style="{ margin:'30px 0 7px 2px', width: sizing.seriesInfoWidth || '250px', fontSize: sizing.seriesInfoFontSize || '17px', lineHeight: sizing.infoBoxLineHeight || '1.2', display:'flex', flexDirection:'column',textAlign:'center', fontWeight:'bold' }")
        #dates(v-html="dates"
               v-if="dates.length > 0"
               style="min-height:24px; margin-top:10px;")
        #seasons(v-html="seasonsTxt"
                 v-if="seasonsTxt.length > 0"
                 style="min-height:24px;")
        #cntrylang(v-if="cntryLangTxt.length > 0"
                   v-html="cntryLangTxt"
                   style="min-height:20px;")
        #nextup(v-if="nextUpTxt.length > 0"
                v-html="nextUpTxt"
                style="min-height:32px;")
        #collection(v-if="collectionName"
                    style="min-height:24px;")
          | Collection: {{collectionName}}

  #allButtons(style="display:flex; flex-wrap:wrap; margin-top:15px; padding:0 10px; justify-content:space-around; width:100%;")
    div(v-if="showSpinner")
      img(src="../../loading.gif"
          style="width:100px; height:100px; position:relative; top:20px; left:45px;")
    div(v-if="showRemotes" 
        v-for="remote in remotes"
        @click.stop="remoteClick(remote)"
        :style="{ margin:'5px 5px', padding: sizing.remoteButtonPadding || '10px', backgroundColor:'#eee', borderRadius:'7px', textAlign:'center', border:'1px solid black', fontWeight:'bold', fontSize: sizing.remoteFontSize || 'inherit' }")
      | {{remote.name}}
  
  #bot(:style="{ fontSize: sizing.overviewFontSize || '20px', padding:'10px' }") {{show.Overview}}

</template>

<script>
import evtBus from '../evtBus.js';
import * as tvdb from "../tvdb.js";
import * as emby from "../emby.js";
import * as srvr from "../srvr.js";

let allTvdb = null;

export default {
  name: "Series",

  props: {
    simpleMode: {
      type: Boolean,
      default: false
    },
    sizing: {
      type: Object,
      default: () => ({})
    }
  },

  data() {
    return {
      show: {Name:''},
      showHdr: false,
      emailText: '',
      dates: '',
      remoteShowName: '',
      remotes: [],
      seasonsTxt: '',
      cntryLangTxt: '',
      subs: '',
      subsActive:  false,
      showSpinner: false,
      showRemotes: false,
      nextUpTxt: '',
      watchButtonTxtArr: [],
      episodeId: '',
      deletedTxt: '',
      notInEmby: false,
      collectionName: '',
      currentTvdbData: null
    }
  },
  
  methods: {

    async sendEmail() {
      if (!this.emailText.trim() || this.emailText === 'Email Sent') return;
      
      const textToSend = this.show.Name + '~' + this.emailText;
      
      try {
        await srvr.sendEmail(textToSend);
        console.log('Email sent to server:', textToSend);
        this.emailText = 'Email Sent';
      } catch (error) {
        console.error('Failed to send email:', error);
      }
    },

    async handleBodyClick() {
      // If there's text in the email box, send it instead of opening map
      if (this.simpleMode && this.emailText.trim() && this.emailText !== 'Email Sent') {
        await this.sendEmail();
        return;
      }
      
      // Otherwise open the map
      this.openMap(this.show);
    },

    async handleSeriesClick() {
      // If there's text in the email box, send it instead of opening map
      if (this.simpleMode && this.emailText.trim() && this.emailText !== 'Email Sent') {
        await this.sendEmail();
        return;
      }
      
      // Rotate panes: if coming from map, go to actors; otherwise go to map
      // Check if we should go to actors (this will be after map is shown)
      // For now, just open map - the map will handle going to actors
      this.openMap(this.show);
    },

    openMap(show) {
      console.log('Series: openMap called with show:', show?.Name);
      if (!show || !show.Name) {
        console.log('Series: No show to open map for');
        return;
      }
      evtBus.emit('openMap', show);
    },

    deleteClick() {
      console.log('Series, deleteClick:', this.show.Name);
      evtBus.emit('deleteShow', this.show);
    },

    torrentsClick() {
      evtBus.emit('showTorrentsPane', this.show);
    },

    remoteClick(remote) {
      const url = remote.url;
      if(url) window.open(url);
    },

    setDeleted(tvdbData) {
      const deleted = !!tvdbData?.deleted;
      // console.log('series, setDeleted:', deleted)
      if(deleted) this.deletedTxt = 'Deleted ' + tvdbData.deleted;
      else        this.deletedTxt = '';
      this.notInEmby = this.show.Id.startsWith('noemby-');
    },

    setPoster(tvdbData) {
      const img = new Image();
      img.style.maxWidth  = this.sizing.posterWidth || "300px"; 
      img.style.maxHeight = this.sizing.posterHeight || "400px"; 
      if(!tvdbData) {
        console.error('setPoster: tvdbData missing');
        img.src = './question-mark.png';
        return;
      }
      if(tvdbData.image) {
        img.src = tvdbData.image;
      } else {
        console.error(
              'image missing from tvdbData', tvdbData.name);
        img.src = './question-mark.png';
      }
      const posterEl = document.getElementById('poster');
      if (posterEl) {
        posterEl.replaceChildren(img);
      }
    },

    setDates(tvdbData) {
      const show = this.show;
      const {firstAired, lastAired, status} = tvdbData;
      this.dates = ' &nbsp; ' + firstAired + 
                    '&nbsp; ' + lastAired +
                   ' &nbsp; ' + status;
    },

    async setSeasonsTxt(tvdbData) {
      if(!(tvdbData instanceof Object)) {
        console.error('setSeasonsTxt, tvdbData:', 
                       name, {tvdbData});
        return;
      }
      this.seasonsTxt = "";
      const show = this.show;
      const name = show.Name;
      if(!this.show.Id.startsWith('noemby-')) {
        const epiCounts = await emby.getEpisodeCounts(show);
        Object.assign(tvdbData, epiCounts);
        const fields = Object.assign({name}, epiCounts);
        tvdbData = await srvr.setTvdbFields(fields);
      }
      allTvdb[name] = tvdbData;
      let seasonsTxt;
      const {episodeCount, seasonCount, watchedCount} = tvdbData;
      switch (seasonCount) {
        case 0:  
          console.error('setSeasonsTxt, no seasonCount:', name);
          return;
        case 1:  seasonsTxt = "1 Season"; break;
        default: seasonsTxt = `${seasonCount} Seasons`;
      }
      const watchedTxt = (episodeCount > 0  &&
                          watchedCount == episodeCount) 
              ? ` &nbsp; &nbsp; Watched All ${episodeCount}` 
              :`  &nbsp  
                  Watched ${watchedCount} of ${episodeCount}`;
      this.seasonsTxt = ' &nbsp; ' + seasonsTxt + watchedTxt;
    },

    setCntryLangTxt(tvdbData) {
      this.cntryLangTxt = ``;
      let {originalCountry, originalLanguage, 
           averageRuntime,  originalNetwork} = tvdbData;

      const longNets = ['Amazon', 'Paramount+'];
      longNets.forEach((net) => {
        if(originalNetwork.includes(net))
          originalNetwork = net;
      });
      if(originalCountry == 'gbr') originalCountry = 'UK';
      originalNetwork    = originalNetwork.substr(0, 10); 
      const origCountry  = originalCountry?.toLowerCase()  ?? '';
      const origLanguage = originalLanguage?.toLowerCase() ?? '';
      const OrigNetwork  = originalNetwork?.toLowerCase()  ?? '';
      const avgRuntime   = averageRuntime?.toString().toLowerCase();
      this.cntryLangTxt = 
                `${origCountry}`                      +
                `${origCountry != '' ? '/' : ''}`     +
                `${origLanguage} ${OrigNetwork}&nbsp;`+
                `${avgRuntime !== undefined
                      ? ' ' + avgRuntime + ' Mins' : ''}` 
    },

  async setNextWatch() {
      const afterWatched = await emby.afterLastWatched(this.show.Id);
      const status       = afterWatched.status;
      const readyToWatch = (status === 'ok');
      if(!this.show.Id.startsWith('noemby') && status !== 'allWatched') {
        const {seasonNumber, episodeNumber, episodeId} = afterWatched;
        const seaEpiTxt = `S${(''+seasonNumber) .padStart(2, "0")} ` +
                          `E${(''+episodeNumber).padStart(2, "0")}`;
        if (readyToWatch) {
          this.episodeId = episodeId;
          this.nextUpTxt = ` &nbsp; Next Up: ${seaEpiTxt}`;
        }
        else this.nextUpTxt = ` 
                &nbsp; Next Up: ${seaEpiTxt} 
                &nbsp; ${status === 'missing' ? 'No File' : 'Unaired'}`;
      }
      else this.nextUpTxt = '';
      const watchButtonTxtArr = [];
      const devices = await srvr.getDevices();
      for(const device of devices) {
        if(!device.showName) {
          if(readyToWatch)
            watchButtonTxtArr.push(`Play on ${device.deviceName}`);
        }
        else watchButtonTxtArr.push(`Stop ${device.deviceName}`);
      }
      this.watchButtonTxtArr = watchButtonTxtArr.sort();
    },

    setRemotes() {
      this.remoteShowName  = this.show.Name;
      this.showSpinner     = false;
      this.showRemotes     = false;
      let  delayingSpinner = true;
      this.remotes         = [];
      setTimeout(() => {
        if(delayingSpinner) this.showSpinner = true;
        delayingSpinner = false;
      }, 1000);
      try {
        const remotes = allTvdb[this.show.Name]?.remotes;
        if (!remotes) {
          console.error('setRemotes: no allTvdb:', this.show.Name);
          this.showSpinner = false;
          this.showRemotes = false;
          delayingSpinner  = false;
          return;
        }
        this.remotes     = remotes;
        this.showSpinner = false;
        this.showRemotes = true;
        delayingSpinner  = false;
      } catch(err) {
        console.error('setRemotes:', err);
      }
    },

    async watchButtonClick(show, watchButtonTxt) {
      await emby.startStop(show, this.episodeId, watchButtonTxt);
      setTimeout(async () => {
        await this.setNextWatch();
      }, 1000);
    },
  },

  /////////////////  MOUNTED  /////////////////
  // series vue component at mounted phase
  // set everything in html
  mounted() {
    evtBus.on('setUpSeries', async (show) => { 
      allTvdb        = await tvdb.getAllTvdb();
      this.emailText = ''; // Clear email text when changing shows
      this.show      = show;
      this.showBody  = true;
      
      // Set collection name(s)
      const collections = [];
      if (show.InToTry) collections.push('To Try');
      if (show.InContinue) collections.push('Continue');
      if (show.InMark) collections.push('Mark');
      if (show.InLinda) collections.push('Linda');
      if (show.IsFavorite) collections.push('Favorite');
      this.collectionName = collections.join(', ');
      
      const tvdbData = allTvdb[show.Name];
      this.currentTvdbData = tvdbData; // Store for actors pane
      evtBus.emit('tvdbDataReady', tvdbData); // Send to App.vue
      await this.setDeleted(tvdbData);
      await this.setPoster(tvdbData);
      await this.setDates(tvdbData);
      await this.setSeasonsTxt(tvdbData);
      await this.setCntryLangTxt(tvdbData);
      await this.setNextWatch();
      await this.setRemotes();
    });

    setTimeout(() => {
      this.showHdr = true;
    }, 1000);
  },
}
</script>

<style>
  button {
    cursor:pointer;
  }
</style>