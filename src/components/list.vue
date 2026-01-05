<template lang="pug">

#list(style="height:100%; padding:0; margin:0; display:flex; flex-direction:column; align-items:center;")
  #searchingModal(v-if="showSearching" style="position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background-color:white; padding:30px 40px; border:2px solid black; border-radius:10px; box-shadow:0 4px 6px rgba(0,0,0,0.3); z-index:1000; text-align:center;")
    div(style="font-size:18px; font-weight:bold; margin-bottom:10px;") Searching web for information about show:
    div(style="font-size:20px; color:#0066cc; margin-bottom:15px;") {{searchingShowName}}
    div(style="font-size:16px; color:#666; margin-bottom:6px;") {{ searchingStatus || 'Please wait ...' }}

  #reloadingShowsModal(v-if="showReloadingShows" @click.stop style="position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background-color:white; padding:30px 40px; border:2px solid black; border-radius:10px; box-shadow:0 4px 6px rgba(0,0,0,0.3); z-index:10000; text-align:center;")
    div(style="font-size:18px; font-weight:bold;") Reloading Shows

  #embyRefreshingModal(v-if="showEmbyRefreshing" @click.stop style="position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background-color:white; padding:30px 40px; border:2px solid black; border-radius:10px; box-shadow:0 4px 6px rgba(0,0,0,0.3); z-index:10000; text-align:center;")
    div(style="font-size:18px; font-weight:bold;") Emby is being refreshed.
  
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
        @send-filters="sendSharedFilters"
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
        v-if="simpleMode && !hideButtonsPane"
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
        @select-show="onSelectShow"
      )
</template>


<script>
import * as emby from "../emby.js";
import * as tvdb from "../tvdb.js";
import * as srvr from "../srvr.js";
import * as util from "../util.js";
import parseTorrentTitle from 'parse-torrent-title';
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
let srchListWeb      = null;
let gapWorkerRunning = false;
const pruneTvdb = (window.location.href.slice(-5) == 'prune');

export default {
  name: "List",

  components: { FontAwesomeIcon, Shows, HdrTop, HdrBot, Buttons },

  emits: ['show-map', 'hide-map', 'all-shows'],
  
  props: {
    simpleMode: {
      type: Boolean,
      default: false
    },
    hideButtonsPane: {
      type: Boolean,
      default: false
    },
    sizing: {
      type: Object,
      default: () => ({})
    }
  },

  data() {

    const toggleNoEmbyFlag = async (show, flagName) => {
      this.saveVisShow(show);
      // If the flag doesn't exist yet, treat it as false and set to true.
      show[flagName] = !show[flagName];
      await srvr.addNoEmby(show)
        .catch((err) => {
          console.error(`late addNoEmby error (${flagName}):`, err);
        });
    };
    
    const toggleToTry = async (show) => {
      if (show.Id.startsWith("noemby-")) {
        await toggleNoEmbyFlag(show, 'InToTry');
        return;
      }
      this.saveVisShow(show);
      show.InToTry = !show.InToTry;
      await emby.saveToTry(show.Id, show.InToTry)
        .catch((err) => {
          console.error("late toggleToTry error:", err);
          //- show.InToTry = !show.InToTry;
        });
    };

    const toggleContinue = async (show) => {
      if (show.Id.startsWith("noemby-")) {
        await toggleNoEmbyFlag(show, 'InContinue');
        return;
      }
      this.saveVisShow(show);
      show.InContinue = !show.InContinue;
      emby.saveContinue(show.Id, show.InContinue)
        .catch((err) => {
          console.error("late saveContinue error:", err);
          //- show.InContinue = !show.InContinue;
        });
    };

    const toggleMark = async (show) => {
      if (show.Id.startsWith("noemby-")) {
        await toggleNoEmbyFlag(show, 'InMark');
        return;
      }
      this.saveVisShow(show);
      show.InMark = !show.InMark;
      emby.saveMark(show.Id, show.InMark)
        .catch((err) => {
          console.error("late toggleMark error:", err);
          //- show.InMark = !show.InMark;
        });
    };

    const toggleLinda = async (show) => {
      if (show.Id.startsWith("noemby-")) {
        await toggleNoEmbyFlag(show, 'InLinda');
        return;
      }
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
        // Optimistically remove from UI before slow deletes
        this.removeRow(show);
        // Delete files from server first, then from Emby
        await srvr.deleteShowFromSrvr(show);
        await emby.deleteShowFromEmby(show);
      } else {
        // Non-emby: still remove immediately
        this.removeRow(show);
        await srvr.deleteShowFromSrvr(show);
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
      currentPane:       'series',
      mapShow:            null,
      hideMapBottom:      true,
      seriesMapSeasons:     [],
      seriesMapEpis:        [],
      seriesMap:            {},
      gapPercent:            0,
      watchingName:      '---',
      currentPlayingDevice: null,
      sortPopped:        false,
      sortChoice:     'Viewed', 
      fltrPopped:        false,
      fltrChoice:        'All',  
      showingSrchList:   false,
      searchList:         null,
      showSearching:     false,
      searchingShowName: '',        
      searchingStatus:   '',
      showReloadingShows: false,
      showEmbyRefreshing: false,
      allNotesCache: {},
      allNotesCacheAt: 0,
      allNotesCacheInFlight: null,
      wasFilterEmpty: true,
      sortChoices:          
        ['Alpha', 'Viewed', 'Added', 'Ratings', 'Notes', 'Size'],
      fltrChoices:
        ['All', 'Try Drama', 'Download', 'Notes', 'Finished'],
      conds: [ {
          color: "#0cf", filter: 0, icon: ["fas", "plus"],
          cond(show)  { return !show.NotReady },
          click() {}, name: "unplayed",
        }, {
          color: "#f88", filter: 0, icon: ["fas", "minus"],
          cond(show)  { 
            return (show.FileGap || show.WatchGap ||
                    (show.Id.startsWith("noemby-") && !show.S1E1Unaired));
          },
          click() { },
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

    async getAllNotesCached(ttlMs = 3000) {
      const now = Date.now();
      if (this.allNotesCache && (now - (this.allNotesCacheAt || 0)) < ttlMs) {
        return this.allNotesCache;
      }

      if (this.allNotesCacheInFlight) {
        return await this.allNotesCacheInFlight;
      }

      this.allNotesCacheInFlight = (async () => {
        try {
          const res = await srvr.getAllNotes();
          this.allNotesCache = (res && typeof res === 'object') ? res : {};
          this.allNotesCacheAt = Date.now();
          return this.allNotesCache;
        } catch (err) {
          console.error('List: getAllNotes failed', err);
          this.allNotesCache = this.allNotesCache || {};
          this.allNotesCacheAt = Date.now();
          return this.allNotesCache;
        } finally {
          this.allNotesCacheInFlight = null;
        }
      })();

      return await this.allNotesCacheInFlight;
    },

    async sendSharedFilters(e) {
      // Save current filter settings (for simple-mode Custom button).
      // If we're effectively in "All" mode, clear sharedFilters instead.
      try {
        // Ctrl-click: load sharedFilters into internal state (like simple-mode Custom).
        if (e && e.ctrlKey) {
          let shared = null;
          try {
            shared = await srvr.getSharedFilters();
          } catch (err) {
            console.error('ctrl-send: getSharedFilters failed', err);
            shared = null;
          }

          if (shared && typeof shared === 'object') {
            if (shared.filterStr !== undefined) this.filterStr = String(shared.filterStr || '');
            if (shared.fltrChoice !== undefined) this.fltrChoice = String(shared.fltrChoice || 'All');

            const condFilters = shared.condFilters && typeof shared.condFilters === 'object' ? shared.condFilters : null;
            if (condFilters) {
              this.conds.forEach((cond) => {
                if (!cond?.name) return;
                if (condFilters[cond.name] !== undefined) {
                  cond.filter = condFilters[cond.name];
                }
              });
            }
          }

          // Always keep ban enabled.
          const banCond = this.conds.find(c => c?.name === 'ban');
          if (banCond) banCond.filter = -1;

          await this.select();
          this.sortShows();

          this.$nextTick(() => {
            const container = document.querySelector('#shows');
            if (container) container.scrollTop = 0;
            if (Array.isArray(this.shows) && this.shows.length > 0) {
              this.saveVisShow(this.shows[0], false);
            }
          });
          return;
        }

        const condFilters = {};
        (this.conds || []).forEach((c) => {
          if (!c?.name) return;
          condFilters[c.name] = c.filter;
        });

        // Always keep ban enabled for shared filters.
        condFilters.ban = -1;

        const payload = {
          fltrChoice: this.fltrChoice,
          filterStr: this.filterStr,
          condFilters,
        };

        const isAllMode =
          (this.fltrChoice === 'All') &&
          (!this.filterStr || String(this.filterStr).length === 0) &&
          (this.conds || []).every((c) => {
            if (!c?.name) return true;
            if (c.name === 'ban') return c.filter === -1; // default ban behavior
            return c.filter === 0;
          });

        if (isAllMode) {
          await srvr.setSharedFilters(null);
        } else {
          await srvr.setSharedFilters(payload);
        }
      } catch (e) {
        console.error('sendSharedFilters failed:', e);
      }
    },

    async handleButtonClick(activeButtons) {
      // In simple mode, button states control conds (pure state-based)
      if (!this.simpleMode) return;

      // Custom: apply previously-shared filter state (saved by non-simple Send).
      if (activeButtons && activeButtons['Custom']) {
        try {
          const shared = await srvr.getSharedFilters();
          if (shared && typeof shared === 'object') {
            if (shared.filterStr !== undefined) this.filterStr = String(shared.filterStr || '');
            if (shared.fltrChoice !== undefined) this.fltrChoice = String(shared.fltrChoice || 'All');
            const condFilters = shared.condFilters && typeof shared.condFilters === 'object' ? shared.condFilters : null;
            if (condFilters) {
              this.conds.forEach((cond) => {
                if (!cond?.name) return;
                if (condFilters[cond.name] !== undefined) {
                  cond.filter = condFilters[cond.name];
                }
              });
            }
          }
        } catch (e) {
          console.error('Custom sharedFilters parse/apply failed:', e);
        }

        // Always keep ban enabled.
        const banCond = this.conds.find(c => c?.name === 'ban');
        if (banCond) banCond.filter = -1;

        // Preserve current sort unless an order button is active.
        const orderToSortMap = {
          'Added Order': 'Added',
          'Viewed Order': 'Viewed',
          'Ratings Order': 'Ratings',
          'Notes Order': 'Notes'
        };
        let activeSortOrder = null;
        for (const [label, isActive] of Object.entries(activeButtons || {})) {
          if (isActive && orderToSortMap[label]) {
            activeSortOrder = orderToSortMap[label];
            break;
          }
        }
        if (activeSortOrder) {
          this.sortChoice = activeSortOrder;
        }

        await this.select();
        this.sortShows();

        // When clicking Custom, scroll to top and select first show.
        this.$nextTick(() => {
          const container = document.querySelector('#shows');
          if (container) container.scrollTop = 0;
          if (Array.isArray(this.shows) && this.shows.length > 0) {
            this.saveVisShow(this.shows[0], false);
          }
        });
        return;
      }

      // Not in Custom: ensure any previously-applied sharedFilters state does not
      // linger (but do NOT delete localStorage.sharedFilters; Custom can be used again).
      this.filterStr = '';
      this.fltrChoice = 'All';

      // Always keep ban enabled.
      const banCond = this.conds.find(c => c?.name === 'ban');
      if (banCond) banCond.filter = -1;
      
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
        'Ratings Order': 'Ratings',
        'Notes Order': 'Notes'
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
        case 'Notes':
          if (!forSort) return '';
          return String(show?.Notes ?? '').trim().toLowerCase();
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
      if (!show) return;
      const existsById = (arr) => Array.isArray(arr) && arr.some((s) => s?.Id && s.Id === show.Id);
      const existsByName = (arr) => Array.isArray(arr) && arr.some((s) => s?.Name && s.Name === show.Name);
      const alreadyExists = existsById(allShows) || existsByName(allShows) || existsById(this.shows) || existsByName(this.shows);
      if (alreadyExists) {
        // Don't insert duplicates; just select/highlight.
        this.saveVisShow(show, true);
        return;
      }

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
      this.searchingStatus = 'Starting...';

      const setWebAddStatus = (txt) => {
        this.searchingStatus = txt;
        console.log('web add progress:', name, txt);
      };
      const withTimeout = async (promise, ms, label) => {
        const timeoutMs = Math.max(0, Number(ms) || 0);
        let t;
        const timeout = new Promise((_, reject) => {
          t = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), timeoutMs);
        });
        try {
          return await Promise.race([promise, timeout]);
        } finally {
          clearTimeout(t);
        }
      };

      let show = null;
      const reject = emby.isReject(name);

      const showSeed = {
        Name: name,
        TvdbId: tvdbId,
        Overview: overview,
        Reject: reject,
      };

      const paramObj = {
        show: showSeed,
        seasonCount:  0,
        episodeCount: 0,
        watchedCount: 0,
      };
      // For no-Emby shows, never inherit episode/watched counts from any existing
      // tvdb.json entry keyed by the same name. Name-collisions (or stale tvdb data)
      // can otherwise leak watchedCount into a show that cannot be watched in Emby.
      let tvdbData = null;

      try {
        setWebAddStatus('Waiting for TVDB data...');
        tvdbData = await withTimeout(srvr.getNewTvdb(paramObj), 60000, 'tvdb data');

        // Derive the season list from the actual series map (episodes), not from seasonCount.
        let seriesMapSeasons = [];
        try {
          setWebAddStatus('Fetching season map...');
          const seriesMapIn = await withTimeout(
            tvdb.getSeriesMapByTvdbId(tvdbId),
            60000,
            'tvdb series map'
          );
          if (Array.isArray(seriesMapIn) && seriesMapIn.length > 0) {
            seriesMapSeasons = seriesMapIn
              .map((season) => Number(Array.isArray(season) ? season[0] : undefined))
              .filter((n) => Number.isFinite(n) && n > 0)
              .sort((a, b) => a - b);
          }
        } catch (e) {
          seriesMapSeasons = [];
          console.error('web add: failed to fetch series map', { name, tvdbId, err: e?.message || e });
        }

        const hasMapData = !!tvdbData && typeof tvdbData === 'object' && Object.keys(tvdbData).length > 0;

        // Prefer putting the show into Emby by creating the show folder and refreshing
        // the Emby library so it receives a real Emby Id.
        let createdFolder = false;
        if (!hasMapData) {
          createdFolder = false;
          console.error('web add: missing map data; skipping createShowFolder', {
            name,
            tvdbId,
            seriesMapSeasons,
            tvdbData,
          });
          alert(`No map data for new show ${name}`);
        } else {
          const res = await emby.createShowFolderAndRefreshEmby({
            showName: name,
            tvdbId,
            seriesMapSeasons,
            tvdbData,
            onStatus: setWebAddStatus,
            createTimeoutMs: 15000,
            refreshTimeoutMs: 120000,
          });
          createdFolder = !!res?.createdFolder;
          if (!createdFolder) {
            console.error('web add: createShowFolderAndRefreshEmby failed', { name, tvdbId, res });
          }
        }

        if (createdFolder) {
          try {
            setWebAddStatus('Reloading shows...');
            await this.newShows(false);
          } catch {
            // ignore
          }

          show = Array.isArray(allShows) ? allShows.find((s) => s?.Name === name) : null;
          if (show) {
            show.TvdbId = tvdbId;
            show.Overview = overview;
            show.Reject = reject;
          }
        }

        // Fallback: old behavior, track as a no-Emby placeholder.
        if (!show) {
          show = await emby.createNoemby(showSeed);
        }

        if (tvdbData) {
          delete tvdbData.deleted;
          allTvdb[show.Name] = tvdbData;
        }
        // If the show came from Emby via refresh + reload, it's already in allShows.
        // Only insert a new row for the no-Emby placeholder case.
        const alreadyInAllShows = Array.isArray(allShows) && (allShows.some((s) => s?.Id === show?.Id) || allShows.some((s) => s?.Name === show?.Name));
        if (!alreadyInAllShows) {
          this.addRow(show);
        } else {
          // Ensure it's selected even if current filters hide it.
          this.saveVisShow(show, true);
        }
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
      } catch (e) {
        console.error('web add: failed', { name, tvdbId, err: e?.message || e });
        alert(`Web add failed for ${name}`);
      } finally {
        this.showSearching = false;
        this.searchingStatus = '';
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
    onSelectShow(show, scroll = false) {
      console.log('List: selected show:', show);
      this.saveVisShow(show, scroll);
    },

    normalizeForShowMatch(name) {
      return String(name || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\b(and|the)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();
    },

    stripTitleNoise(raw) {
      let s = String(raw || '').trim();
      if (!s) return '';

      // Remove path prefix if present (Windows or Unix paths)
      s = s.replace(/^.*[\\/]/, '');

      // Remove common media extensions
      s = s.replace(/\.(mkv|mp4|avi|m4v|ts|m2ts|wmv|mov|mpg|mpeg|srt|sub|rar|zip|7z)$/i, '');

      return s.trim();
    },

    async selectShowFromCardTitle(rawTitle) {
      const raw = String(rawTitle || '').trim();
      if (!raw) return;
      if (!Array.isArray(allShows) || allShows.length === 0) return;

      const stripped = this.stripTitleNoise(raw);

      let parsed = null;
      try {
        const parser = parseTorrentTitle?.parse
          ? parseTorrentTitle.parse
          : (typeof parseTorrentTitle === 'function' ? parseTorrentTitle : null);
        parsed = parser ? parser(stripped) : null;
      } catch {
        parsed = null;
      }

      const candidates = [];
      const parsedTitle = String(parsed?.title || '').trim();
      if (parsedTitle) candidates.push(parsedTitle);
      if (stripped) candidates.push(stripped);
      candidates.push(raw);

      const candidateKeys = candidates
        .map(c => this.normalizeForShowMatch(c))
        .filter(Boolean);

      const showKeyOf = (show) => this.normalizeForShowMatch(show?.Name);

      // 1) Exact normalized match
      for (const key of candidateKeys) {
        const match = allShows.find(s => showKeyOf(s) === key);
        if (match) {
          if (!this.shows.some(sh => sh?.Name === match.Name)) {
            await this.fltrAction('All');
          }
          this.onSelectShow(match, true);
          return;
        }
      }

      // 2) Prefix/contains heuristic (pick strongest)
      let best = null;
      let bestScore = 0;
      for (const show of allShows) {
        const sk = showKeyOf(show);
        if (!sk) continue;
        for (const ck of candidateKeys) {
          if (!ck) continue;
          const isRelated = sk.startsWith(ck) || ck.startsWith(sk) || sk.includes(ck) || ck.includes(sk);
          if (!isRelated) continue;
          const score = Math.min(sk.length, ck.length);
          if (score > bestScore) {
            bestScore = score;
            best = show;
          }
        }
      }

      if (best) {
        if (!this.shows.some(sh => sh?.Name === best.Name)) {
          await this.fltrAction('All');
        }
        this.onSelectShow(best, true);
      }
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
      const showChanged = showName !== this.highlightName;
      
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
      
      // Only emit setUpSeries if the show selection changed
      if(showChanged) {
        this.$nextTick(() =>
          evtBus.emit('setUpSeries', show));
      }
      
      // If map pane is currently showing, update it to show the newly selected show
      if(this.currentPane === 'map' && this.mapShow !== null) {
        void this.seriesMapAction('open', show);
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
      if (e?.ctrlKey) {
        const cell = this.seriesMap?.[season]?.[episode];
        const path = cell?.path;
        const noFile = !!cell?.noFile;

        if (!path || noFile) return;

        const ok = confirm(
          `OK to delete file for ${show.Name} S${season}E${episode} ?`
        );
        if (!ok) return;

        try {
          await srvr.deletePath(path);
        } catch (err) {
          console.error('episodeClick: deletePath failed', { path, err });
          window.alert(err?.message || String(err));
          return;
        }

        // Emby won't reflect the deletion until the library is refreshed.
        await this.refreshEmbyLibraryWithDialog();

        // Refresh the Map grid now that Emby has refreshed.
        await this.seriesMapAction('refresh', show, null);

        // Reload show list (shows the Reloading Shows dialog).
        evtBus.emit('library-refresh-complete');
        return;
      }

      // toggle watched or set to specific value
      await emby.editEpisode(show.Id, season, episode, false, setWatched);
      await this.seriesMapAction('', show, null);
    },

    async refreshEmbyLibraryWithDialog(timeoutMs = 120000) {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

      this.showEmbyRefreshing = true;
      try {
        const res = await emby.refreshLib();
        if (res?.status === 'hasTask' && res?.taskId) {
          const startMs = Date.now();
          while (Date.now() - startMs < timeoutMs) {
            const st = await emby.taskStatus(res.taskId);
            if (st?.status !== 'refreshing') break;
            await sleep(2000);
          }
        }
      } catch (e) {
        console.error('refreshEmbyLibraryWithDialog failed', e);
      } finally {
        this.showEmbyRefreshing = false;
      }
    },

    async seriesMapAction(action, show, wasDeleted) {
      if(action == 'close') {
        this.mapShow = null;
        this.$emit('hide-map');
        return;
      }
      if(action == 'open' && this.mapShow?.Name === show?.Name && this.currentPane === 'map') {
        // If clicking the same show while already on map, keep it as-is
        return;
      }
      if(action == 'date') {
        console.log('setting last watched to cur date');
        await emby.setLastWatched(show.Id);
      }
      
      const isRefresh = action === 'refresh';
      
      this.hideMapBottom     = true;
      this.mapShow           = show;
      const seriesMapSeasons = [];
      const seriesMapEpis    = [];
      const seriesMap        = {};
      let errorMessage = '';
      
      let seriesMapIn = 
          await emby.getSeriesMap(show, action == 'prune');
      
      // If emby has no data, try tvdb as fallback
      if (!seriesMapIn || seriesMapIn.length === 0) {
        seriesMapIn = await tvdb.getSeriesMap(show);
        if (!seriesMapIn || seriesMapIn.length === 0) {
          errorMessage = 'Not in emby and show not found in TVDB.';
          seriesMapIn = []; // Keep empty for error display
        }
      }
      
      for(const season of seriesMapIn) {
        const [seasonNum, episodes] = season;
        seriesMapSeasons[seasonNum] = seasonNum;
        const seasonMap = {};
        seriesMap[seasonNum] = seasonMap;
        for(const episode of episodes) {
          let [episodeNum, epiObj] = episode;
          const {error, played, avail, noFile, 
             unaired, deleted:epiDeleted, path} = epiObj;
          seriesMapEpis[episodeNum] = episodeNum;
          const deleted = epiDeleted ||
              (wasDeleted?.season  == seasonNum && 
               wasDeleted?.episode == episodeNum);
          seasonMap[episodeNum] = 
              {error, played, avail,
           noFile, unaired, deleted, path};
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
        seriesMap: this.seriesMap,
        mapError: errorMessage,
        noSwitch: isRefresh
      });
    },

    async condFltrClick(cond, event) {
      this.fltrChoice = '- - - - -';
      if (++cond.filter == 2) cond.filter = -1;
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
      if (this.sortChoice === 'Notes') {
        this.shows.sort((a, b) => {
          const aNoteRaw = String(a?.Notes ?? '').trim();
          const bNoteRaw = String(b?.Notes ?? '').trim();
          const aHas = aNoteRaw.length > 0;
          const bHas = bNoteRaw.length > 0;
          if (aHas !== bHas) return aHas ? -1 : 1; // notes first

          const aKey = aNoteRaw.toLowerCase();
          const bKey = bNoteRaw.toLowerCase();
          if (aKey !== bKey) return aKey > bKey ? 1 : -1; // alphabetical

          const aName = String(a?.Name ?? '').replace(/^the\s*/i, '').toLowerCase();
          const bName = String(b?.Name ?? '').replace(/^the\s*/i, '').toLowerCase();
          if (aName === bName) return 0;
          return aName > bName ? 1 : -1;
        });
        return;
      }

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
      // Preserve original behavior: always refresh TVDB data here.
      allTvdb = await tvdb.getAllTvdb();
      await this.refilter(scroll);
    },

    async refilter(scroll = true) {
      // Lightweight version of select(): avoids a full TVDB refresh unless
      // the "Finished" filter needs it.
      let localAllTvdb = null;
      if(this.fltrChoice === 'Finished') {
        if(!allTvdb) allTvdb = await tvdb.getAllTvdb();
        localAllTvdb = allTvdb;
      }

      let srchStrLc;
      let allNotes = null;
      if(this.fltrChoice !== 'Finished') {
        if(this.filterStr.length > 0)
              this.fltrChoice = '- - - - -';
        const filterEmpty = (this.filterStr == null) || (String(this.filterStr).length === 0);
        srchStrLc = filterEmpty ? null : String(this.filterStr).toLowerCase();

        if (filterEmpty) {
          this.wasFilterEmpty = true;
        } else {
          // First keystroke into the filter box: force a fresh notes fetch.
          const forceFresh = !!this.wasFilterEmpty;
          this.wasFilterEmpty = false;
          allNotes = await this.getAllNotesCached(forceFresh ? 0 : 3000);
        }
      }

      const filteredShows = [];
      fltrLoop:
      for(const show of allShows) {
        if(this.fltrChoice === 'Finished') {
          const tvdbData = localAllTvdb?.[show.Name];
          if(!tvdbData) continue;
          const {status, episodeCount, watchedCount} = tvdbData;
          const watchedAll = episodeCount > 0 && watchedCount == episodeCount;
          const finished = (status == "Ended"            &&
                            watchedAll                   &&
                            !show.Reject);
          if(finished) filteredShows.push(show);
          continue;
        }
        // Special-case Download filter: exclude pure WatchGap entries; allow FileGap or eligible noemby only
        if (this.fltrChoice === 'Download') {
          const downloadEligible = (show.FileGap ||
            (show.Id.startsWith('noemby-') && !show.S1E1Unaired));
          if (!downloadEligible) continue;
        }
        if (this.fltrChoice === 'Notes') {
          const note = show?.Notes;
          if (note == null || String(note).trim().length === 0) continue;
        }
        if (srchStrLc && !show.Name.toLowerCase().includes(srchStrLc)) {
          const note = allNotes?.[show.Name];
          const noteLc = (note == null) ? '' : String(note).toLowerCase();
          if (!noteLc.includes(srchStrLc)) continue;
        }
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
        
        // If we have episode info, open actors pane and show episode actors
        if(this.currentPlayingDevice && 
           this.currentPlayingDevice.seasonNumber && 
           this.currentPlayingDevice.episodeNumber) {
          // Use setTimeout to ensure series pane setup completes first
          setTimeout(() => {
            evtBus.emit('showActorsPaneWithEpisode', {
              seasonNumber: this.currentPlayingDevice.seasonNumber,
              episodeNumber: this.currentPlayingDevice.episodeNumber
            });
          }, 100);
        }
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
      
      // Prefer updating the reactive object (this.shows) so the UI repaints.
      // Keep the backing allShows entry in sync if it differs by reference.
      const reactiveShow = this.shows.find((s) => s.Id == showId);
      const allShowsShow = allShows.find((s) => s.Id == showId);
      const show = reactiveShow || allShowsShow;
      if(!show) return;

      // if(fileEndError)
      //   console.log('fileEndError', show.Name);

      if(anyWatched && show.InToTry) {
        if(reactiveShow) reactiveShow.InToTry = false;
        if(allShowsShow) allShowsShow.InToTry = false;
        emby.saveToTry(show.Id, false)
          .catch((err) => {
              console.error(
                "addGapToShow, late saveToTry error:", err);
          });
      }

      const gap = {};
      gap.ShowId          = showId;
      gap.showName        = show.Name;
      gap.FileGapSeason   = fileGapSeason;
      gap.FileGapEpisode  = fileGapEpisode;
      gap.WatchGapSeason  = watchGapSeason;
      gap.WatchGapEpisode = watchGapEpisode;
      gap.WatchGap        = watchGap; 
      gap.NotReady        = notReady;
      gap.FileGap = !(!notReady && show.InToTry) &&
                     (fileGap || fileEndError || seasonWatchedThenNofile);

      // Apply to reactive show first, but always keep the backing store synced.
      if(reactiveShow) Object.assign(reactiveShow, gap);
      if(allShowsShow && allShowsShow !== reactiveShow) Object.assign(allShowsShow, gap);
      await srvr.addGap([show.Id, gap, save]);

      // When worker finishes (progress == 100), mark it as not running
      if(progress == 100) {
        gapWorkerRunning = false;
        // Re-run filters/sort once at completion so any gap-driven UI changes
        // (e.g. Download filter) are reflected immediately.
        await this.refilter(false);
      }
    },

    async newShows(isInitialLoad = false) {
      await emby.init();

      allShows = await emby.loadAllShows();
      if(!allShows) {
        console.error("No shows from loadAllShows");
        return;
      }
      this.shows = [...allShows];
      this.$emit('all-shows', allShows);

      // must be set before startWorker

      // Handle gap worker restart logic
      if(!pruneTvdb) {
        if(isInitialLoad) {
          // Initial load: start worker immediately
          gapWorkerRunning = true;
          emby.startGapWorker(allShows, this.addGapToShow);
        } else if(gapWorkerRunning) {
          // Worker is running, wait for it to finish then restart
          const checkAndRestart = setInterval(() => {
            if(!gapWorkerRunning) {
              clearInterval(checkAndRestart);
              gapWorkerRunning = true;
              emby.startGapWorker(allShows, this.addGapToShow);
            }
          }, 100);
        } else {
          // Worker not running, start immediately
          gapWorkerRunning = true;
          emby.startGapWorker(allShows, this.addGapToShow);
        }
      }

      // Only set sort properties on initial load
      if(isInitialLoad) {
        this.sortByNew  = true;
        this.sortBySize = false;
        this.sortChoice = 'Alpha';
      }
      
      // Initialize ban condition to -1 to filter out rejected shows BEFORE showAll
      const banCond = this.conds.find(c => c.name === 'ban');
      if (banCond) {
        banCond.filter = -1;
      }
      
      this.showAll(true);
      await this.select(); // Apply filters including ban
      this.sortShows();

      const name = window.localStorage.getItem("lastVisShow");
      if (!name)   window.localStorage.setItem("lastVisShow",
                                     allShows[0].Name);
      this.scrollToSavedShow(true);

      // Update series pane infobox with refreshed data
      if(this.highlightName) {
        const currentShow = allShows.find(s => s.Name === this.highlightName);
        if(currentShow) {
          this.$nextTick(() => {
            evtBus.emit('setUpSeries', currentShow);
          });
          
          // Reload map pane with updated data (regardless of whether it's currently visible)
          // Use 'refresh' action to avoid switching panes
          if(this.mapShow) {
            this.$nextTick(() => {
              void this.seriesMapAction('refresh', currentShow);
            });
          }
        }
      }

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
  },

  /////////////////  MOUNTED  /////////////////
  mounted() {
    // Simple + portrait: Buttons are rendered in App.vue and forward events via evtBus.
    evtBus.on('simpleModeButtonsClick', (activeButtons) => {
      void this.handleButtonClick(activeButtons);
    });

    evtBus.on('simpleModeButtonsTop', () => {
      this.topClick();
    });

    evtBus.on('reelSearchAction', (srchChoice) => {
      void this.searchAction(srchChoice);
    });

    evtBus.on('openMap', (show) => {
      console.log('List: openMap event received for show:', show?.Name);
      this.seriesMapAction('open', show);
    });
    
    // Track current pane
    evtBus.on('paneChanged', (pane) => {
      this.currentPane = pane;
    });
    
    // Listen for map actions from App.vue
    evtBus.on('mapAction', async ({ action, show }) => {
      await this.seriesMapAction(action, show);
    });
    
    // Listen for episode clicks from App.vue
    evtBus.on('episodeClick', async ({ e, show, season, episode, setWatched }) => {
      await this.episodeClick(e, show, season, episode, setWatched);
    });

    // Listen for season folder deletes from App.vue (ctrl-click season number in Map)
    evtBus.on('seasonDelete', async ({ e, show, season }) => {
      if (this.simpleMode) return;
      if (!e?.ctrlKey) return;

      const showName = show?.Name || '';
      const showPath = show?.Path || '';
      if (!showPath) return;

      const ok = window.confirm(
        `OK to delete folder Season ${season} for show ${showName} ?`
      );
      if (!ok) return;

      const sep = showPath.includes('\\') ? '\\' : '/';
      const seasonPath = `${showPath.replace(/[\\/]+$/, '')}${sep}Season ${season}`;

      try {
        await srvr.deletePath(seasonPath);
      } catch (err) {
        console.error('seasonDelete: deletePath failed', { seasonPath, err });
        window.alert(err?.message || String(err));
        return;
      }

      await this.refreshEmbyLibraryWithDialog();
      await this.seriesMapAction('refresh', show, null);
      evtBus.emit('library-refresh-complete');
    });
    
    // Listen for library refresh completion to refresh show list
    evtBus.on('library-refresh-complete', (payload) => {
      const onDone = payload && typeof payload === 'object' ? payload.onDone : null;
      this.showReloadingShows = true;
      Promise.resolve(this.newShows())
        .catch((err) => {
          console.error('library-refresh-complete: newShows failed', err);
        })
        .finally(() => {
          this.showReloadingShows = false;
          if (typeof onDone === 'function') {
            try { onDone(); } catch { /* ignore */ }
          }
        });
    });

    // Cross-pane: click a card in Flex/Qbt/Down to select show in list
    evtBus.on('selectShowFromCardTitle', (rawTitle) => {
      void this.selectShowFromCardTitle(rawTitle);
    });

    setInterval(async () => {
      const devices  = await srvr.getDevices();
      let   showName = null;
      let   playingDevice = null;
      for(const device of devices) {
        if(!device.showName) continue;
        showName = device.showName;
        playingDevice = device;
        if(device.deviceName == 'chromecast') break;
      }
      this.watchingName = showName ?? '---';
      this.currentPlayingDevice = playingDevice;
    }, 10*1000);

    void (async () => {
      document.addEventListener('keydown', (event) => {
        if(event.code == 'Escape') {
          this.remotesAction('close');
          this.seriesMapAction('close');
        }
      }); 

      try {
        await this.newShows(true);
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

#showsContainer {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

#showsContainer::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
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
