<template lang="pug">

#series(@click="handleSeriesClick" :style="{ height:'100%', padding:'5px', margin:0, display:'flex', flexDirection:'column', overflowY:'auto', maxWidth:'100%', width: sizing.seriesWidth || 'auto' }")

  #hdr(v-if="showHdr"
       :style="{ display:'flex', justifyContent:'space-between', fontWeight:'bold', fontSize: sizing.seriesFontSize || '25px', marginBottom:'20px', maxWidth:'565px' }")
    div(style="margin-left:20px; max-width:450px") {{show.Name}}
    
    div(v-if="simpleMode" style="display:flex; gap:4px;")
      textarea(
              v-model="emailText"
              @click.stop
              rows="2"
              placeholder="Email note..."
              :style="{ marginLeft:'165px', width: sizing.emailWidth || '200px', padding:'5px', fontSize:'14px', border:'1.5px solid black', backgroundColor:'#eee', resize:'none' }")
      
      div(v-if="notInEmby" 
          style="font-weight:bold; color:red; font-size:18px; margin-top:4px; max-height:24px; white-space:nowrap;") Not In Emby
    
    div(v-if="!simpleMode && notInEmby" 
        style="font-weight:bold; color:red; font-size:18px; margin-top:4px; max-height:24px;") Not In Emby
                
    div(v-if="show?.Reject" 
        style="font-weight:bold; color:red; font-size:18px; margin-top:4px; max-height:24px;") Banned From Download
                
    button(v-if="!simpleMode"
            @click.stop="deleteClick"
            style="font-size:15px; cursor:pointer; margin-left:20px; margin-top:3px; max-height:24px; border-radius: 7px;") Delete
  #body(style="display:flex; cursor:pointer;")
    #topLeft(@click.stop="handleBodyClick"
              style="display:flex; flex-direction:column; text-align:center;") 
      #poster(style="margin-left:20px;")  
    #topRight(style="display:flex; flex-direction:column; width:300px; margin-left:10px;")
      #infoBox(@click.stop="handleBodyClick"
                :style="{ margin:'0 0 7px 12px', width: sizing.seriesInfoWidth || '250px', fontSize: sizing.seriesInfoFontSize || '17px', display:'flex', flexDirection:'column', border:'2px solid gray', textAlign:'center', fontWeight:'bold' }")
        #dates(v-html="dates"
               v-if="dates.length > 0"
               style="min-height:24px; margin-top:10px;")
        #seasons(v-html="seasonsTxt"
                 v-if="seasonsTxt.length > 0"
                 style="min-height:24px;")
        #cntrylang(v-if="cntryLangTxt.length > 0"
                   v-html="cntryLangTxt"
                   style="min-height:20px; font-size:16px;")
        #nextup(v-if="nextUpTxt.length > 0"
                v-html="nextUpTxt"
                style="min-height:32px;")

      #remotes(:style="{ width: sizing.remotesWidth || '260px', margin:'5px 0 0 10px', justifyContent:'space-between', display:'flex', flexWrap:'wrap' }") 
        div(v-if="showSpinner")
          img(src="../../loading.gif"
              style="width:100px; height:100px; position:relative; top:20px; left:45px;")
        div(v-if="showRemotes" 
            v-for="remote in remotes"
            @click.stop="remoteClick(remote)"
            :style="{ margin:'5px 5px', padding: sizing.remoteButtonPadding || '10px', backgroundColor:'#eee', borderRadius:'7px', textAlign:'center', border:'1px solid black', fontWeight:'bold', fontSize: sizing.remoteFontSize || 'inherit' }")
          | {{remote.name}}
      #buttons(style="display:flex; flex-wrap:wrap; margin-top:15px; width:280px; justify-content:space-around;")
        #watchButton(v-for="watchButtonTxt in watchButtonTxtArr"
            @click.stop="watchButtonClick(show, watchButtonTxt)"
            :style="{ margin:'5px 10px 10px 7px', borderRadius:'10px', padding: sizing.watchButtonPadding || '3px', maxWidth:'110px', backgroundColor:'#eee', textAlign:'center', border:'1px solid black', fontWeight:'bold', fontSize: sizing.watchButtonFontSize || 'inherit' }")
          | {{watchButtonTxt}}
  #bot(:style="{ fontSize: sizing.overviewFontSize || '20px', padding:'10px' }") {{show.Overview}}

</template>

<script>
import evtBus    from '../evtBus.js';
import * as tvdb from "../tvdb.js";
import * as emby from "../emby.js";
import * as srvr from "../srvr.js";

let allTvdb = null;
let windowId = null;
let windowLabel = Math.random();

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
      
      // Open map when clicking anywhere in series pane
      // .stop modifiers on buttons prevent their clicks from reaching here
      this.openMap(this.show);
    },

    openMap(show) {
      if(show.Id.startsWith('noemby-')) return;
      // console.log('Series: openMap:', show);
      evtBus.emit('openMap', show);
    },

    deleteClick() {
      console.log('Series, deleteClick:', this.show.Name);
      evtBus.emit('deleteShow', this.show);
    },

    remoteClick(remote) {
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
      const origCountry  = originalCountry?.toUpperCase()  ?? '';
      const origLanguage = originalLanguage?.toUpperCase() ?? '';
      const OrigNetwork  = originalNetwork?.toUpperCase()  ?? '';
      const avgRuntime   = averageRuntime?.toString().toUpperCase();
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
      const tvdbData = allTvdb[show.Name];
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