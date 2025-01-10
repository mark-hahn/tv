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
                    flex-direction:row; justify-content:start;`)
        #nums(style=`background-color:#ccc; 
                      display:flex; justify-content:space-around;`)
          #count(style="display:inline-block; margin:4px 5px 4px 15px;") 
            | {{shows.length + '/' + allShowsLength}}
          #prog(style=`display:inline-block; 
                      margin:4px 10px 4px 5px;`) 
            | {{gapPercent+'%'}}

        #srch(style=`margin-top:3px;`)
          input(v-model="searchStr" 
                @input="select"
                 style="border:1px solid black; width:120px;")
          button(@click="select" 
                  style="margin-left:1px;")
            font-awesome-icon(icon="search")

        button(@click="watchClick" 
                style=`margin-left:10px; margin-right:5px;
                      fontSize:15px; margin:4px;
                      background-color:white;`) 
          | {{ watchingName }}

      #hdrbottom(style=`width:100%; background-color:#ccc; 
                        display:flex; justify-content:space-between;
                        margin-top:5px; margin-bottom:5px;`)
          #botlft(style=`width:400px;
                        overflow:hidden;
                        display:flex; justify-content:space-between;`)

            button(@click="addClick" 
                    style=`display:inline-block'; 
                          font-size:15px; margin:4px 4px 4px 20px;backgroundColor:white`) Add
            button(@click="topClick" 
                    style=`margin-left:10px; margin-right:5px;
                          fontSize:15px; margin:4px;
                          background-color:white;`) Top
            #sortFltr(style=`display:inline-block;
                          display:flex; justify-content:space-between;`)
              button(@click='sortClick'
                     :style=`{width:'100px', 
                              fontSize:'15px', margin:'4px'}`) 
                | {{sortChoice}}

              button(@click='filterClick' 
                     :style=`{width:'100px', 
                              fontSize:'15px', margin:'4px'}`)
                | {{fltrChoice}}
            
          #botrgt(style=`display:flex;
                         justify-content:space-between;
                         margin: 5px 17px 0 0;`)
            #fltrs(v-for="cond in conds"
                @click="condFltrClick(cond)"
                :style=`{width:'1.435em', textAlign:'center',
                          display:'inline-block', 
                          color:condFltrColor(cond)}`)
              font-awesome-icon(:icon="cond.icon"
                                :style="{}")
    #sortpop(v-if="sortPopped" 
          style=`width:200px; background-color:#eee;
                border: 1px solid black; position: fixed; 
                display:flex; flex-direction:column;
                left: 144px; top: 75px;`) 
      div(style=`text-align:center;
                margin:10px; font-weight:bold;`) 
        | Sort
      div(v-for="sortChoice in sortChoices"
          style=`margin:3px 10px; padding:10px; 
                background-color:white; text-align:center;
                border: 1px solid black; font-weight:bold;
                cursor:default;`
          @click="sortAction(sortChoice)") 
        | {{sortChoice}}

    #fltrpop(v-if="fltrPopped" 
          style=`width:200px;
                background-color:#eee; padding:0px;
                border: 1px solid black; position: fixed; 
                display:flex; flex-direction:column;
                left: 253px; top: 75px;`) 
      div(style=`text-align:center;
                 margin:10px; font-weight:bold;`) 
        | Filter
      div(v-for="fltrChoice in fltrChoices"
          style=`margin:3px 10px; padding:10px; 
                background-color:white; text-align:center;
                border: 1px solid black; font-weight:bold;
                cursor:default;`
          @click="fltrAction(fltrChoice)") 
        | {{fltrChoice}}

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

          td(@click="saveVisShow(show, false, true)"
             :style=`{width:'80px', fontSize:'16px',
                      backgroundColor: hilite(show),
                      cursor:'default', textAlign:'center'}`) 
            | {{  getValBySortChoice(show) }}
            
          td(:style=`{display:'flex', justifyContent:'space-between',
                      padding:'5px', backgroundColor: hilite(show)}`)

            div(style=`padding:2px; 
                        fontSize:16px; font-weight:bold;` 
               @click="saveVisShow(show, false, true)"
            ) {{show.Name}} 

            div(style=`padding:2px; flex-grow:1;
                        fontSize:16px; font-weight:bold;` 
               @click="saveVisShow(show, false, true)"
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

  #map(v-if="mapShow !== null" 
        style=`background-color:#ffe; padding:10px;
               display:flex; flex-direction:column;
               position:fixed; top:10px; left:300px; z-index:2`)
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
      if(await this.chkRowDelete(show))
        deleteShow(show);
    };

    // from dom click
    const deleteShow = async (show) => {
      if(!show.Id.startsWith("noemby-")) {
        this.saveVisShow(show);
        if (!window.confirm(
            `Do you really want to delete series ${show.Name}?`)) 
          return;
        if(!await this.chkRowDelete(show, true)){
          show.RunTimeTicks = 0;
          show.IsFavorite   = false;
          return
        }
        await emby.deleteShowFromEmby(show);
      }
      await srvr.deleteShowFromSrvr(show)
    }

    return {
      shows:                [],
      searchStr:            "",
      errMsg:               "",
      highlightName:        "",
      allShowsLength:        0,
      mapShow:            null,
      seriesMapSeasons:     [],
      seriesMapEpis:        [],
      seriesMap:            {},
      gapPercent:            0,
      watchingName:      '---',
      sortPopped:        false,
      sortChoices:          
        ['Alpha', 'Viewed', 'Added', 'Updated', 'Size'],
      sortChoice:     'Viewed', 
      fltrPopped:        false,
      fltrChoices:          
        ['All', 'Ready', 'Drama', 'To-Try', 'Try Drama', 
                            'Continue', 'Mark', 'Linda'],
      fltrChoice:        'All',          

      conds: [ {
          color: "#0cf", filter: 0, icon: ["fas", "plus"],
          cond(show)  { return !show.NotReady },
          click() {}, name: "unplayed",
        }, {
          color: "#f88", filter: 0, icon: ["fas", "minus"],
          cond(show)  { return show.Missing || show.WatchGap},
          click() {}, name: "gap",
        }, {
          color: "#0c0", filter: 0, icon: ["far", "clock"],
          cond(show)  { return show.Waiting; },
          click(show) { toggleWaiting(show); },
          name: "waiting",
        }, {
          color: "blue", filter: 0, icon: ["far", "sad-cry"],
          cond(show)  { return show.Genres?.includes("Drama"); },
          click(show) {}, name: "drama",
        }, {
          color: "lime", filter: 0, icon: ["fas", "question"],
          cond(show)  { return show.InToTry; },
          click(show) { toggleToTry(show); },
           name: "totry",
        }, {
          color: "lime", filter: 0, icon: ["fas", "arrow-right"],
          cond(show)  { return show.InContinue; },
          click(show) { toggleContinue(show); },
           name: "continue",
        }, {
          color: "lime", filter: 0, icon: ["fas", "mars"],
          cond(show)  { return show.InMark; },
          click(show) { toggleMark(show); },
           name: "mark",
        }, {
          color: "lime", filter: 0, icon: ["fas", "venus"],
          cond(show)  { return show.InLinda; },
          click(show) { toggleLinda(show); },
          name: "linda",
        }, {
          color: "red", filter: 0, icon: ["far", "heart"],
          cond(show)  { return show.IsFavorite; },
          click(show) { toggleFavorite(show); },
          name: "favorite",
        }, {
          color: "red", filter: -1, icon: ["fas", "ban"],
          cond(show)  { return show.Reject; },
          click(show) { toggleReject(show); },
          name: "ban",
        }, {
          color: "#5ff", filter: 0, icon: ["fas", "arrow-down"],
          cond(show)  { return show.Pickup; },
          click(show) { togglePickup(show); },
          name: "pickup",
        }, {
          color: "#a66", filter: 0, icon: ["fas", "tv"],
          cond(show)  { return !show.Id.startsWith("noemby-"); },
          click(show) { deleteShow(show); },
          name: "hasemby",
        },
      ],
    };
  },

  /////////////  METHODS  ////////////
  methods: {
    getValBySortChoice(show, forSort = false) {
      switch(this.sortChoice) {
        case 'Alpha':   
          if(!forSort) return '';
          return show.Name.replace(/^the\s*/i, "").toLowerCase();
        case 'Added':   return show.DateCreated;
        case 'Updated': return show.Date;
        case 'Size':    
          if(forSort) return show.Size;
          return util.fmtSize(show);
        case 'Viewed':  
          if(forSort) 
            return srvr.lastViewedCache[show.Name] || 0;
          return util.fmtDate(srvr.lastViewedCache[show.Name]);
      }
    },

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
        //- console.error("Search string is empty");
        return;
      }

      const tvdbData = await tvdb.srchTvdbData(srchTxt);
      if(!tvdbData) {
        console.error('No series found in tvdb for:', srchTxt);
        alert(`No tv series found using search text: ${srchTxt}`);
        return;
      }
      const {name, tvdbId} = tvdbData;

      const matchShow = allShows.find((s) => s.Name == name);
      if(matchShow) {  
        alert(matchShow.Name + ' already exists.');
        console.log(matchShow.Name + ' already exists.');
        this.saveVisShow(matchShow, true);
        return;
      }

      const dateStr = util.fmtDate(0);
      const show = {
        Name: name,
        Id: "noemby-" + Math.random(),
        DateCreated: dateStr, 
        Waiting: false,
        WaitStr: '',
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
        TvdbId: tvdbId,
      };

      allShows.unshift(show);
      this.shows.unshift(show);

      this.saveVisShow(show, true);

      await srvr.addBlockedWait(show.Name);
      await srvr.addNoEmby(show);
    },

    topClick() {
      const container = document.querySelector("#shows");
      container.scrollTop = 0;
      this.saveVisShow(this.shows[0], true);
    },

    nameHash(name) {
      this.allShowsLength = allShows.length;
      if(!name) {
        //- console.error('nameHash name param null:', name);
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
      this.$nextTick(() =>
        evtBus.emit('setUpSeries', show));
    },

    async sortClick() {
      this.sortPopped = !this.sortPopped;
      this.fltrPopped = false;
    },
    async sortAction(sortChoice) {
      console.log('sortAction', sortChoice);
      window.localStorage.setItem("sortChoice", sortChoice);
      this.sortChoice = sortChoice;
      this.sortPopped = false;
      this.fltrPopped = false;
      this.sortShows();
      if(sortChoice != 'Alpha')
           this.saveVisShow(this.shows[0], true);
      this.scrollToSavedShow();
    },
    async filterClick() {
      this.fltrPopped = !this.fltrPopped
      this.sortPopped = false;
    },
    async fltrAction(fltrChoice) {
      console.log('fltrAction', fltrChoice);
      window.localStorage.setItem("fltrChoice", fltrChoice);
      this.fltrChoice = fltrChoice;
      this.sortPopped = false;
      this.fltrPopped = false;
      this.searchStr = "";
      for (let cond of this.conds) {
         util.setCondFltr(cond, this.fltrChoice);
         console.log('cond:', cond.name, cond.filter);
      }
      this.select();
      this.sortShows();
    },

    scrollToSavedShow(saveVis = false) {
      let show = null;
      this.$nextTick(() => {
        const name = window.localStorage.getItem("lastVisShow");
        if(!name) {
          console.error(
            "scrollToSavedShow: lastVisShow missing, ignoring");
        } 
        else {
          show = allShows.find((shw) => shw.Name == name);
          if (!show) {
            console.error("scrollToSavedShow: show not found", name);
            show =allShows.find(() => true);
            if(!show) {
              console.error("scrollToSavedShow: no show found", name);
              return;
            }
          }
        }
        if(saveVis) this.saveVisShow(show);
        const id  = this.nameHash(show.Name);
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

    async waitStrClick(show) {
      console.log("waitStrClick", show.Name);
      this.saveVisShow(show);
      if (show.WaitStr?.length > 0) {
        show.Waiting = true;
        srvr.delBlockedWait(show.Name); 
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
      this.shows.sort((a, b) => {
        a = this.getValBySortChoice(a, true);
        b = this.getValBySortChoice(b, true);
        if (a == b) return 0;
        if(this.sortChoice == 'Alpha')
          return a > b ? +1 : -1;
        return a > b ? -1 : +1;
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

    watchClick() {
      console.log('watchClick');
      if(this.watchingName !== '---') {
        window.localStorage.setItem(
                      "lastVisShow", this.watchingName);
        this.scrollToSavedShow(true);
      }
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
             watchGap, missing, waiting, notReady} = event.data;
      this.gapPercent = progress;
      if(!watchGap && !missing && !waiting && !notReady) return;
      
      const show = allShows.find((show) => show.Id == showId);
      if(!show) return;

      const blockedWait = blockedWaitShows.includes(show.Name);
      const gap = {};
      gap.ShowId        = showId;
      gap.GapSeason     = seasonNum;
      gap.GapEpisode    = episodeNum;
      gap.WatchGap      = watchGap; 
      gap.Missing       = missing;
      gap.NotReady      = notReady;
      gap.Waiting       = !blockedWait && waiting;
      gap.WaitStr       = await tvdb.getWaitStr(show);

      Object.assign(show, gap);
      const idGapStr = JSON.stringify([show.Id, gap]);
      await srvr.addGap(idGapStr);
    }
  },

  /////////////////  MOUNTED  /////////////////
  mounted() {
    evtBus.on('openMap', (show) => {
      this.seriesMapAction('open', show);
    });

    setInterval(async () => {
      const watchingName = await emby.getCurrentlyWatching();
      if(watchingName === null)  this.watchingName = '----';
      else                       this.watchingName = watchingName;
    }, 5*1000);

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

        // emby.startWorker(allShows, this.addGapToShow);

        this.sortByNew     = true;
        this.sortByUpdated = false;
        this.sortBySize    = false;
        this.sortChoice = 
          window.localStorage.getItem("sortChoice") || 'Viewed';
        this.sortShows();
        this.showAll(true);

        const name = window.localStorage.getItem("lastVisShow");
        if (!name)   window.localStorage.setItem("lastVisShow",
                       allShows[0].Name);
        this.scrollToSavedShow(true);

        ////////// TEMP //////////
        // set all favorites
        // allShows.forEach(async (show) => {
        //   if(show.Id.startsWith("noemby-")) return;
        //   await emby.saveFav(show.Id, true);
        //   console.log('saved fav:', show.Name);
        // });
        // 
        // calculate all gaps
        // let showIdx = 0;
        // const intvl = setInterval(async () => {
        //   while(showIdx < allShows.length) {
        //     if(showIdx % 10 == 0) 
        //       console.log(new Date().toISOString(), 
        //                  showIdx + ' of ' +allShows.length);
        //     // if(Math.random() < 0.75) break;
        //     const show = allShows[showIdx++];
        //     const remotes = await tvdb.getRemotes(show);
        //     if(!remotes) continue;
        //     const [_remotes, cached] = remotes
        //     if(cached) continue;
        //     break;
        //   }
        //   if(showIdx == allShows.length) {
        //      clearInterval(intvl);
        //      console.log('load remotes done:', showIdx);
        //   }
        // }, 45*1000);

      } 
      catch (err) {
        console.error("Mounted:", err);
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
