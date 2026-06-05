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
      id="removingFromEmbyModal"
      v-if="showRemovingFromEmby"
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
        Removing show from emby.
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
              :watchingName="watchingNameDisplay"
              :simpleMode="simpleMode"
              :isWideLandscape="isWideLandscape"
              :statusMsg="updatingMsg"
              :libraryProgressText="libraryProgressText"
              @watch-click="watchClick"
              @filter-input="select"
              @filter-focus="filterInputFocused = true"
              @filter-blur="onFilterBlur"
              @send-filters="sendSharedFilters"
              @library-click="libraryClick"
              @all-click="allClick"
              @custom-click="customClick"
              :hasSharedFilters="hasSharedFilters"
              :actorsListMode="actorsListMode"
              @actors-click="startActorsListMode"
            ></HdrTop>
            <HdrBot
              v-if="!simpleMode"
              :conds="conds"
              :sortPopped="sortPopped"
              :fltrPopped="fltrPopped"
              :sortChoices="sortChoices"
              :fltrChoices="fltrChoices"
              :selectedSort="actorsListMode ? '---' : sortChoice"
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
            <div
              v-if="actorsListMode"
              ref="actorsListRef"
              @click.stop
              style="flex-grow: 1; overflow-y: auto; background-color: white"
            >
              <div
                v-for="actor in filteredActorsList"
                :key="actor.name"
                @click="actorsListItemClick(actor.name)"
                style="
                  padding: 8px 12px;
                  cursor: pointer;
                  border-bottom: 1px solid #eee;
                  font-size: 18px;
                  font-weight: bold;
                "
              >
                {{ actor.displayName }} ({{ actor.showCount }})
              </div>
            </div>
            <Shows
              v-else
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
            :watchingName="watchingNameDisplay"
            :simpleMode="simpleMode"
            :isWideLandscape="isWideLandscape"
            :statusMsg="updatingMsg"
            :libraryProgressText="libraryProgressText"
            @watch-click="watchClick"
            @filter-input="select"
            @filter-focus="filterInputFocused = true"
            @filter-blur="onFilterBlur"
            @send-filters="sendSharedFilters"
            @library-click="libraryClick"
            @all-click="allClick"
            @custom-click="customClick"
            :hasSharedFilters="hasSharedFilters"
            :actorsListMode="actorsListMode"
            @actors-click="startActorsListMode"
          ></HdrTop>
          <HdrBot
            v-if="!simpleMode"
            :conds="conds"
            :sortPopped="sortPopped"
            :fltrPopped="fltrPopped"
            :sortChoices="sortChoices"
            :fltrChoices="fltrChoices"
            :selectedSort="actorsListMode ? '---' : sortChoice"
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
          <div
            v-if="actorsListMode"
            ref="actorsListRef"
            @click.stop
            style="flex-grow: 1; overflow-y: auto; background-color: white"
          >
            <div
              v-for="actor in filteredActorsList"
              :key="actor.name"
              @click="actorsListItemClick(actor.name)"
              style="
                padding: 8px 12px;
                cursor: pointer;
                border-bottom: 1px solid #eee;
                font-size: 18px;
                font-weight: bold;
              "
            >
              {{ actor.displayName }} ({{ actor.showCount }})
            </div>
          </div>
          <Shows
            v-else
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

let _vipSet = new Set();
srvr
  .getVipActors()
  .then((s) => {
    _vipSet = s;
  })
  .catch(() => {});
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
  faClock,
  faComment,
} from "@fortawesome/free-regular-svg-icons";
import {
  faCheck,
  faPlus,
  faMinus,
  faArrowDown,
  faArrowRight,
  faArrowUp,
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
  faFilm,
  faExclamation,
} from "@fortawesome/free-solid-svg-icons";
library.add([
  faLaughBeam,
  faSadCry,
  faClock,
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
  faArrowUp,
  faMars,
  faVenus,
  faClock,
  faTrafficLight,
  faTrash,
  faFilm,
  faExclamation,
  faComment,
]);

let allTvdb = null;
let allShows = [];
let showHistory = [];
let showHistoryPtr = -1;

export default {
  name: "List",

  components: { FontAwesomeIcon, Shows, HdrTop, HdrBot, Buttons },

  emits: ["show-map", "all-shows", "all-tvdb", "filtered-shows"],

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
      const originalValue = show.inToTry;
      show.inToTry = !show.inToTry;
      try {
        await emby.saveToTry(show.id, show.inToTry, show.name);
      } catch (err) {
        console.error("toggleToTry error:", err);
        show.inToTry = originalValue; // Revert on error
      }
    };

    const toggleAnticipating = async (show) => {
      const originalValue = !!show.anticipating;
      show.anticipating = !originalValue;
      try {
        await srvr.setTvdbFields({
          name: show.name,
          anticipating: show.anticipating,
        });
      } catch (err) {
        console.error("toggleAnticipating error:", err);
        show.anticipating = originalValue;
      }
    };

    const toggleContinue = async (show) => {
      if (show.inEmby === false) {
        await toggleNoEmbyFlag(show, "InContinue");
        return;
      }
      this.saveVisShow(show);
      const originalValue = show.inContinue;
      show.inContinue = !show.inContinue;
      try {
        await emby.saveContinue(show.id, show.inContinue, show.name);
      } catch (err) {
        console.error("toggleContinue error:", err);
        show.inContinue = originalValue; // Revert on error
      }
    };

    const toggleMark = async (show) => {
      if (show.inEmby === false) {
        await toggleNoEmbyFlag(show, "InMark");
        return;
      }
      this.saveVisShow(show);
      const originalValue = show.inMark;
      show.inMark = !show.inMark;
      try {
        await emby.saveMark(show.id, show.inMark, show.name);
      } catch (err) {
        console.error("toggleMark error:", err);
        show.inMark = originalValue;
      }
    };

    const toggleLinda = async (show) => {
      if (show.inEmby === false) {
        await toggleNoEmbyFlag(show, "InLinda");
        return;
      }
      this.saveVisShow(show);
      const originalValue = show.inLinda;
      show.inLinda = !show.inLinda;
      try {
        await emby.saveLinda(show.id, show.inLinda, show.name);
      } catch (err) {
        console.error("toggleLinda error:", err);
        show.inLinda = originalValue; // Revert on error
      }
    };

    const deleteShow = async (show) => {
      allTvdb = await tvdb.getAllTvdb();
      const name = show.name;
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
        const leftEmby = util.getPstDate();
        // Re-fetch allTvdb in case async ops replaced the cached reference
        allTvdb = await tvdb.getAllTvdb();
        const tvdbData = allTvdb[name];
        if (tvdbData) {
          tvdbData.inEmby = false;
          tvdbData.leftEmby = leftEmby;
          tvdbData.notReady = true;
        }
        allTvdb[name] = await srvr.setTvdbFields({
          name,
          inEmby: false,
          leftEmby,
          notReady: true,
        });
        // Capture the next visible show before refilter removes this one from the list.
        const delIdx = this.shows.findIndex((s) => s.id == show.id);
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
      filterInputFocused: false,
      updatingMsg: "",
      shows: [],
      filterStr: "",
      descrSearchStr: "",
      errMsg: "",
      highlightName: "",
      previewMode: false,
      _pendingSetUpSeriesToken: 0,
      _mapActionToken: 0,
      allShowsLength: 0,
      currentPane: "info",
      mapShow: null,
      hideMapBottom: true,
      seriesMapSeasons: [],
      seriesMapEpis: [],
      seriesMap: {},
      watchingName: "---",
      lastWatchingName: null,
      currentPlayingSeason: null,
      currentPlayingEpisode: null,
      nowPlayingShowNames: new Set(),
      sortPopped: false,
      sortChoice: "Viewed",
      fltrPopped: false,
      fltrChoice: "All",
      showSearching: false,
      searchingShowName: "",
      searchingStatus: "",
      showReloadingShows: false,
      showRemovingFromEmby: false,
      isWideLandscape: false,
      actorFilter: null,
      actorSearchParams: null, // Store search params for word-based actor search
      actorsListMode: false, // Whether we are in actors list mode
      actorsList: [], // List of all actors (for actors list mode)
      savedSortChoice: null, // Sort choice saved when entering actors mode
      qbtActiveShowNames: [],
      downActiveShowNames: [],
      hasLoadedAllShows: false,
      hasSharedFilters: false,
      sortChoices: [
        "Close",
        "Alpha",
        "Viewed",
        "Added",
        "Ratings",
        "Size",
        "Safe start",
        "Ended",
        "Length",
        "Creator",
      ],
      fltrChoices: ["Close", "Try Drama", "Watching", "Finished", "Playing"],
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
          color: "lime",
          filter: 0,
          icon: ["far", "clock"],
          cond(show) {
            return !!show.waitStr?.length;
          },
          click() {},
          name: "waiting",
        },
        {
          color: "#0cf",
          filter: 0,
          icon: ["fas", "film"],
          hideIcon: true,
          cond(show) {
            return !!show.needsIntro;
          },
          click() {},
          name: "needsIntro",
        },
        {
          color: "#f88",
          filter: 0,
          icon: ["fas", "minus"],
          cond(show) {
            return show.fileGap || show.watchGap;
          },
          click() {},
          name: "gap",
        },
        {
          color: "#faa",
          filter: 0,
          icon: ["fas", "traffic-light"],
          cond(show) {
            return show.ended;
          },
          click() {},
          name: "ended",
        },
        {
          color: "#88f",
          filter: 0,
          icon: ["far", "sad-cry"],
          cond(show) {
            return !show.genres?.includes("Comedy");
          },
          click() {},
          name: "drama",
        },
        {
          color: "#88f",
          filter: 0,
          icon: ["fas", "globe"],
          cond(show) {
            return show?.originalCountry?.toUpperCase() != "USA";
          },
          click() {},
          name: "foreign",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["fas", "question"],
          cond(show) {
            return show.inToTry;
          },
          async click(show) {
            await toggleToTry(show);
          },
          name: "totry",
        },
        {
          color: "#c8925a",
          filter: 0,
          icon: ["fas", "exclamation"],
          cond(show) {
            return !!show.anticipating;
          },
          async click(show) {
            await toggleAnticipating(show);
          },
          name: "anticipating",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["fas", "arrow-right"],
          cond(show) {
            return show.inContinue;
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
            return show.inMark;
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
            return show.inLinda;
          },
          async click(show) {
            await toggleLinda(show);
          },
          name: "linda",
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

  watch: {
    async highlightName(newName) {
      if (!newName || this.currentPane !== "map" || !this.mapShow) return;
      const show = allShows.find((s) => s.name === newName);
      if (show) await this.seriesMapAction("open", show);
    },
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

    filteredActorsList() {
      const srch = String(this.filterStr || "").toLowerCase();
      if (!srch) return this.actorsList;
      return this.actorsList.filter((a) =>
        a.displayName.toLowerCase().includes(srch),
      );
    },

    watchingNameDisplay() {
      if (this.watchingName === "---") return "---";
      if (
        this.currentPlayingSeason != null &&
        this.currentPlayingEpisode != null
      ) {
        const s = String(this.currentPlayingSeason).padStart(2, "0");
        const e = String(this.currentPlayingEpisode).padStart(2, "0");
        return `${this.watchingName} (S${s}E${e})`;
      }
      return this.watchingName;
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
      const existingNames = new Set(allShows.map((s) => s.name));
      const newShows = additionalShowsArray.filter(
        (s) => !existingNames.has(s.name),
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

    libraryClick(evt) {
      if (evt && evt.ctrlKey) {
        util.openExternalPage(
          "https://hahnca.com:8920/web/index.html#!/librarysetup/libraries",
        );
        return;
      }
      evtBus.emit("startLibraryRefresh");
    },

    async customClick() {
      let shared = null;
      try {
        shared = await srvr.getSharedFilters();
        if (shared && typeof shared === "object") {
          if (shared.filterStr !== undefined)
            this.filterStr = String(shared.filterStr || "");
          if (shared.fltrChoice !== undefined)
            this.fltrChoice = String(shared.fltrChoice || "All");
          if (shared.sortChoice !== undefined)
            this.sortChoice = String(shared.sortChoice || "Viewed");
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
        console.error("customClick sharedFilters apply failed:", e);
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
            if (shared.sortChoice !== undefined)
              this.sortChoice = String(shared.sortChoice || "Viewed");

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
          sortChoice: this.sortChoice,
        };

        const isAllMode =
          this.fltrChoice === "All" &&
          (!this.filterStr || String(this.filterStr).length === 0) &&
          (this.conds || []).every((c) => {
            if (!c?.name) return true;
            if (c.name === "hasemby") return c.filter === 1; // default hasemby behavior
            return c.filter === 0;
          });

        if (isAllMode) {
          await srvr.setSharedFilters(null);
          this.hasSharedFilters = false;
        } else {
          await srvr.setSharedFilters(payload);
          this.hasSharedFilters = true;
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

        const currentShow = allShows.find((s) => s.name === this.highlightName);
        if (!currentShow) {
          console.log("Could not find show:", this.highlightName);
          return;
        }

        const tvdbId = currentShow.tvdbId || currentShow.tvdbId;
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
          name: currentShow.name,
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
        let shared = null;
        try {
          shared = await srvr.getSharedFilters();
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

        // Apply sortChoice from sharedFilters if present.
        if (shared && shared.sortChoice !== undefined) {
          this.sortChoice = String(shared.sortChoice || "Viewed");
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
        "Ended Order": "Ended",
        "Length Order": "Length",
      };

      // Pure state-based: Sync conds to match button states
      this.conds.forEach((cond) => {
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
          return show.name
            .replace(/^the\s*/i, "")
            .replace(/[^a-z0-9\s]/gi, "")
            .toLowerCase();
        case "Added":
          if (forSort) {
            const a = show.dateCreated || "";
            return a.length > 10 ? a : a + " 00:00:00";
          }
          return (show.dateCreated || "").slice(0, 10);
        case "Ended":
          return show.lastAired || "";
        case "Length":
          return show.averageRuntime || 0;
        case "Size":
          if (forSort) return show.size;
          return util.fmtSize(show);
        case "Safe start": {
          const ws = show.waitStr || "";
          if (!ws) return "9999-99-99";
          const inner = ws.slice(1, -1);
          const parts = inner.split("-");
          const yr =
            parts.length === 3
              ? `20${parts[0]}`
              : String(new Date().getFullYear());
          const mo = (parts.length === 3 ? parts[1] : parts[0]).padStart(
            2,
            "0",
          );
          const dy = parts.length === 3 ? parts[2] : parts[1];
          return `${yr}-${mo}-${dy}`;
        }
        case "Ratings":
          ratings = show?.ratings;
          if (forSort)
            return ratings !== undefined && ratings !== null && ratings !== 0
              ? +ratings
              : 0;
          return ratings !== undefined && ratings !== null && ratings !== 0
            ? String(ratings)
            : "";
        case "Creator": {
          const crewArr = Array.isArray(allTvdb?.[show.name]?.crew)
            ? allTvdb[show.name].crew
            : [];
          const vipSet = _vipSet;
          const vip = crewArr.find((c) => vipSet.has(c.name));
          if (vip) {
            const val = vip.name;
            return forSort ? val.toLowerCase() : val;
          }
          const CREW_PREF = [
            "Creator",
            "Producer",
            "Executive Producer",
            "Writer",
          ];
          let best = null;
          for (const type of CREW_PREF) {
            best = crewArr.find((c) => c.type === type);
            if (best) break;
          }
          const val = best ? best.name : "";
          return forSort ? val.toLowerCase() : val;
        }
        case "Viewed":
          lastViewed = srvr.lastViewedCache[show.name];
          if (forSort) return lastViewed || 0;
          if (lastViewed === undefined) return "";
          return util.fmtDate(lastViewed);
      }
    },

    setHighlightAfterDel(id) {
      for (let i = 0; i < this.shows.length; i++) {
        if (this.shows[i].id == id) {
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
        Array.isArray(arr) && arr.some((s) => s?.id && s.id === show.id);
      const existsByName = (arr) =>
        Array.isArray(arr) && arr.some((s) => s?.name && s.name === show.name);
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

      console.log("addRow", show.name);
      this.shows.unshift(show);
      if (allShows !== this.shows) allShows.unshift(show);
      this.saveVisShow(show, true);
    },

    removeRow(show) {
      console.log("removeRow", show.name);
      const id = show.id;
      const newShow = this.setHighlightAfterDel(id);
      this.shows = this.shows.filter((show) => show.id != id);
      if (this.shows !== allShows)
        allShows = allShows.filter((show) => show.id != id);
      if (newShow) this.saveVisShow(newShow, true);
    },

    hilite(show) {
      return this.highlightName == show.name ? "yellow" : "white";
    },

    async searchAction(payload) {
      const srchChoice = payload?.srchChoice ? payload.srchChoice : payload;
      const action = payload?.action || "preview";
      const onDone =
        typeof payload?.onDone === "function" ? payload.onDone : null;
      const onStatus =
        typeof payload?.onStatus === "function" ? payload.onStatus : null;
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
        if (onDone) onDone({ ok: true });
        return;
      }

      // Fallback: if something explicitly asks to add.
      await this.addSearchChoice(
        { name, tvdbId, overview },
        { onDone, onStatus },
      );
    },

    async addSearchChoice({ name, tvdbId, overview }, opts = null) {
      // This is the original "web dropdown click" behavior: add/create the show.
      if (!name) return;

      const options = opts && typeof opts === "object" ? opts : {};
      const fromPreview = !!options.fromPreview;
      const onDone =
        typeof options.onDone === "function" ? options.onDone : null;
      const externalOnStatus =
        typeof options.onStatus === "function" ? options.onStatus : null;
      if (fromPreview) {
        evtBus.emit("addPreviewShowStart", { name, tvdbId, overview });
      }

      const matchShow = this.findExistingShowForSearchChoice({
        name,
        tvdbId,
      });
      if (matchShow && matchShow.inEmby !== false) {
        console.log(matchShow.name + " already exists.");
        if (!this.shows.some((sh) => sh?.name === matchShow.name)) {
          await this.fltrAction("All");
        }
        this.onSelectShow(matchShow, true);
        if (onDone) onDone({ ok: true, show: matchShow });
        return;
      }

      // Show searching modal
      this.showSearchingModal(name, "Starting...");

      const setWebAddStatus = (txt) => {
        this.setSearchingModalStatus(txt);
        evtBus.emit("setLibraryProgress", txt);
        if (externalOnStatus) externalOnStatus(txt);
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

      const findShowByTvdbIdOrName = ({ requireInEmby = false } = {}) =>
        Array.isArray(allShows)
          ? allShows.find((s) => {
              if (requireInEmby && s?.inEmby === false) return false;
              const sTvdbId = String(
                s?.tvdbId || s?.tvdbId || s?.tvdb_id || "",
              ).trim();
              if (tvdbId && sTvdbId && sTvdbId === String(tvdbId).trim()) {
                return true;
              }
              return s?.name === name;
            })
          : null;

      let show = null;

      const showSeed = {
        name: name,
        tvdbId: tvdbId,
        overview: overview,
        reject: false,
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
        // If tvdbId was empty (e.g. load from info pane), resolve it from the returned tvdbData.
        if (!tvdbId && tvdbData?.tvdbId) {
          tvdbId = String(tvdbData.tvdbId).trim();
        }

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
          if (res?.status === "refreshfailed") {
            alert(
              `The folder for "${name}" was created, but the Emby library refresh timed out.\nThe show should appear after Emby finishes scanning on its own.`,
            );
          } else if (!createdFolder) {
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
            const newShow = findShowByTvdbIdOrName({ requireInEmby: true });
            if (newShow?.id) {
              await srvr
                .triggerShowGapCheck(newShow.id, name)
                .catch((err) =>
                  console.error("triggerShowGapCheck failed:", err),
                );
            }
          } catch {
            // ignore
          }

          show = findShowByTvdbIdOrName({ requireInEmby: true });

          // Emby created the folder, but the item may not be visible immediately.
          // Retry discovery; never create a no-emby duplicate in this branch.
          if (!show) {
            const noEmbyMatch = findShowByTvdbIdOrName({
              requireInEmby: false,
            });
            setWebAddStatus("Waiting for Emby scan...");
            for (let attempt = 1; attempt <= 4; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              tvdb.clearCache();
              await this.newShows(false);
              show = findShowByTvdbIdOrName({ requireInEmby: true });
              if (show) break;
              setWebAddStatus(`Waiting for Emby scan... (${attempt}/4)`);
            }
          }

          if (!show) {
            // Folder was created but Emby scan hasn't indexed it yet.
            // Fall back to the existing record — inEmby will update when Emby finishes scanning.
            show = findShowByTvdbIdOrName({ requireInEmby: false });
          }
          if (!show) {
            throw new Error(
              `Created in Emby but not found after refresh: ${name} (tvdbId=${tvdbId})`,
            );
          }

          if (show) {
            show.tvdbId = tvdbId;
            show.overview = overview;
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
              id: "",
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
          tvdb.upsertTvdbCacheRecord(allTvdb, tvdbData, show?.name || name);
          // Clear shared cache so Info/Reviews get fresh data
          tvdb.clearCache();
        }

        const alreadyInAllShows =
          Array.isArray(allShows) &&
          (allShows.some((s) => s?.id === show?.id) ||
            allShows.some((s) => s?.name === show?.name));
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
        if (!onDone) alert(`Web add failed for ${name}`);
      } finally {
        this.showSearching = false;
        this.searchingStatus = "";
        evtBus.emit("setLibraryProgress", "");

        if (fromPreview) {
          // Done adding: exit preview mode and notify Series so it can hide the button.
          evtBus.emit("addPreviewShowDone", { ok, name, tvdbId, overview });
          this.setPreviewMode(false);
          // Explicitly switch to info pane so the newly added show is visible.
          // setPreviewMode(false) restores savedPane (browse) and sets restoringPreviewPane=true,
          // which would block setUpSeries from switching panes; override that here.
          if (ok) evtBus.emit("showSeriesPane");
        }
        if (onDone) onDone({ ok, show });
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
        if (!this.shows.some((sh) => sh?.name === existing.name)) {
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
        id: `noemby-preview-${String(tvdbId || imdbId || showName).replace(/\s+/g, "-")}`,
        inEmby: false,
        name: showName,
        tvdbId: tvdbId,
        ImdbId: imdbId,
        overview: overview,
        imageUrl: imageUrl,
        reject: false,
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
            incomingShow?.name && show?.name && incomingShow.name === show.name;
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

    onFilterBlur() {
      this.filterInputFocused = false;
      if (!this.highlightName) return;
      const show = allShows.find((s) => s.name === this.highlightName);
      if (!show) return;
      this.saveVisShow(show, false, { skipHistory: true });
    },

    async prevNextClick(next) {
      if (showHistory.length === 0) return;
      const newPtr = showHistoryPtr + (next ? 1 : -1);
      if (newPtr < 0 || newPtr >= showHistory.length) return;
      showHistoryPtr = newPtr;
      const showName = showHistory[showHistoryPtr];
      const show = allShows.find((s) => s.name === showName);
      if (!show) return;
      if (!this.shows.some((s) => s.name === showName)) {
        await this.fltrAction("All");
      }
      this.saveVisShow(show, true, { skipHistory: true });
    },

    async allClick() {
      evtBus.emit("clearFilterButtons");
      evtBus.emit("clearDescrSearch");
      this.actorFilter = null;
      this.actorSearchParams = null;
      evtBus.emit("actorSearchCleared");
      window.localStorage.setItem("fltrChoice", "All");
      this.fltrChoice = "All";
      this.filterStr = "";
      for (let cond of this.conds) {
        util.setCondFltr(cond, "All");
      }
      // Default hasemby=1 (in-emby only), but if selected show is not in emby use 0
      const hasembyCond = this.conds.find((c) => c?.name === "hasemby");
      if (hasembyCond) {
        const selectedShow = allShows.find(
          (s) => s.name === this.highlightName,
        );
        const selectedInEmby = !selectedShow || selectedShow.inEmby !== false;
        hasembyCond.filter = selectedInEmby ? 1 : 0;
      }
      await this.select();
      this.sortPopped = false;
      this.fltrPopped = false;
    },
    onSelectShow(show, scroll = false) {
      const wasPreview = !!this.previewMode;
      const wasAlreadySelected = show?.name === this.highlightName;
      const keepCurrentPane = this.currentPane;

      if (wasPreview) this.setPreviewMode(false);
      this.saveVisShow(show, scroll);

      // --- Guard layer (suppress showSeriesPane when pane should stay) ---
      // Priority 1: map pane always preserved (setUpSeries also guards this).
      if (keepCurrentPane === "map") return;

      // Priority 2: preview exit — land on Series for the newly-added show.
      if (wasPreview) {
        evtBus.emit("showSeriesPane");
        return;
      }

      // Priority 3: re-clicking same show — always return to Series.
      if (wasAlreadySelected) {
        evtBus.emit("showSeriesPane");
        return;
      }

      // --- Resolve layer ---
      // Panes that keep their content across show changes — stay put.
      const keepPane = new Set([
        "actors",
        "subs",
        "files",
        "reviews",
        "trailer",
        "ai",
      ]);
      if (keepPane.has(keepCurrentPane)) return;

      // Default: return to Series.
      evtBus.emit("showSeriesPane");
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
          const sid = s?.tvdbId ?? s?.TvdbShowId ?? s?.tvdbId ?? null;
          if (sid == null || sid === "") return false;
          return String(sid).trim() === id;
        });
        if (byId) return byId;
      }

      if (nm) {
        // Duplicate Detection: forceChoice = false
        const match = util.smartTitleMatch(nm, allShows, null, false);
        if (match) {
          // If both have tvdbIds but they differ, these are different shows
          if (id) {
            const matchId = String(
              match?.tvdbId ?? match?.tvdbId ?? match?.TvdbShowId ?? "",
            ).trim();
            if (matchId && matchId !== id) return null;
          }
          return match;
        }
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
        if (show?.name) names.add(show.name);
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
            s?.tvdbId || s?.tvdbId || s?.tvdb_id || "",
          ).trim();
          return sTvdb && sTvdb === reqTvdbId;
        });
      }

      // Then exact name match (important for gallery selections)
      if (!match) {
        match = allShows.find((s) => s.name === raw);
      }

      if (!match) {
        // Try case-insensitive exact match
        const rawLower = raw.toLowerCase();
        match = allShows.find((s) => s.name?.toLowerCase() === rawLower);
      }

      if (!match && !this.hasLoadedAllShows) {
        await this.loadAllShowsWithDialog();

        if (!match && reqTvdbId) {
          match = allShows.find((s) => {
            const sTvdb = String(
              s?.tvdbId || s?.tvdbId || s?.tvdb_id || "",
            ).trim();
            return sTvdb && sTvdb === reqTvdbId;
          });
        }

        // Try exact match again with the complete show list
        if (!match) {
          match = allShows.find((s) => s.name === raw);
        }
        if (!match) {
          const rawLower = raw.toLowerCase();
          match = allShows.find((s) => s.name?.toLowerCase() === rawLower);
        }
      }

      if (!match) {
        // Fall back to fuzzy matching as last resort
        match = util.smartTitleMatch(searchTitle, allShows, searchYear, true);
      }

      if (match) {
        const isVisible = this.shows.some((sh) => sh?.name === match.name);
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
      const showName = show.name;
      const shouldUpdateVisibleMap =
        !options.skipMapUpdate &&
        this.currentPane === "map" &&
        this.mapShow !== null;

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

      if (!options.skipHistory && !this.filterInputFocused) {
        showHistory = showHistory.slice(0, showHistoryPtr + 1);
        showHistory = showHistory.filter((n) => n !== showName);
        showHistory.push(showName);
        if (showHistory.length > 100) showHistory = showHistory.slice(-100);
        showHistoryPtr = showHistory.length - 1;
        try {
          localStorage.setItem("showHistory", JSON.stringify(showHistory));
        } catch {
          /* ignore storage errors */
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
        // Trigger background processing (no Rotten scrape) for the newly selected show
        if (show.name) {
          srvr
            .triggerShowSelect(show.name)
            .catch((err) => console.error("triggerShowSelect failed:", err));
        }
      }

      // If map pane is currently showing, update it to show the newly selected show
      if (shouldUpdateVisibleMap) {
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
      if (this.actorsListMode) return;
      this.sortPopped = !this.sortPopped;
      this.fltrPopped = false;
    },

    sortAction(sortChoice) {
      if (sortChoice != "Close") {
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
      if (fltrChoice === "All") evtBus.emit("clearDescrSearch");
      if (fltrChoice != "Close") {
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
        show = allShows.find((shw) => shw.name == name);
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
        this.$refs.showsComponent.scrollToShow(show.name);
      }
    },

    async copyNameToClipboard(show, event) {
      console.log("copyNameToClipboard", show.name);
      const ele = event.target;
      const color = ele.style.color;
      ele.style.color = "#f00";
      await navigator.clipboard.writeText(show.name);
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
          `OK to delete file for ${show.name} S${season}E${episode} ?`,
        );
        if (!ok) return;

        try {
          await srvr.deletePath(path);
        } catch (err) {
          console.error("episodeClick: deletePath failed", { path, err });
          window.alert(err?.message || String(err));
          return;
        }

        if (cell) {
          cell.path = null;
          cell.noFile = true;
          cell.avail = false;
          cell.error = false;
        }

        this.$emit("show-map", {
          mapShow: this.mapShow,
          hideMapBottom: this.hideMapBottom,
          seriesMapSeasons: this.seriesMapSeasons,
          seriesMapEpis: this.seriesMapEpis,
          seriesMap: this.seriesMap,
          mapError: "",
          noSwitch: true,
        });

        // Refresh just this show in Emby so the episode is removed from its list
        this.markShowUpdating(show.name);
        await srvr
          .refreshEmbyItem(show.id, show.name)
          .catch((err) => console.error("refreshEmbyItem failed:", err));

        // Refresh the Map grid now that Emby has updated.
        await this.seriesMapAction("refresh", show, null);
        return;
      }

      // toggle watched or set to specific value
      if (show.inEmby === false) {
        // Non-Emby show: toggle played locally and persist watchedEpis
        const cell = this.seriesMap?.[season]?.[episode];
        if (!cell) return;
        cell.played = setWatched !== null ? setWatched : !cell.played;

        // Convert this.seriesMap (object-of-objects) to array format for seriesMapToWatchedEpis
        const seriesMapArr = [];
        for (const sNum of Object.keys(this.seriesMap).sort((a, b) => a - b)) {
          const episodes = [];
          for (const eNum of Object.keys(this.seriesMap[sNum]).sort(
            (a, b) => a - b,
          )) {
            episodes.push([+eNum, this.seriesMap[sNum][eNum]]);
          }
          seriesMapArr.push([+sNum, episodes]);
        }
        const watchedEpis = tvdb.seriesMapToWatchedEpis(seriesMapArr);
        if (allTvdb?.[show.name]) {
          allTvdb[show.name].watchedEpis = watchedEpis;
        }
        await srvr.setTvdbFields({
          name: show.name,
          watchedEpis,
          dontEnqueue: true,
        });
        // Re-emit to App.vue so the map prop updates
        this.$emit("show-map", {
          mapShow: this.mapShow,
          hideMapBottom: this.hideMapBottom,
          seriesMapSeasons: this.seriesMapSeasons,
          seriesMapEpis: this.seriesMapEpis,
          seriesMap: this.seriesMap,
          mapError: "",
          noSwitch: true,
        });
      } else {
        const cell = this.seriesMap?.[season]?.[episode];
        if (cell && !cell.id) {
          // Episode is filesOnDisk-only (not in Emby) — use local path
          cell.played = setWatched !== null ? setWatched : !cell.played;
          const seriesMapArr = [];
          for (const sNum of Object.keys(this.seriesMap).sort(
            (a, b) => a - b,
          )) {
            const episodes = [];
            for (const eNum of Object.keys(this.seriesMap[sNum]).sort(
              (a, b) => a - b,
            )) {
              episodes.push([+eNum, this.seriesMap[sNum][eNum]]);
            }
            seriesMapArr.push([+sNum, episodes]);
          }
          const watchedEpis = tvdb.seriesMapToWatchedEpis(seriesMapArr);
          if (allTvdb?.[show.name]) {
            allTvdb[show.name].watchedEpis = watchedEpis;
          }
          await srvr.setTvdbFields({
            name: show.name,
            watchedEpis,
            dontEnqueue: true,
          });
          this.$emit("show-map", {
            mapShow: this.mapShow,
            hideMapBottom: this.hideMapBottom,
            seriesMapSeasons: this.seriesMapSeasons,
            seriesMapEpis: this.seriesMapEpis,
            seriesMap: this.seriesMap,
            mapError: "",
            noSwitch: true,
          });
        } else {
          await emby.editEpisode(
            show.id,
            season,
            episode,
            false,
            setWatched,
            show.name,
          );
          await this.seriesMapAction("", show, null);
        }
      }
    },

    async deleteEpisodes(show, targets) {
      const showName = show?.name || "";
      const deletableTargets = Array.isArray(targets)
        ? targets
            .map(({ season, episode }) => {
              const cell = this.seriesMap?.[season]?.[episode];
              const path = cell?.path;
              const noFile = !!cell?.noFile;
              if (!path || noFile) return null;
              return { path, season, episode };
            })
            .filter(Boolean)
        : [];

      if (deletableTargets.length === 0) return;

      const preview = deletableTargets
        .slice(0, 12)
        .map(
          ({ season, episode }) =>
            `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`,
        )
        .join(", ");
      const extraCount =
        deletableTargets.length - Math.min(deletableTargets.length, 12);
      const msg =
        `OK to delete ${deletableTargets.length} episode file(s) for ${showName}?` +
        (preview
          ? `\n${preview}${extraCount > 0 ? `, +${extraCount} more` : ""}`
          : "");
      if (!window.confirm(msg)) return;

      const failures = [];
      let deletedCount = 0;
      for (const { path, season, episode } of deletableTargets) {
        try {
          await srvr.deletePath(path);
          deletedCount += 1;

          const cell = this.seriesMap?.[season]?.[episode];
          if (cell) {
            cell.path = null;
            cell.noFile = true;
            cell.avail = false;
            cell.error = false;
          }

          this.$emit("show-map", {
            mapShow: this.mapShow,
            hideMapBottom: this.hideMapBottom,
            seriesMapSeasons: this.seriesMapSeasons,
            seriesMapEpis: this.seriesMapEpis,
            seriesMap: this.seriesMap,
            mapError: "",
            noSwitch: true,
          });
        } catch (err) {
          console.error("deleteEpisodes: deletePath failed", {
            path,
            season,
            episode,
            err,
          });
          failures.push({ season, episode, err });
        }
      }

      if (deletedCount > 0) {
        this.markShowUpdating(show.name);
        await srvr
          .refreshEmbyItem(show.id, show.name)
          .catch((err) => console.error("refreshEmbyItem failed:", err));

        await this.seriesMapAction("refresh", show, null);
      }

      if (failures.length > 0) {
        const summary = failures
          .slice(0, 8)
          .map(
            ({ season, episode, err }) =>
              `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}: ${err?.message || String(err)}`,
          )
          .join("\n");
        const extraFailures = failures.length - Math.min(failures.length, 8);
        window.alert(
          `${deletedCount > 0 ? `Deleted ${deletedCount} item(s).\n` : ""}Failed to delete ${failures.length} item(s).` +
            (summary ? `\n${summary}` : "") +
            (extraFailures > 0 ? `\n+${extraFailures} more failure(s)` : ""),
        );
      }
    },

    async seasonWatched(show, season, episodeStates) {
      if (show.inEmby !== false) return;
      const seasonMap = this.seriesMap?.[season];
      if (!seasonMap) return;

      console.log(
        "[seasonWatched] season:",
        season,
        "episodeStates:",
        JSON.stringify(episodeStates),
      );

      // Apply all episode states at once
      for (const [episodeNum, watched] of Object.entries(episodeStates)) {
        const cell = seasonMap[episodeNum];
        if (cell) cell.played = watched;
      }

      // Log played state of all seasons
      for (const sNum of Object.keys(this.seriesMap)) {
        const eps = this.seriesMap[sNum];
        const playedEps = Object.entries(eps)
          .filter(([, c]) => c.played)
          .map(([e]) => e);
        console.log(
          `[seasonWatched] S${sNum} played:`,
          playedEps.length > 0 ? playedEps.join(",") : "none",
        );
      }

      // Convert this.seriesMap to array format and persist once
      const seriesMapArr = [];
      for (const sNum of Object.keys(this.seriesMap).sort((a, b) => a - b)) {
        const episodes = [];
        for (const eNum of Object.keys(this.seriesMap[sNum]).sort(
          (a, b) => a - b,
        )) {
          episodes.push([+eNum, this.seriesMap[sNum][eNum]]);
        }
        seriesMapArr.push([+sNum, episodes]);
      }
      const watchedEpis = tvdb.seriesMapToWatchedEpis(seriesMapArr);
      console.log("[seasonWatched] watchedEpis:", JSON.stringify(watchedEpis));
      if (allTvdb?.[show.name]) {
        allTvdb[show.name].watchedEpis = watchedEpis;
      }
      await srvr.setTvdbFields({
        name: show.name,
        watchedEpis,
        dontEnqueue: true,
      });
      // Re-emit to App.vue so the map prop updates
      this.$emit("show-map", {
        mapShow: this.mapShow,
        hideMapBottom: this.hideMapBottom,
        seriesMapSeasons: this.seriesMapSeasons,
        seriesMapEpis: this.seriesMapEpis,
        seriesMap: this.seriesMap,
        mapError: "",
        noSwitch: true,
      });
    },

    async seriesMapAction(action, show, options = {}) {
      if (
        action == "open" &&
        this.mapShow?.name === show?.name &&
        this.currentPane === "map"
      ) {
        // If clicking the same show while already on map, keep it as-is
        return;
      }

      // Generation token: newer calls invalidate older in-flight ones
      const mapToken = ++this._mapActionToken;

      if (action == "date") {
        console.log("setting last watched to cur date");
        await emby.setLastWatched(show.id);
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

      // Bail if a newer seriesMapAction started while we were fetching
      if (mapToken !== this._mapActionToken) return;

      // Persist watchedEpis if we got data from Emby
      if (
        seriesMapIn &&
        seriesMapIn.length > 0 &&
        show.name &&
        show.inEmby !== false &&
        allTvdb?.[show.name]
      ) {
        const embySeasons = new Set(seriesMapIn.map(([sNum]) => sNum));
        const existingWatchedEpis = allTvdb[show.name].watchedEpis || [];
        const embyWatchedEpis = tvdb.seriesMapToWatchedEpis(seriesMapIn);
        // Preserve watched state for seasons not in Emby (e.g. filesOnDisk-only seasons)
        const watchedEpis = [
          ...existingWatchedEpis.filter(([sNum]) => !embySeasons.has(sNum)),
          ...embyWatchedEpis,
        ];
        allTvdb[show.name].watchedEpis = watchedEpis;
        await srvr.setTvdbFields({
          name: show.name,
          watchedEpis: watchedEpis,
          dontEnqueue: true,
          dontNotify: true,
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

      // Bail if a newer seriesMapAction started during any of the awaits above
      if (mapToken !== this._mapActionToken) return;

      for (const season of seriesMapIn) {
        const [seasonNum, episodes] = season;
        seriesMapSeasons[seasonNum] = seasonNum;
        const seasonMap = {};
        seriesMap[seasonNum] = seasonMap;
        for (const episode of episodes) {
          let [episodeNum, epiObj] = episode;
          const { error, played, avail, noFile, unaired, path, id } = epiObj;
          seriesMapEpis[episodeNum] = episodeNum;
          seasonMap[episodeNum] = {
            error,
            played,
            avail,
            noFile,
            unaired,
            path,
            id,
          };
        }
      }

      // Override avail/noFile using filesOnDisk — shows + immediately when
      // a file lands on disk without waiting for Emby to finish scanning.
      const diskFiles = allTvdb?.[show.name]?.filesOnDisk;
      if (Array.isArray(diskFiles)) {
        // Build set of watched episodes from persisted watchedEpis for filesOnDisk-only cells
        const persistedWatchedEpis = allTvdb?.[show.name]?.watchedEpis || [];
        const filesOnDiskWatchedSet = new Set();
        for (const entry of persistedWatchedEpis) {
          const [sNum, ...eps] = entry;
          for (const ep of eps) filesOnDiskWatchedSet.add(`${sNum}.${ep}`);
        }
        for (const row of diskFiles) {
          const s = row[0];
          for (let i = 1; i < row.length; i++) {
            const e = row[i];
            if (!seriesMap[s]) {
              seriesMap[s] = {};
              seriesMapSeasons[s] = s;
            }
            if (!seriesMapEpis[e]) seriesMapEpis[e] = e;
            const cell = seriesMap[s][e];
            if (cell) {
              cell.avail = true;
              cell.noFile = false;
              cell.unaired = false;
            } else {
              seriesMap[s][e] = {
                avail: true,
                noFile: false,
                unaired: false,
                played: filesOnDiskWatchedSet.has(`${s}.${e}`),
                error: false,
                path: null,
              };
            }
          }
        }
      }
      this.seriesMapSeasons = seriesMapSeasons.filter((x) => x !== null);
      this.seriesMapEpis = seriesMapEpis.filter((x) => x !== null);
      this.seriesMap = seriesMap;

      // Debug aid: detect cells that will render blank because no episode object exists.
      const blankCells = [];
      for (const season of this.seriesMapSeasons) {
        for (const episode of this.seriesMapEpis) {
          if (!this.seriesMap?.[season]?.[episode]) {
            blankCells.push(`S${season}E${episode}`);
            if (blankCells.length >= 12) break;
          }
        }
        if (blankCells.length >= 12) break;
      }
      if (blankCells.length > 0) {
        console.warn("[map-debug] blank map cells", {
          show: this.mapShow?.name,
          inEmby: this.mapShow?.inEmby !== false,
          tvdbId: this.mapShow?.tvdbId || this.mapShow?.tvdbId || null,
          seasons: this.seriesMapSeasons.length,
          episodes: this.seriesMapEpis.length,
          sampleBlankCells: blankCells,
        });
      }

      this.hideMapBottom = false;

      // If a newer seriesMapAction started while we were loading, discard this stale result
      if (mapToken !== this._mapActionToken) return;

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

      // Attach season premiere dates from allTvdb if available
      const spd = allTvdb?.[show.name]?.seasonPremiereDates;
      // Guard: if mapShow has been cleared out from under us (e.g. by an external
      // close), do not merge — spreading null would emit a partial object.
      if (spd && this.mapShow?.name === show.name) {
        this.mapShow = { ...this.mapShow, seasonPremiereDates: spd };
      } else if (spd) {
        return;
      }

      this.$emit("show-map", {
        mapShow: this.mapShow,
        hideMapBottom: this.hideMapBottom,
        seriesMapSeasons: this.seriesMapSeasons,
        seriesMapEpis: this.seriesMapEpis,
        seriesMap: this.seriesMap,
        mapError: errorMessage,
        noSwitch: isRefresh || !!options.noSwitch,
      });

      if (action === "prune") {
        this.markShowUpdating(show.name);
        await srvr
          .refreshEmbyItem(show.id, show.name)
          .catch((err) => console.error("refreshEmbyItem failed:", err));
        await this.seriesMapAction("refresh", show);
      }
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
      this.shows = [...this.shows].sort((a, b) => {
        a = this.getValBySortChoice(a, true);
        b = this.getValBySortChoice(b, true);
        if (a == b) return 0;
        if (
          ["Alpha", "Length", "Creator", "Safe start"].includes(this.sortChoice)
        ) {
          if (this.sortChoice === "Creator") {
            if (a === "" && b !== "") return 1;
            if (b === "" && a !== "") return -1;
          }
          return a > b ? +1 : -1;
        }
        return a > b ? -1 : +1;
      });
    },

    condColor(show, cond) {
      if (cond.cond(show)) return cond.color;
      return "#ddd";
    },

    async select(scroll = true) {
      if (this.actorsListMode) return; // filtering handled by filteredActorsList computed
      // Skip re-fetching TVDB data if all shows are already loaded
      if (!this.hasLoadedAllShows) {
        allTvdb = await tvdb.getAllTvdb();
      }
      await this.refilter(scroll);
    },

    async refilter(scroll = true) {
      let selectFirstAfterSort = false;
      // If actor filter is active, maintain it
      if (this.actorFilter) {
        // Check if we have search params (word-based search) or just filter (exact match)
        if (this.actorSearchParams) {
          // Use word-based search with stored params
          const { searchWords, matchesSearchTerm } = this.actorSearchParams;

          if (!allTvdb)
            allTvdb = await tvdb.getAllTvdb(this.hasLoadedAllShows ? 0 : 1);

          const checkShowForActorMatch = (show) => {
            const tvdbData = allTvdb?.[show.name];
            if (!tvdbData) return false;

            const actualData = tvdbData.response?.data || tvdbData;
            const characters = actualData?.characters;

            if (Array.isArray(characters)) {
              if (
                characters.some((char) => {
                  const actorName = char?.personName || char?.actor || "";
                  return matchesSearchTerm(actorName, searchWords);
                })
              )
                return true;
            }

            const crew = actualData?.crew;
            if (Array.isArray(crew)) {
              if (
                crew.some((c) => matchesSearchTerm(c?.name || "", searchWords))
              )
                return true;
            }

            return false;
          };

          const filteredShows = allShows.filter(checkShowForActorMatch);

          this.shows = filteredShows;

          // Preserve highlightName selection if possible
          if (this.highlightName && this.shows.length > 0) {
            const matchingShow = this.shows.find(
              (show) => show.name === this.highlightName,
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

      if (this.fltrChoice === "Playing") {
        const playing = this.nowPlayingShowNames;
        this.shows = allShows.filter((show) => playing.has(show.name));
        this.sortShows();
        if (scroll) this.scrollToSavedShow();
        return;
      }
      let srchStrLc;
      if (this.fltrChoice !== "Finished") {
        if (this.filterStr.length > 0) this.fltrChoice = "- - - - -";
        const filterEmpty =
          this.filterStr == null || String(this.filterStr).length === 0;
        srchStrLc = filterEmpty ? null : String(this.filterStr).toLowerCase();
      }

      const descrSrchLc = this.descrSearchStr
        ? String(this.descrSearchStr).toLowerCase()
        : null;
      if (descrSrchLc && !localAllTvdb) {
        if (!allTvdb) allTvdb = await tvdb.getAllTvdb();
        localAllTvdb = allTvdb;
      }

      const prevHighlightIdx = this.highlightName
        ? this.shows.findIndex((s) => s.name === this.highlightName)
        : -1;

      const filteredShows = [];
      fltrLoop: for (const show of allShows) {
        if (this.fltrChoice === "Finished") {
          const tvdbData = localAllTvdb?.[show.name];
          if (!tvdbData) continue;
          const { status, episodeCount, watchedCount } = tvdbData;
          const watchedAll = episodeCount > 0 && watchedCount == episodeCount;
          const finished =
            status == "Ended" && watchedAll && show.inEmby !== false;
          if (finished) filteredShows.push(show);
          continue;
        }
        if (srchStrLc && !show.name.toLowerCase().includes(srchStrLc)) continue;
        if (descrSrchLc) {
          const overview = String(
            localAllTvdb?.[show.name]?.overview ?? "",
          ).toLowerCase();
          if (!overview.includes(descrSrchLc)) continue;
        }
        for (let cond of this.conds) {
          const effectiveFilter = cond.filter;
          if (effectiveFilter === 0) continue;
          if ((effectiveFilter === +1) != !!cond.cond(show)) {
            continue fltrLoop;
          }
        }
        filteredShows.push(show);
      }

      this.shows = filteredShows;
      if (this.shows.length === 1) this.saveVisShow(this.shows[0]);
      else if (this.highlightName) {
        // Only update selection if highlightName is already set
        const showArr = this.shows.filter(
          (show) => show.name == this.highlightName,
        );
        if (showArr.length == 0) {
          selectFirstAfterSort = true;
        } else {
          // Show is preserved - update localStorage to match
          window.localStorage.setItem("lastVisShow", this.highlightName);
        }
      }
      this.sortShows();
      this.$emit("filtered-shows", this.shows);
      if (selectFirstAfterSort && this.shows.length > 0) {
        const idx =
          prevHighlightIdx >= 0
            ? Math.min(prevHighlightIdx, this.shows.length - 1)
            : 0;
        this.saveVisShow(this.shows[idx]);
      }
      if (scroll) this.scrollToSavedShow();
    },

    formatLastFirst(fullName) {
      const parts = String(fullName || "")
        .trim()
        .split(/\s+/);
      if (parts.length <= 1) return fullName || "";
      // A "pure" word contains only letters or single quote
      const isPure = (w) => /^[a-zA-Z']+$/.test(w);
      // Find rightmost pure word — last name starts there
      let lastPureIdx = -1;
      for (let i = parts.length - 1; i >= 0; i--) {
        if (isPure(parts[i])) {
          lastPureIdx = i;
          break;
        }
      }
      if (lastPureIdx <= 0) return fullName || "";
      const last = parts.slice(lastPureIdx).join(" ");
      const first = parts.slice(0, lastPureIdx).join(" ");
      return `${last}, ${first}`;
    },

    async buildActorsList() {
      if (!allTvdb) allTvdb = await tvdb.getAllTvdb();
      const normName = (n) =>
        String(n || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
      const actorMap = new Map(); // normKey -> { name, displayName, showCount }
      for (const show of allShows) {
        const tvdbData = allTvdb?.[show.name];
        if (!tvdbData) continue;
        const actualData = tvdbData.response?.data || tvdbData;
        const characters = actualData?.characters;
        if (!Array.isArray(characters)) continue;
        const seenInShow = new Set();
        for (const char of characters) {
          const name = String(char?.personName || char?.actor || "").trim();
          if (!name) continue;
          const key = normName(name);
          if (seenInShow.has(key)) continue;
          seenInShow.add(key);
          if (actorMap.has(key)) {
            actorMap.get(key).showCount++;
          } else {
            actorMap.set(key, {
              name,
              displayName: this.formatLastFirst(name),
              showCount: 1,
            });
          }
        }
      }
      const actors = Array.from(actorMap.values());
      actors.sort(
        (a, b) =>
          b.showCount - a.showCount ||
          a.displayName.localeCompare(b.displayName),
      );
      return actors;
    },

    async startActorsListMode() {
      if (this.actorsListMode) {
        this.endActorsListMode();
        return;
      }
      this.savedSortChoice = this.sortChoice;
      this.filterStr = "";
      const actors = await this.buildActorsList();
      this.actorsList = actors;
      this.actorsListMode = true;
      evtBus.emit("showActorsPane");
      evtBus.emit("clearActorSelection");
    },

    endActorsListMode() {
      this.actorsListMode = false;
      this.filterStr = "";
      this.actorsList = [];
      if (this.savedSortChoice !== null) {
        this.sortChoice = this.savedSortChoice;
        this.savedSortChoice = null;
      }
    },

    async actorsListItemClick(actorName) {
      this.actorsListMode = false;
      this.actorsList = [];
      await this.filterShowsByActor(actorName);
      // Sort matched actor to beginning in actors pane on next show selection
      const normName = (n) =>
        String(n || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
      const targetNorm = normName(actorName);
      const matchesSearchTerm = (n) => normName(n) === targetNorm;
      this.actorSearchParams = { searchWords: [], matchesSearchTerm };
      evtBus.emit("actorSearchActive", { searchWords: [], matchesSearchTerm });
      if (this.shows.length > 0) this.saveVisShow(this.shows[0], true);
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
        const tvdbData = allTvdb?.[show.name];
        if (!tvdbData) return false;

        // Handle both data formats (like actors.vue does)
        const actualData = tvdbData.response?.data || tvdbData;
        const characters = actualData?.characters;

        if (!Array.isArray(characters)) return false;

        const inCharacters = characters.some((char) => {
          const charActorName = normName(char?.personName || char?.actor);
          return charActorName === targetActorName;
        });
        if (inCharacters) return true;

        const crew = actualData?.crew;
        if (!Array.isArray(crew)) return false;
        return crew.some((c) => normName(c?.name) === targetActorName);
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
        const tvdbData = allTvdb?.[show.name];
        if (!tvdbData) return false;

        const actualData = tvdbData.response?.data || tvdbData;
        const characters = actualData?.characters;

        if (Array.isArray(characters)) {
          if (
            characters.some((char) => {
              const actorName = char?.personName || char?.actor || "";
              return matchesSearchTerm(actorName, searchWords);
            })
          )
            return true;
        }

        const crew = actualData?.crew;
        if (Array.isArray(crew)) {
          if (crew.some((c) => matchesSearchTerm(c?.name || "", searchWords)))
            return true;
        }

        return false;
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

    async watchClick() {
      console.log("watchClick");
      const target =
        this.lastWatchingName ??
        (this.watchingName !== "---" ? this.watchingName : null);
      if (target) {
        // Check if show is in the current filtered list
        const isInFilteredList = this.shows.some((s) => s.name === target);

        if (!isInFilteredList) {
          // Show is filtered out - click the All button to clear filters
          await this.allClick();
        }

        window.localStorage.setItem("lastVisShow", target);
        this.scrollToSavedShow(true);

        // If we have episode info, load map data and select that episode.
        if (
          this.currentPlayingSeason != null &&
          this.currentPlayingEpisode != null
        ) {
          const show = this.shows.find((s) => s.name === target);
          if (show) {
            // Keep the full map populated, but do not switch panes.
            await this.seriesMapAction("open", show, { noSwitch: true });
            // Switch to info pane without clearing the background map.
            evtBus.emit("showInfoPane");
            // Select only the current episode inside the already-loaded map.
            evtBus.emit("selectMapEpisode", {
              season: this.currentPlayingSeason,
              episode: this.currentPlayingEpisode,
            });
          }
        } else {
          // No episode info, just show info pane
          evtBus.emit("showInfoPane");
        }
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
      evtBus.emit("intro-count", allShows.filter((s) => s.needsIntro).length);

      // Gap checking now handled server-side
      // Server will notify via WebSocket when tvdb data is updated

      // Only set sort properties on initial load
      if (isInitialLoad) {
        this.sortByNew = true;
        this.sortBySize = false;
        this.sortChoice = "Alpha";
        try {
          const saved = localStorage.getItem("showHistory");
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
              showHistory = parsed.filter((n) => typeof n === "string");
              showHistoryPtr = showHistory.length - 1;
            }
          }
        } catch {
          /* ignore storage errors */
        }
      }

      // If saved show is not in emby, disable the in-emby filter so it's visible
      const savedName = window.localStorage.getItem("lastVisShow");
      if (savedName) {
        const savedShow = allShows.find((s) => s.name === savedName);
        if (savedShow && savedShow.inEmby === false) {
          const embyCond = this.conds.find((c) => c.name === "hasemby");
          if (embyCond) embyCond.filter = 0;
        }
      }

      this.showAll(true);
      await this.select();
      this.sortShows();

      let name = savedName;
      if (!name) {
        const firstShow = this.shows[0] || allShows[0];
        window.localStorage.setItem("lastVisShow", firstShow.name);
        name = firstShow.name;
      }

      // On initial load, restore selection from lastVisShow.
      // On subsequent reloads, do not change selection (avoids races where a reload
      // can override an explicit selection made immediately after the reload).
      await this.scrollToSavedShow(!!isInitialLoad);

      // Update series pane infobox with refreshed data
      if (this.highlightName) {
        const currentShow = allShows.find((s) => s.name === this.highlightName);
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
        const show = allShows.find((s) => s.name === showName);
        const showTvdbId = String(
          show?.tvdbId || show?.tvdbId || show?.tvdb_id || "",
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
          show.watchGap = show.watchGap;
          show.fileGap =
            show.fileGap || show.fileEndError || show.seasonWatchedThenNofile;
          show.needsIntro = tvdbRecord.needsIntro ?? false;
          show.anticipating = tvdbRecord.anticipating ?? false;
          evtBus.emit(
            "intro-count",
            allShows.filter((s) => s.needsIntro).length,
          );

          // Update allTvdb cache
          tvdb.upsertTvdbCacheRecord(allTvdb, tvdbRecord, showName);

          // If this show is currently displayed on the map, refresh it
          if (this.mapShow && this.mapShow.name === showName) {
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

    void (async () => {
      try {
        const shared = await srvr.getSharedFilters();
        this.hasSharedFilters =
          !!shared &&
          typeof shared === "object" &&
          Object.keys(shared).length > 0;
      } catch {
        this.hasSharedFilters = false;
      }
    })();

    // Listen for WebSocket notifications instead of polling
    this._onSharedFiltersChanged = (shared) => {
      this.hasSharedFilters =
        !!shared &&
        typeof shared === "object" &&
        Object.keys(shared).length > 0;
    };
    evtBus.on("sharedFiltersChanged", this._onSharedFiltersChanged);

    // Click-outside handler for actors list mode (capture phase to consume the click)
    this._actorsListClickOutside = (e) => {
      if (!this.actorsListMode) return;
      const actorsListEl = this.$refs.actorsListRef;
      const filterInput = document.querySelector("#hdrtop input");
      if (
        (actorsListEl && actorsListEl.contains(e.target)) ||
        (filterInput && filterInput.contains(e.target))
      ) {
        return;
      }
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
      this.endActorsListMode();
    };
    document.addEventListener("click", this._actorsListClickOutside, true);

    // Click-outside handler to close sort/filter dropdowns
    this._popClickOutside = (e) => {
      if (!this.sortPopped && !this.fltrPopped) return;
      const sortpop = document.getElementById("sortpop");
      const fltrpop = document.getElementById("fltrpop");
      const sortFltr = document.getElementById("sortFltr");
      if (
        (sortpop && sortpop.contains(e.target)) ||
        (fltrpop && fltrpop.contains(e.target)) ||
        (sortFltr && sortFltr.contains(e.target))
      ) {
        return;
      }
      this.sortPopped = false;
      this.fltrPopped = false;
    };
    document.addEventListener("click", this._popClickOutside);

    // Setup evtBus listeners cleanup
    this.evtHandlers = {};
    const on = (name, fn) => {
      this.evtHandlers[name] = fn;
      evtBus.on(name, fn);
    };

    on("descrSearch", (str) => {
      this.descrSearchStr = String(str || "");
      void this.select();
    });

    on("deleteShow", async (show) => {
      if (!show) return;
      await this.deleteShow(show);
    });

    on("vipActorsChanged", (updatedSet) => {
      _vipSet = updatedSet instanceof Set ? updatedSet : new Set(updatedSet);
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
        record.watchGap = record.watchGap || false;
        record.watchGapSeason = record.watchGapSeason;
        record.watchGapEpisode = record.watchGapEpisode;
        record.fileGap =
          record.fileGap ||
          record.fileEndError ||
          record.seasonWatchedThenNofile;

        // Merge fields into the existing show in allShows
        const show = allShows.find((s) => s.name === name);
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
          show.watchGap = record.watchGap;
          show.watchGapSeason = record.watchGapSeason;
          show.watchGapEpisode = record.watchGapEpisode;
          show.fileGap = record.fileGap;
          show.needsIntro = record.needsIntro ?? false;
          show.anticipating = record.anticipating ?? false;
          evtBus.emit(
            "intro-count",
            allShows.filter((s) => s.needsIntro).length,
          );
          show.notReady = record.notReady;
          show.date = record.date ?? show.date;
          show.size = record.size ?? show.size;
          show.noFiles = record.noFiles ?? show.noFiles;
          show.waitStr = record.waitStr ?? show.waitStr;
          if ("introDur" in record) show.introDur = record.introDur;
          if ("startMark" in record) show.startMark = record.startMark;
        }

        // Update allTvdb reference
        allTvdb[name] = record;

        // If this show is currently in the map pane, refetch series map so
        // map cells (noFile/avail/etc.) update after disk/download changes.
        if (this.mapShow && this.mapShow.name === name && show) {
          await this.seriesMapAction("refresh", show, null);
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
    on("showDiskChanged", (data) => {
      const { showName } = data || {};
      if (!showName) return;
      console.log(`[showDiskChanged] Disk changed for: ${showName}`);
      // Progress and reload driven by libraryProgress/libraryRefreshDone WS events via App.vue
    });

    // Simple + portrait: Buttons are rendered in App.vue and forward events via evtBus.
    on("simpleModeButtonsClick", (activeButtons) => {
      void this.handleButtonClick(activeButtons);
    });

    on("simpleModeButtonsTop", () => {
      this.topClick();
    });

    on("showsButtonClicked", () => {
      // Navigate to info pane and set sort to Viewed
      this.sortChoice = "Viewed";
      evtBus.emit("selectTab", "info");
      // Scroll to top of list
      this.$nextTick(() => {
        const listPane = this.$refs.listPane;
        if (listPane) listPane.scrollTop = 0;
      });
    });

    on("reelSearchAction", (payload) => {
      void this.searchAction(payload);
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
        ? allShows.find((s) => s?.name === prevName)
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

    on("deleteEpisodes", async ({ show, targets }) => {
      await this.deleteEpisodes(show, targets);
    });

    // Listen for season watched toggle from App.vue (non-Emby shows)
    on("seasonWatched", async ({ e, show, season, episodeStates }) => {
      await this.seasonWatched(show, season, episodeStates);
    });

    // Listen for play episode requests from info pane
    on("playEpisode", async ({ show, season, episode }) => {
      if (this.mapShow?.name !== show?.name || !this.seriesMap?.[season]) {
        await this.seriesMapAction("refresh", show);
      }
      const cell = this.seriesMap?.[season]?.[episode];
      if (cell?.path && !cell?.noFile) {
        evtBus.emit("playEpisodePath", cell.path);
      }
    });

    // Listen for season content deletes from App.vue (ctrl-click season number in Map)
    on("seasonDelete", async ({ e, show, season }) => {
      if (this.simpleMode) return;
      if (!e?.ctrlKey) return;

      const showName = show?.name || "";
      const showPath = show?.path || "";
      if (!showPath) return;

      const ok = window.confirm(
        `OK to delete contents of Season ${season} for show ${showName} ?`,
      );
      if (!ok) return;

      try {
        await srvr.delSeasonFiles(showName, showPath, season);
      } catch (err) {
        console.error("seasonDelete: delSeasonFiles failed", {
          showName,
          showPath,
          season,
          err,
        });
        window.alert(err?.message || String(err));
        return;
      }

      // Refresh this show in Emby after content deletion.
      this.markShowUpdating(show.name);
      await srvr
        .refreshEmbyItem(show.id, show.name)
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

      try {
        if (typeof onDone === "function") {
          // Map "Not in Emby" flow: a new show was just created — full reload needed
          this.showReloadingShows = true;
          this.logModalMessage("reloadingShowsModal", "Reloading Shows");
          tvdb.clearCache();
          await this.newShows();
        } else if (diskChangeShowName) {
          // Disk change: targeted update only — no full reload
          await this.updateShowFromDiskChange(diskChangeShowName);
        }
        // Manual scan: triggerEmbySync pushes tvdbUpdated WS events — no reload needed
      } catch (err) {
        console.error("library-refresh-complete: failed", err);
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

    on("introPaneClosed", async () => {
      if (this.conds.find((c) => c.name === "needsIntro")?.filter !== 1) return;
      await this.select();
    });

    on("activeQbtTitles", (titles) => {
      this.updateActiveShowNames("qbt", titles);
    });

    on("activeDownTitles", (titles) => {
      this.updateActiveShowNames("down", titles);
    });

    // Filter shows by actor (Shows button in actors pane)
    on("filterByActor", async ({ actorName }) => {
      await this.filterShowsByActor(actorName);
      // Sort matched actor to top of actors pane on each show selection
      const normName = (n) =>
        String(n || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
      const targetNorm = normName(actorName);
      const matchesSearchTerm = (n) => normName(n) === targetNorm;
      this.actorSearchParams = { searchWords: [], matchesSearchTerm };
      evtBus.emit("actorSearchActive", { searchWords: [], matchesSearchTerm });
    });

    // Clear actorsListMode and actor shows filter when an actor is selected in the actors pane
    on("actorSelected", async () => {
      if (this.actorsListMode) this.endActorsListMode();
      if (this.actorFilter || this.actorSearchParams) {
        this.actorFilter = null;
        this.actorSearchParams = null;
        evtBus.emit("actorSearchCleared");
        await this.select();
      }
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

    on("nowPlaying", ({ showName, playing }) => {
      if (showName) {
        this.lastWatchingName = showName;
        this.watchingName = showName;
        // Extract season/episode from first playing item
        const firstPlaying =
          Array.isArray(playing) && playing.length > 0 ? playing[0] : null;
        if (
          firstPlaying &&
          firstPlaying.season != null &&
          firstPlaying.episode != null
        ) {
          this.currentPlayingSeason = firstPlaying.season;
          this.currentPlayingEpisode = firstPlaying.episode;
        } else {
          this.currentPlayingSeason = null;
          this.currentPlayingEpisode = null;
        }
      } else {
        this.watchingName = this.lastWatchingName ?? "---";
        this.currentPlayingSeason = null;
        this.currentPlayingEpisode = null;
      }
      this.nowPlayingShowNames = new Set(
        Array.isArray(playing) ? playing.map((p) => p.showName) : [],
      );
    });

    void (async () => {
      try {
        await this.newShows(true);
      } catch (err) {
        console.error("Mounted:", err);
      }
    })();
  },

  beforeUnmount() {
    if (this._onSharedFiltersChanged) {
      evtBus.off("sharedFiltersChanged", this._onSharedFiltersChanged);
      this._onSharedFiltersChanged = null;
    }

    if (this._actorsListClickOutside) {
      document.removeEventListener("click", this._actorsListClickOutside, true);
      this._actorsListClickOutside = null;
    }

    if (this._popClickOutside) {
      document.removeEventListener("click", this._popClickOutside);
      this._popClickOutside = null;
    }

    if (this.evtHandlers) {
      for (const [name, fn] of Object.entries(this.evtHandlers)) {
        evtBus.off(name, fn);
      }
      this.evtHandlers = null;
    }

    if (this._onResizeWideLandscape) {
      window.removeEventListener("resize", this._onResizeWideLandscape);
      window.removeEventListener(
        "orientationchange",
        this._onResizeWideLandscape,
      );
      this._onResizeWideLandscape = null;
    }

    if (this._sharedFiltersPollList) {
      clearInterval(this._sharedFiltersPollList);
      this._sharedFiltersPollList = null;
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
