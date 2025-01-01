<template lang="pug">

#list(style=`height:95dvh; 
                 padding:0; margin:0;
                 display:flex; flex-direction:column;
                 align-items:center;`)
  #center(style=`height:100%; width:800px;
                 display:flex; flex-direction:column;`)             
    #hdr(style=`width:100%; background-color:#ccc;
                display:flex; flex-direction:column;`)

      #hdrtop(style=`width:100%; display:flex;
                    flex-direction:row; justify-content:space-between;`)
        button(@click="showAll" 
                style=`margin-left:10px; margin-right:5px;
                       fontSize:15px; margin:4px;
                       background-color:white;`) All
        #srch(style=`margin-top:3px;`)
          input(v-model="searchStr" 
                @input="select"
                  style="border:1px solid black; width:100px;")
          button(@click="select" 
                  style="margin-left:1px;")
            font-awesome-icon(icon="search")
        button(@click="topClick" 
                style=`margin-left:10px; margin-right:5px;
                      fontSize:15px; margin:4px;
                      background-color:white;`) Top
        #err(@click="errClick" 
              style=`flex-grow:1; display:inline-block; 
                    font-size:20px; color:red;
                    cursor:default; height:20px;`) {{errMsg}}

      #hdrbottom(style=`width:100%; background-color:#ccc; 
                        display:flex; justify-content:space-between;
                        margin-top:5px; margin-bottom:5px;`)
          #botlft(style=`overflow:hidden;
                        display:flex; justify-content:space-between;`)
            #nums(style=`background-color:#ccc; 
                          display:flex; justify-content:space-around;`)
              #count(style="display:inline-block; margin:4px 5px 4px 15px;") 
                | {{shows.length + '/' + allShowsLength}}
              #prog(style=`display:inline-block; 
                          margin:4px 10px 4px 5px;`) 
                | {{gapPercent+'%'}}

            #sorts(style=`display:inline-block;
                          display:flex; justify-content:space-between;`)
              button(@click='sortClickAdded' 
                      :style=`{display:'inlineBlock', 
                              fontSize:'15px', margin:'4px', 
                              backgroundColor: 
                                sortByNew ? 'yellow' : 'white'}`) Added
              button(@click='sortClickActivity' 
                    :style=`{display:'inlineBlock', 
                              fontSize:'15px', margin:'4px', 
                              backgroundColor: 
                                sortByActivity ? 'yellow' : 'white'}`) Active
              button(@click='sortClickSize' 
                    :style=`{display:'inlineBlock', 
                              fontSize:'15px', margin:'4px', 
                              backgroundColor: 
                                sortBySize ? 'yellow' : 'white'}`) Size

            button(@click="addClick" 
                    style=`display:inline-block'; 
                          font-size:15px; margin:4px 4px 4px 20px;backgroundColor:white`) Add

          #botrgt(style=`display:flex; justify-content:space-between;
                         margin: 5px 17px 0 0;`)
            #fltr(v-for="cond in conds"
                @click="condFltrClick(cond)"
                :style=`{width:'1.435em', textAlign:'center',
                         display:'inline-block', 
                         color:condFltrColor(cond)}`)
              font-awesome-icon(:icon="cond.icon"
                               :style="{}")
  
    #shows(style="width:100%; flex-grow: 1; overflow-y:scroll;")
      table(style="width:100%; font-size:18px")
       tbody
        tr(v-for="show in shows" key="show.Id" 
              style="outline:thin solid; cursor:default" 
             :id="nameHash(show.Name)")
          td(style="width:30px; text-align:center;"
            @click="copyNameToClipboard(show)")
            font-awesome-icon(icon="copy" style="color:#ccc")
          td(style="width:30px; text-align:center;" )
            div(v-show="!show.Id.startsWith('noemby-')" 
                  @click="seriesMapAction('open', show)")
              font-awesome-icon(icon="border-all" style="color:#ccc")

          td(@click="rowClick(show)"
               v-if="sortByNew" 
             :style=`{width:'80px', fontSize:'16px',
                      backgroundColor: hilite(show),
                      cursor:'default'}`) 
            | {{ show.DateCreated }}
            
          td(@click="rowClick(show)"
               v-if="sortByActivity" 
             :style=`{width:'80px', fontSize:'16px',
                      backgroundColor: hilite(show),
                      cursor:'default'}`) 
            | {{ show.Date }}

          td(@click="rowClick(show)"
             v-if="sortBySize" 
             :style=`{width:'80px', fontSize:'16px', 
                      textAlign:'center',
                      backgroundColor: hilite(show), 
                      cursor:'default'}`) 
            | {{ formatSize(show) }}

          td(:style=`{display:'flex', justifyContent:'space-between',
                      padding:'5px', backgroundColor: hilite(show)}`)

            div(style=`padding:2px; 
                        fontSize:16px; font-weight:bold;` 
               @click="rowClick(show)"
            ) {{show.Name}} 

            div(style=`padding:2px; flex-grow:1;
                        fontSize:16px; font-weight:bold;` 
               @click="rowClick(show)"
            )

            div(v-if="show.WaitStr?.length" 
                @click="waitStrClick(show)"
                style="padding:2px; color: #00f; fontSize:16px;") 
              |  {{show.WaitStr}}

          td( v-for="cond in conds" 
                style="width:22px; text-align:center;"
               @click="cond.click(show)" )
            font-awesome-icon(:icon="cond.icon"
                :style="{color:condColor(show,cond)}")

  #remotes(v-if="remotes.length" 
        style=`width:200px; background-color:#eee; padding:20px;
               border: 1px solid black; position: fixed; 
               left: 41%; top: 150px;
               display:flex; flex-direction:column;`) 
    div(style=`text-align:center;
               margin-bottom:12px; font-weight:bold;`) 
      | {{remoteShowName}}
    div( v-if="remotes[0] !== 1" 
         v-for="remote in remotes"
            style=`margin:3px 10px; padding:10px; 
                  background-color:white; text-align:center;
                  border: 1px solid black; font-weight:bold;
                  cursor:default;`
          @click="remotesAction('click', remote)") 
      | {{remote.name}}

  #map(v-if="mapShow !== null" 
        style=`background-color:#eee; padding:10px;
               display:flex; flex-direction:column;`)
    div(style=`margin:0 5px; display:flex; 
                justify-content:space-between;`)
      div(style=`font-size:20px; margin:6px 20px 0 0;
                 font-weight:bold; flex-grow:4;`)
        | {{mapShow.Name}}
      button(@click="seriesMapAction('prune', mapShow)"
             style="margin:5px;")                     Prune
      button(@click="seriesMapAction('date',  mapShow)"
             style="margin:5px;")                     Set Date
      button(@click="seriesMapAction('close')"
             style="margin:5px;")                     Close

    div(v-if=`mapShow.WatchGap ||
              mapShow.Missing  || mapShow.WaitStr?.length`
        style=`display:flex; justify-content:space-around; 
               color:red; margin: 0 10px; 4px 10px;`)
      div(v-if="mapShow.WatchGap" 
          style="display:inline-block;")
        | {{`Watch Gap`}}
      div(v-if="mapShow.Missing"
          style="display:inline-block; margin 3px 10px")
        | {{`Missing File`}}
      div(v-if="mapShow.Waiting" 
          style="display:inline-block; margin 3px 10px")
        | {{'Waiting ' + mapShow.WaitStr}}

    table(style="padding:0 5px; font-size:16px" )
     tbody
      tr(style="font-weight:bold;")
        td
        td(v-for="episode in seriesMapEpis" 
           style="text-align:center;"
           key="episode") {{episode}}
      tr(v-for="season in seriesMapSeasons" key="season"
                style="outline:thin solid;")
        td(style="font-weight:bold; width:10px; text-align:center;")
          | {{season}}

        td(v-for="episode in seriesMapEpis" key="series+'.'+episode" 
            @click="episodeClick($event, mapShow, season, episode)"
            :style=`{cursor:'default', width:'10px',
                     textAlign:'center', 
                     backgroundColor:  
                      (seriesMap[season]?.[episode]?.error) 
                          ? 'yellow': 
                      (seriesMap[season]?.[episode]?.noFile) 
                          ? '#faa' : 'white'}`)
          span(v-if="seriesMap?.[season]?.[episode]?.played")  w
          span(v-if="seriesMap?.[season]?.[episode]?.avail")   +
          span(v-if="seriesMap?.[season]?.[episode]?.noFile")  -
          span(v-if="seriesMap?.[season]?.[episode]?.unaired") u
          span(v-if="seriesMap?.[season]?.[episode]?.deleted") d
</template>


<script>
import * as emby from "../emby.js";
import * as tvdb from "../tvdb.js";
import * as urls from "../urls.js";
import * as srvr from "../srvr.js";
import * as util from "../util.js";
import    evtBus from '../evtBus.js';

import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { library }         from "@fortawesome/fontawesome-svg-core";
import { faLaughBeam, faSadCry, faHeart, faClock } 
                           from "@fortawesome/free-regular-svg-icons"; 
import { faCheck, faPlus, faMinus, faArrowDown, faArrowRight,
         faTv, faSearch, faQuestion, faCopy, faBorderAll, faBan,
         faMars, faVenus} 
                           from "@fortawesome/free-solid-svg-icons";

library.add([  
  faLaughBeam, faSadCry, faClock, faHeart, faCheck, faPlus, 
  faMinus, faArrowDown, faTv, faSearch, faQuestion, faCopy, 
  faBan, faBorderAll, faArrowRight, faMars, faVenus, faClock]);

let   allShows         = [];
let   blockedWaitShows = null;
let   showErr          = null;
const errFifo          = [];
let   openedWindow     = null;

export default {
  name: "List",
  components: { FontAwesomeIcon },
  data() {

    const toggleWaiting = async (show) => {
      // console.log("toggleWaiting", show.Name);
      this.saveVisShow(show);

      if(show.Waiting) {
        show.Waiting = false;
        srvr.addBlockedWait(show.Name);
      }
      else if (show.WaitStr?.length > 0) {
        show.Waiting = true;
        srvr.delBlockedWait(show.Name); 
      }
    };

    const toggleToTry = async (show) => {
      if(show.Id.startsWith("noemby-") &&
           !show.InToTry) return;
      this.saveVisShow(show);
      show.InToTry = !show.InToTry;
      emby.saveToTry(show.Id, show.InToTry)
          .catch((err) => {
              console.error("late toggleToTry error:", err);
              //- show.InToTry = !show.InToTry;
            });
      await this.chkRowDelete(show);
    };

    const toggleContinue = async (show) => {
      if(show.Id.startsWith("noemby-") &&
           !show.InContinue) return;
      this.saveVisShow(show);
      show.InContinue = !show.InContinue;
      emby.saveContinue(show.Id, show.InContinue)
          .catch((err) => {
              console.error("late toggleContinue error:", err);
              //- show.InContinue = !show.InContinue;
            });
      await this.chkRowDelete(show);
    };

    const toggleMark = async (show) => {
      if(show.Id.startsWith("noemby-") &&
           !show.InMark) return;
      this.saveVisShow(show);
      show.InMark = !show.InMark;
      emby.saveMark(show.Id, show.InMark)
          .catch((err) => {
              console.error("late toggleMark error:", err);
              //- show.InMark = !show.InMark;
            });
      await this.chkRowDelete(show);
    };

    const toggleLinda = async (show) => {
      if(show.Id.startsWith("noemby-") &&
           !show.InLinda) return;
      this.saveVisShow(show);
      show.InLinda = !show.InLinda;
      emby.saveLinda(show.Id, show.InLinda)
          .catch((err) => {
              console.error("late toggleLinda error:", err);
              //- show.InLinda = !show.InLinda;
            });
      await this.chkRowDelete(show);
    };

    const toggleFavorite = async (show) => {
      if(show.Id.startsWith("noemby-") &&
           !show.IsFavorite) return
      this.saveVisShow(show);
      show.IsFavorite = !show.IsFavorite;
      emby.saveFav(show.Id, show.IsFavorite)
          .catch((err) => {
              console.error("late saveFavorite error:", err);
              //- show.IsFavorite = !show.IsFavorite;
           });
      await this.chkRowDelete(show);
    };

    const toggleReject = async (show) => {
      this.saveVisShow(show);
      show.Reject = !show.Reject; 
      if(show.Reject) 
           srvr.addReject(show.Name) 
               .catch((err) => {
                   console.error("late addReject:", err);
                   //- show.Reject = !show.Reject;
               });
      else srvr.delReject(show.Name)
            .catch((err) => {
                console.error("late delReject:", err);
                //- show.Reject = !show.Reject;
            });
      await this.chkRowDelete(show);
    };

    const togglePickup = async (show) => {
      this.saveVisShow(show);
      show.Pickup = !show.Pickup;
      if(show.Pickup) 
           srvr.addPickup(show.Name) 
               .catch((err) => {
                   console.error("late addPickup:", err);
                   //- show.Pickup = !show.Pickup;
               });
      else srvr.delPickup(show.Name)
            .catch((err) => {
                console.error("late delPickup:", err);
                //- show.Pickup = !show.Pickup;
            });
      await this.chkRowDelete(show);
    };

    // from dom click
    const deleteShow = async (show) => {
      if(show.Id.startsWith("noemby-")) return;
      this.saveVisShow(show);
      // console.log("delete Show From Emby?", show.Name);
      if (!window.confirm(
          `Do you really want to delete series ${show.Name}?`)) 
        return;
      if(!await this.chkRowDelete(show, true)){
        show.RunTimeTicks      = 0;
        show.UnplayedItemCount = 0;
        show.IsFavorite        = false;
        return
      }
      await emby.deleteShowFromEmby(show);
      await srvr.deleteShowFromSrvr(show)
    }

    return {
      shows:                [],
      searchStr:            "",
      errMsg:               "",
      sortByNew:          true,
      sortByActivity:    false,
      sortBySize:        false,
      highlightName:        "",
      allShowsLength:        0,
      remotes:              [],
      remoteShowName:       "",
      mapShow:            null,
      seriesMapSeasons:     [],
      seriesMapEpis:        [],
      seriesMap:            {},
      gapPercent:            0,

      conds: [ {
          color: "#0cf", filter: 0, icon: ["fas", "plus"],
          cond(show)  { return show.UnplayedItemCount > 0; },
          click() {},
        }, {
          color: "#f88", filter: 0, icon: ["fas", "minus"],
          cond(show)  { return show.Missing || show.WatchGap},
          click() {},
        }, {
          color: "#0c0", filter: 0, icon: ["far", "clock"],
          cond(show)  { return show.Waiting; },
          click(show) { toggleWaiting(show); },
        }, {
          color: "blue", filter: 0, icon: ["far", "sad-cry"],
          cond(show)  { return show.Genres?.includes("Drama"); },
          click(show) {},
        }, {
          color: "lime", filter: 0, icon: ["fas", "question"],
          cond(show)  { return show.InToTry; },
          click(show) { toggleToTry(show); },
        }, {
          color: "lime", filter: 0, icon: ["fas", "arrow-right"],
          cond(show)  { return show.InContinue; },
          click(show) { toggleContinue(show); },
        }, {
          color: "lime", filter: 0, icon: ["fas", "mars"],
          cond(show)  { return show.InMark; },
          click(show) { toggleMark(show); },
        }, {
          color: "lime", filter: 0, icon: ["fas", "venus"],
          cond(show)  { return show.InLinda; },
          click(show) { toggleLinda(show); },
        }, {
          color: "red", filter: 0, icon: ["far", "heart"],
          cond(show)  { return show.IsFavorite; },
          click(show) { toggleFavorite(show); },
        }, {
          color: "red", filter: -1, icon: ["fas", "ban"],
          cond(show)  { return show.Reject; },
          click(show) { toggleReject(show); },
        }, {
          color: "#5ff", filter: 0, icon: ["fas", "arrow-down"],
          cond(show)  { return show.Pickup; },
          click(show) { togglePickup(show); },
        }, {
          color: "#a66", filter: 0, icon: ["fas", "tv"],
          cond(show)  { return !show.Id.startsWith("noemby-"); },
          click(show) { deleteShow(show); },
        },
      ],
    };
  },

  /////////////  METHODS  ////////////
  methods: {
    async chkRowDelete(show, force) {
      if (force || (!show.Reject && !show.Pickup &&
                     show.Id.startsWith("noemby-"))) {
        console.log("no reason to keep row, deleting it:", show.Name);
        const id = show.Id;
        for(let i = 0; i < allShows.length; i++) {
          if(allShows[i].Id == id) {
            let nextShow           = allShows[i+1];
            if(!nextShow) nextShow = allShows[i-1];
            if(!nextShow) break;
            this.saveVisShow(nextShow);
            break;
          }
        }
        allShows   = allShows.filter(  (show) => show.Id != id);
        this.shows = this.shows.filter((show) => show.Id != id);
        return true;
      }
      return false;
    },

    hilite(show) {
      return this.highlightName == show.Name ? "yellow" : "white";
    },

    async addClick () {
      const srchTxt = prompt(
                "Enter series name. " +
                "It is used as an approximate search string.");
      if (!srchTxt) {
        //- showErr("Search string is empty");
        return;
      }

      const tvdbData = await tvdb.getTvdbData(srchTxt);
      if(!tvdbData) {
        showErr('No series found in tvdb for:', srchTxt);
        return;
      }
      const {name, waitStr} = tvdbData;

      const matchShow = allShows.find((s) => s.Name == name);
      if(matchShow) {  
        alert(matchShow.Name + ' already exists.');
        console.log(matchShow.Name + ' already exists.');
        this.saveVisShow(matchShow, true);
        return;
      }

      const dateStr = util.fmtDate();
      const show = {
        Name: name,
        Id: "noemby-" + Math.random(),
        DateCreated: dateStr, 
        Waiting: !!waitStr,
        WaitStr: waitStr,
        Missing: false,
        WatchGap: false,
        InToTry: false,
        InContinue: false,
        InMark: false,
        InLinda: false,
        Reject: false,
        Pickup: true,
        Date: dateStr,
        Size: 0,
        Seasons: [],
      };

      allShows.unshift(show);
      this.shows.unshift(show);

      this.saveVisShow(show, true);

      await srvr.addBlockedWait(show.Name);
      await srvr.addNoEmby(show);
    },

    showErr (...params) {
      let err = "";
      for (let param of params) {
        if (param instanceof Error)
             err += param.message    + " ";
        else if (typeof param == "object") 
             err += JSON.stringify(param, null, 2) + " ";
        else err += param.toString() + " ";
      }
      // err = err.slice(0, -4)
      console.error(err);
      if(this.errMsg) 
        errFifo.push(err);
      else this.errMsg = err;
    },

    errClick (evt) {
      if(evt.ctrlKey) {
        errFifo.length = 0;
        this.errMsg = "";
      }
      else if (errFifo.length) 
        this.errMsg = errFifo.shift();
      else
        this.errMsg = "";
    },
    
    topClick() {
      const container = document.querySelector("#shows");
      container.scrollTop = 0;
      this.saveVisShow(allShows[0]);
    },

    formatSize (show) {
      if(show.Id.startsWith("noemby-")) return "";
      const size = show.Size;
      if (size < 1e3) return size;
      if (size < 1e6) return Math.round(size / 1e3) + "K";
      if (size < 1e9) return Math.round(size / 1e6) + "M";
                      return Math.round(size / 1e9) + "G";
    },

    nameHash(name) {
      this.allShowsLength = allShows.length;
      if(!name) {
        //- showErr('nameHash name param null:', name);
        return null;
      }
      return (
        "name-" +
        name
          .toLowerCase()
          .replace(/^the\s/, "")
          .replace(/[^a-zA-Z0-9]*/g, "")
      );
    },

    saveVisShow(show, scroll = false) {
      this.highlightName = show.Name;
      window.localStorage.setItem("lastVisShow", show.Name);
      if(scroll) this.scrollToSavedShow();
      evtBus.emit('showSelected', show);
    },

    async sortClickAdded() {
      this.sortByNew      = true;
      this.sortByActivity = false;
      this.sortBySize     = false;
      this.sortShows();
      this.showAll();
      // this.topClick()
      // console.log("sort by Added");
    },

    async sortClickActivity() {
      this.sortByNew      = false;
      this.sortByActivity = true;
      this.sortBySize     = false;
      this.sortShows();
      this.showAll();
      // this.topClick()
      // console.log("sort by Activity");
    },

    async sortClickSize() {
      this.sortByNew      = false;
      this.sortByActivity = false;
      this.sortBySize     = true;
      this.sortShows();
      this.showAll();
      // this.topClick()
      // console.log("sort by Size");
    },
  
    scrollToSavedShow(saveVis = false) {
      this.$nextTick(() => {
        const name = window.localStorage.getItem("lastVisShow");
        let defaultShow = false;
        let show = allShows.find(
                (shw) => shw.Name == name);
        if (show === -1) {
          showErr("scrollToSavedShow: show not found:", name);
          show = allShows[0];
          defaultShow = true;
        }
        if(saveVis || defaultShow) this.saveVisShow(show);
        const id = this.nameHash(show.Name);
        const ele = document.getElementById(id);
        if (ele) ele.scrollIntoView({block: "center"});
      });
    },

    async copyNameToClipboard(show) {
      console.log(`copying ${show.Name} to clipboard`);
      await navigator.clipboard.writeText(show.Name);
      this.saveVisShow(show);
    },

    async episodeClick(e, show, season, episode) {
      let deleted = null;
      if(e.ctrlKey) {
        const ok = 
          confirm(`OK to delete file for ${show.Name} S${season}E${episode} ?`);
        if(!ok) return;
        // delete episode file
        await emby.editEpisode(show.Id, season, episode, true);
        deleted = {season, episode};
      }
      else // toggle watched
        await emby.editEpisode(show.Id, season, episode);

      this.seriesMapAction('', show, deleted);
    },

    async rowClick(show) {
      console.log('rowClick:', show.Name);
      if(show.Name == this.remoteShowName) {
        await this.remotesAction('close');
      }
      else {
        this.remoteShowName = show.Name;
        this.saveVisShow(show);    
        await this.remotesAction('open', null, show);
      }
    },

    async waitStrClick(show) {
      console.log("waitStrClick", show.Name);
      this.saveVisShow(show);
      if (show.WaitStr?.length > 0) {
        show.Waiting = true;
        srvr.delBlockedWait(show.Name); 
      }
    },

    async remotesAction(action, remote, show) {
      // console.log('remotesAction:', action, show?.Name);
      switch(action) {
        case 'open':  
          try {  
            const name      = show.Name;
            this.remotes    = [1];
            const [remotes] = await tvdb.getRemotes(name);
            if(!remotes) this.remotes = [];
            else         this.remotes = remotes;
            const url = urls.embyPageUrl(show.Id);
            if(url && !show.Id.startsWith("noemby-"))
                this.remotes.unshift({name:'Emby', url});
            this.remotes.push({name:'Close', url:null});
          } catch(err) {
            console.error('remotesAction open:', err);
          }
          break;

        case 'click':
          if(openedWindow) openedWindow.close();
          openedWindow = null;
          if(!remote.url) this.remotesAction('close');
          else openedWindow = window.open(remote.url, "_blank");
          break; 

        case 'close':
          this.remotes = [];
          this.remoteShowName = "";
          break;
      }
    },

    async seriesMapAction(action, show, wasDeleted) {
      if((action == 'open' && this.mapShow === show) ||
          action == 'close') {
        this.mapShow = null;
        return;
      }
      if(action == 'date') {
        console.log('setting last watched to cur date');
        await emby.setLastWatched(show.Id);
      }
      this.mapShow           = show;
      const seriesMapSeasons = [];
      const seriesMapEpis    = [];
      const seriesMap        = {};
      const seriesMapIn = 
          await emby.getSeriesMap(show, action == 'prune');
      for(const season of seriesMapIn) {
        const [seasonNum, episodes] = season;
        seriesMapSeasons[seasonNum] = seasonNum;
        const seasonMap = {};
        seriesMap[seasonNum] = seasonMap;
        for(const episode of episodes) {
          let [episodeNum, epiObj] = episode;
          const {error, played, avail, noFile, 
                 unaired, deleted:epiDeleted} = epiObj;
          seriesMapEpis[episodeNum] = episodeNum;
          const deleted = epiDeleted ||
              (wasDeleted?.season  == seasonNum && 
               wasDeleted?.episode == episodeNum);
          seasonMap[episodeNum] = 
              {error, played, avail,
               noFile, unaired, deleted};
        }
      }
      this.seriesMapSeasons = 
           seriesMapSeasons.filter(x => x !== null);
      this.seriesMapEpis = 
           seriesMapEpis   .filter(x => x !== null);
      this.seriesMap = seriesMap;
      this.saveVisShow(show);
    },

    condFltrClick(cond) {
      if (++cond.filter == 2) cond.filter = -1;
      this.select();
    },

    condFltrColor(cond) {
      switch (cond.filter) {
        case  0: return "gray";
        case -1: return "pink";
        case +1: return cond.color;
      }
    },

    sortShows() {
      allShows.sort((a, b) => {
        if (this.sortByNew) {
          if (a.DateCreated == b.DateCreated) return 0;
          return a.DateCreated > b.DateCreated ? -1 : +1;
        }
        if (this.sortByActivity) {
          if (a.Date == b.Date) return 0;
          return a.Date > b.Date ? -1 : +1;
        }
        if (this.sortBySize) 
          return b.Size - a.Size;
      });
    },

    condColor(show, cond) {
      if (cond.cond(show)) return cond.color;
      return "#ddd";
    },

    select(scroll = true) {
      const srchStrLc = this.searchStr == 
            "" ? null : this.searchStr.toLowerCase();
      this.shows = allShows.filter((show) => {
        if (srchStrLc && 
           !show.Name.toLowerCase().includes(srchStrLc)) 
              return false;
        for (let cond of this.conds) {
          if ( cond.filter ===  0) continue;
          if ((cond.filter === +1) != (!!cond.cond(show))) 
            return false;
        }
        return true;
      });
      if (this.shows.length === 1) 
        this.saveVisShow(this.shows[0]);
      if (scroll) this.scrollToSavedShow();
    },

    /////////////////  UPDATE METHODS  /////////////////

    showAll(dontClrFilters = false) {
      if(dontClrFilters?.altKey !== undefined) dontClrFilters = false;
      this.searchStr = "";
      if(!dontClrFilters) {
        for (let cond of this.conds) cond.filter = 0;
      }
      this.select(true);
    },

    async addGapToShow(event) {
      const {showId, progress, 
             seasonNum, episodeNum, 
             watchGap, missing, waiting} = event.data;
      this.gapPercent = progress;

      if(!watchGap && !missing && !waiting) return;
      const show = allShows.find((show) => show.Id == showId);
      if(!show) return;

      const blockedWait = blockedWaitShows.includes(show.Name);

      const gap = {};
      gap.ShowId     = showId;
      gap.GapSeason  = seasonNum;
      gap.GapEpisode = episodeNum;
      gap.WatchGap   = watchGap; 
      gap.Missing    = missing;
      gap.Waiting    = !blockedWait && waiting;
      gap.WaitStr    = await emby.getWaitStr(show);
      Object.assign(show, gap);
      const idGapStr = JSON.stringify([show.Id, gap]);
      await srvr.addGap(idGapStr);
    }
  },

  /////////////////  MOUNTED  /////////////////
  mounted() {
    (async () => {
      document.addEventListener('keydown', (event) => {
        if(event.code == 'Escape') {
          this.remotesAction('close');
          this.seriesMapAction('close');
        }
      }); 
      try {
        showErr = this.showErr;
        await emby.init(showErr);
        tvdb.init(showErr);

        const showsBlocks = await emby.loadAllShows();
        allShows          = showsBlocks.shows;
        this.shows        = allShows;

        // must be set before startWorker
        blockedWaitShows = showsBlocks.blockedWaitShows;

        emby.startWorker(allShows, this.addGapToShow);

        this.sortByNew      = true;
        this.sortByActivity = false;
        this.sortBySize     = false;
        this.sortShows();
        this.showAll(true);

        const name = window.localStorage.getItem("lastVisShow");
        if (!name)   window.localStorage.setItem("lastVisShow",
                       allShows[0].Name);
        this.scrollToSavedShow(true);
      } 
      catch (err) {
        showErr("Mounted:", err);
      }
    })();
  },
};
</script>


<style scoped>
tr:nth-child(even) {
  background-color: #f4f4f4;
}
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-size:large;
}
input {
  font-size:18px;
}
button {
  font-size:18px;
}
#map {
  border: 1px solid black;
  position: fixed;
  left: 50px;
  top: 100px;
}

#lbl {
  display: inline-block;
  margin-right: 10px;
  font-size: 16px;
  margin-right: 20px;
  font-weight: bold;
  color: blue;
}
</style>
