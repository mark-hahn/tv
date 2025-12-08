<template lang="pug">

#list(style="height:100%; padding:0; margin:0; display:flex; flex-direction:column; align-items:center;")
  #searchingModal(v-if="showSearching" style="position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background-color:white; padding:30px 40px; border:2px solid black; border-radius:10px; box-shadow:0 4px 6px rgba(0,0,0,0.3); z-index:1000; text-align:center;")
    div(style="font-size:18px; font-weight:bold; margin-bottom:10px;") Searching web for information about show:
    div(style="font-size:20px; color:#0066cc; margin-bottom:15px;") {{searchingShowName}}
    div(style="font-size:16px; color:#666;") Please wait ...
  
  #center(:style="{ height:'100%', width: sizing.listWidth || '800px', display:'flex', flexDirection:'column' }")             
    #hdr(style="width:100%; background-color:#ccc; display:flex; flex-direction:column;")

      HdrTop(
        :showsLength="shows.length"
        :allShowsLength="allShowsLength"
        :gapPercent="gapPercent"
        v-model:filterStr="filterStr"
        v-model:webHistStr="webHistStr"
        :watchingName="watchingName"
        :showingSrchList="showingSrchList"
        :searchList="searchList"
        :simpleMode="simpleMode"
        @search-click="searchClick"
        @watch-click="watchClick"
        @filter-input="select"
        @cancel-srch-list="cancelSrchList"
        @search-action="searchAction"
      )

      HdrBot(
        v-if="!simpleMode"
        :conds="conds"
        :sortPopped="sortPopped"
        :fltrPopped="fltrPopped"
        :sortChoices="sortChoices"
        :fltrChoices="fltrChoices"
        :selectedSort="sortChoice"
        :selectedFilter="fltrChoice"
        @top-click="topClick"
        @prev-next-click="prevNextClick"
        @sort-click="sortClick"
        @filter-click="filterClick"
        @all-click="allClick"
        @cond-fltr-click="condFltrClick"
        @sort-action="sortAction"
        @fltr-action="fltrAction"
      )

    #showsContainer(style="display:flex; flex-grow:1; overflow:hidden; min-height:0;")
      Buttons(
        v-if="simpleMode"
        style="width:140px; flex-shrink:0;"
        :sizing="sizing"
        @button-click="handleButtonClick"
        @top-click="topClick"
      )
      Shows(
        style="flex-grow:1;"
        :shows="shows"
        :conds="conds"
        :highlightName="highlightName"
        :getSortDisplayValue="getValBySortChoice"
        :allShowsLength="allShowsLength"
        :showConds="!simpleMode"
        :simpleMode="simpleMode"
        @copy-name="copyNameToClipboard"
        @open-map="(show) => seriesMapAction('open', show)"
        @select-show="saveVisShow"
        @wait-str-click="waitStrClick"
      )
</template>


<script>
import * as emby from "../emby.js";
import * as tvdb from "../tvdb.js";
import * as srvr from "../srvr.js";
import * as util from "../util.js";
import    evtBus  from '../evtBus.js';
import    Shows   from './shows.vue';
import    HdrTop  from './hdrtop.vue';
import    HdrBot  from './hdrbot.vue';
import    Buttons from './buttons.vue';

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

  components: { FontAwesomeIcon, Shows, HdrTop, HdrBot, Buttons },

  emits: ['show-map', 'hide-map'],
  
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

    const toggleWaiting = async (show) => {
      // console.log("toggleWaiting", show.Name);
      this.saveVisShow(show);
      if(show.Waiting) {
        show.Waiting = false;
        await srvr.addBlockedWait(show.Name);
      }
      else if (show.WaitStr?.length > 0) {
        show.Waiting = true;
        await srvr.delBlockedWait(show.Name); 
      }
    };

    const toggleBlkGap = async (show) => {
      // console.log("toggleBlkGap", show.Name);
      this.saveVisShow(show);
      if(show.BlockedGap) {
        show.BlockedGap = false;
        await srvr.delBlockedGap(show.Name);
      }
      else {
        show.BlockedGap = true;
        await srvr.addBlockedGap(show.Name); 
      }
    };
    
    const toggleToTry = async (show) => {
      if(show.Id.startsWith("noemby-") &&
           !show.InToTry) return;
      this.saveVisShow(show);
      show.InToTry = !show.InToTry;
      await emby.saveToTry(show.Id, show.InToTry)
          .catch((err) => {
              console.error("late toggleToTry error:", err);
              //- show.InToTry = !show.InToTry;
            });
    };

    const toggleContinue = (show) => {
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

    const toggleMark = (show) => {
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

    const toggleLinda = (show) => {
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

    const toggleFavorite = (show) => {
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
      if(!show.Reject && !show.Id.startsWith('noemby-')) {
        if (!window.confirm(
            `Do you really want to delete series ${show.Name}?`)) 
          return;
        await emby.deleteShowFromEmby(show);
        srvr.addReject(show.Name) 
                .catch((err) => {
                    console.error("late addReject:", err);
                });
        await this.removeRow(show);
        show.Reject = true;
        return;
      }
      if(show.Reject) {
        srvr.delReject(show.Name) 
                .catch((err) => {
                    console.error("late delReject:", err);
                });
        show.Reject = false;
        return;
      }
    };

    const togglePickup = (show) => {
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
        await srvr.setTvdbFields({name, $delTvdb:true});
      }
      else {
        const deleted = tvdbData.deleted = util.fmtDate();
        allTvdb[name] = await srvr.setTvdbFields({name, deleted});
      }
      await srvr.deleteShowFromSrvr(show);
      await this.removeRow(show);
    }

    evtBus.on('deleteShow', async (show) => {
      // console.log('evtBus deleteShow', show.Name);
      if(!show) return;
      await deleteShow(show);
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
      showSearching:     false,
      searchingShowName: '',        
      sortChoices:          
        ['Alpha', 'Viewed', 'Added', 'Ratings', 'Size'],
      fltrChoices:
        ['All', 'Ready', 'Drama', 'To-Try', 
         'Try Drama', 'Continue', 'Download', 
         'Mark', 'Linda', 'Finished'],
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
          async click(show) { await toggleBlkGap(show); },
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
          async click(show) { await toggleToTry(show); },
           name: "totry",
        }, {
          color: "lime", filter: 0, icon: ["fas", "arrow-right"],
          cond(show)  { return show.InContinue; },
          async click(show) { await toggleContinue(show); },
           name: "continue",
        }, {
          color: "lime", filter: 0, icon: ["fas", "mars"],
          cond(show)  { return show.InMark; },
          async click(show) { await toggleMark(show); },
           name: "mark",
        }, {
          color: "lime", filter: 0, icon: ["fas", "venus"],
          cond(show)  { return show.InLinda; },
          async click(show) { await toggleLinda(show); },
          name: "linda",
        }, {
          color: "red", filter: 0, icon: ["far", "heart"],
          cond(show)  { return show.IsFavorite; },
          async click(show) { await toggleFavorite(show); },
          name: "favorite",
        }, {
          color: "red", filter: -1, icon: ["fas", "ban"],
          cond(show)  { return show.Reject; },
          async click(show) { await toggleReject(show); },
          name: "ban",
        }, {
          color: "#5ff", filter: 0, icon: ["fas", "arrow-down"],
          cond(show)  { return show.Pickup; },
          async click(show) { await togglePickup(show); },
          name: "pickup",
        }, {
          color: "#a66", filter: 0, icon: ["fas", "tv"],
          cond(show)  { return !show.Id.startsWith("noemby-"); },
          async click(show) { await deleteShow(show); },
          name: "hasemby",
        },
      ],
    };
  },

  /////////////  METHODS  ////////////
  methods: {

    async handleButtonClick(activeButtons) {
      // In simple mode, button states control conds (pure state-based)
      if (!this.simpleMode) return;
      
      // activeButtons is an object with all button states
      // e.g., { 'Drama': true, 'Mark': true, 'Comedy': false, ... }
      
      // Map button labels to cond names
      const buttonToCondMap = {
        'Ready To Watch': 'unplayed',
        'Drama': 'drama',
        'Comedy': 'drama', // Comedy uses drama cond but inverted
        'To Try': 'totry',
        'Continue': 'continue',
        'Mark': 'mark',
        'Linda': 'linda'
      };
      
      // Map order button labels to sortChoice values
      const orderToSortMap = {
        'Added Order': 'Added',
        'Viewed Order': 'Viewed',
        'Ratings Order': 'Ratings'
      };
      
      // Pure state-based: Sync conds to match button states
      this.conds.forEach(cond => {
        // Ban is always -1 in simple mode
        if (cond.name === 'ban') {
          cond.filter = -1;
          return;
        }
        
        // Find if any button controls this cond
        let condValue = 0; // Default: off
        
        for (const [label, isActive] of Object.entries(activeButtons)) {
          const mappedCondName = buttonToCondMap[label];
          if (mappedCondName === cond.name && isActive) {
            // Special handling for Comedy button - inverts the drama cond
            condValue = (label === 'Comedy') ? -1 : 1;
            break;
          }
        }
        
        cond.filter = condValue;
      });
      
      // Pure state-based: Sync sortChoice to match order button states
      let activeSortOrder = null;
      for (const [label, isActive] of Object.entries(activeButtons)) {
        if (isActive && orderToSortMap[label]) {
          activeSortOrder = orderToSortMap[label];
          break;
        }
      }
      
      // If no order button is active, default to 'Alpha'
      const previousSort = this.sortChoice;
      this.sortChoice = activeSortOrder || 'Alpha';
      
      // Trigger re-filtering of shows
      await this.select();
      
      // If sort changed, go to top
      if (previousSort !== this.sortChoice) {
        this.saveVisShow(this.shows[0], true);
        this.scrollToSavedShow();
      }
    },

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
            this.webHistStr = "No series.";
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
          this.webHistStr = "-- No Series --";
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
      
      // Show searching modal
      this.searchingShowName = name;
      this.showSearching = true;
      
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
      
      // Hide searching modal
      this.showSearching = false;
      
      delete tvdbData.deleted;
      allTvdb[show.Name] = tvdbData;
      await srvr.addBlockedWait(show.Name);
      this.addRow(show);
      this.sortShows();
      this.saveVisShow(show, true);
      
      // Send email notification for new show added
      const emailText = show.Name + '~New show added';
      try {
        await srvr.sendEmail(emailText);
        console.log('New show email sent:', emailText);
      } catch (error) {
        console.error('Failed to send new show email:', error);
      }
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

    async prevNextClick(next) {
      if(showHistory.length == 0) return;
      const newPtr = showHistoryPtr + (next ? 1 : -1);
      if(newPtr < 0 || newPtr >= showHistory.length) return;
      showHistoryPtr = newPtr;
      const show = showHistory[showHistoryPtr];
      const showArr = this.shows.filter(
              (showIn) => showIn.Name == show.Name);
      if (showArr.length == 0) {
        await this.fltrAction('All');
      }
      this.saveVisShow(show, true);
    },

    async allClick() {
      await this.fltrAction('All');
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
      
      // If map is showing, update it to show the newly selected show
      if(this.mapShow !== null) {
        this.seriesMapAction('open', show);
      }
    },

    sortClick() {
      this.sortPopped = !this.sortPopped;
      console.debug("🚀 ~ sortPopped:", sortPopped)
      this.fltrPopped = false;
    },

    sortAction(sortChoice) {
      if (sortChoice != 'sortClose') {
        this.sortChoice = sortChoice;
        this.sortShows();
        setTimeout(() => {
          this.saveVisShow(this.shows[0], true);
        }, 0);
      }
      this.sortPopped = false;
      this.fltrPopped = false;
    },

    filterClick() {
      this.fltrPopped = !this.fltrPopped
      this.sortPopped = false;
    },

    async fltrAction(fltrChoice) {
      console.log('fltrAction', fltrChoice);
      if (fltrChoice != 'fltrClose') {
        this.showAll();
        window.localStorage.setItem("fltrChoice", fltrChoice);
        this.fltrChoice = fltrChoice;
        this.filterStr = "";
        for (let cond of this.conds) {
          util.setCondFltr(cond, this.fltrChoice);
          //  console.log('cond:', cond.name, cond.filter);
        }
        await this.select();
        this.sortShows();
      }
      this.sortPopped = false;
      this.fltrPopped = false;
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

    async episodeClick(e, show, season, episode, setWatched = null) {
      let deleted = null;
      if(e.ctrlKey) {
        const ok = 
          confirm(`OK to delete file for ${show.Name} ` +
                     `S${season}E${episode} ?`);
        if(!ok) return;
        // delete episode file
        await emby.editEpisode(show.Id, season, episode, true, setWatched);
        deleted = {season, episode};
      }
      else // toggle watched or set to specific value
        await emby.editEpisode(show.Id, season, episode, false, setWatched);

      await this.seriesMapAction('', show, deleted);
    },

    async waitStrClick(show) {
      console.log("waitStrClick", show.Name);
      this.saveVisShow(show);
      if (show.WaitStr?.length > 0) {
        show.Waiting = true;
        await srvr.delBlockedWait(show.Name);
      }
    },

    async seriesMapAction(action, show, wasDeleted) {
      if(action == 'close') {
        this.mapShow = null;
        this.$emit('hide-map');
        return;
      }
      if(action == 'open' && this.mapShow === show) {
        // If clicking the same show, keep the map open
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
      
      // Emit to App.vue to show map
      this.$emit('show-map', {
        mapShow: this.mapShow,
        hideMapBottom: this.hideMapBottom,
        seriesMapSeasons: this.seriesMapSeasons,
        seriesMapEpis: this.seriesMapEpis,
        seriesMap: this.seriesMap
      });
    },

    async condFltrClick(cond, event) {
      this.fltrChoice = '- - - - -';
      if (cond.name == 'gap' && event.ctrlKey) {
        for (const show of allShows) {
          if (show.BlockedGap) {
            show.BlockedGap = false;
            await srvr.delBlockedGap(show.Name);
            cond.filter = 1;
          }
        }
      }
      else if (++cond.filter == 2) cond.filter = -1;
      await this.select();
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
          const watchedAll = episodeCount > 0 && watchedCount == episodeCount;
          const finished = (status == "Ended"            && 
                            watchedAll                   &&
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
      else if (this.highlightName) {
        // Only update selection if highlightName is already set
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
  async mounted() {
    evtBus.on('openMap', (show) => {
      console.log('List: openMap event received for show:', show?.Name);
      this.seriesMapAction('open', show);
    });
    
    // Listen for map actions from App.vue
    evtBus.on('mapAction', async ({ action, show }) => {
      await this.seriesMapAction(action, show);
    });
    
    // Listen for episode clicks from App.vue
    evtBus.on('episodeClick', async ({ e, show, season, episode, setWatched }) => {
      await this.episodeClick(e, show, season, episode, setWatched);
    });

    setInterval(async () => {
      const devices  = await srvr.getDevices();
      let   showName = null; 
      for(const device of devices) {
        if(!device.showName) continue;
        showName = device.showName;
        if(device.deviceName == 'chromecast') break;
      }
      this.watchingName = showName ?? '---';
    }, 10*1000);

    await (async () => {
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
        this.sortChoice = 'Alpha';
        
        // Initialize ban condition to -1 to filter out rejected shows BEFORE showAll
        const banCond = this.conds.find(c => c.name === 'ban');
        if (banCond) {
          banCond.filter = -1;
        }
        
        this.showAll(true);
        this.select(); // Apply filters including ban
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
