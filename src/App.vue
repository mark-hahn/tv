<template lang="pug">
div
  #hdr(style="width:700px; background-color:#ccc; margin-left:11%;  position:fixed; top:0; z-index:1")
    div(style="display:inline-block;width:100%;")
      button(@click="showAll" style="margin-left:5px;margin-right:5px;") 
        | All
      input(v-model="searchStr" @input="select"
            style="border:1px solid black; width:100px;")
      button(@click="select")
        font-awesome-icon(icon="search")
      button(@click="topClick" style="margin-left:5px;margin-right:5px;") 
        | Top
      #err(@click="errClick" style="width:450px; display:inline-block; margin-left:10px; font-size:16px;color:red;background-color:white;cursor:default;") {{errMsg}}

    div(style="width:100%;")
      table(style="background-color:white; padding:0 20px; width:710px;")
        tr(style="width:100px;")
          td(style="width:60px;font-size:large;") 
            | {{shows.length + '/' + allShowsLength}}
          td(style="width:100px;")
            button(@click="sortClick" style="width:90px; text-align:right;") Sort By:
          td(v-if="sortByDate"
             style="width:120px; text-align:left; font-size:large;") New Shows
          td(v-if="sortBySize" 
             style="width:120px; text-align:left; font-size:large;") Size
          td(style="padding:0 4px; text-align:right;") Filters:
          td( v-for="cond in conds"
              :style="{width:'22px',textAlign:'center'}"
              @click="condFltrClick(cond)" )
            font-awesome-icon(:icon="cond.icon"
              :style="{color:condFltrColor(cond)}")

  div(style="margin-top:65px; width:700px; margin-left:10%;")
    table(style="padding:0 5px; width:100%; font-size:18px")
      tr(v-for="show in shows" key="show.Id" style="outline:thin solid;")
        td(style="width:30px; text-align:center;"
             @click="copyNameToClipboard(show)")
          font-awesome-icon(icon="copy" style="color:#ccc")
        td(style="width:30px; text-align:center;" )
          div(v-show="!show.Id.startsWith('noemby-')" 
                 @click="seriesMapAction('open', show)")
            font-awesome-icon(icon="border-all" style="color:#ccc")
        td(v-if="sortByDate" style="width:80px;font-size:16px;") 
          | {{ show.Date.substring(0,10) }}
        td(v-if="sortBySize" style="margin-right:200px;width:60px;font-size:16px;text-align:right") 
          | {{ formatSize(show) + '&nbsp;&nbsp;&nbsp;' }}
        td(@click="showInExternal(show, $event)"
           :style="{padding:'4px', backgroundColor: highlightName == show.Name ? 'yellow' : 'white', fontWeight:'bold', fontSize:'20px'}" :id="nameHash(show.Name)") {{show.Name}}
        td( v-for="cond in conds" 
            style="width:22px; text-align:center;"
           @click="cond.click(show)" )
          font-awesome-icon(:icon="cond.icon"
              :style="{color:condColor(show,cond)}")

  #map(v-if="mapShow !== null" 
        style="width:60%; background-color:#eee; padding:20px;")
    //- div(style="display:inline-block;")x {{mapShow.Name}} 
    div(style="margin:3px 10px; display:inline-block;")
      button(@click="seriesMapAction('close')")          close
      button(@click="seriesMapAction('prune', mapShow)") prune
      button(@click="seriesMapAction('date',  mapShow)") set date
      | {{'&nbsp;&nbsp;&nbsp;'+mapShow.Name}}
      div(v-if="seriesMap?.gap" style="color:red;") &nbsp; -- &nbsp; {{seriesMap?.gap?.[2]}} &nbsp; -- 
    table(style="padding:0 5px; width:100%; font-size:16px" )
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
import * as emby           from "./emby.js";
import * as urls           from "./urls.js";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { library }         from "@fortawesome/fontawesome-svg-core";
import { faLaughBeam, faSadCry, faClock, faHeart, } 
                           from "@fortawesome/free-regular-svg-icons"; 
import { faCheck, faPlus, faMinus, faArrowDown, faArrowRight,
         faTv, faSearch, faQuestion, faCopy, faBorderAll, faBan,
         faMars, faVenus, faCalendar} 
                           from "@fortawesome/free-solid-svg-icons";

library.add([  
  faLaughBeam, faSadCry, faClock, faHeart, faCheck, faPlus, 
  faMinus, faArrowDown, faTv, faSearch, faQuestion, faCopy, 
  faBan, faBorderAll, faArrowRight, faMars, faVenus, faCalendar]);

let allShows  = [];
let embyWin   = null;
let imdbWin   = null;
let showErr   = null;
const errFifo = [];

export default {
  name: "App",
  components: { FontAwesomeIcon },
  data() {
    const dataGapClick = async (show) => {
      this.gapClick(show);
    };

    const toggleWaiting = async (show) => {
      this.saveVisShow(show.Name);
      show.Waiting = !show.Waiting;
      emby.saveWaiting(show.Name, show.Waiting)
          .catch((err) => {
              showErr("late saveFavorite error:", err);
              show.Waiting = !show.Waiting;
           });
    };

    const toggleFavorite = async (show) => {
      this.saveVisShow(show.Name);
      show.IsFavorite = !show.IsFavorite;
      emby.saveFav(show.Id, show.IsFavorite)
          .catch((err) => {
              showErr("late saveFavorite error:", err);
              show.IsFavorite = !show.IsFavorite;
           });
    };

    const toggleReject = async (show) => {
      this.saveVisShow(show.Name);
      show.Reject = !show.Reject; 
      emby.saveReject(show.Name, show.Reject) 
          .catch((err) => {
              showErr("late saveReject:", err);
              show.Reject = !show.Reject;
           });
      const id = show.Id;
      if (!show.Reject && !show.Pickup && 
              show.Id.startsWith("noemby-")) {
        console.log("turned off reject, removing row");
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
      }
    };

    const togglePickup = async (show) => {
      this.saveVisShow(show.Name);
      show.Pickup = !show.Pickup;
      emby.savePickup(show.Name, show.Pickup)
          .catch((err) => {
              showErr("late savePickup error:", err);
              show.Pickup = !show.Pickup;
            });
      if (!show.Pickup && show.Id.startsWith("noemby-")) {
        console.log("toggled pickUp, removing row");
        const id   = show.Id;
        for(let i = 0; i < allShows.length; i++) {
          if(allShows[i].Id == id) {
            let nextShow           = allShows[i+1];
            if(!nextShow) nextShow = allShows[i-1];
            if(!nextShow) break;
            this.saveVisShow(nextShow.Name);
            break;
          }
        }
        allShows   = allShows  .filter((show) => show.Id != id);
        this.shows = this.shows.filter((show) => show.Id != id);
      }
    };

    const toggleToTry = async (show) => {
      this.saveVisShow(show.Name);
      show.InToTry = !show.InToTry;
      emby.saveToTry(show.Id, show.InToTry)
          .catch((err) => {
              showErr("late toggleToTry error:", err);
              show.InToTry = !show.InToTry;
            });
    };

    const toggleContinue = async (show) => {
      this.saveVisShow(show.Name);
      show.InContinue = !show.InContinue;
      emby.saveContinue(show.Id, show.InContinue)
          .catch((err) => {
              showErr("late toggleContinue error:", err);
              show.InContinue = !show.InContinue;
            });
    };

    const toggleMark = async (show) => {
      this.saveVisShow(show.Name);
      show.InMark = !show.InMark;
      emby.saveMark(show.Id, show.InMark)
          .catch((err) => {
              showErr("late toggleMark error:", err);
              show.InMark = !show.InMark;
            });
    };

    const toggleLinda = async (show) => {
      this.saveVisShow(show.Name);
      show.InLinda = !show.InLinda;
      emby.saveLinda(show.Id, show.InLinda)
          .catch((err) => {
              showErr("late toggleLinda error:", err);
              show.InLinda = !show.InLinda;
            });
    };

    const deleteShowFromEmby = async (show) => {
      this.saveVisShow(show.Name);
      console.log("delete Show From Emby:", show.Name);
      if (!window.confirm(`Do you really want to delete series ${show.Name} from Emby?`))
        return;
      const id = show.Id;
      const res = await emby.deleteShowFromEmby(id);
      if (res != "ok") return;
      if (show.Pickup || show.Reject) {
        show.RunTimeTicks      = 0;
        show.UnplayedItemCount = 0;
        show.IsFavorite        = false;
        show.Id = "noemby-" + Math.random();
        console.log("deleted db, keeping row");
      } else {
        console.log("deleted db, no pickup, removing row");
        for(let i = 0; i < allShows.length; i++) {
          if(allShows[i].Id == id) {
            let nextShow           = allShows[i+1];
            if(!nextShow) nextShow = allShows[i-1];
            if(!nextShow) break;
            this.saveVisShow(nextShow.Name);
            break;
          }
        }
        allShows   = allShows.filter  ((show) => show.Id != id);
        this.shows = this.shows.filter((show) => show.Id != id);
        this.scrollSavedVisShowIntoView();
      }
    };

    return {
      shows:            [],
      searchStr:        "",
      pkupEditName:     "",
      errMsg:           "",
      sortByDate:     true,
      sortBySize:    false,
      highlightName:    "",
      allShowsLength:    0,
      mapShow:        null,
      seriesMapSeasons: [],
      seriesMapEpis:    [],
      seriesMap:        {},

      conds: [ {
          color: "#0cf", filter: 0, icon: ["fas", "plus"],
          cond(show)  { return show.UnplayedItemCount > 0; },
          click(show) {},
        }, {
          color: "#f88", filter: 0, icon: ["fas", "minus"],
          cond(show)  { return !!show.Gap; },
          click(show) { dataGapClick(show); },
        }, {
          color: "#lime", filter: 0, icon: ["fas", "calendar"],
          cond(show)  { return !!show.Waiting; },
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
          click(show) { deleteShowFromEmby(show); },
        },
      ],
    };
  },

  /////////////  METHODS  ////////////
  methods: {
  
   showErr (...params) {
      let err = "";
      for (let param of params) {
        if (param instanceof Error)
             err += param.message    + " -- ";
        else if (typeof param == "object") 
             err += JSON.stringify(param, null, 2) + " -- ";
        else err += param.toString() + " -- ";
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
    
    topClick () {
      window.scrollTo(0,0)
      const name = allShows[0].Name;
      this.highlightName = name;
      this.saveVisShow(name);
    },

    formatSize (show) {
      const size = show.Size;
      if (size < 1e6) return size;
      if (size < 1e9) return Math.round(size / 1e6) + "M";
                      return Math.round(size / 1e9) + "G";
    },

    nameHash(name) {
      this.allShowsLength = allShows.length;
      if(!name) {
        console.log('nameHash name param null', {name});
        console.trace();
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
      const hash = this.nameHash(name);
      // console.log(`saving ${hash} as last visible show`);
      this.highlightName = name;
      window.localStorage.setItem("lastVisShow", name);
    },

    async sortClick() {
      if (this.sortByDate) {
        this.sortByDate = false;
        this.sortBySize = true;
        console.log("sort by size");
      }
      else {
        this.sortByDate = true;
        this.sortBySize = false;
        console.log("sort by date");
      }
      this.sortShows();
      this.showAll();
    },

    scrollSavedVisShowIntoView() {
      this.$nextTick(() => {
        const name = window.localStorage.getItem("lastVisShow");
        const id = this.nameHash(name);
        this.highlightName = name;
        // console.log(`srolling ${id} into view`);
        const ele = document.getElementById(id);
        if (ele) {
          ele.scrollIntoView(true);
          window.scrollBy(0, -80);
        } else {
          console.log(`show ${id} not in show list, finding best match`);
          for (let show of allShows) {
            const hash = this.nameHash(show.Name);
            if (hash > id) {
              const ele = document.getElementById(hash);
              if (ele) {
                ele.scrollIntoView(true);
                window.scrollBy(0, -160);
                this.saveVisShow(show.Name);
              }
              break;
            }
          }
        }
      });
    },

    copyNameToClipboard(show) {
      console.log(`copying ${show.Name} to clipboard`);
      navigator.clipboard.writeText(show.Name);
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
        if (this.sortByDate) return a.Date > b.Date ? -1 : +1;
        if (this.sortBySize) return a.Size > b.Size ? -1 : +1;
      });
    },

    condColor(show, cond) {
      if (cond.cond(show)) return cond.color;
      return "#ddd";
    },

    // filter shows based on search string and conditions
    select() {
      const srchStrLc = this.searchStr == 
            "" ? null : this.searchStr.toLowerCase();
      this.shows = allShows.filter((show) => {
        if (srchStrLc && !show.Name.toLowerCase().includes(srchStrLc)) 
              return false;
        for (let cond of this.conds) {
          if ( cond.filter ===  0) continue;
          if ((cond.filter === +1) != (!!cond.cond(show))) return false;
        }
        return true;
      });
      this.scrollSavedVisShowIntoView();
    },

    /////////////////  UPDATE METHODS  /////////////////
    showAll() {
      this.searchStr = "";
      for (let cond of this.conds) cond.filter = 0;
      this.scrollSavedVisShowIntoView();
      this.select();
    },

    async showInExternal(show, event) {
      console.log("showInExternal", show);
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
      const {showId, seasons, gap} = event.data;
      let show = allShows.find((show) => show.Id == showId);
      show.Seasons = seasons;
      show.Gap     = gap;
      // show = this.shows.find((show) => show.Id == showId);
      // if(show) {
      //   show.Seasons = seasons;
      //   show.Gap     = gap;
      // }
    },
  },

  /////////////////  MOUNTED  /////////////////
  mounted() {
    (async () => {
      try {
        await emby.init(this.showErr);
        showErr = this.showErr;
        allShows = await emby.loadAllShows();
        this.shows = allShows;
        const name = window.localStorage.getItem("lastVisShow");
        let lastVisShow;
        if(name) lastVisShow = this.nameHash(name);
        if (!name || !lastVisShow) {
          const name = allShows[0].Name;
          this.highlightName = name;
          this.saveVisShow(name);
        } else this.scrollSavedVisShowIntoView();

        const banCond = this.conds[this.conds.length-3];
        banCond.filter = -1;
        this.select();

        emby.getSeasons(allShows, this.addSeasonsToShow);

        this.sortByDate = true;
        this.sortShows();
        this.showAll();
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
#hdr {
  border: 1px solid black;
  position: fixed;
  left: 0;
  top: 0;
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
