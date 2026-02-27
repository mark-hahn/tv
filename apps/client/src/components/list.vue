<template>
  <div
    id="list"
    style="
      height: 100%;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
    "
  >
    <div
      id="searchingModal"
      v-if="showSearching"
      style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: white;
        padding: 30px 40px;
        border: 2px solid black;
        border-radius: 10px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        z-index: 1000;
        text-align: center;
      "
    >
      <div style="font-size: 18px; font-weight: bold; margin-bottom: 10px">
        Searching web for information about show:
      </div>
      <div style="font-size: 20px; color: #0066cc; margin-bottom: 15px">
        {{ searchingShowName }}
      </div>
      <div style="font-size: 16px; color: #666; margin-bottom: 6px">
        {{ searchingStatus || "Please wait ..." }}
      </div>
    </div>
    <div
      id="reloadingShowsModal"
      v-if="showReloadingShows"
      @click.stop
      style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: white;
        padding: 30px 40px;
        border: 2px solid black;
        border-radius: 10px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        text-align: center;
      "
    >
      <div style="font-size: 18px; font-weight: bold">Reloading Shows</div>
    </div>
    <div
      id="embyRefreshingModal"
      v-if="showEmbyRefreshing"
      @click.stop
      style="
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: white;
        padding: 30px 40px;
        border: 2px solid black;
        border-radius: 10px;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        text-align: center;
      "
    >
      <div style="font-size: 18px; font-weight: bold">
        Emby is being refreshed.
      </div>
    </div>
    <div
      id="center"
      :style="{
        height: '100%',
        width: sizing.listWidth || '800px',
        display: 'flex',
        flexDirection: simpleMode && isWideLandscape ? 'row' : 'column',
      }"
    >
      <!-- Wide/landscape simple mode: buttons left column full height; header+shows stacked right.-->
      <template v-if="simpleMode && isWideLandscape">
        <Buttons
          v-if="!hideButtonsPane"
          style="width: 140px; flex-shrink: 0; height: 100%"
          :sizing="sizing"
          @button-click="handleButtonClick"
          @top-click="topClick"
        ></Buttons>
        <div
          id="rightCol"
          style="
            display: flex;
            flex-direction: column;
            flex-grow: 1;
            min-width: 0;
          "
        >
          <div
            id="hdr"
            style="
              width: 100%;
              background-color: #ccc;
              display: flex;
              flex-direction: column;
            "
          >
            <HdrTop
              :showsLength="shows.length"
              :allShowsLength="allShowsLength"
              v-model:filterStr="filterStr"
              :watchingName="watchingName"
              :simpleMode="simpleMode"
              :isWideLandscape="isWideLandscape"
              :statusMsg="updatingMsg"
              :libraryProgressText="libraryProgressText"
              @watch-click="watchClick"
              @filter-input="select"
              @send-filters="sendSharedFilters"
              @library-click="libraryClick"
              @all-click="allClick"
            ></HdrTop>
            <HdrBot
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
            ></HdrBot>
          </div>
          <div
            id="showsLandscape"
            style="display: flex; flex-grow: 1; overflow: hidden; min-height: 0"
          >
            <Shows
              ref="showsComponent"
              style="flex-grow: 1"
              :shows="shows"
              :conds="conds"
              :highlightName="displayHighlightName"
              :getSortDisplayValue="getValBySortChoice"
              :allShowsLength="allShowsLength"
              :showConds="!simpleMode"
              :simpleMode="simpleMode"
              :sortChoice="sortChoice"
              @copy-name="copyNameToClipboard"
              @open-map="(show) =&gt; seriesMapAction('open', show)"
              @select-show="onSelectShow"
            ></Shows>
          </div>
        </div>
      </template>
      <!-- Default layout-->
      <template v-else>
        <div
          id="hdr"
          style="
            width: 100%;
            background-color: #ccc;
            display: flex;
            flex-direction: column;
          "
        >
          <HdrTop
            :showsLength="shows.length"
            :allShowsLength="allShowsLength"
            v-model:filterStr="filterStr"
            :watchingName="watchingName"
            :simpleMode="simpleMode"
            :isWideLandscape="isWideLandscape"
            :statusMsg="updatingMsg"
            :libraryProgressText="libraryProgressText"
            @watch-click="watchClick"
            @filter-input="select"
            @send-filters="sendSharedFilters"
            @library-click="libraryClick"
            @all-click="allClick"
          ></HdrTop>
          <HdrBot
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
          ></HdrBot>
        </div>
        <div
          id="showsContainer"
          style="display: flex; flex-grow: 1; overflow: hidden; min-height: 0"
        >
          <Buttons
            v-if="simpleMode && !hideButtonsPane"
            style="width: 140px; flex-shrink: 0"
            :sizing="sizing"
            @button-click="handleButtonClick"
            @top-click="topClick"
          ></Buttons>
          <Shows
            ref="showsComponent"
            style="flex-grow: 1"
            :shows="shows"
            :conds="conds"
            :highlightName="displayHighlightName"
            :getSortDisplayValue="getValBySortChoice"
            :allShowsLength="allShowsLength"
            :showConds="!simpleMode"
            :simpleMode="simpleMode"
            :sortChoice="sortChoice"
            :activeDownloadShowNames="activeDownloadShowNames"
            @copy-name="copyNameToClipboard"
            @open-map="(show) =&gt; seriesMapAction('open', show)"
            @select-show="onSelectShow"
          ></Shows>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
import * as emby from "../emby.js";
import * as tvdb from "../tvdb.js";
import * as srvr from "../srvr.js";
import * as util from "../util.js";
import parseTorrentTitle from "parse-torrent-title";
import evtBus from "../evtBus.js";
import Shows from "./shows.vue";
import HdrTop from "./hdrtop.vue";
import HdrBot from "./hdrbot.vue";
import Buttons from "./buttons.vue";

import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";
import { library } from "@fortawesome/fontawesome-svg-core";
import {
  faLaughBeam,
  faSadCry,
  faHeart,
  faClock,
} from "@fortawesome/free-regular-svg-icons";
import {
  faCheck,
  faPlus,
  faMinus,
  faArrowDown,
  faArrowRight,
  faTv,
  faSearch,
  faQuestion,
  faCopy,
  faBorderAll,
  faBan,
  faMars,
  faVenus,
  faGlobe,
  faTrafficLight,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
library.add([
  faLaughBeam,
  faSadCry,
  faClock,
  faHeart,
  faCheck,
  faPlus,
  faGlobe,
  faMinus,
  faArrowDown,
  faTv,
  faSearch,
  faQuestion,
  faCopy,
  faBan,
  faBorderAll,
  faArrowRight,
  faMars,
  faVenus,
  faClock,
  faTrafficLight,
  faTrash,
]);

let allTvdb = null;
let allShows = [];
let showHistory = [];
let showHistoryPtr = -1;

export default {
  name: "List",

  components: { FontAwesomeIcon, Shows, HdrTop, HdrBot, Buttons },

  emits: ["show-map", "hide-map", "all-shows", "all-tvdb"],

  props: {
    simpleMode: {
      type: Boolean,
      default: false,
    },
    hideButtonsPane: {
      type: Boolean,
      default: false,
    },
    sizing: {
      type: Object,
      default: () => ({}),
    },
    libraryProgressText: {
      type: String,
      default: "",
    },
  },

  data() {
    const toggleNoEmbyFlag = async (show, flagName) => {
      this.saveVisShow(show);
      // If the flag doesn't exist yet, treat it as false and set to true.
      show[flagName] = !show[flagName];
      await srvr.addNoEmby(show).catch((err) => {
        console.error(`late addNoEmby error (${flagName}):`, err);
      });
    };

    const toggleToTry = async (show) => {
      if (show.inEmby === false) {
        await toggleNoEmbyFlag(show, "InToTry");
        return;
      }
      this.saveVisShow(show);
      const originalValue = show.InToTry;
      show.InToTry = !show.InToTry;
      try {
        await emby.saveToTry(show.Id, show.InToTry, show.Name);
      } catch (err) {
        console.error("toggleToTry error:", err);
        show.InToTry = originalValue; // Revert on error
      }
    };

    const toggleContinue = async (show) => {
      if (show.inEmby === false) {
        await toggleNoEmbyFlag(show, "InContinue");
        return;
      }
      this.saveVisShow(show);
      const originalValue = show.InContinue;
      show.InContinue = !show.InContinue;
      try {
        await emby.saveContinue(show.Id, show.InContinue, show.Name);
      } catch (err) {
        console.error("toggleContinue error:", err);
        show.InContinue = originalValue; // Revert on error
      }
    };

    const toggleMark = async (show) => {
      if (show.inEmby === false) {
        await toggleNoEmbyFlag(show, "InMark");
        return;
      }
      this.saveVisShow(show);
      const originalValue = show.InMark;
      show.InMark = !show.InMark;
      try {
        await emby.saveMark(show.Id, show.InMark, show.Name);
      } catch (err) {
        console.error("toggleMark error:", err);
        show.InMark = originalValue;
      }
    };

    const toggleLinda = async (show) => {
      if (show.inEmby === false) {
        await toggleNoEmbyFlag(show, "InLinda");
        return;
      }
      this.saveVisShow(show);
      const originalValue = show.InLinda;
      show.InLinda = !show.InLinda;
      try {
        await emby.saveLinda(show.Id, show.InLinda, show.Name);
      } catch (err) {
        console.error("toggleLinda error:", err);
        show.InLinda = originalValue; // Revert on error
      }
    };

    const toggleFavorite = (show) => {
      if (show.inEmby === false && !show.IsFavorite) return;
      this.saveVisShow(show);
      show.IsFavorite = !show.IsFavorite;
      emby.saveFav(show.Id, show.IsFavorite).catch((err) => {
        console.error("late saveFavorite error:", err);
        //- show.IsFavorite = !show.IsFavorite;
      });
    };

    const toggleReject = async (show) => {
      this.saveVisShow(show);
      if (!show.Reject) {
        show.Reject = true;
        try {
          await srvr.addReject(show.Name);
        } catch (err) {
          console.error("addReject error:", err);
          show.Reject = false;
          return;
        }
        if (show.inEmby !== false) {
          try {
            // Delete files only — do not call deleteShowFromSrvr which would
            // also call delNoEmby and remove the tvdb record
            const showFolder = show.Path.split("/").pop();
            this.showEmbyRefreshing = true;
            this.logModalMessage("embyRefreshingModal", "Deleting from Emby.");
            await srvr.deletePath(showFolder);
            await this.refreshEmbyLibraryWithDialog();
            await emby.deleteShowFromEmby(show);
          } catch (err) {
            console.error("deleteShowFromEmby after reject error:", err);
            this.showEmbyRefreshing = false;
          }
          const tvdbData = allTvdb[show.Name];
          if (tvdbData) {
            const leftEmby = util.getPstDate();
            tvdbData.inEmby = false;
            tvdbData.leftEmby = leftEmby;
            allTvdb[show.Name] = await srvr.setTvdbFields({
              name: show.Name,
              inEmby: false,
              leftEmby,
            });
          }
          show.inEmby = false;
        }
        return;
      }

      show.Reject = false;
      try {
        await srvr.delReject(show.Name);
      } catch (err) {
        console.error("delReject error:", err);
        show.Reject = true;
      }
    };

    const togglePickup = (show) => {
      this.saveVisShow(show);
      show.Pickup = !show.Pickup;
      if (show.Pickup)
        srvr.addPickup(show.Name).catch((err) => {
          console.error("late addPickup:", err);
          //- show.Pickup = !show.Pickup;
        });
      else
        srvr.delPickup(show.Name).catch((err) => {
          console.error("late delPickup:", err);
          // show.Pickup = !show.Pickup;
        });
    };

    const deleteShow = async (show) => {
      allTvdb = await tvdb.getAllTvdb();
      const name = show.Name;
      if (show.reject) {
        alert("Show is banned, ignoring delete");
        return;
      }
      if (show.inEmby !== false) {
        this.saveVisShow(show);
        if (
          !window.confirm(
            `Do you really want to remove ${name} from emby and the disk?`,
          )
        )
          return;
        // Delete files from server first
        await srvr.deleteShowFromSrvr(show);
        // Now delete from Emby (DELETE /Items/{id} removes it directly, no library scan needed)
        await emby.deleteShowFromEmby(show);
        // Set inEmby to false to mark as deleted and set leftEmby timestamp
        const tvdbData = allTvdb[name];
        tvdbData.inEmby = false;
        const leftEmby = util.getPstDate();
        tvdbData.leftEmby = leftEmby;
        allTvdb[name] = await srvr.setTvdbFields({
          name,
          inEmby: false,
          leftEmby,
        });
        // Capture the next visible show before refilter removes this one from the list.
        const delIdx = this.shows.findIndex((s) => s.Id == show.Id);
        const nextShow =
          delIdx >= 0
            ? this.shows[delIdx + 1] || this.shows[delIdx - 1] || null
            : null;
        // Update the show object so refilter reflects the new inEmby state.
        // The show stays in allShows so it appears when hasemby condfltr is 0.
        show.inEmby = false;
        await this.refilter(false);
        // Highlight the next show now that the deleted show has been filtered out.
        if (nextShow) this.saveVisShow(nextShow, true);
      } else {
        // Not in Emby: permanently delete with confirmation (no files to delete)
        if (
          !window.confirm(
            `Do you want to PERMANENTLY delete the show "${name}"?`,
          )
        )
          return;
        this.removeRow(show);
        // Permanently remove from tvdb.json and in-memory lists
        delete allTvdb[name];
        await srvr.setTvdbFields({ name, $delTvdb: true });
      }
    };

    return {
      deleteShow,
      updatingMsg: "",
      shows: [],
      filterStr: "",
      errMsg: "",
      highlightName: "",
      previewMode: false,
      _pendingSetUpSeriesToken: 0,
      allShowsLength: 0,
      currentPane: "info",
      mapShow: null,
      hideMapBottom: true,
      seriesMapSeasons: [],
      seriesMapEpis: [],
      seriesMap: {},
      watchingName: "---",
      currentPlayingDevice: null,
      sortPopped: false,
      sortChoice: "Viewed",
      fltrPopped: false,
      fltrChoice: "All",
      showSearching: false,
      searchingShowName: "",
      searchingStatus: "",
      showReloadingShows: false,
      showEmbyRefreshing: false,
      isWideLandscape: false,
      actorFilter: null,
      actorSearchParams: null, // Store search params for word-based actor search
      qbtActiveShowNames: [],
      downActiveShowNames: [],
      hasLoadedAllShows: false,
      sortChoices: [
        "Alpha",
        "Viewed",
        "Added",
        "Ratings",
        "Notes",
        "Size",
        "Ended",
        "Length",
      ],
      fltrChoices: ["All", "Try Drama", "Finished"],
      conds: [
        {
          color: "#0cf",
          filter: 0,
          icon: ["fas", "plus"],
          cond(show) {
            return show.notReady === false;
          },
          click() {},
          name: "unplayed",
        },
        {
          color: "#f88",
          filter: 0,
          icon: ["fas", "minus"],
          cond(show) {
            return (
              show.FileGap ||
              show.WatchGap ||
              (show.inEmby === false && !show.S1E1Unaired)
            );
          },
          click() {},
          name: "gap",
        },
        {
          color: "#faa",
          filter: 0,
          icon: ["fas", "traffic-light"],
          cond(show) {
            return show.Ended;
          },
          click() {},
          name: "ended",
        },
        {
          color: "#88f",
          filter: 0,
          icon: ["far", "sad-cry"],
          cond(show) {
            return !show.Genres?.includes("Comedy");
          },
          click() {},
          name: "drama",
        },
        {
          color: "#88f",
          filter: 0,
          icon: ["fas", "globe"],
          cond(show) {
            return show?.OriginalCountry?.toUpperCase() != "USA";
          },
          click() {},
          name: "foreign",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["fas", "question"],
          cond(show) {
            return show.InToTry;
          },
          async click(show) {
            await toggleToTry(show);
          },
          name: "totry",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["fas", "arrow-right"],
          cond(show) {
            return show.InContinue;
          },
          async click(show) {
            await toggleContinue(show);
          },
          name: "continue",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["fas", "mars"],
          cond(show) {
            return show.InMark;
          },
          async click(show) {
            await toggleMark(show);
          },
          name: "mark",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["fas", "venus"],
          cond(show) {
            return show.InLinda;
          },
          async click(show) {
            await toggleLinda(show);
          },
          name: "linda",
        },
        {
          color: "red",
          filter: 0,
          icon: ["far", "heart"],
          cond(show) {
            return show.IsFavorite;
          },
          async click(show) {
            await toggleFavorite(show);
          },
          name: "favorite",
        },
        {
          color: "red",
          filter: -1,
          icon: ["fas", "ban"],
          cond(show) {
            return show.Reject;
          },
          async click(show) {
            await toggleReject(show);
          },
          name: "ban",
        },
        {
          color: "#5ff",
          filter: 0,
          icon: ["fas", "arrow-down"],
          cond(show) {
            return show.Pickup;
          },
          async click(show) {
            await togglePickup(show);
          },
          name: "pickup",
        },
        {
          color: "#a66",
          filter: +1,
          icon: ["fas", "tv"],
          cond(show) {
            return show.inEmby !== false;
          },
          async click(show) {
            await deleteShow(show);
          },
          name: "hasemby",
        },
      ],
    };
  },

  computed: {
    displayHighlightName() {
      return this.highlightName;
    },

    activeDownloadShowNames() {
      return Array.from(
        new Set([
          ...(Array.isArray(this.qbtActiveShowNames)
            ? this.qbtActiveShowNames
            : []),
          ...(Array.isArray(this.downActiveShowNames)
            ? this.downActiveShowNames
            : []),
        ]),
      );
    },
  },

  /////////////  METHODS  ////////////
  methods: {
    markShowUpdating(showName) {
      if (!showName) return;
      if (!this._updatingShows) this._updatingShows = new Set();
      this._updatingShows.add(showName);
      this.updatingMsg = `Updating ${showName}...`;
    },

    clearShowUpdating(showName) {
      if (!this._updatingShows || !showName) return;
      this._updatingShows.delete(showName);
      if (this._updatingShows.size === 0) {
        this.updatingMsg = "";
      } else {
        const remaining = [...this._updatingShows];
        this.updatingMsg = `Updating ${remaining[remaining.length - 1]}...`;
      }
    },

    logModalMessage(modalName, message) {
      console.error(`[${modalName}] ${String(message ?? "")}`);
    },

    showSearchingModal(showName, status) {
      this.searchingShowName = String(showName || "");
      this.searchingStatus = String(status || "");
      this.showSearching = true;
      this.logModalMessage(
        "searchingModal",
        [
          "Searching web for information about show:",
          this.searchingShowName,
          this.searchingStatus || "Please wait ...",
        ].join("\n"),
      );
    },

    setSearchingModalStatus(status) {
      this.searchingStatus = String(status || "");
      if (this.showSearching) {
        this.logModalMessage(
          "searchingModal",
          [
            "Searching web for information about show:",
            this.searchingShowName,
            this.searchingStatus || "Please wait ...",
          ].join("\n"),
        );
      }
    },

    async loadAllShowsWithDialog() {
      if (this.hasLoadedAllShows) {
        console.log("All shows already loaded, skipping");
        return;
      }

      console.log("Loading all shows...");

      this.hasLoadedAllShows = true;

      // Load full dataset
      const additionalShows = await tvdb.getAllTvdb(0);

      // Merge into allTvdb
      Object.assign(allTvdb, additionalShows);

      // Add to allShows array, avoiding duplicates
      const additionalShowsArray = Object.values(additionalShows);
      const existingNames = new Set(allShows.map((s) => s.Name));
      const newShows = additionalShowsArray.filter(
        (s) => !existingNames.has(s.Name),
      );
      allShows.push(...newShows);

      console.log(`Added ${newShows.length} shows (total: ${allShows.length})`);
    },

    updateWideLandscape() {
      // Simple heuristic: treat landscape as "wide".
      // (On desktops, simpleMode is typically off, so this won't affect normal layout.)
      try {
        const isLandscape = !!(
          window.matchMedia &&
          window.matchMedia("(orientation: landscape)").matches
        );
        const w = Number(window.innerWidth || 0);
        const h = Number(window.innerHeight || 0);
        this.isWideLandscape = isLandscape && w > h;
      } catch {
        this.isWideLandscape = false;
      }
    },

    libraryClick() {
      evtBus.emit("startLibraryRefresh");
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
            console.error("ctrl-send: getSharedFilters failed", err);
            shared = null;
          }

          if (shared && typeof shared === "object") {
            if (shared.filterStr !== undefined)
              this.filterStr = String(shared.filterStr || "");
            if (shared.fltrChoice !== undefined)
              this.fltrChoice = String(shared.fltrChoice || "All");

            const condFilters =
              shared.condFilters && typeof shared.condFilters === "object"
                ? shared.condFilters
                : null;
            if (condFilters) {
              this.conds.forEach((cond) => {
                if (!cond?.name) return;
                if (condFilters[cond.name] !== undefined) {
                  cond.filter = condFilters[cond.name];
                }
              });
            }
          }

          await this.select();
          this.sortShows();

          this.$nextTick(() => {
            const container = document.querySelector("#shows");
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

        const payload = {
          fltrChoice: this.fltrChoice,
          filterStr: this.filterStr,
          condFilters,
        };

        const isAllMode =
          this.fltrChoice === "All" &&
          (!this.filterStr || String(this.filterStr).length === 0) &&
          (this.conds || []).every((c) => {
            if (!c?.name) return true;
            if (c.name === "ban") return c.filter === -1; // default ban behavior
            return c.filter === 0;
          });

        if (isAllMode) {
          await srvr.setSharedFilters(null);
        } else {
          await srvr.setSharedFilters(payload);
        }
      } catch (e) {
        console.error("sendSharedFilters failed:", e);
      }
    },

    async debugClick() {
      try {
        if (!this.highlightName) {
          console.log("No show selected");
          return;
        }

        const currentShow = allShows.find((s) => s.Name === this.highlightName);
        if (!currentShow) {
          console.log("Could not find show:", this.highlightName);
          return;
        }

        const tvdbId = currentShow.TvdbId || currentShow.tvdbId;
        if (!tvdbId) {
          console.log("Show has no TvdbId:", this.highlightName);
          return;
        }

        console.log(
          "Fetching TVDB API data for:",
          this.highlightName,
          "TvdbId:",
          tvdbId,
        );

        const result = await srvr.debugTvdb({
          name: currentShow.Name,
          tvdbId: tvdbId,
        });

        console.log("Debug result:", result);
      } catch (e) {
        console.error("debugClick failed:", e);
      }
    },

    async handleButtonClick(activeButtons, clickedLabel) {
      // In simple mode, button states control conds (pure state-based)
      if (!this.simpleMode) return;

      // Custom: apply previously-shared filter state (saved by non-simple Send).
      if (activeButtons && activeButtons["Custom"]) {
        try {
          const shared = await srvr.getSharedFilters();
          if (shared && typeof shared === "object") {
            if (shared.filterStr !== undefined)
              this.filterStr = String(shared.filterStr || "");
            if (shared.fltrChoice !== undefined)
              this.fltrChoice = String(shared.fltrChoice || "All");
            const condFilters =
              shared.condFilters && typeof shared.condFilters === "object"
                ? shared.condFilters
                : null;
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
          console.error("Custom sharedFilters parse/apply failed:", e);
        }

        // Preserve current sort unless an order button is active.
        const orderToSortMap = {
          "Added Order": "Added",
          "Viewed Order": "Viewed",
          "Ratings Order": "Ratings",
          "Notes Order": "Notes",
          "Ended Order": "Ended",
          "Length Order": "Length",
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
          const container = document.querySelector("#shows");
          if (container) container.scrollTop = 0;
          if (Array.isArray(this.shows) && this.shows.length > 0) {
            this.saveVisShow(this.shows[0], false);
          }
        });
        return;
      }

      // Trash button: only update hasemby, leave all other conds unchanged
      if (clickedLabel === "Trash") {
        const hasembyCond = this.conds.find((c) => c?.name === "hasemby");
        if (hasembyCond) {
          hasembyCond.filter = activeButtons["Trash"] ? 0 : 1;
        }
        if (activeButtons["Trash"] && !this.hasLoadedAllShows) {
          await this.loadAllShowsWithDialog();
        }
        await this.select();
        return;
      }

      // Not in Custom: ensure any previously-applied sharedFilters state does not
      // linger (but do NOT delete localStorage.sharedFilters; Custom can be used again).
      this.filterStr = "";
      this.fltrChoice = "All";

      // activeButtons is an object with all button states
      // e.g., { 'Drama': true, 'Mark': true, 'Comedy': false, ... }

      // Map button labels to cond names
      const buttonToCondMap = {
        "Ready To Watch": "unplayed",
        Drama: "drama",
        Comedy: "drama", // Comedy uses drama cond but inverted
        "To Try": "totry",
        Continue: "continue",
        Mark: "mark",
        Linda: "linda",
      };

      // Map order button labels to sortChoice values
      const orderToSortMap = {
        "Added Order": "Added",
        "Viewed Order": "Viewed",
        "Ratings Order": "Ratings",
        "Notes Order": "Notes",
        "Ended Order": "Ended",
        "Length Order": "Length",
      };

      // Pure state-based: Sync conds to match button states
      this.conds.forEach((cond) => {
        // Ban is always -1 in simple mode
        if (cond.name === "ban") {
          cond.filter = -1;
          return;
        }

        // Special handling for hasemby: default to 1 (hide trash), Trash button sets to 0 (show all)
        if (cond.name === "hasemby") {
          const trashActive = activeButtons["Trash"];
          cond.filter = trashActive ? 0 : 1;
          return;
        }

        // Find if any button controls this cond
        let condValue = 0; // Default: off

        for (const [label, isActive] of Object.entries(activeButtons)) {
          const mappedCondName = buttonToCondMap[label];
          if (mappedCondName === cond.name && isActive) {
            // Special handling for Comedy button - inverts the drama cond
            condValue = label === "Comedy" ? -1 : 1;
            break;
          }
        }

        cond.filter = condValue;
      });

      if (activeButtons["Trash"] && !this.hasLoadedAllShows) {
        await this.loadAllShowsWithDialog();
      }

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
      this.sortChoice = activeSortOrder || "Alpha";

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
      switch (this.sortChoice) {
        case "Alpha":
          if (!forSort) return "";
          return show.Name.replace(/^the\s*/i, "").toLowerCase();
        case "Added":
          return show.DateCreated;
        case "Ended":
          return show.LastAired || "";
        case "Length":
          return show.averageRuntime || 0;
        case "Size":
          if (forSort) return show.Size;
          return util.fmtSize(show);
        case "Ratings":
          ratings = show?.Ratings;
          if (forSort)
            return ratings !== undefined && ratings !== null && ratings !== 0
              ? +ratings
              : 0;
          return ratings !== undefined && ratings !== null && ratings !== 0
            ? String(ratings)
            : "";
        case "Notes":
          if (!forSort) return "";
          return String(show?.Notes ?? "")
            .trim()
            .toLowerCase();
        case "Viewed":
          lastViewed = srvr.lastViewedCache[show.Name];
          if (forSort) return lastViewed || 0;
          if (lastViewed === undefined) return "";
          return util.fmtDate(lastViewed);
      }
    },

    setHighlightAfterDel(id) {
      for (let i = 0; i < this.shows.length; i++) {
        if (this.shows[i].Id == id) {
          let nextShow = this.shows[i + 1];
          if (!nextShow) nextShow = this.shows[i - 1];
          if (!nextShow) nextShow = this.shows[0];
          this.saveVisShow(nextShow, true);
          return nextShow;
        }
      }
      return null;
    },

    addRow(show) {
      if (!show) return;
      const existsById = (arr) =>
        Array.isArray(arr) && arr.some((s) => s?.Id && s.Id === show.Id);
      const existsByName = (arr) =>
        Array.isArray(arr) && arr.some((s) => s?.Name && s.Name === show.Name);
      const alreadyExists =
        existsById(allShows) ||
        existsByName(allShows) ||
        existsById(this.shows) ||
        existsByName(this.shows);
      if (alreadyExists) {
        // Don't insert duplicates; just select/highlight.
        this.saveVisShow(show, true);
        return;
      }

      console.log("addRow", show.Name);
      this.shows.unshift(show);
      if (allShows !== this.shows) allShows.unshift(show);
      this.saveVisShow(show, true);
    },

    removeRow(show) {
      console.log("removeRow", show.Name);
      const id = show.Id;
      const newShow = this.setHighlightAfterDel(id);
      this.shows = this.shows.filter((show) => show.Id != id);
      if (this.shows !== allShows)
        allShows = allShows.filter((show) => show.Id != id);
      if (newShow) this.saveVisShow(newShow, true);
    },

    hilite(show) {
      return this.highlightName == show.Name ? "yellow" : "white";
    },

    async searchAction(payload) {
      const srchChoice = payload?.srchChoice ? payload.srchChoice : payload;
      const action = payload?.action || "preview";
      const { name, tvdbId, overview, imageUrl, imdbId } = srchChoice || {};

      // Dropdown click now previews by default.
      if (action === "preview") {
        await this.previewSearchChoice({
          name,
          tvdbId,
          overview,
          imageUrl,
          imdbId,
        });
        return;
      }

      // Fallback: if something explicitly asks to add.
      await this.addSearchChoice({ name, tvdbId, overview });
    },

    async addSearchChoice({ name, tvdbId, overview }, opts = null) {
      // This is the original "web dropdown click" behavior: add/create the show.
      if (!name) return;

      const options = opts && typeof opts === "object" ? opts : {};
      const fromPreview = !!options.fromPreview;
      if (fromPreview) {
        evtBus.emit("addPreviewShowStart", { name, tvdbId, overview });
      }

      const matchShow = this.findExistingShowForSearchChoice({
        name,
        tvdbId,
      });
      if (matchShow && matchShow.inEmby !== false) {
        console.log(matchShow.Name + " already exists.");
        if (!this.shows.some((sh) => sh?.Name === matchShow.Name)) {
          await this.fltrAction("All");
        }
        this.onSelectShow(matchShow, true);
        return;
      }

      // Show searching modal
      this.showSearchingModal(name, "Starting...");

      const setWebAddStatus = (txt) => {
        this.setSearchingModalStatus(txt);
      };
      const withTimeout = async (promise, ms, label) => {
        const timeoutMs = Math.max(0, Number(ms) || 0);
        let t;
        const timeout = new Promise((_, reject) => {
          t = setTimeout(
            () => reject(new Error(`timeout waiting for ${label}`)),
            timeoutMs,
          );
        });
        try {
          return await Promise.race([promise, timeout]);
        } finally {
          clearTimeout(t);
        }
      };

      const findShowByTvdbIdOrName = () =>
        Array.isArray(allShows)
          ? allShows.find((s) => {
              const sTvdbId = String(
                s?.TvdbId || s?.tvdbId || s?.tvdb_id || "",
              ).trim();
              if (tvdbId && sTvdbId && sTvdbId === String(tvdbId).trim()) {
                return true;
              }
              return s?.Name === name;
            })
          : null;

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
        seasonCount: 0,
        episodeCount: 0,
        watchedCount: 0,
      };
      let tvdbData = null;

      let ok = false;
      try {
        setWebAddStatus("Waiting for TVDB data...");
        tvdbData = await withTimeout(
          srvr.getNewTvdb(paramObj),
          60000,
          "tvdb data",
        );

        let seriesMapSeasons = [];
        try {
          setWebAddStatus("Fetching season map...");
          const seriesMapIn = await withTimeout(
            tvdb.getSeriesMapByTvdbId(tvdbId),
            60000,
            "tvdb series map",
          );
          if (Array.isArray(seriesMapIn) && seriesMapIn.length > 0) {
            seriesMapSeasons = seriesMapIn
              .map((season) =>
                Number(Array.isArray(season) ? season[0] : undefined),
              )
              .filter((n) => Number.isFinite(n) && n > 0)
              .sort((a, b) => a - b);
          }
        } catch (e) {
          seriesMapSeasons = [];
          console.error("web add: failed to fetch series map", {
            name,
            tvdbId,
            err: e?.message || e,
          });
        }

        const hasMapData =
          !!tvdbData &&
          typeof tvdbData === "object" &&
          Object.keys(tvdbData).length > 0;

        let createdFolder = false;
        let createResult = null;
        if (!hasMapData) {
          createdFolder = false;
          console.error(
            "web add: missing map data; skipping createShowFolder",
            {
              name,
              tvdbId,
              seriesMapSeasons,
              tvdbData,
            },
          );
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
          createResult = res;
          createdFolder = !!res?.createdFolder;
          if (!createdFolder) {
            console.error("web add: createShowFolderAndRefreshEmby failed", {
              name,
              tvdbId,
              res,
            });
          }
        }

        if (createdFolder) {
          try {
            setWebAddStatus("Reloading shows...");
            tvdb.clearCache();
            await this.newShows(false);

            // Trigger gap check for the newly added show
            const newShow = Array.isArray(allShows)
              ? allShows.find((s) => {
                  const sTvdbId = String(
                    s?.TvdbId || s?.tvdbId || s?.tvdb_id || "",
                  ).trim();
                  if (tvdbId && sTvdbId && sTvdbId === String(tvdbId).trim()) {
                    return true;
                  }
                  return s?.Name === name;
                })
              : null;
            if (newShow?.Id) {
              await srvr
                .triggerShowGapCheck(newShow.Id, name)
                .catch((err) =>
                  console.error("triggerShowGapCheck failed:", err),
                );
            }
          } catch {
            // ignore
          }

          show = findShowByTvdbIdOrName();

          // Emby created the folder, but the item may not be visible immediately.
          // Retry discovery; never create a no-emby duplicate in this branch.
          if (!show) {
            setWebAddStatus("Waiting for Emby scan...");
            for (let attempt = 1; attempt <= 4; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              tvdb.clearCache();
              await this.newShows(false);
              show = findShowByTvdbIdOrName();
              if (show) break;
              setWebAddStatus(`Waiting for Emby scan... (${attempt}/4)`);
            }
          }

          if (!show) {
            throw new Error(
              `Created in Emby but not found after refresh: ${name} (tvdbId=${tvdbId})`,
            );
          }

          if (show) {
            show.TvdbId = tvdbId;
            show.Overview = overview;
            show.Reject = reject;
          }
        }

        if (!show) {
          console.error("web add: aborted without creating noemby fallback", {
            name,
            tvdbId,
            createdFolder,
            hasMapData,
            createResult,
            seriesMapSeasons,
          });

          evtBus.emit("tvdb-mismatch", {
            reason: "add-aborted-no-create",
            action: "blocked-create",
            name,
            showId: "",
            tvdbId,
            existing: {
              key: "",
              name: "",
              tvdbId: "",
              Id: "",
              inEmby: "",
            },
            details: {
              hasMapData,
              createdFolder,
              createResult,
              seriesMapSeasons,
            },
          });
          return;
        }

        if (tvdbData) {
          delete tvdbData.deleted;
          tvdb.upsertTvdbCacheRecord(allTvdb, tvdbData, show?.Name || name);
          // Clear shared cache so Info/Reviews get fresh data
          tvdb.clearCache();
        }

        const alreadyInAllShows =
          Array.isArray(allShows) &&
          (allShows.some((s) => s?.Id === show?.Id) ||
            allShows.some((s) => s?.Name === show?.Name));
        if (!alreadyInAllShows) {
          this.addRow(show);
        }
        this.sortShows();
        this.saveVisShow(show, true, { forceSetUpSeries: true });

        ok = true;
      } catch (e) {
        console.error("web add: failed", {
          name,
          tvdbId,
          err: e?.message || e,
        });
        alert(`Web add failed for ${name}`);
      } finally {
        this.showSearching = false;
        this.searchingStatus = "";

        if (fromPreview) {
          // Done adding: exit preview mode and notify Series so it can hide the button.
          evtBus.emit("addPreviewShowDone", { ok, name, tvdbId, overview });
          this.setPreviewMode(false);
          // Explicitly switch to info pane so the newly added show is visible.
          // setPreviewMode(false) restores savedPane (browse) and sets restoringPreviewPane=true,
          // which would block setUpSeries from switching panes; override that here.
          if (ok) evtBus.emit("showSeriesPane");
        }
      }
    },

    async previewSearchChoice({ name, tvdbId, overview, imageUrl, imdbId }) {
      const showName = String(name || "").trim();
      if (!showName) return;

      // If the show already exists, do nothing but select it.
      // Do not enter preview mode, regardless of emby/noemby/rejected status.
      const existing = this.findExistingShowForSearchChoice({
        name: showName,
        tvdbId,
      });
      if (existing) {
        if (!this.shows.some((sh) => sh?.Name === existing.Name)) {
          await this.fltrAction("All");
        }
        this.onSelectShow(existing, true);
        return;
      }

      this.setPreviewMode(true);

      // Preview mode: panes will start loading info.
      evtBus.emit("previewPanesLoading", true);

      // Always switch to the Series pane for preview.
      evtBus.emit("showSeriesPane");

      // Let Series know which search choice is being previewed (for Add Show button).
      evtBus.emit("previewSrchChoice", { name: showName, tvdbId, overview });

      const show = {
        // Mark as no-Emby so Series doesn't try to query Emby counts.
        Id: `noemby-preview-${String(tvdbId || imdbId || showName).replace(/\s+/g, "-")}`,
        inEmby: false,
        Name: showName,
        TvdbId: tvdbId,
        ImdbId: imdbId,
        Overview: overview,
        imageUrl: imageUrl,
        Reject: emby.isReject(showName),
      };

      // Update Map pane contents on preview (map will show TVDB data).
      this.saveVisShow(show, false, {
        skipHighlight: true,
        skipPersist: true,
        skipHistory: true,
        forceSetUpSeries: true,
      });

      // Once Series publishes tvdbDataReady, preload Actors without prefetching series-map.
      const onTvdbDataReady = (data) => {
        try {
          const incomingShow = data?.show;
          if (!incomingShow) return;
          const sameName =
            incomingShow?.Name && show?.Name && incomingShow.Name === show.Name;
          if (!sameName) return;

          evtBus.off("tvdbDataReady", onTvdbDataReady);

          // Preload Actors in preview mode.
          evtBus.emit("showActors", {
            show,
            tvdbData: data?.tvdbData ?? null,
          });
        } catch {
          // ignore
        }
      };
      evtBus.on("tvdbDataReady", onTvdbDataReady);

      // Fallback cleanup: if tvdbDataReady never arrives, don't leak listeners.
      setTimeout(() => {
        try {
          evtBus.off("tvdbDataReady", onTvdbDataReady);
        } catch {
          /* ignore */
        }
      }, 15000);
    },

    topClick() {
      const container = document.querySelector("#shows");
      container.scrollTop = 0;
      this.saveVisShow(this.shows[0], true);
    },

    async prevNextClick(next) {
      if (showHistory.length == 0) return;
      const newPtr = showHistoryPtr + (next ? 1 : -1);
      if (newPtr < 0 || newPtr >= showHistory.length) return;
      showHistoryPtr = newPtr;
      const show = showHistory[showHistoryPtr];
      const showArr = this.shows.filter((showIn) => showIn.Name == show.Name);
      if (showArr.length == 0) {
        await this.fltrAction("All");
      }
      this.saveVisShow(show, true);
    },

    async allClick() {
      evtBus.emit("clearFilterButtons");
      await this.fltrAction("All");
    },
    onSelectShow(show, scroll = false) {
      // console.log('List: selected show:', show);
      const wasPreview = !!this.previewMode;
      const wasAlreadySelected = show?.Name === this.highlightName;

      if (wasPreview) this.setPreviewMode(false);
      this.saveVisShow(show, scroll);

      // If we just exited preview mode, always land on Series for the newly selected show.
      if (wasPreview) {
        evtBus.emit("showSeriesPane");
        return;
      }

      // If clicking on an already-selected show, always switch to info pane.
      if (wasAlreadySelected) {
        evtBus.emit("showSeriesPane");
        return;
      }

      // Clicking a show should generally return to the Series pane.
      // Exception: when the user is actively in Map/Actors/Subs/Files/Reviews/Trailer/AI, do not switch panes.
      const keepPane = new Set([
        "map",
        "actors",
        "subs",
        "files",
        "reviews",
        "trailer",
        "ai",
      ]);
      if (!keepPane.has(this.currentPane)) {
        evtBus.emit("showSeriesPane");
      }
    },

    normalizeForShowMatch(name) {
      return String(name || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\b(and|the)\b/gi, " ")
        .replace(/\s+/g, " ")
        .replace(/[^a-zA-Z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
    },

    findExistingShowForSearchChoice({ name, tvdbId }) {
      if (!Array.isArray(allShows) || allShows.length === 0) return null;

      const nm = String(name || "").trim();
      const id = tvdbId == null || tvdbId === "" ? "" : String(tvdbId).trim();

      if (id) {
        const byId = allShows.find((s) => {
          const sid = s?.TvdbId ?? s?.TvdbShowId ?? s?.tvdbId ?? null;
          if (sid == null || sid === "") return false;
          return String(sid).trim() === id;
        });
        if (byId) return byId;
      }

      if (nm) {
        // Duplicate Detection: forceChoice = false
        const match = util.smartTitleMatch(nm, allShows, null, false);
        if (match) return match;
      }

      return null;
    },

    stripTitleNoise(raw) {
      let s = String(raw || "").trim();
      if (!s) return "";

      // Remove path prefix if present (Windows or Unix paths)
      s = s.replace(/^.*[\\/]/, "");

      // Remove common media extensions
      s = s.replace(
        /\.(mkv|mp4|avi|m4v|ts|m2ts|wmv|mov|mpg|mpeg|srt|sub|rar|zip|7z)$/i,
        "",
      );

      return s.trim();
    },

    findShowFromActiveRawTitle(rawTitle) {
      const raw = String(rawTitle || "").trim();
      if (!raw) return null;
      if (!Array.isArray(allShows) || allShows.length === 0) return null;
      return util.smartTitleMatch(raw, allShows, null, true);
    },

    updateActiveShowNames(source, rawTitles) {
      const names = new Set();
      const list = Array.isArray(rawTitles) ? rawTitles : [];

      for (const rawTitle of list) {
        const show = this.findShowFromActiveRawTitle(rawTitle);
        if (show?.Name) names.add(show.Name);
      }

      const next = Array.from(names);
      if (source === "qbt") {
        this.qbtActiveShowNames = next;
        return;
      }
      if (source === "down") {
        this.downActiveShowNames = next;
      }
    },

    async selectShowFromCardTitle(rawTitle) {
      const req =
        rawTitle && typeof rawTitle === "object"
          ? rawTitle
          : { rawTitle: rawTitle };

      const raw = String(req.rawTitle || req.title || req.name || "").trim();
      const reqTvdbId = String(req.tvdbId || "").trim();

      if (!raw) return;
      if (!Array.isArray(allShows) || allShows.length === 0) {
        return;
      }

      const stripped = this.stripTitleNoise(raw);

      let parsed = null;
      try {
        let parser = null;
        if (typeof parseTorrentTitle === "function") {
          parser = parseTorrentTitle;
        } else if (
          parseTorrentTitle &&
          typeof parseTorrentTitle.parse === "function"
        ) {
          parser = parseTorrentTitle.parse;
        } else if (
          parseTorrentTitle &&
          parseTorrentTitle.default &&
          typeof parseTorrentTitle.default.parse === "function"
        ) {
          parser = parseTorrentTitle.default.parse;
        }

        parsed = parser ? parser(stripped) : null;
      } catch (e) {
        parsed = null;
      }

      const searchTitle = parsed?.title || stripped || raw;
      const searchYear = parsed?.year || null;

      let match = null;

      // First try requested tvdb id if provided (important for TVDB browse selections).
      if (reqTvdbId) {
        match = allShows.find((s) => {
          const sTvdb = String(
            s?.TvdbId || s?.tvdbId || s?.tvdb_id || "",
          ).trim();
          return sTvdb && sTvdb === reqTvdbId;
        });
      }

      // Then exact name match (important for gallery selections)
      if (!match) {
        match = allShows.find((s) => s.Name === raw);
      }

      if (!match) {
        // Try case-insensitive exact match
        const rawLower = raw.toLowerCase();
        match = allShows.find((s) => s.Name?.toLowerCase() === rawLower);
      }

      if (!match && !this.hasLoadedAllShows) {
        await this.loadAllShowsWithDialog();

        if (!match && reqTvdbId) {
          match = allShows.find((s) => {
            const sTvdb = String(
              s?.TvdbId || s?.tvdbId || s?.tvdb_id || "",
            ).trim();
            return sTvdb && sTvdb === reqTvdbId;
          });
        }

        // Try exact match again with the complete show list
        if (!match) {
          match = allShows.find((s) => s.Name === raw);
        }
        if (!match) {
          const rawLower = raw.toLowerCase();
          match = allShows.find((s) => s.Name?.toLowerCase() === rawLower);
        }
      }

      if (!match) {
        // Fall back to fuzzy matching as last resort
        match = util.smartTitleMatch(searchTitle, allShows, searchYear, true);
      }

      if (match) {
        const isVisible = this.shows.some((sh) => sh?.Name === match.Name);
        if (!isVisible) {
          const hasembyCond = this.conds.find((c) => c?.name === "hasemby");
          const showInEmby = match.inEmby !== false;
          const hiddenByHasemby =
            !!hasembyCond &&
            hasembyCond.filter !== 0 &&
            ((hasembyCond.filter === +1 && !showInEmby) ||
              (hasembyCond.filter === -1 && showInEmby));

          if (hiddenByHasemby) {
            hasembyCond.filter = 0;
            if (!this.hasLoadedAllShows) {
              await this.loadAllShowsWithDialog();
            }
            await this.select(false);
          } else {
            await this.fltrAction("All");
          }
        }
        this.onSelectShow(match, true);
      }
    },

    nameHash(name) {
      this.allShowsLength = allShows.length;
      if (!name) {
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

    async saveVisShow(show, scroll = false, opts = null) {
      if (!show) {
        console.error("saveVisShow show param null");
        return;
      }
      const options = opts && typeof opts === "object" ? opts : {};
      const showName = show.Name;

      const showChanged = options.forceSetUpSeries
        ? true
        : showName !== this.highlightName;

      // Update highlightName BEFORE checking filters so refilter() can preserve the new selection
      if (!options.skipHighlight) {
        this.highlightName = showName;
      }

      // Check if hasemby filter would hide this show, and reset if needed.
      // Skip in preview mode — the fake preview record has inEmby:false and should
      // never cause the real filter selection to change.
      const hasembyCond = this.conds.find((c) => c?.name === "hasemby");
      let needsRefilter = false;
      if (!this.previewMode && hasembyCond && hasembyCond.filter !== 0) {
        const showInEmby = show.inEmby !== false;
        const filterHidesShow =
          (hasembyCond.filter === -1 && showInEmby) ||
          (hasembyCond.filter === +1 && !showInEmby);
        if (filterHidesShow) {
          hasembyCond.filter = 0;
          needsRefilter = true;
        }
      }

      // Re-apply filters if hasemby was reset (highlightName now points to new show)
      if (needsRefilter) {
        await this.refilter(false);
      }

      if (!options.skipHistory) {
        if (
          showHistoryPtr == -1 ||
          showName != showHistory[showHistoryPtr].Name
        ) {
          // console.log("adding show to history:", showName);
          showHistory.push(show);
          showHistoryPtr = showHistory.length - 1;
          // showHistory = showHistory.slice(0, showHistoryPtr+1);
        }
      }

      if (!options.skipPersist) {
        window.localStorage.setItem("lastVisShow", showName);
      }
      if (scroll) this.scrollToSavedShow();

      // Only emit setUpSeries if the show selection changed
      if (showChanged) {
        const token = (this._pendingSetUpSeriesToken || 0) + 1;
        this._pendingSetUpSeriesToken = token;
        this.$nextTick(() => {
          // If another selection happened since scheduling, ignore this one.
          if (token !== this._pendingSetUpSeriesToken) return;
          evtBus.emit("setUpSeries", show);
        });
      }

      // If map pane is currently showing, update it to show the newly selected show
      if (
        !options.skipMapUpdate &&
        this.currentPane === "map" &&
        this.mapShow !== null
      ) {
        void this.seriesMapAction("open", show);
      }

      // Emit after all work is done so browse pane can hide loading dialog
      evtBus.emit("showSelected");
    },

    setPreviewMode(active) {
      const next = !!active;
      if (this.previewMode === next) return;
      this.previewMode = next;
      evtBus.emit("previewMode", next);

      if (!next) {
        evtBus.emit("previewPanesLoading", false);
      }
    },

    sortClick() {
      this.sortPopped = !this.sortPopped;
      console.debug("🚀 ~ sortPopped:", this.sortPopped);
      this.fltrPopped = false;
    },

    sortAction(sortChoice) {
      if (sortChoice != "sortClose") {
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
      this.fltrPopped = !this.fltrPopped;
      this.sortPopped = false;
    },

    async fltrAction(fltrChoice) {
      this.actorFilter = null; // Clear actor filter when changing filter
      this.actorSearchParams = null;
      evtBus.emit("actorSearchCleared");
      if (fltrChoice != "fltrClose") {
        // Set filters first
        window.localStorage.setItem("fltrChoice", fltrChoice);
        this.fltrChoice = fltrChoice;
        this.filterStr = "";
        for (let cond of this.conds) {
          util.setCondFltr(cond, this.fltrChoice);
          if (cond.name === "hasemby" && !this.hasLoadedAllShows) {
            cond.filter = 1;
          }
        }

        await this.select();

        // sortShows() already called in refilter(), no need to call again
      }
      this.sortPopped = false;
      this.fltrPopped = false;
    },

    async scrollToSavedShow(saveVis = false) {
      let show = null;
      const name = window.localStorage.getItem("lastVisShow");
      if (!name) {
        console.log("scrollToSavedShow: lastVisShow missing, ignoring");
        show = allShows[0];
      } else {
        show = allShows.find((shw) => shw.Name == name);
        if (!show) {
          console.log("scrollToSavedShow: show not found", name);
          show = allShows[0];
        }
      }
      if (saveVis) await this.saveVisShow(show);

      // Wait for DOM to update after potential refiltering
      await this.$nextTick();

      // Use RecycleScroller's scrollToItem method
      if (this.$refs.showsComponent && show) {
        this.$refs.showsComponent.scrollToShow(show.Name);
      }
    },

    async copyNameToClipboard(show, event) {
      console.log("copyNameToClipboard", show.Name);
      const ele = event.target;
      const color = ele.style.color;
      ele.style.color = "#f00";
      await navigator.clipboard.writeText(show.Name);
      this.saveVisShow(show);
      ele.style.color = color;
    },

    async episodeClick(e, show, season, episode, setWatched = null) {
      if (e?.ctrlKey) {
        const cell = this.seriesMap?.[season]?.[episode];
        const path = cell?.path;
        const noFile = !!cell?.noFile;

        if (!path || noFile) return;

        const ok = confirm(
          `OK to delete file for ${show.Name} S${season}E${episode} ?`,
        );
        if (!ok) return;

        try {
          await srvr.deletePath(path);
        } catch (err) {
          console.error("episodeClick: deletePath failed", { path, err });
          window.alert(err?.message || String(err));
          return;
        }

        // Refresh just this show in Emby so the episode is removed from its list
        this.markShowUpdating(show.Name);
        await srvr
          .refreshEmbyItem(show.Id, show.Name)
          .catch((err) => console.error("refreshEmbyItem failed:", err));

        // Refresh the Map grid now that Emby has updated.
        await this.seriesMapAction("refresh", show, null);
        return;
      }

      // toggle watched or set to specific value
      await emby.editEpisode(
        show.Id,
        season,
        episode,
        false,
        setWatched,
        show.Name,
      );
      await this.seriesMapAction("", show, null);
    },

    async refreshEmbyLibraryWithDialog(timeoutMs = 120000) {
      const sleep = (ms) =>
        new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, Number(ms) || 0)),
        );

      this.showEmbyRefreshing = true;
      this.logModalMessage("embyRefreshingModal", "Emby is being refreshed.");
      try {
        const res = await emby.refreshLib();
        if (res?.status === "hasTask" && res?.taskId) {
          const startMs = Date.now();
          while (Date.now() - startMs < timeoutMs) {
            const st = await emby.taskStatus(res.taskId);
            if (st?.status !== "refreshing") break;
            await sleep(2000);
          }
        }
      } catch (e) {
        console.error("refreshEmbyLibraryWithDialog failed", e);
      } finally {
        this.showEmbyRefreshing = false;
      }
    },

    async seriesMapAction(action, show, wasDeleted) {
      if (action == "close") {
        this.mapShow = null;
        this.$emit("hide-map");
        return;
      }
      if (
        action == "open" &&
        this.mapShow?.Name === show?.Name &&
        this.currentPane === "map"
      ) {
        // If clicking the same show while already on map, keep it as-is
        return;
      }
      if (action == "date") {
        console.log("setting last watched to cur date");
        await emby.setLastWatched(show.Id);
      }

      const isRefresh = action === "refresh";

      this.hideMapBottom = true;
      this.mapShow = show;
      const seriesMapSeasons = [];
      const seriesMapEpis = [];
      const seriesMap = {};
      let errorMessage = "";

      let seriesMapIn = null;

      // Fetch fresh data from Emby/TVDB
      seriesMapIn = await emby.getSeriesMap(show, action == "prune");

      // Persist watchedEpis if we got data from Emby
      if (
        seriesMapIn &&
        seriesMapIn.length > 0 &&
        show.Name &&
        show.inEmby !== false &&
        allTvdb?.[show.Name]
      ) {
        const watchedEpis = tvdb.seriesMapToWatchedEpis(seriesMapIn);
        allTvdb[show.Name].watchedEpis = watchedEpis;
        await srvr.setTvdbFields({
          name: show.Name,
          watchedEpis: watchedEpis,
        });
      }

      // If emby has no data, try tvdb as fallback
      if (!seriesMapIn || seriesMapIn.length === 0) {
        seriesMapIn = await tvdb.getSeriesMap(show);
        if (!seriesMapIn || seriesMapIn.length === 0) {
          errorMessage = "Not in emby and show not found in TVDB.";
          seriesMapIn = []; // Keep empty for error display
        }
      }

      for (const season of seriesMapIn) {
        const [seasonNum, episodes] = season;
        seriesMapSeasons[seasonNum] = seasonNum;
        const seasonMap = {};
        seriesMap[seasonNum] = seasonMap;
        for (const episode of episodes) {
          let [episodeNum, epiObj] = episode;
          const {
            error,
            played,
            avail,
            noFile,
            unaired,
            deleted: epiDeleted,
            path,
          } = epiObj;
          seriesMapEpis[episodeNum] = episodeNum;
          const deleted =
            epiDeleted ||
            (wasDeleted?.season == seasonNum &&
              wasDeleted?.episode == episodeNum);
          seasonMap[episodeNum] = {
            error,
            played,
            avail,
            noFile,
            unaired,
            deleted,
            path,
          };
        }
      }
      this.seriesMapSeasons = seriesMapSeasons.filter((x) => x !== null);
      this.seriesMapEpis = seriesMapEpis.filter((x) => x !== null);
      this.seriesMap = seriesMap;
      this.hideMapBottom = false;
      // In preview mode, don't overwrite highlightName with the preview show.
      // On refresh, skip saveVisShow entirely — it's just a data update, not a selection change.
      if (!isRefresh) {
        if (this.previewMode) {
          this.saveVisShow(show, false, {
            skipHighlight: true,
            skipPersist: true,
            skipHistory: true,
          });
        } else {
          this.saveVisShow(show);
        }
      }

      // Emit to App.vue to show map
      this.$emit("show-map", {
        mapShow: this.mapShow,
        hideMapBottom: this.hideMapBottom,
        seriesMapSeasons: this.seriesMapSeasons,
        seriesMapEpis: this.seriesMapEpis,
        seriesMap: this.seriesMap,
        mapError: errorMessage,
        noSwitch: isRefresh,
      });
    },

    async condFltrClick(cond, event) {
      this.actorFilter = null; // Clear actor filter when clicking conditional filters
      this.actorSearchParams = null;
      evtBus.emit("actorSearchCleared");
      this.fltrChoice = "- - - - -";
      if (++cond.filter == 2) cond.filter = -1;

      await this.select();
    },

    condFltrColor(cond) {
      switch (cond.filter) {
        case 0:
          return "gray";
        case -1:
          return "pink";
        case +1:
          return cond.color;
      }
    },

    sortShows() {
      if (this.sortChoice === "Notes") {
        this.shows = [...this.shows].sort((a, b) => {
          // Get raw note values, handling null/undefined/non-strings more explicitly
          const aNoteRaw = (a?.Notes != null ? String(a.Notes) : "").trim();
          const bNoteRaw = (b?.Notes != null ? String(b.Notes) : "").trim();
          // Check if notes are truly non-empty (not just whitespace)
          const aHas = aNoteRaw.length > 0;
          const bHas = bNoteRaw.length > 0;
          // Shows with notes always come before shows without notes
          if (aHas !== bHas) return aHas ? -1 : 1;

          // Both have notes or both don't - sort alphabetically by note
          const aKey = aNoteRaw.toLowerCase();
          const bKey = bNoteRaw.toLowerCase();
          if (aKey !== bKey) return aKey > bKey ? 1 : -1;

          // Notes are equal - sort by show name as tiebreaker
          const aName = String(a?.Name ?? "")
            .replace(/^the\s*/i, "")
            .toLowerCase();
          const bName = String(b?.Name ?? "")
            .replace(/^the\s*/i, "")
            .toLowerCase();
          if (aName === bName) return 0;
          return aName > bName ? 1 : -1;
        });
        return;
      }

      this.shows = [...this.shows].sort((a, b) => {
        a = this.getValBySortChoice(a, true);
        b = this.getValBySortChoice(b, true);
        if (a == b) return 0;
        if (["Alpha", "Length"].includes(this.sortChoice))
          return a > b ? +1 : -1;
        return a > b ? -1 : +1;
      });
    },

    condColor(show, cond) {
      if (cond.cond(show)) return cond.color;
      return "#ddd";
    },

    async select(scroll = true) {
      // Skip re-fetching TVDB data if all shows are already loaded
      if (!this.hasLoadedAllShows) {
        allTvdb = await tvdb.getAllTvdb();
      }
      await this.refilter(scroll);
    },

    async refilter(scroll = true) {
      // If actor filter is active, maintain it
      if (this.actorFilter) {
        // Check if we have search params (word-based search) or just filter (exact match)
        if (this.actorSearchParams) {
          // Use word-based search with stored params
          const { searchWords, matchesSearchTerm } = this.actorSearchParams;

          if (!allTvdb)
            allTvdb = await tvdb.getAllTvdb(this.hasLoadedAllShows ? 0 : 1);

          const checkShowForActorMatch = (show) => {
            const tvdbData = allTvdb?.[show.Name];
            if (!tvdbData) return false;

            const actualData = tvdbData.response?.data || tvdbData;
            const characters = actualData?.characters;

            if (!Array.isArray(characters)) return false;

            return characters.some((char) => {
              const actorName = char?.personName || char?.actor || "";
              return matchesSearchTerm(actorName, searchWords);
            });
          };

          const filteredShows = allShows.filter(checkShowForActorMatch);

          this.shows = filteredShows;

          // Preserve highlightName selection if possible
          if (this.highlightName && this.shows.length > 0) {
            const matchingShow = this.shows.find(
              (show) => show.Name === this.highlightName,
            );
            if (matchingShow) {
              // Update localStorage to ensure consistency
              window.localStorage.setItem("lastVisShow", this.highlightName);
            }
          }

          if (scroll) this.scrollToSavedShow();
          this.sortShows();

          return;
        } else {
          // Use exact match filter (original behavior)
          await this.filterShowsByActor(this.actorFilter);
          return;
        }
      }

      // Lightweight version of select(): avoids a full TVDB refresh unless
      // the "Finished" filter needs it.
      let localAllTvdb = null;
      if (this.fltrChoice === "Finished") {
        if (!allTvdb) allTvdb = await tvdb.getAllTvdb();
        localAllTvdb = allTvdb;
      }

      let srchStrLc;
      if (this.fltrChoice !== "Finished") {
        if (this.filterStr.length > 0) this.fltrChoice = "- - - - -";
        const filterEmpty =
          this.filterStr == null || String(this.filterStr).length === 0;
        srchStrLc = filterEmpty ? null : String(this.filterStr).toLowerCase();
      }

      const filteredShows = [];
      const rejectShows = allShows.filter((s) => s.Reject);
      const banCond = this.conds.find((c) => c.name === "ban");
      console.log(
        "[refilter] allShows:",
        allShows.length,
        "Reject=true:",
        rejectShows.length,
        "ban.filter:",
        banCond?.filter,
        "conds:",
        this.conds.map((c) => `${c.name}:${c.filter}`).join(" "),
      );
      fltrLoop: for (const show of allShows) {
        if (this.fltrChoice === "Finished") {
          const tvdbData = localAllTvdb?.[show.Name];
          if (!tvdbData) continue;
          const { status, episodeCount, watchedCount } = tvdbData;
          const watchedAll = episodeCount > 0 && watchedCount == episodeCount;
          const finished = status == "Ended" && watchedAll && !show.Reject;
          if (finished) filteredShows.push(show);
          continue;
        }
        if (srchStrLc && !show.Name.toLowerCase().includes(srchStrLc)) {
          const noteLc = String(show?.Notes ?? "").toLowerCase();
          if (!noteLc.includes(srchStrLc)) continue;
        }
        for (let cond of this.conds) {
          if (cond.filter === 0) continue;
          if ((cond.filter === +1) != !!cond.cond(show)) {
            if (show.Reject)
              console.log(
                "[refilter] REJECT show blocked:",
                show.Name,
                "by cond:",
                cond.name,
                "filter:",
                cond.filter,
                "condResult:",
                !!cond.cond(show),
              );
            continue fltrLoop;
          }
        }
        filteredShows.push(show);
      }
      console.log(
        "[refilter] filteredShows:",
        filteredShows.length,
        "Reject=true in result:",
        filteredShows.filter((s) => s.Reject).length,
      );

      this.shows = filteredShows;
      let selectFirstAfterSort = false;
      if (this.shows.length === 1) this.saveVisShow(this.shows[0]);
      else if (this.highlightName) {
        // Only update selection if highlightName is already set
        const showArr = this.shows.filter(
          (show) => show.Name == this.highlightName,
        );
        if (showArr.length == 0) {
          selectFirstAfterSort = true;
        } else {
          // Show is preserved - update localStorage to match
          window.localStorage.setItem("lastVisShow", this.highlightName);
        }
      }
      this.sortShows();
      if (selectFirstAfterSort && this.shows.length > 0) {
        this.saveVisShow(this.shows[0]);
      }
      if (scroll) this.scrollToSavedShow();
    },

    async filterShowsByActor(actorName) {
      if (!actorName) return;

      // Normalize actor name for comparison
      const normName = (name) =>
        String(name || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");

      const targetActorName = normName(actorName);
      console.log(
        "Filtering by actor:",
        actorName,
        "normalized:",
        targetActorName,
      );

      // Get TVDB data for all shows to check their actors
      if (!allTvdb) allTvdb = await tvdb.getAllTvdb();

      const filteredShows = allShows.filter((show) => {
        const tvdbData = allTvdb?.[show.Name];
        if (!tvdbData) return false;

        // Handle both data formats (like actors.vue does)
        const actualData = tvdbData.response?.data || tvdbData;
        const characters = actualData?.characters;

        if (!Array.isArray(characters)) return false;

        return characters.some((char) => {
          const charActorName = normName(char?.personName || char?.actor);
          return charActorName === targetActorName;
        });
      });

      console.log(
        `Found ${filteredShows.length} shows with actor ${actorName}`,
      );

      // Update the shows list and UI
      this.shows = filteredShows;
      this.actorFilter = actorName;
      this.fltrChoice = "- - - - -";

      this.scrollToSavedShow();
      this.sortShows();
    },

    async searchShowsByActor(searchParams) {
      const { searchText, searchWords, matchesSearchTerm } = searchParams;
      if (!searchText || !searchWords || searchWords.length === 0) return;

      if (!allTvdb)
        allTvdb = await tvdb.getAllTvdb(this.hasLoadedAllShows ? 0 : 1);

      const checkShowForActorMatch = (show) => {
        const tvdbData = allTvdb?.[show.Name];
        if (!tvdbData) return false;

        const actualData = tvdbData.response?.data || tvdbData;
        const characters = actualData?.characters;

        if (!Array.isArray(characters)) return false;

        return characters.some((char) => {
          const actorName = char?.personName || char?.actor || "";
          return matchesSearchTerm(actorName, searchWords);
        });
      };

      let filteredShows = allShows.filter(checkShowForActorMatch);

      if (!this.hasLoadedAllShows) {
        try {
          const serverMatches = await srvr.searchActorsInNonEmby({
            searchWords: searchWords,
          });

          if (serverMatches && serverMatches.length > 0) {
            await this.loadAllShowsWithDialog();

            filteredShows = allShows.filter(checkShowForActorMatch);
          }
        } catch (error) {
          console.error("Error searching non-emby shows:", error);
        }
      }

      // Step 3: Update the shows list and UI
      this.shows = filteredShows;
      this.actorFilter = searchText;
      this.actorSearchParams = { searchWords, matchesSearchTerm }; // Store for refiltering
      this.fltrChoice = "- - - - -";

      // Notify App component that actor search is active
      evtBus.emit("actorSearchActive", { searchWords, matchesSearchTerm });

      this.sortShows();

      // Select first show in the list
      if (this.shows.length > 0) {
        this.saveVisShow(this.shows[0], true);
      }
    },

    watchClick() {
      console.log("watchClick");
      if (this.watchingName !== "---") {
        window.localStorage.setItem("lastVisShow", this.watchingName);
        this.scrollToSavedShow(true);

        // If we have episode info, open actors pane and show episode actors
        // Changed per user request: go to series pane instead
        evtBus.emit("showSeriesPane");
      }
    },

    /////////////////  UPDATE METHODS  /////////////////

    showAll(dontClrFilters = false) {
      // if(dontClrFilters?.altKey !== undefined) dontClrFilters = false;
      // Keep the current selection (highlightName) so refilter() can preserve it
      this.filterStr = "";
      this.actorFilter = null; // Clear actor filter
      this.actorSearchParams = null;
      evtBus.emit("actorSearchCleared");
      if (!dontClrFilters) {
        for (let cond of this.conds) cond.filter = 0;
      }
      this.fltrChoice = "All";
      this.shows = [...allShows];
      // highlightName is intentionally left unchanged so refilter() can preserve the selection
    },

    async addGapToShow(event) {
      // Gap data now comes from server-side tvdb records
      // This method kept for compatibility but deprecated
      console.warn(
        "addGapToShow called - gap checking now handled server-side",
      );
    },

    async newShows(isInitialLoad = false) {
      await emby.init();

      const result = await emby.loadAllShows();
      allShows = result.allShows;
      allTvdb = result.allTvdb;
      this.hasLoadedAllShows = true;

      if (!allShows) {
        console.error("No shows from loadAllShows");
        return;
      }
      this.shows = [...allShows];
      this.allShowsLength = allShows.length;
      this.$emit("all-shows", allShows);
      this.$emit("all-tvdb", allTvdb);

      // Gap checking now handled server-side
      // Server will notify via WebSocket when tvdb data is updated

      // Only set sort properties on initial load
      if (isInitialLoad) {
        this.sortByNew = true;
        this.sortBySize = false;
        this.sortChoice = "Alpha";
      }

      const banCond = this.conds.find((c) => c.name === "ban");
      if (banCond) {
        banCond.filter = -1;
      }

      this.showAll(true);
      await this.select(); // Apply filters including ban
      this.sortShows();

      let name = window.localStorage.getItem("lastVisShow");
      if (!name) {
        window.localStorage.setItem("lastVisShow", allShows[0].Name);
        name = allShows[0].Name;
      }

      // Keep initial selection on Emby-visible entries for default UX.
      const savedShow = allShows.find((s) => s.Name === name);
      if (savedShow && savedShow.inEmby === false) {
        console.log(
          "Saved show has inEmby false, selecting first show instead",
        );
        name = allShows[0].Name;
        window.localStorage.setItem("lastVisShow", name);
      }

      // On initial load, restore selection from lastVisShow.
      // On subsequent reloads, do not change selection (avoids races where a reload
      // can override an explicit selection made immediately after the reload).
      await this.scrollToSavedShow(!!isInitialLoad);

      // Update series pane infobox with refreshed data
      if (this.highlightName) {
        const currentShow = allShows.find((s) => s.Name === this.highlightName);
        if (currentShow) {
          this.$nextTick(() => {
            evtBus.emit("setUpSeries", currentShow);
          });

          // Reload map pane with updated data (regardless of whether it's currently visible)
          // Use 'refresh' action to avoid switching panes
          if (this.mapShow) {
            this.$nextTick(() => {
              void this.seriesMapAction("refresh", currentShow);
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
    },

    async updateShowFromDiskChange(showName) {
      if (!showName) return;

      try {
        // Get updated tvdb record for this show
        const updatedTvdb = await tvdb.getAllTvdb(
          this.hasLoadedAllShows ? 0 : 1,
        );
        const show = allShows.find((s) => s.Name === showName);
        const showTvdbId = String(
          show?.TvdbId || show?.tvdbId || show?.tvdb_id || "",
        ).trim();
        const tvdbRecord = tvdb.getTvdbRecordByNameOrId(
          updatedTvdb,
          showName,
          showTvdbId,
        ).record;

        if (!tvdbRecord) {
          console.warn(
            `[updateShowFromDiskChange] No tvdb record found for ${showName}`,
          );
          return;
        }

        // Update the show in allShows
        if (show) {
          // Update disk-related fields
          if (tvdbRecord.diskMaxDate !== undefined) {
            show.diskMaxDate = tvdbRecord.diskMaxDate;
          }
          if (tvdbRecord.diskSize !== undefined) {
            show.diskSize = tvdbRecord.diskSize;
          }

          // Update gap-related fields
          show.notReady = tvdbRecord.notReady;
          show.anyWatched = tvdbRecord.anyWatched;
          show.watchGap = tvdbRecord.watchGap;
          show.watchGapSeason = tvdbRecord.watchGapSeason;
          show.watchGapEpisode = tvdbRecord.watchGapEpisode;
          show.fileGap = tvdbRecord.fileGap;
          show.fileGapSeason = tvdbRecord.fileGapSeason;
          show.fileGapEpisode = tvdbRecord.fileGapEpisode;
          show.fileEndError = tvdbRecord.fileEndError;
          show.seasonWatchedThenNofile = tvdbRecord.seasonWatchedThenNofile;

          // Update computed fields (uppercase properties)
          show.WatchGap = show.watchGap;
          show.FileGap =
            !(show.notReady === false && show.InToTry) &&
            (show.fileGap || show.fileEndError || show.seasonWatchedThenNofile);

          // Update allTvdb cache
          tvdb.upsertTvdbCacheRecord(allTvdb, tvdbRecord, showName);

          // If this show is currently displayed on the map, refresh it
          if (this.mapShow && this.mapShow.Name === showName) {
            console.log(
              `[updateShowFromDiskChange] Refreshing map for ${showName}`,
            );
            await this.seriesMapAction("refresh", show, null);
          }

          // Refresh UI to show updated data
          await this.refilter(false);
        }
      } catch (err) {
        console.error(
          `[updateShowFromDiskChange] Error updating ${showName}:`,
          err,
        );
      }
    },
  },

  /////////////////  MOUNTED  /////////////////
  mounted() {
    this.updateWideLandscape();
    this._onResizeWideLandscape = () => this.updateWideLandscape();
    window.addEventListener("resize", this._onResizeWideLandscape);
    window.addEventListener("orientationchange", this._onResizeWideLandscape);

    // Setup evtBus listeners cleanup
    this.evtHandlers = {};
    const on = (name, fn) => {
      this.evtHandlers[name] = fn;
      evtBus.on(name, fn);
    };

    on("deleteShow", async (show) => {
      if (!show) return;
      await this.deleteShow(show);
    });

    // Listen for server notifications about tvdb updates
    on("tvdbUpdated", async (data) => {
      const { name, record } = data || {};
      if (!name || !record) {
        console.warn("[tvdbUpdated] Missing name or record in push data");
        return;
      }
      if (!allTvdb || !allShows) return; // loadAllShows not yet complete, ignore early push
      try {
        // Apply computed props to the pushed record
        record.WatchGap = record.watchGap || false;
        record.WatchGapSeason = record.watchGapSeason;
        record.WatchGapEpisode = record.watchGapEpisode;
        record.FileGap =
          !(record.notReady === false && record.InToTry) &&
          (record.fileGap ||
            record.fileEndError ||
            record.seasonWatchedThenNofile);
        record.NotReady = record.inEmby === false;

        // Merge fields into the existing show in allShows
        const show = allShows.find((s) => s.Name === name);
        if (show) {
          show.notReady = record.notReady;
          show.anyWatched = record.anyWatched;
          show.watchGap = record.watchGap;
          show.watchGapSeason = record.watchGapSeason;
          show.watchGapEpisode = record.watchGapEpisode;
          show.fileGap = record.fileGap;
          show.fileGapSeason = record.fileGapSeason;
          show.fileGapEpisode = record.fileGapEpisode;
          show.fileEndError = record.fileEndError;
          show.seasonWatchedThenNofile = record.seasonWatchedThenNofile;
          show.WatchGap = record.WatchGap;
          show.WatchGapSeason = record.WatchGapSeason;
          show.WatchGapEpisode = record.WatchGapEpisode;
          show.FileGap = record.FileGap;
          show.NotReady = record.NotReady;
          show.Date = record.Date ?? show.Date;
          show.Size = record.Size ?? show.Size;
          show.NoFiles = record.NoFiles ?? show.NoFiles;
          show.WaitStr = record.waitStr ?? record.WaitStr ?? show.WaitStr;
          show.waitStr = record.waitStr ?? show.waitStr;
        }

        // Update allTvdb reference
        allTvdb[name] = record;

        // If this show is currently in the map pane, re-emit show-map with a
        // fresh shallow copy so Vue detects the new reference and re-renders
        // gap fields (e.g. FileGap / Missing File message) reactively.
        if (this.mapShow && this.mapShow.Name === name && show) {
          this.mapShow = { ...show };
          this.$emit("show-map", {
            mapShow: this.mapShow,
            hideMapBottom: this.hideMapBottom,
            seriesMapSeasons: this.seriesMapSeasons,
            seriesMapEpis: this.seriesMapEpis,
            seriesMap: this.seriesMap,
            noSwitch: true,
          });
        }

        // Refresh UI
        await this.refilter(false);
      } catch (err) {
        console.error("[tvdbUpdated] Failed to handle tvdb push:", err);
      }
    });

    on("showUpdating", ({ name } = {}) => {
      if (name) this.markShowUpdating(name);
    });

    on("showQueueEmpty", () => {
      if (this._updatingShows) this._updatingShows.clear();
      this.updatingMsg = "";
    });

    // Listen for disk changes from chokidar watcher
    on("showDiskChanged", async (data) => {
      const { showName, taskId } = data || {};
      if (!showName) return;

      console.log(
        `[showDiskChanged] Disk changed for: ${showName}, taskId: ${taskId}`,
      );

      // If we have a taskId, trigger library refresh dialog and wait for completion
      if (taskId) {
        evtBus.emit("diskChangeLibraryRefresh", { showName, taskId });
        // Wait for library scan to complete before refreshing data
        return;
      }

      // No taskId - update immediately (shouldn't happen in normal flow)
      try {
        await this.updateShowFromDiskChange(showName);
      } catch (err) {
        console.error(`[showDiskChanged] Error updating ${showName}:`, err);
      }
    });

    // Simple + portrait: Buttons are rendered in App.vue and forward events via evtBus.
    on("simpleModeButtonsClick", (activeButtons) => {
      void this.handleButtonClick(activeButtons);
    });

    on("simpleModeButtonsTop", () => {
      this.topClick();
    });

    on("reelSearchAction", (srchChoice) => {
      void this.searchAction(srchChoice);
    });

    // Series pane "Add Show" button while in preview mode.
    on("addPreviewShow", (payload) => {
      const fromPreview = !!payload?.fromPreview;
      const sc = payload?.srchChoice
        ? payload.srchChoice
        : payload?.srchChoice === null
          ? null
          : payload;
      const choice = sc?.srchChoice ? sc.srchChoice : sc;
      void this.addSearchChoice(choice, { fromPreview });
    });

    // Any pane can request exit from preview mode.
    on("exitPreviewMode", () => {
      if (!this.previewMode) return;

      this.setPreviewMode(false);

      // Restore the previously highlighted show into the panes so the UI is consistent.
      const prevName = this.highlightName;
      const prevShow = Array.isArray(allShows)
        ? allShows.find((s) => s?.Name === prevName)
        : null;
      if (prevShow) {
        this.saveVisShow(prevShow, false, {
          skipHistory: true,
          forceSetUpSeries: true,
        });
      }
    });

    on("openMap", (show) => {
      this.seriesMapAction("open", show);
    });

    // Track current pane
    on("paneChanged", (pane) => {
      this.currentPane = pane;
    });

    // Listen for map actions from App.vue
    on("mapAction", async ({ action, show }) => {
      await this.seriesMapAction(action, show);
    });

    // Listen for episode clicks from App.vue
    on("episodeClick", async ({ e, show, season, episode, setWatched }) => {
      await this.episodeClick(e, show, season, episode, setWatched);
    });

    // Listen for season folder deletes from App.vue (ctrl-click season number in Map)
    on("seasonDelete", async ({ e, show, season }) => {
      if (this.simpleMode) return;
      if (!e?.ctrlKey) return;

      const showName = show?.Name || "";
      const showPath = show?.Path || "";
      if (!showPath) return;

      const ok = window.confirm(
        `OK to delete folder Season ${season} for show ${showName} ?`,
      );
      if (!ok) return;

      const sep = showPath.includes("\\") ? "\\" : "/";
      const seasonPath = `${showPath.replace(/[\\/]+$/, "")}${sep}Season ${season}`;

      try {
        await srvr.deletePath(seasonPath);
      } catch (err) {
        console.error("seasonDelete: deletePath failed", { seasonPath, err });
        window.alert(err?.message || String(err));
        return;
      }

      // Refresh just this show in Emby so the season folder is removed from its list
      this.markShowUpdating(show.Name);
      await srvr
        .refreshEmbyItem(show.Id, show.Name)
        .catch((err) => console.error("refreshEmbyItem failed:", err));
      await this.seriesMapAction("refresh", show, null);
    });

    // Listen for library refresh completion to refresh show list
    on("library-refresh-complete", async (payload) => {
      const onDone =
        payload && typeof payload === "object" ? payload.onDone : null;
      const diskChangeShowName =
        payload && typeof payload === "object"
          ? payload.diskChangeShowName
          : null;

      this.showReloadingShows = true;
      this.logModalMessage("reloadingShowsModal", "Reloading Shows");
      try {
        await this.newShows();

        // If this was triggered by a disk change, update that specific show
        if (diskChangeShowName) {
          console.log(
            `[library-refresh-complete] Updating show after disk change: ${diskChangeShowName}`,
          );
          await this.updateShowFromDiskChange(diskChangeShowName);
        }
      } catch (err) {
        console.error("library-refresh-complete: newShows failed", err);
      } finally {
        this.showReloadingShows = false;
        if (typeof onDone === "function") {
          try {
            onDone();
          } catch {
            /* ignore */
          }
        }
      }
    });

    // Cross-pane: click a card in Flex/Qbt/Down to select show in list
    on("selectShowFromCardTitle", (rawTitle) => {
      void this.selectShowFromCardTitle(rawTitle);
    });

    on("activeQbtTitles", (titles) => {
      this.updateActiveShowNames("qbt", titles);
    });

    on("activeDownTitles", (titles) => {
      this.updateActiveShowNames("down", titles);
    });

    // Filter shows by actor (long-press on actor in actors pane)
    on("filterByActor", async ({ actorName }) => {
      await this.filterShowsByActor(actorName);
    });

    // Clear actor filter when actor is deselected in actors pane
    on("clearActorFilter", async () => {
      if (!this.actorFilter && !this.actorSearchParams) return;
      this.actorFilter = null;
      this.actorSearchParams = null;
      evtBus.emit("actorSearchCleared");
      await this.select();
    });

    // Patch a single tvdb record in the local allTvdb cache (e.g. after TMDB actors are saved)
    on("tvdbRecordPatched", ({ showName, record }) => {
      if (showName && record && allTvdb) {
        allTvdb[showName] = record;
      }
    });

    // Search shows by actor (from search box in actors pane)
    on("searchActors", async (searchParams) => {
      await this.searchShowsByActor(searchParams);
    });

    this.devicePollTimer = setInterval(async () => {
      const devices = await srvr.getDevices();
      let showName = null;
      let playingDevice = null;
      for (const device of devices) {
        if (!device.showName) continue;
        showName = device.showName;
        playingDevice = device;
        if (device.deviceName == "chromecast") break;
      }
      this.watchingName = showName ?? "---";
      this.currentPlayingDevice = playingDevice;
    }, 10 * 1000);

    this.keydownHandler = (event) => {
      if (event.code == "Escape") {
        this.remotesAction("close");
        this.seriesMapAction("close");
      }
    };
    document.addEventListener("keydown", this.keydownHandler);

    void (async () => {
      try {
        await this.newShows(true);
      } catch (err) {
        console.error("Mounted:", err);
      }
    })();
  },

  beforeUnmount() {
    if (this.evtHandlers) {
      for (const [name, fn] of Object.entries(this.evtHandlers)) {
        evtBus.off(name, fn);
      }
      this.evtHandlers = null;
    }

    if (this.devicePollTimer) {
      clearInterval(this.devicePollTimer);
      this.devicePollTimer = null;
    }

    if (this.keydownHandler) {
      document.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }

    if (this._onResizeWideLandscape) {
      window.removeEventListener("resize", this._onResizeWideLandscape);
      window.removeEventListener(
        "orientationchange",
        this._onResizeWideLandscape,
      );
      this._onResizeWideLandscape = null;
    }
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
  font-size: large;
}
input {
  font-size: 18px;
}
button {
  font-size: 18px;
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
