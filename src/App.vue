<template lang="pug">

#all(style=`width:100%; height:95dvh; box-sizing: border-box;
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
           style="outline:thin solid;" 
             :id="nameHash(show.Name)")
          td(style="width:30px; text-align:center;"
            @click="copyNameToClipboard(show)")
            font-awesome-icon(icon="copy" style="color:#ccc")
          td(style="width:30px; text-align:center;" )
            div(v-show="!show.Id.startsWith('noemby-')" 
                  @click="seriesMapAction('open', show)")
              font-awesome-icon(icon="border-all" style="color:#ccc")

          td(@click="setHilite(show)"
               v-if="sortByNew" 
             :style=`{width:'80px', fontSize:'16px',
                      backgroundColor: hilite(show)}`) 
            | {{ show.DateCreated }}
            
          td(@click="setHilite(show)"
               v-if="sortByActivity" 
             :style=`{width:'80px', fontSize:'16px',
                      backgroundColor: hilite(show)}`) 
            | {{ show.Date }}

          td(@click="setHilite(show)"
             v-if="sortBySize" 
             :style=`{width:'80px', fontSize:'16px', textAlign:'center',
                      backgroundColor: hilite(show)}`) 
            | {{ formatSize(show) + '&nbsp;&nbsp;&nbsp;' }}

          td(:style="{display:'flex', justifyContent:'space-between', padding:'5px', backgroundColor: hilite(show)}")

            div(style="padding:2px; fontSize:16px; font-weight:bold;" 
                @click="showInExternal(show, $event)" 
            ) {{show.Name}} 

            div(v-if="show.Waiting" style="padding:2px; color: #00f; fontSize:16px;" 
                @click="showInExternal(show, $event)"
            ) {{show.WaitStr}}

          td( v-for="cond in conds" 
              style="width:22px; text-align:center;"
            @click="cond.click(show)" )
            font-awesome-icon(:icon="cond.icon"
                :style="{color:condColor(show,cond)}")
  //- #remotes(v-if="remoteShow !== null" 
  //-         style="width:60%; background-color:#eee; padding:20px;")

  #map(v-if="mapShow !== null" 
        style="width:60%; background-color:#eee; padding:20px;")
    div(style="margin:3px 10px; display:inline-block;")
      button(@click="seriesMapAction('close')")          close
      button(@click="seriesMapAction('prune', mapShow)") prune
      button(@click="seriesMapAction('date',  mapShow)") set date
      | {{'&nbsp;&nbsp;&nbsp;'+mapShow.Name}}
      div(v-if="seriesMap?.gap" style="display:inline-block;color:red;") &nbsp; -- &nbsp; {{seriesMap?.gap?.[2]}} &nbsp; -- 
    table(style="padding:0 5px; width:100%; font-size:16px" )
     tbody
      tr(style="font-weight:bold;")
        td
        td(v-for="episode in seriesMapEpis" style="width:30px; text-align:center;"
              key="episode") {{episode}}
      tr(v-for="season in seriesMapSeasons" key="season" style="outline:thin solid;")
        td(style="font-weight:bold; width:20px; text-align:left;") {{season}}
        td(v-for="episode in seriesMapEpis" 
             :style="{cursor:'default', width:'30px', textAlign:'center', backgroundColor: (seriesMap?.gap?.[0] == season && seriesMap?.gap?.[1] == episode ? 'yellow' : (seriesMap?.[season]?.[episode]?.missing ? '#f88' :'white') ) }"
           key="episode" @click="episodeClick($event, mapShow, season, episode)")
          span(v-if="seriesMap?.[season]?.[episode]?.deleted") d
          span(v-if="seriesMap?.[season]?.[episode]?.played")  w
          span(v-if="seriesMap?.[season]?.[episode]?.avail")   +
          span(v-if="seriesMap?.[season]?.[episode]?.missing") -
          span(v-if="seriesMap?.[season]?.[episode]?.unaired") u
</template>


<script>
import * as emby  from "./emby.js";
import * as tvdb  from "./tvdb.js";
import * as urls  from "./urls.js";

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

let   allShows  = [];
let   embyWin   = null;
let   imdbWin   = null;
let   showErr   = null;
const errFifo   = [];

export default {
  name: "App",
  components: { FontAwesomeIcon },
  data() {

    const toggleWaiting = async (show) => {
      console.log("toggleWaiting", show.Name);
      this.saveVisShow(show.Name);
      const waitRes = await tvdb.getTvDbData(show.Name);
      if(!waitRes) {
        console.log('toggleWaiting, no series:', show.Name);
        return;
      }
      show.Waiting = !show.Waiting;
      show.WaitStr = waitRes.waitStr;
      emby.saveWaiting(show.Name, show.Waiting)
          .catch(async (err) => {
              console.log("late saveWaiting error:", err);
              //- show.Waiting = !show.Waiting;
              show.WaitStr = 
                  (await tvdb.getTvDbData(show.Name)).waitStr;
           });
    };

    const toggleFavorite = async (show) => {
      this.saveVisShow(show.Name);
      show.IsFavorite = !show.IsFavorite;
      emby.saveFav(show.Id, show.IsFavorite)
          .catch((err) => {
              console.log("late saveFavorite error:", err);
              //- show.IsFavorite = !show.IsFavorite;
           });
    };

    const toggleReject = async (show) => {
      this.saveVisShow(show.Name);
      show.Reject = !show.Reject; 
      emby.saveReject(show.Name, show.Reject) 
          .catch((err) => {
              console.log("late saveReject:", err);
              //- show.Reject = !show.Reject;
           });
      await this.chkRowDelete(show);
    };

    const togglePickup = async (show) => {
      this.saveVisShow(show.Name);
      show.Pickup = !show.Pickup;
      emby.savePickup(show.Name, show.Pickup)
          .catch((err) => {
              console.log("late savePickup error:", err);
              //- show.Pickup = !show.Pickup;
            });
      await this.chkRowDelete(show);
    };

    const toggleToTry = async (show) => {
      this.saveVisShow(show.Name);
      show.InToTry = !show.InToTry;
      emby.saveToTry(show.Id, show.InToTry)
          .catch((err) => {
              console.log("late toggleToTry error:", err);
              //- show.InToTry = !show.InToTry;
            });
    };

    const toggleContinue = async (show) => {
      this.saveVisShow(show.Name);
      show.InContinue = !show.InContinue;
      emby.saveContinue(show.Id, show.InContinue)
          .catch((err) => {
              console.log("late toggleContinue error:", err);
              //- show.InContinue = !show.InContinue;
            });
    };

    const toggleMark = async (show) => {
      this.saveVisShow(show.Name);
      show.InMark = !show.InMark;
      emby.saveMark(show.Id, show.InMark)
          .catch((err) => {
              console.log("late toggleMark error:", err);
              //- show.InMark = !show.InMark;
            });
    };

    const toggleLinda = async (show) => {
      this.saveVisShow(show.Name);
      show.InLinda = !show.InLinda;
      emby.saveLinda(show.Id, show.InLinda)
          .catch((err) => {
              console.log("late toggleLinda error:", err);
              //- show.InLinda = !show.InLinda;
            });
    };

    const deleteShow = async (show) => {
      this.saveVisShow(show.Name);
      console.log("delete Show From Emby?", show.Name);
      if (!window.confirm(
          `Do you really want to delete series ${show.Name}?`)) 
        return;
      if(!await this.chkRowDelete(show)){
        show.RunTimeTicks      = 0;
        show.UnplayedItemCount = 0;
        show.IsFavorite        = false;
        show.Id = "noemby-" + Math.random();
        return
      }
      await emby.deleteShowFromEmby(show);
      await emby.deleteShowFromServer(show);
      console.log("app: deleted show:", show.Name);
    }

    return {
      shows:             [],
      searchStr:         "",
      errMsg:            "",
      sortByNew:       true,
      sortByActivity: false,
      sortBySize:     false,
      highlightName:     "",
      allShowsLength:     0,
      mapShow:         null,
      seriesMapSeasons:  [],
      seriesMapEpis:     [],
      seriesMap:         {},
      gapPercent:         0,

      conds: [ {
          color: "#0cf", filter: 0, icon: ["fas", "plus"],
          cond(show)  { return show.UnplayedItemCount > 0; },
          click() {},
        }, {
          color: "#f88", filter: 0, icon: ["fas", "minus"],
          cond(show)  { return !!show.Gap; },
          click() {},
        }, {
          color: "#0c0", filter: 0, icon: ["far", "clock"],
          cond(show)  { return show.Waiting; },
          click(show) { toggleWaiting(show); },
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
      if (!show.Reject && !show.Pickup && !show.Waiting &&
              show.Id.startsWith("noemby-")) {
        console.log("no reason to keep row, deleting it:", show.Name);
        const id = show.Id;
        for(let i = 0; i < allShows.length; i++) {
          if(allShows[i].Id == id) {
            let nextShow           = allShows[i+1];
            if(!nextShow) nextShow = allShows[i-1];
            if(!nextShow) break;
            this.saveVisShow(nextShow.Name);
            break;
          }
        }
        allShows   = allShows.filter(  (show) => show.Id != id);
        this.shows = this.shows.filter((show) => show.Id != id);
        try {
          await emby.deleteNoemby(show.Name);
        } catch (err) {
          console.log("deleteNoemby error:", err);
          return force;
        }
        return true;
      }
      return false;
    },

    hilite(show) {
      return this.highlightName == show.Name ? "yellow" : "white";
    },

    setHilite(show) {
      this.highlightName = show.Name;
      this.saveVisShow(show.Name);
    },

    async addClick () {
      const srchTxt = prompt(
                "Enter series name. " +
                "It is used as an approximate search string.");
      if (!srchTxt) {
        //- showErr("Search string is empty");
        return;
      }

      const waitRes = await tvdb.getTvDbData(srchTxt);
      if(!waitRes) {
        showErr('No series found for:', srchTxt);
        return;
      }
      const {waitStr, exactName, lastAired} = waitRes;
                     

      const test = allShows.find((s) => s.Name == exactName);
      if(test) {  
        showErr('Show already exists: ' + test.Name);
        return;
      }

      const date    = new Date().toISOString();
      const dateStr = date.substring(0, 10);
      const show = {
        Name: exactName,
        Id: "noemby-" + Math.random(),
        DateCreated: dateStr, 
        LastAired: lastAired, 
        Waiting: true,
        WaitStr: waitStr,
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

      this.highlightName = exactName;
      this.saveVisShow(exactName);
      this.scrollToSavedShow();

      await emby.addNoEmby(show);
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
      err = err.slice(0, -4)
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
      const name = allShows[0].Name;
      this.highlightName = name;
      this.saveVisShow(name);
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

    saveVisShow(name) {
      this.highlightName = name;
      window.localStorage.setItem("lastVisShow", name);
    },

    async sortClickAdded() {
      this.sortByNew      = true;
      this.sortByActivity = false;
      this.sortBySize     = false;
      this.sortShows();
      this.showAll();
      this.topClick()
      console.log("sort by Added");
    },

    async sortClickActivity() {
      this.sortByNew      = false;
      this.sortByActivity = true;
      this.sortBySize     = false;
      this.sortShows();
      this.showAll();
      this.topClick()
      console.log("sort by Activity");
    },

    async sortClickSize() {
      this.sortByNew      = false;
      this.sortByActivity = false;
      this.sortBySize     = true;
      this.sortShows();
      this.showAll();
      this.topClick()
      console.log("sort by Size");
    },

    scrollToSavedShow() {
      this.$nextTick(() => {
        const name = window.localStorage.getItem("lastVisShow");
        const id = this.nameHash(name);
        if (!id) return;
        this.highlightName = name;
        // console.log(`srolling ${name} into view`);
        const ele = document.getElementById(id);
        if (ele) ele.scrollIntoView({block: "center"});
      });
    },

    async copyNameToClipboard(show) {
      console.log(`copying ${show.Name} to clipboard`);
      await navigator.clipboard.writeText(show.Name);
      this.saveVisShow(show.Name);
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
      const seriesMap        = {gap:show.Gap};
      const seriesMapIn = 
            await emby.getSeriesMap(show.Id, action == 'prune');
      for(const season of seriesMapIn) {
        const [seasonNum, episodes] = season;
        seriesMapSeasons[seasonNum] = seasonNum;
        const seasonMap = {};
        seriesMap[seasonNum] = seasonMap;
        for(const episode of episodes) {
          let [episodeNum, [played, avail, unaired, deleted]] = episode;
          seriesMapEpis[episodeNum] = episodeNum;
          if(wasDeleted &&
              wasDeleted.season == seasonNum && wasDeleted.episode == episodeNum) {
            deleted = true;
          }
          const missing = !avail && !unaired;
          seasonMap[episodeNum] = {played, avail, missing, unaired, deleted};
        }
      }
      this.seriesMapSeasons = 
           seriesMapSeasons.filter(x => x !== null);
      this.seriesMapEpis = 
           seriesMapEpis.filter(x => x !== null);
      this.seriesMap = seriesMap;
      this.saveVisShow(show.Name);
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

    async showInExternal(show, event) {
      console.log("showInExternal", show.Name);
      this.saveVisShow(show.Name);
      if (!show.Id.startsWith("noemby-")) {
        if (event.ctrlKey) {
          console.log("closing old imdb page");
          if (imdbWin) imdbWin.close();
          const imdbProviderId = show?.ProviderIds?.Imdb;
          if (imdbProviderId) {
            console.log("got imdbProviderId, opening imdb page", 
                            show?.ProviderIds);
            const url = `https://www.imdb.com/title/${imdbProviderId}`;
            imdbWin = window.open(url, "imdbWebPage");
          }
          else console.log("no imdb Provider Id for show:", show);
        } 
        else {
          console.log("opening emby page for", show.Name);

          const url = urls.embyPageUrl(show.Id);
          if (embyWin) {
            console.log("closing old emby page", show.Name);
            embyWin.close();
            embyWin = window.open(url, "embyWin");
          }
          else embyWin = window.open(url, "_blank");
          // console.log("done opening emby page", url);
        }
      }
    },

    addSeasonsToShow(event) {
      const {showId, seasons, gap, progress} = event.data;
      this.gapPercent = progress;
      
      let show = allShows.find((show) => show.Id == showId);
      if(show) {
        show.Seasons = seasons;
        show.Gap     = gap;
      }
      show = this.shows.find((show) => show.Id == showId); 
      if(show) {
        show.Seasons = seasons;
        show.Gap     = gap;
      }
    },
  },

  /////////////////  MOUNTED  /////////////////
  mounted() {
    (async () => {
      document.addEventListener('keydown', (event) => {
        if(event.code == 'Escape') 
          this.seriesMapAction('close');
      }); 
      try {
      
       console.log("mounted try");

        showErr = this.showErr;
        await emby.init(showErr);
        tvdb.init(showErr);

        allShows = await emby.loadAllShows();
        this.shows = allShows;

        emby.getSeasons(allShows, this.addSeasonsToShow);

        this.sortByNew      = true;
        this.sortByActivity = false;
        this.sortBySize     = false;
        this.sortShows();
        this.showAll(true);

        const name = window.localStorage.getItem("lastVisShow");
        if (!name) {
          const name = allShows[0].Name;
          this.highlightName = name;
          this.saveVisShow(name);
        }
        this.scrollToSavedShow();

      } catch (err) {
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
