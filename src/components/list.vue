<template lang="pug">

#list(style=`height:95dvh; 
                 padding:0; margin:0;
                 display:flex; flex-direction:column;
                 align-items:center;`)
  #center(style=`height:100%; width:800px;
                 display:flex; flex-direction:column;`)             
    #hdr(style=`width:100%; background-color:#ccc;
                display:flex; flex-direction:column;`)

      #hdrtop(style=`width:100%; height:40px;
                     display:flex; justify-content:space-start;
                     background-color:#ccc;`)
        div(style=`display:flex; justify-content:space-between;
                   margin-bottom:10px;`)
          #nums(style=`display:flex; justify-content:space-around;
                      width:120px;`)
            #count(style=`display:inline-block; margin:4px 5px 4px 15px;
                          width:75px;`) 
              | {{shows.length + '/' + allShowsLength}}
            #prog(style=`display:inline-block; 
                        margin:4px 10px 4px 5px; width:75px;`) 
              | {{gapPercent+'%'}}

          #srch(style=`border:1.5px solid black;
                        width:132px;
                        margin: 3px 10px 0 20px;
                        padding-top:3px; padding-left:5px;
                        background-color:#eee;
                        height:31px;`)
            input(v-model="filterStr" 
                  @input="select" placeholder="Filter..."
                  style=`width:120px;`)

        #webHist(style=`border:1.5px solid black;
                        margin: 2px 10px 0 10px;
                        padding-top:3px; padding-left:5px;
                        background-color:#eee;
                        height:31px;`)
          input(v-model="webHistStr"
                v-on:keyup.enter="searchClick('enter')" 
                placeholder="Search..." style=`width:120px;`)
          button(@click="searchClick('hist')"
                  style=`display:inline-block'; 
                        font-size:15px; margin:2px 4px 0 0;backgroundColor:white`) Hist
          button(@click="searchClick('web')" 
                  style=`display:inline-block'; 
                        font-size:15px; margin:2px 4px 0 10px;backgroundColor:white`) Web
        button(@click="watchClick"
                style=`height:29px; background-color:white;
                       fontSize:15px; margin:6px 5px 4px 10px;`) 
          | {{ watchingName }}

      #hdrbottom(style=`width:100%; background-color:#ccc; 
                        display:flex; justify-content:space-between;
                        margin-top:5px; margin-bottom:5px;`)
          #botlft(style=`width:400px;
                        overflow:hidden;
                        display:flex; justify-content:space-between;`)

            button(@click="topClick" 
                    style=`margin-left:10px; margin-right:5px;
                          fontSize:15px; margin:4px;
                          background-color:white;`) Top
            button(@click="prevNextClick(false)" 
                    style=`margin-left:10px; margin-right:5px;
                          fontSize:15px; margin:4px;
                          background-color:white;`) Prev
            button(@click="prevNextClick(true)" 
                    style=`margin-left:10px; margin-right:5px;
                          fontSize:15px; margin:4px;
                          background-color:white;`) Next
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
          button(@click="allClick" 
                  style=`display:inline-block'; width:40px;
                        font-size:15px; margin:4px 10px 4px 10px;backgroundColor:white`) All
          #botrgt(style=`display:flex;
                         justify-content:space-between;
                         margin: 5px 17px 0 0;`)
            #fltrs(v-for="cond in conds"
                @click="condFltrClick(cond, $event)"
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

    #searchList( v-if="showingSrchList"
          style=`background-color:#eee; padding:0px;
                border: 1px solid black; height:85%;
                position: fixed;
                display:flex; flex-direction:column;
                left: 253px; top: 88px;
                cursor:pointer; min-width:280px;`) 
      div(@click="cancelSrchList()"
           style=`font-weight:bold; text-align:center;
                  margin:10px; padding:10px; height:20px; background-color:white;`)
        | Cancel
      div(style="overflow-y:scroll")
        div(v-if="showingSrchList && searchList === null")
          img(src="../../loading.gif"
              style=`width:100px; height:100px; overflow-y:scroll;
                      position:relative; top:20px; left:80px;`)
        div(v-for="srchChoice in searchList"
            v-if="searchList !== null"
            @click="searchAction(srchChoice)"
            style=`margin:3px 10px; padding:10px; width:230px;
                  background-color:white; text-align:center;
                  border: 1px solid black; 
                  display:flex;`)
          img(:src="srchChoice.image" 
              style=`max-width:80px; max-height:120px;`)
          #srchTxt(style=`max-width:230px;
                          display:flex; margin:5px; 
                          flex-direction:column;`)
            #srchName(style=`font-weight:bold;
                            font-size:20px; `)
              | {{srchChoice.name}}
            #srchDtl(style=`font-size:18px; margin:10px 0 0 10px;`)
              | {{srchChoice.searchDtlTxt}}
            #srchDel(v-if="srchChoice.deleted"
                    style=`font-size:18px; 
                            margin:10px 0 0 10px; color:red`)
              | Deleted

    #shows(style="width:100%; flex-grow: 1; overflow-y:scroll;")
      table(style="width:100%; font-size:18px")
       tbody
        tr(v-for="show in shows" key="show.Id" 
              style="outline:thin solid; cursor:default" 
             :id="nameHash(show.Name)")

          td(style="width:30px; text-align:center;"
            @click="copyNameToClipboard(show, $event)")
            font-awesome-icon(id="cpbrd" icon="copy" 
                              style="color:#ccc")

          td(style="width:30px; text-align:center;" )
            div(v-show="!show.Id.startsWith('noemby-')" 
                  @click="seriesMapAction('open', show)")
              font-awesome-icon(icon="border-all" style="color:#ccc")

          td(@click="saveVisShow(show, false)"
             :style=`{width:'80px', fontSize:'16px',
                      backgroundColor: hilite(show),
                      cursor:'default', textAlign:'center'}`) 
            | {{  getValBySortChoice(show) }}
            
          td(:style=`{display:'flex', padding:'5px', 
                      justifyContent:'space-between',
                      backgroundColor: hilite(show)}`)

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
                :style="{color:condColor(show, cond)}")

  #map(v-if="mapShow !== null" 
        style=`background-color:#ffe; padding:10px;
               display:flex; flex-direction:column;
               position:fixed; top:70px; left:260px; z-index:2;
               max-height:85%; max-width:500px; 
               border: 2px solid black;
               overflow-y:scroll;`)
    div(style=`margin:0 5px; display:flex; 
                justify-content:space-between;`)
      div(style=`font-size:20px; margin:6px 20px 0 0;
                 font-weight:bold; flex-grow:4;`)
        | {{mapShow.Name}}
      button(@click="seriesMapAction('prune', mapShow)"
             style="margin:5px;")           Prune
      button(@click="seriesMapAction('date',  mapShow)"
             style="margin:5px;")           Set Date
      button(@click="seriesMapAction('close')"
             style="margin:5px;")            Close
    div(v-if="!hideMapBottom")
      div(v-if=`mapShow.WatchGap ||
                mapShow.FileGap  || mapShow.WaitStr?.length`
          style=`display:flex; justify-content:space-around; 
                color:red; margin: 0 10px; 4px 10px;`)
        div(v-if="mapShow.WatchGap" 
            style="display:inline-block;")
          | {{`Watch Gap`}}
        div(v-if="mapShow.FileGap"
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
              :style=`{cursor:'default',
                      padding:'0 4px',
                      textAlign:'center', border:'1px solid #ccc',
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
         faMars, faVenus, faGlobe, faTrafficLight }
                           from "@fortawesome/free-solid-svg-icons";
library.add([  
  faLaughBeam, faSadCry, faClock, faHeart, faCheck, faPlus, 
  faGlobe, faMinus, faArrowDown, faTv, faSearch, faQuestion, 
  faCopy, faBan, faBorderAll, faArrowRight, faMars, faVenus, 
  faClock,faTrafficLight]);

let allTvdb          = null;
let allShows         = [];
let showHistory      = [];
let showHistoryPtr   = -1;
let blockedWaitShows = null;
let blockedGapShows  = null;
let srchListWeb      = null;
const pruneTvdb = (window.location.href.slice(-5) == 'prune');

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

    const toggleBlkGap = async (show) => {
      // console.log("toggleBlkGap", show.Name);
      this.saveVisShow(show);
      if(show.BlockedGap) {
        show.BlockedGap = false;
        srvr.delBlockedGap(show.Name);
      }
      else {
        show.BlockedGap = true;
        srvr.addBlockedGap(show.Name); 
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
    };

    const toggleContinue = async (show) => {
      if(show.Id.startsWith("noemby-") &&
           !show.InContinue) return;
      this.saveVisShow(show);
      show.InContinue = !show.InContinue;
      emby.saveContinue(show.Id, show.InContinue)
          .catch((err) => {
              console.error("late saveContinue error:", err);
              //- show.InContinue = !show.InContinue;
            });
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
    };

    const toggleReject = async (show) => {
      this.saveVisShow(show);
      show.Reject = !show.Reject; 
      if(show.Reject) 
        srvr.addReject(show.Name) 
                .catch((err) => {
                    console.error("late addReject:", err);
                });
      else
        srvr.delReject(show.Name) 
                .catch((err) => {
                    console.error("late delReject:", err);
                });
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
              // show.Pickup = !show.Pickup;
          });
    };

    const deleteShow = async (show) => {
      allTvdb = await tvdb.getAllTvdb();
      const name = show.Name;
      // console.log('list, deleteShow:', name);
      if(show.Reject) {
        alert("Show is banned, ignoring delete");
        return;
      }
      if(!show.Id.startsWith('noemby-')) {
        this.saveVisShow(show);
        if (!window.confirm(
            `Do you really want to delete series ${name}?`)) 
          return;
        await emby.deleteShowFromEmby(show);
      }
      const tvdbData = allTvdb[name];

      if(pruneTvdb) {
        delete allTvdb[name];
        srvr.setTvdbFields({name, $delTvdb:true});
      }
      else {
        const deleted = tvdbData.deleted = util.fmtDate();
        allTvdb[name] = await srvr.setTvdbFields({name, deleted});
      }
      await srvr.deleteShowFromSrvr(show);
      await this.removeRow(show);
    }

    evtBus.on('deleteShow', (show) => {
      // console.log('evtBus deleteShow', show.Name);
      if(!show) return;
      deleteShow(show);
    });

    return {
      shows:                [],
      filterStr:            "",
      webHistStr:           "",
      errMsg:               "",
      highlightName:        "",
      allShowsLength:        0,
      mapShow:            null,
      hideMapBottom:      true,
      seriesMapSeasons:     [],
      seriesMapEpis:        [],
      seriesMap:            {},
      gapPercent:            0,
      watchingName:      '---',
      sortPopped:        false,
      sortChoice:     'Viewed', 
      fltrPopped:        false,
      fltrChoice:        'All',  
      showingSrchList:   false,
      searchList:         null,        
      sortChoices:          
        ['Alpha', 'Viewed', 'Added', 'Ratings', 'Size'],
      fltrChoices:
        ['All', 'Ready', 'Drama', 'To-Try', 
         'Try Drama', 'Continue', 'Download', 
         'Finished', 'Mark', 'Linda'],
      conds: [ {
          color: "#0cf", filter: 0, icon: ["fas", "plus"],
          cond(show)  { return !show.NotReady },
          click() {}, name: "unplayed",
        }, {
          color: "#f88", filter: 0, icon: ["fas", "minus"],
          cond(show)  { 
            return (show.FileGap || show.WatchGap ||
                    show.Id.startsWith("noemby-")) && 
                   !show.BlockedGap},
          click(show) { toggleBlkGap(show); },
          name: "gap",
        }, {
          color: "#faa", filter: 0, 
          icon: ["fas", "traffic-light"],
          cond(show)  { return show.Ended; },
          click() {}, name: "ended",
        }, {
          color: "#88f", filter: 0, icon: ["far", "sad-cry"],
          cond(show)  { return show.Genres?.includes("Drama"); },
          click() {}, name: "drama",
        }, {
          color: "#88f", filter: 0, icon: ["fas", "globe"],
          cond(show)  { 
            return show?.OriginalCountry?.toUpperCase() != 'USA';},
          click()  {}, name: "foreign",
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
          click(show) { deleteShow(show) },
          name: "hasemby",
        },
      ],
    };
  },

  /////////////  METHODS  ////////////
  methods: {

    getValBySortChoice(show, forSort = false) {
      let lastViewed, ratings;
      switch(this.sortChoice) {
        case 'Alpha':   
          if(!forSort) return '';
          return show.Name.replace(/^the\s*/i, "").toLowerCase();
        case 'Added':   return show.DateCreated;
        case 'Size':    
          if(forSort) return show.Size;
          return util.fmtSize(show);
        case 'Ratings':  
          ratings = show?.Ratings;
          return ((ratings !== undefined) ? +ratings : 0);
        case 'Viewed': 
          lastViewed = srvr.lastViewedCache[show.Name];
          if(forSort) return lastViewed || 0;
          if(lastViewed === undefined) return "";
          return util.fmtDate(lastViewed);
      }
    },

    setHighlightAfterDel(id) {
      for(let i = 0; i < this.shows.length; i++) {
        if(this.shows[i].Id == id) {
          let nextShow           = this.shows[i+1];
          if(!nextShow) nextShow = this.shows[i-1];
          if(!nextShow) nextShow = this.shows[0];
          this.saveVisShow(nextShow, true);
          return nextShow;
        }
      }
      return null;
    },

    addRow(show) {
      console.log("addRow", show.Name);
      this.shows.unshift(show);
      if(allShows !== this.shows)
        allShows.unshift(show);
      this.saveVisShow(show, true);
    },

    removeRow(show) {
      console.log("removeRow", show.Name);
      const id = show.Id;
      const newShow = this.setHighlightAfterDel(id);
      this.shows = this.shows.filter((show) => show.Id != id);
      if(this.shows !== allShows)
        allShows = allShows.filter((show) => show.Id != id);
      if(newShow) this.saveVisShow(newShow, true);
    },

    hilite(show) {
      return (this.highlightName == show.Name) ? "yellow" : "white";
    },

    async searchClick(source) {
      allTvdb = await tvdb.getAllTvdb();
      const srchTxt   = this.webHistStr;
      const srcIsWeb  = (source == 'web');
      if(srcIsWeb && pruneTvdb) return;
      const justClose = (srchTxt.length == 0) || 
           (this.showingSrchList && (srchListWeb == srcIsWeb));
      this.cancelSrchList();
      if(justClose) return;
      srchListWeb = srcIsWeb;
      let tvdbSrchData;
      if(srcIsWeb) {
        tvdbSrchData = await tvdb.srchTvdbData(srchTxt);
        if(!tvdbSrchData) {
          this.cancelSrchList();
          setTimeout(() => {
            console.error('No results for web search:', srchTxt);
            this.webHistStr = `No series.`;
          }, 100);
          return;
        }
      }
      else {
        const tvdbDataArr = Object.entries(allTvdb);
        const srchTvdb    = tvdbDataArr.filter((tvdbDataItem) =>
                                tvdbDataItem[0].toLowerCase()
                                .includes(srchTxt.toLowerCase()));
        if(srchTvdb.length == 0) {
          this.webHistStr = `-- No Series --`;
          this.cancelSrchList();
          return;
        }
        tvdbSrchData = srchTvdb.sort((a, b) => 
            a[0].replace(/^the\s/i, '') > 
            b[0].replace(/^the\s/i, '') ? 1 : -1);
        tvdbSrchData = tvdbSrchData.map(
          (item) => {
            const tvdbData = item[1];
            tvdbData.year  = tvdbData.firstAired.substring(0, 4);
            return tvdbData;
          }
        );
      }
      tvdbSrchData.forEach((tvdbData) => {
        tvdbData.image = tvdbData.image ?? 
                           tvdbData.image_url;
        delete tvdbData.image_url;
        if(tvdbData.originalCountry == 'gbr') 
           tvdbData.originalCountry  = 'uk';
        if(tvdbData.tvdb_id) 
           tvdbData.tvdbId = tvdbData.tvdb_id;
        tvdbData.searchDtlTxt = 
         ` ${tvdbData.year}, 
           ${tvdbData.originalCountry?.toUpperCase() || ''}`;
      });
      // console.log('searchList:', tvdbData);
      this.searchList = tvdbSrchData;
      this.showingSrchList = true;
    },

    async searchAction(srchChoice) {
      const {name, tvdbId, overview} = srchChoice;
      console.log('searchAction:', name);
      this.cancelSrchList();
      if(!pruneTvdb) {
        const matchShow = allShows.find((s) => s.Name == name);
        if(matchShow) {  
          console.log(matchShow.Name + ' already exists.');
          this.saveVisShow(matchShow, true);
          return;
        }
      }
      let show = {
        Name: name,
        TvdbId: tvdbId,
        Overview: overview,
        Reject: emby.isReject(name),
      };
      show = await emby.createNoemby(show);
      const paramObj = {
        show,
        seasonCount:  0, 
        episodeCount: 0, 
        watchedCount: 0, 
      };
      let tvdbData = allTvdb[show.Name];
      if(tvdbData) {
        const {seasonCount, episodeCount, watchedCount} = tvdbData;
        Object.assign(paramObj, 
              {seasonCount, episodeCount, watchedCount});
      }
      tvdbData = await srvr.getNewTvdb(paramObj);
      delete tvdbData.deleted;
      allTvdb[show.Name] = tvdbData;
      await srvr.addBlockedWait(show.Name);
      this.addRow(show);
      this.sortShows();
      this.saveVisShow(show, true);
    },
    
    cancelSrchList() {
      console.log('closing searchlist');
      this.showingSrchList = false;
      this.searchList      = null;
      srchListWeb          = null;
    },

    topClick() {
      const container = document.querySelector("#shows");
      container.scrollTop = 0;
      this.saveVisShow(this.shows[0], true);
    },

    prevNextClick(next) {
      if(showHistory.length == 0) return;
      const newPtr = showHistoryPtr + (next ? 1 : -1);
      if(newPtr < 0 || newPtr >= showHistory.length) return;
      showHistoryPtr = newPtr;
      const show = showHistory[showHistoryPtr];
      const showArr = this.shows.filter(
              (showIn) => showIn.Name == show.Name);
      if (showArr.length == 0) {
        this.fltrAction('All');
      }
      this.saveVisShow(show, true);
    },

    allClick() {
      this.fltrAction('All');
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
      if(!show) {
        console.error('saveVisShow show param null');
        return;
      }
      const showName = show.Name;
      if(showHistoryPtr == -1 ||
           showName != showHistory[showHistoryPtr].Name) {
        // console.log("adding show to history:", showName);
        showHistory.push(show);
        showHistoryPtr = showHistory.length - 1;
        // showHistory = showHistory.slice(0, showHistoryPtr+1);
      }
      this.highlightName = showName;
      window.localStorage.setItem("lastVisShow", showName);
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
      this.showAll();
      window.localStorage.setItem("fltrChoice", fltrChoice);
      this.fltrChoice = fltrChoice;
      this.sortPopped = false;
      this.fltrPopped = false;
      this.filterStr = "";
      for (let cond of this.conds) {
         util.setCondFltr(cond, this.fltrChoice);
        //  console.log('cond:', cond.name, cond.filter);
      }
      await this.select();
      this.sortShows();
    },

    scrollToSavedShow(saveVis = false) {
      let show = null;
      this.$nextTick(() => {
        const name = window.localStorage.getItem("lastVisShow");
        if(!name) {
          console.log(
              "scrollToSavedShow: lastVisShow missing, ignoring");
          show = allShows[0];
        } 
        else {
          show = allShows.find((shw) => shw.Name == name);
          if (!show) {
            console.log("scrollToSavedShow: show not found", name);
            show = allShows[0];
          }
        }
        if(saveVis) this.saveVisShow(show);
        const id  = this.nameHash(show.Name);
        const ele = document.getElementById(id);
        if (ele) ele.scrollIntoView({block: "center"});
      });
    },

    async copyNameToClipboard(show, event) {
      console.log('copyNameToClipboard', show.Name);
      const ele = event.target;
      const color = ele.style.color;
      ele.style.color = "#f00";
      await navigator.clipboard.writeText(show.Name);
      this.saveVisShow(show);
      ele.style.color = color
    },

    async episodeClick(e, show, season, episode) {
      let deleted = null;
      if(e.ctrlKey) {
        const ok = 
          confirm(`OK to delete file for ${show.Name} ` +
                     `S${season}E${episode} ?`);
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
      this.hideMapBottom     = true;
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
      this.hideMapBottom = false;
      this.saveVisShow(show);
    },

    condFltrClick(cond, event) {
      this.fltrChoice = '- - - - -';
      if(cond.name == 'gap' && event.ctrlKey) {
        allShows.forEach((show) =>  {
          if(show.BlockedGap) {
            show.BlockedGap = false;
            srvr.delBlockedGap(show.Name);
            cond.filter = 1;
          }
        });
      }
      else if (++cond.filter == 2) cond.filter = -1;
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

    async select(scroll = true) {
      allTvdb = await tvdb.getAllTvdb();
      let srchStrLc;
      if(this.fltrChoice !== 'Finished') {
        if(this.filterStr.length > 0) 
              this.fltrChoice = '- - - - -';
        srchStrLc = this.filterStr == "" 
                    ? null : this.filterStr.toLowerCase();
      }
      const filteredShows = [];
      fltrLoop:
      for(const show of allShows) {
        if(this.fltrChoice === 'Finished') {
          const tvdbData = allTvdb[show.Name];
          if(!tvdbData) continue;
          const {status, episodeCount, watchedCount} = tvdbData;
          const finished = (status == "Ended"            && 
                            watchedCount == episodeCount &&
                            !show.Reject);
          if(finished) filteredShows.push(show);
          continue;
        }
        if (srchStrLc && 
           !show.Name.toLowerCase().includes(srchStrLc)) continue;
        for (let cond of this.conds) {
          if ( cond.filter ===  0) continue;
          if ((cond.filter === +1) != (!!cond.cond(show))) 
            continue fltrLoop;
        }
        filteredShows.push(show);
      }
      this.shows = filteredShows;
      if (this.shows.length === 1) 
        this.saveVisShow(this.shows[0]);
      else {
        const showArr = this.shows.filter(
                (show) => show.Name == this.highlightName);
        if (showArr.length == 0)
          this.saveVisShow(this.shows[0]);
      }
      if (scroll) this.scrollToSavedShow();
      this.sortShows();
    },

    watchClick() {
      console.log('watchClick');
      if(this.watchingName !== '---') {
        window.localStorage.setItem("lastVisShow", this.watchingName);
        this.scrollToSavedShow(true);
      }
    },


    /////////////////  UPDATE METHODS  /////////////////

    showAll(dontClrFilters = false) {
      // if(dontClrFilters?.altKey !== undefined) dontClrFilters = false;
      this.filterStr = "";
      if(!dontClrFilters) {
        for (let cond of this.conds) cond.filter = 0;
      }
      this.fltrChoice = 'All';
      this.shows = [...allShows];
      // this.select(true);
    },

    async addGapToShow(event) {
      const {showId, progress, notReady, anyWatched,
             watchGap, watchGapSeason, watchGapEpisode, 
             fileEndError, seasonWatchedThenNofile,
             fileGap,  fileGapSeason,  fileGapEpisode}
                          = event.data;
      this.gapPercent = progress;
      const save = progress == 100;
      
      const show = allShows.find((show) => show.Id == showId);
      if(!show) return;

      // if(fileEndError)
      //   console.log('fileEndError', show.Name);

      if(anyWatched && show.InToTry) {
        show.InToTry = false;
        emby.saveToTry(show.Id, false)
          .catch((err) => {
              console.error(
                "addGapToShow, late saveToTry error:", err);
          });
      }

      const blockedGap  = blockedGapShows .includes(show.Name);
      const blockedWait = blockedWaitShows.includes(show.Name);

      const gap = {};
      gap.ShowId          = showId;
      gap.FileGapSeason   = fileGapSeason;
      gap.FileGapEpisode  = fileGapEpisode;
      gap.WatchGapSeason  = watchGapSeason;
      gap.WatchGapEpisode = watchGapEpisode;
      gap.WatchGap        = watchGap; 
      gap.NotReady        = notReady;
      gap.BlockedGap      = blockedGap;
      gap.Waiting         = !blockedWait;
      gap.WaitStr         = await tvdb.getWaitStr(show);
      gap.FileGap = !(!notReady && show.InToTry) &&
                     (fileGap || fileEndError || seasonWatchedThenNofile);
      Object.assign(show, gap);
      await srvr.addGap([show.Id, gap, save]);
    }
  },

  /////////////////  MOUNTED  /////////////////
  mounted() {
    evtBus.on('openMap', (show) => {
      this.seriesMapAction('open', show);
    });

    setInterval(async () => {
      const curWatch = await emby.getCurrentlyWatching();
      if(curWatch == 'rokuOff' ||
         curWatch == 'nothingPlaying') {
        this.watchingName = '---';
        return;
      }
      const  {showName} = curWatch;
      if(showName === null)  this.watchingName = '----';
      else                   this.watchingName = showName;
    }, 5*1000);

    (async () => {
      document.addEventListener('keydown', (event) => {
        if(event.code == 'Escape') {
          this.remotesAction('close');
          this.seriesMapAction('close');
        }
      }); 

      try {
        await emby.init();

        const showsBlocks = await emby.loadAllShows();
        if(!showsBlocks) {
          console.error("No shows from loadAllShows");
          return;
        }
        allShows = showsBlocks.shows;
        this.shows = [...allShows];

        // must be set before startWorker
        blockedWaitShows = showsBlocks.blockedWaitShows;
        blockedGapShows  = showsBlocks.blockedGapShows;

        let showList = allShows;
        // showList = [allShows.find((show) => // for testing
        //                 show.Name == 'Splitting Up Together (US)')]; 
        if(!pruneTvdb) 
          emby.startGapWorker(showList, this.addGapToShow);

        this.sortByNew  = true;
        this.sortBySize = false;
        this.sortChoice = 
          window.localStorage.getItem("sortChoice") ?? 'Viewed';
        this.showAll(true);
        this.sortShows();

        const name = window.localStorage.getItem("lastVisShow");
        if (!name)   window.localStorage.setItem("lastVisShow",
                                       allShows[0].Name);
        this.scrollToSavedShow(true);

        // ... temp one-time mass operations ...
        // await util.fixShowidInTvdbs(allShows);
        // await util.clrEndedContinues(allShows);
        // await util.adjustDeletedFlags(allShows);
        // await util.delPickups(allShows);
        // await util.setPickups(allShows);
        // await util.setTvdbDeleted(allShows);
        // await util.removeDeadShows(allShows);
        // await util.listCountries(allShows);
        // await util.setAllFavs(allShows);
        // await util.setAllTvdbShowIds(allShows);
        // await util.setAllNoEmbyTvdbIds(allShows);
        // await util.removeNoMatchsFromTvdbJson()
        // await util.removeDontSavesFromTvdbJson()
        // await util.loadAllRemotes(allShows); // takes many hours
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
