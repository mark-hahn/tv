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
            <HdrMsg v-if="!simpleMode" />
            <HdrTop
              v-model:filterStr="filterStr"
              :watchingName="watchingNameDisplay"
              :simpleMode="simpleMode"
              :isWideLandscape="isWideLandscape"
              :statusMsg="updatingMsg"
              @watch-click="watchClick"
              @filter-input="select"
              @filter-focus="filterInputFocused = true"
              @filter-blur="onFilterBlur"
              @send-filters="sendSharedFilters"
              @library-click="libraryClick"
              @opn-lib-click="opnLibClick"
              @all-click="allClick"
              @custom-click="customClick"
              :actorsListMode="actorsListMode"
              :tvDisabled="tvDisabled"
              :getDisabled="getDisabled"
              :getButtonFlashing="getButtonFlashing"
              @actors-click="startActorsListMode"
              @get-click="handleGetClick"
              @tv-click="handleTvClick"
            ></HdrTop>
            <HdrBot
              v-if="!simpleMode"
              :conds="conds"
              :sortChoices="sortChoices"
              :fltrChoices="fltrChoices"
              :selectedSort="actorsListMode ? '---' : sortChoice"
              :selectedFilter="fltrChoice"
              :reversed="reversed"
              @top-click="topClick"
              @prev-next-click="prevNextClick"
              @all-click="allClick"
              @cond-fltr-click="condFltrClick"
              @sort-action="sortAction"
              @fltr-action="fltrAction"
              @rev-click="revClick"
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
              @copy-sort="copySortValToClipboard"
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
          <HdrMsg v-if="!simpleMode" />
          <HdrTop
            v-model:filterStr="filterStr"
            :watchingName="watchingNameDisplay"
            :simpleMode="simpleMode"
            :isWideLandscape="isWideLandscape"
            :statusMsg="updatingMsg"
            @watch-click="watchClick"
            @filter-input="select"
            @filter-focus="filterInputFocused = true"
            @filter-blur="onFilterBlur"
            @send-filters="sendSharedFilters"
            @library-click="libraryClick"
            @opn-lib-click="opnLibClick"
            @all-click="allClick"
            @custom-click="customClick"
            :actorsListMode="actorsListMode"
            :tvDisabled="tvDisabled"
            :getDisabled="getDisabled"
            :getButtonFlashing="getButtonFlashing"
            @actors-click="startActorsListMode"
            @get-click="handleGetClick"
            @tv-click="handleTvClick"
          ></HdrTop>
          <HdrBot
            v-if="!simpleMode"
            :conds="conds"
            :sortChoices="sortChoices"
            :fltrChoices="fltrChoices"
            :selectedSort="actorsListMode ? '---' : sortChoice"
            :selectedFilter="fltrChoice"
            :reversed="reversed"
            @top-click="topClick"
            @prev-next-click="prevNextClick"
            @all-click="allClick"
            @cond-fltr-click="condFltrClick"
            @sort-action="sortAction"
            @fltr-action="fltrAction"
            @rev-click="revClick"
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
            @copy-sort="copySortValToClipboard"
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
import * as epd from "@tv/share";
// The filter and sort semantics themselves, shared with tv-srvr so the list
// this client shows and the one tvapp gets back are ordered by one same code.
import {
  COND_PREDS,
  getSortKey,
  sortShowList,
  filterShowList,
} from "@tv/share";
import { unilog, logHere } from "../log.js";
import { config } from "../config.js";

import parseTorrentTitle from "parse-torrent-title";
import evtBus from "../evtBus.js";
import Shows from "./shows.vue";
import HdrMsg from "./hdrmsg.vue";
import HdrTop from "./hdrtop.vue";
import HdrBot from "./hdrbot.vue";
import Buttons from "./buttons.vue";
import { setGlobalMessage } from "../globalMessages.js";

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

  components: { FontAwesomeIcon, Shows, HdrMsg, HdrTop, HdrBot, Buttons },

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
  },

  data() {
    const toggleNoEmbyFlag = async (show, flagName) => {
      this.saveVisShow(show);
      // If the flag doesn't exist yet, treat it as false and set to true.
      show[flagName] = !show[flagName];
      await srvr.addNoEmby(show).catch((err) => {
        unilog(
          951,
          `late addNoEmby error for ${show.name} (${flagName}):`,
          err,
        );
      });
    };

    const toggleToTry = async (show) => {
      if (show.inEmby === false) {
        await toggleNoEmbyFlag(show, "inToTry");
        return;
      }
      this.saveVisShow(show);
      const originalValue = show.inToTry;
      show.inToTry = !show.inToTry;
      try {
        await emby.saveToTry(show.id, show.inToTry, show.name);
        // Mirror into the tvdb record now so pushes/other tabs agree
        await srvr.setTvdbFields({ name: show.name, inToTry: show.inToTry });
      } catch (err) {
        unilog(952, `toggleToTry error for ${show.name}:`, err);
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
        unilog(953, `toggleAnticipating error for ${show.name}:`, err);
        show.anticipating = originalValue;
      }
    };

    const toggleSitcom = async (show) => {
      const originalValue = !!show.sitcom;
      show.sitcom = !originalValue;
      try {
        await srvr.setTvdbFields({
          name: show.name,
          sitcom: show.sitcom,
        });
      } catch (e) {
        unilog(1575, `toggleSitcom error for ${show.name}: ${e.message || e}`);
        show.sitcom = originalValue;
      }
    };

    const toggleContinue = async (show) => {
      if (show.inEmby === false) {
        await toggleNoEmbyFlag(show, "inContinue");
        return;
      }
      this.saveVisShow(show);
      const originalValue = show.inContinue;
      show.inContinue = !show.inContinue;
      try {
        await emby.saveContinue(show.id, show.inContinue, show.name);
        // Mirror into the tvdb record now so pushes/other tabs agree
        await srvr.setTvdbFields({
          name: show.name,
          inContinue: show.inContinue,
        });
      } catch (err) {
        unilog(954, `toggleContinue error for ${show.name}:`, err);
        show.inContinue = originalValue; // Revert on error
      }
    };

    const toggleMark = async (show) => {
      if (show.inEmby === false) {
        await toggleNoEmbyFlag(show, "inMark");
        return;
      }
      this.saveVisShow(show);
      const originalValue = show.inMark;
      show.inMark = !show.inMark;
      try {
        await emby.saveMark(show.id, show.inMark, show.name);
        // Mirror into the tvdb record now so pushes/other tabs agree
        await srvr.setTvdbFields({ name: show.name, inMark: show.inMark });
      } catch (err) {
        unilog(955, `toggleMark error for ${show.name}:`, err);
        show.inMark = originalValue;
      }
    };

    const toggleLinda = async (show) => {
      if (show.inEmby === false) {
        await toggleNoEmbyFlag(show, "inLinda");
        return;
      }
      this.saveVisShow(show);
      const originalValue = show.inLinda;
      show.inLinda = !show.inLinda;
      try {
        await emby.saveLinda(show.id, show.inLinda, show.name);
        // Mirror into the tvdb record now so pushes/other tabs agree
        await srvr.setTvdbFields({ name: show.name, inLinda: show.inLinda });
      } catch (err) {
        unilog(956, `toggleLinda error for ${show.name}:`, err);
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
        const leftEmby = util.getPstDateTimeMs();
        // Re-fetch allTvdb in case async ops replaced the cached reference
        allTvdb = await tvdb.getAllTvdb();
        const tvdbData = allTvdb[name];
        if (tvdbData) {
          tvdbData.inEmby = false;
          tvdbData.leftEmby = leftEmby;
          tvdbData.notReady = true;
        }
        const updated = await srvr.setTvdbFields({
          name,
          inEmby: false,
          leftEmby,
          notReady: true,
        });
        // Merge in place so the allShows entry (same object) stays current
        if (updated && typeof updated === "object") {
          if (tvdbData) tvdb.mergeTvdbRecord(tvdbData, updated);
          else allTvdb[name] = tvdb.applyComputedProps(updated);
        }
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
      getButtonFlashing: false,
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
      sortChoice: "Viewed",
      reversed: false,
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
      sortChoices: [
        "Alpha",
        "Viewed",
        "Down",
        "Added",
        "Ratings",
        "Size",
        "Safe start",
        "Ended",
        "Length",
        "Creator",
        "Quality",
      ],
      fltrChoices: [
        "All",
        "Try Drama",
        "Watching",
        "Finished",
        "Playing",
        "Partial",
      ],
      conds: [
        {
          color: "#0cf",
          filter: 0,
          icon: ["fas", "plus"],
          cond: COND_PREDS.unplayed,
          click() {},
          name: "unplayed",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["far", "clock"],
          cond: COND_PREDS.waiting,
          click() {},
          name: "waiting",
        },
        {
          color: "#0cf",
          filter: 0,
          icon: ["fas", "film"],
          hideIcon: true,
          cond: COND_PREDS.needsIntro,
          click() {},
          name: "needsIntro",
        },
        {
          color: "#f88",
          filter: 0,
          icon: ["fas", "minus"],
          cond: COND_PREDS.gap,
          click() {},
          name: "gap",
        },
        {
          color: "#faa",
          filter: 0,
          icon: ["fas", "traffic-light"],
          cond: COND_PREDS.ended,
          click() {},
          name: "ended",
        },
        {
          color: "#88f",
          filter: 0,
          icon: ["far", "sad-cry"],
          cond: COND_PREDS.drama,
          click() {},
          name: "drama",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["far", "laugh-beam"],
          cond: COND_PREDS.sitcom,
          async click(show) {
            await toggleSitcom(show);
          },
          name: "sitcom",
        },
        {
          color: "#88f",
          filter: 0,
          icon: ["fas", "globe"],
          cond: COND_PREDS.foreign,
          click() {},
          name: "foreign",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["fas", "question"],
          cond: COND_PREDS.totry,
          async click(show) {
            await toggleToTry(show);
          },
          name: "totry",
        },
        {
          color: "#c8925a",
          filter: 0,
          icon: ["fas", "exclamation"],
          cond: COND_PREDS.anticipating,
          async click(show) {
            await toggleAnticipating(show);
          },
          name: "anticipating",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["fas", "arrow-right"],
          cond: COND_PREDS.continue,
          async click(show) {
            await toggleContinue(show);
          },
          name: "continue",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["fas", "mars"],
          cond: COND_PREDS.mark,
          async click(show) {
            await toggleMark(show);
          },
          name: "mark",
        },
        {
          color: "lime",
          filter: 0,
          icon: ["fas", "venus"],
          cond: COND_PREDS.linda,
          async click(show) {
            await toggleLinda(show);
          },
          name: "linda",
        },
        {
          color: "#a66",
          filter: +1,
          icon: ["fas", "tv"],
          cond: COND_PREDS.hasemby,
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

    shows() {
      this.updateShowsCounts();
    },

    allShowsLength() {
      this.updateShowsCounts();
    },
  },

  computed: {
    displayHighlightName() {
      return this.highlightName;
    },

    highlightShow() {
      // Read both reactive deps unconditionally — allShows is a plain module
      // array, so without them this computed tracks nothing and caches forever.
      const name = this.highlightName;
      const count = this.allShowsLength;
      if (!name || !count) return null;
      return allShows.find((s) => s.name === name) || null;
    },

    tvDisabled() {
      return !this.highlightShow || this.highlightShow.inEmby === false;
    },

    getDisabled() {
      return !this.highlightShow || this.highlightShow.inEmby !== false;
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
    updateShowsCounts() {
      setGlobalMessage({
        id: "Shows",
        text: `${this.shows.length}/${this.allShowsLength}`,
        position: 0,
        duration: 0,
      });
    },

    checkIfScrollNeeded(showIndex) {
      // Check if the show at the given index is visible in the viewport
      const show = this.shows[showIndex];
      if (!show) return false;

      const showId = this.nameHash(show.name);
      const element = document.getElementById(showId);
      if (!element) return true; // If element not found, scroll to be safe

      const container = document.querySelector("#shows");
      if (!container) return true;

      const rect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Check if element is within the visible area of the container
      const isVisible =
        rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;

      return !isVisible; // Scroll only if not visible
    },

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

    showSearchingModal(showName, status) {
      this.searchingShowName = String(showName || "");
      this.searchingStatus = String(status || "");
      this.showSearching = true;
    },

    setSearchingModalStatus(status) {
      this.searchingStatus = String(status || "");
    },

    async loadAllShowsWithDialog() {
      if (this.hasLoadedAllShows) {
        unilog(1091, "All shows already loaded, skipping");
        return;
      }

      unilog(1090, "Loading all shows...");

      this.hasLoadedAllShows = true;

      // Load full dataset
      const additionalShows = await tvdb.getAllTvdb(0);

      // Merge into allTvdb — in place for records we already hold so the
      // allShows entries (same objects) stay current
      for (const [recName, rec] of Object.entries(additionalShows)) {
        const existing = allTvdb[recName];
        if (existing && existing !== rec) tvdb.mergeTvdbRecord(existing, rec);
        else if (!existing) allTvdb[recName] = rec;
      }

      // Add to allShows array, avoiding duplicates
      const additionalShowsArray = Object.values(additionalShows);
      const existingNames = new Set(allShows.map((s) => s.name));
      const newShows = additionalShowsArray.filter(
        (s) => !existingNames.has(s.name),
      );
      allShows.push(...newShows);

      unilog(
        1089,
        `Added ${newShows.length} shows (total: ${allShows.length})`,
      );
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
      evtBus.emit("startLibraryRefresh");
    },

    opnLibClick() {
      util.openExternalPage(
        "https://hahnca.com:8920/web/index.html#!/librarysetup/libraries",
      );
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
        unilog(957, "customClick sharedFilters apply failed:", e);
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
            unilog(958, "ctrl-send: getSharedFilters failed", err);
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
        } else {
          await srvr.setSharedFilters(payload);
        }
      } catch (e) {
        unilog(959, "sendSharedFilters failed:", e);
      }
    },

    async debugClick() {
      try {
        if (!this.highlightName) {
          unilog(1088, "No show selected");
          return;
        }

        const currentShow = allShows.find((s) => s.name === this.highlightName);
        if (!currentShow) {
          unilog(960, "Could not find show:", this.highlightName);
          return;
        }

        const tvdbId = currentShow.tvdbId || currentShow.tvdbId;
        if (!tvdbId) {
          unilog(961, "Show has no TvdbId:", this.highlightName);
          return;
        }

        unilog(
          962,
          "Fetching TVDB API data for:",
          this.highlightName,
          "TvdbId:",
          tvdbId,
        );

        const result = await srvr.debugTvdb({
          name: currentShow.name,
          tvdbId: tvdbId,
        });

        unilog(963, `Debug result for ${currentShow.name}:`, result);
      } catch (e) {
        unilog(964, `debugClick failed for ${this.highlightName}:`, e);
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
          unilog(965, "Custom sharedFilters parse/apply failed:", e);
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
        Ready: "unplayed",
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
        "Watched Order": "Viewed",
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
      // The sort key is shared with tv-srvr; what each row *displays* is this
      // client's own business, so only that is still worked out here.
      if (forSort) return getSortKey(show, this.sortChoice, allTvdb);
      let lastDownloaded, lastViewed, ratings;
      switch (this.sortChoice) {
        case "Alpha":
          return "";
        case "Added":
          return (show.dateCreated || "").slice(0, 10);
        case "Ended":
          return show.lastAired || "";
        case "Length":
          return show.averageRuntime || 0;
        case "Size":
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
          return ratings !== undefined && ratings !== null && ratings !== 0
            ? String(ratings)
            : "";
        case "Creator": {
          const crewArr = Array.isArray(allTvdb?.[show.name]?.crew)
            ? allTvdb[show.name].crew
            : [];
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
          return best ? best.name : "";
        }
        case "Viewed":
          lastViewed = util.normalizePlayedDate(
            show.lastPlayedDate || allTvdb?.[show.name]?.lastPlayedDate || "",
          );
          if (lastViewed)
            return util.fmtPlayedDate(lastViewed).split(" ")[0] || "";
          return "";
        case "Down":
          lastDownloaded = allTvdb?.[show.name]?.["last-downloaded"] || "";
          return util.fmtDbDate(lastDownloaded);
        case "Quality": {
          const q = show.quality ?? null;
          return q !== null ? String(q) : "";
        }
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

      unilog(966, "addRow", show.name);
      this.shows.unshift(show);
      if (allShows !== this.shows) allShows.unshift(show);
      this.saveVisShow(show, true);
    },

    removeRow(show) {
      unilog(967, "removeRow", show.name);
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
        unilog(968, matchShow.name + " already exists.");
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
          unilog(969, "web add: failed to fetch series map", {
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
          unilog(970, "web add: missing map data; skipping createShowFolder", {
            name,
            tvdbId,
            seriesMapSeasons,
            tvdbData,
          });
          alert(`No map data for new show ${name}`);
        } else {
          unilog(
            1232,
            `Calling createShowFolderAndRefreshEmby for ${name} tvdbId=${tvdbId}`,
          );
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
          unilog(
            1233,
            `createShowFolderAndRefreshEmby result for ${name}: createdFolder=${createdFolder} status=${res?.status}`,
          );
          if (res?.status === "refreshfailed") {
            alert(
              `The folder for "${name}" was created, but the Emby library refresh timed out.\nThe show should appear after Emby finishes scanning on its own.`,
            );
          } else if (!createdFolder) {
            unilog(971, "web add: createShowFolderAndRefreshEmby failed", {
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
                  unilog(972, `triggerShowGapCheck failed for ${name}:`, err),
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
              unilog(1757, `Emby scan discovery did not find ${name} (tvdbId=${tvdbId}) on attempt ${attempt}/4${attempt < 4 ? ", retrying" : ""}`);
              setWebAddStatus(`Waiting for Emby scan... (${attempt}/4)`);
            }
          }

          if (!show) {
            // Folder was created but Emby scan hasn't indexed it yet.
            // Fall back to the existing record — inEmby will update when Emby finishes scanning.
            show = findShowByTvdbIdOrName({ requireInEmby: false });
          }
          if (!show) {
            unilog(1758, `Emby scan discovery gave up for ${name} (tvdbId=${tvdbId}) after refresh retries`);
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
          unilog(973, "web add: aborted without creating noemby fallback", {
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
        unilog(974, "web add: failed", {
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
    async handleTvClick() {
      const show = this.highlightShow;
      if (!show || show.inEmby === false) return;
      fetch(
        `${config.tvTvUrl}/tv/viewshow?showId=${encodeURIComponent(show.id)}&showName=${encodeURIComponent(show.name)}`,
      ).catch(() => {});
    },

    async handleGetClick() {
      const show = this.highlightShow;
      if (!show || show.inEmby !== false) return;
      this.getButtonFlashing = true;
      setTimeout(() => {
        this.getButtonFlashing = false;
      }, 300);
      try {
        await srvr.sendEmail(`Get show "${show.name}".`);
      } catch (err) {
        unilog(1887, `sendEmail failed for ${show.name}:`, err);
      }
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
        // smartTitleMatch returns a name string, not a show object — resolve it.
        const matchName = util.smartTitleMatch(nm, allShows, null, false);
        if (matchName) {
          const matchShow = allShows.find((s) => s.name === matchName);
          if (matchShow) {
            // If both have tvdbIds but they differ, these are different shows
            if (id) {
              const matchId = String(
                matchShow?.tvdbId ?? matchShow?.TvdbShowId ?? "",
              ).trim();
              if (matchId && matchId !== id) return null;
            }
            return matchShow;
          }
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
        // smartTitleMatch returns a name string, not the show object — resolve it back
        const fuzzyName = util.smartTitleMatch(
          searchTitle,
          allShows,
          searchYear,
          true,
        );
        if (fuzzyName) {
          match = allShows.find((s) => s.name === fuzzyName) || null;
        }
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
        unilog(1087, "saveVisShow show param null");
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
        const currentShowName =
          showHistory.length > 0 ? showHistory[showHistoryPtr] : null;
        const prevShowName =
          showHistoryPtr > 0 ? showHistory[showHistoryPtr - 1] : null;
        const nextShowName =
          showHistoryPtr < showHistory.length - 1
            ? showHistory[showHistoryPtr + 1]
            : null;

        if (showName === currentShowName) {
          // 1. Newly selected show matches the current one, do nothing.
        } else if (showName === prevShowName) {
          // 2. Newly selected show is the previous one, move pointer back.
          showHistoryPtr--;
        } else if (showName === nextShowName) {
          // 3. Newly selected show is the next one, move pointer forward.
          showHistoryPtr++;
        } else {
          // 4. New history branch.
          showHistory = showHistory.slice(0, showHistoryPtr + 1);
          showHistory.push(showName);
          if (showHistory.length > 100) {
            showHistory = showHistory.slice(-100);
          }
          showHistoryPtr = showHistory.length - 1;
        }

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
            .catch((err) =>
              unilog(975, `triggerShowSelect failed for ${show.name}:`, err),
            );
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

    revClick() {
      this.reversed = !this.reversed;
      this.sortShows();
    },

    sortAction(sortChoice) {
      this.sortChoice = sortChoice;
      this.reversed = false;
      this.sortShows();
      setTimeout(() => {
        this.saveVisShow(this.shows[0], true);
      }, 0);
    },

    async fltrAction(fltrChoice) {
      this.actorFilter = null; // Clear actor filter when changing filter
      this.actorSearchParams = null;
      evtBus.emit("actorSearchCleared");
      if (fltrChoice === "All") evtBus.emit("clearDescrSearch");
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
    },

    async scrollToSavedShow(saveVis = false) {
      let show = null;
      const name = window.localStorage.getItem("lastVisShow");
      if (!name) {
        unilog(1086, "scrollToSavedShow: lastVisShow missing, ignoring");
        show = allShows[0];
      } else {
        show = allShows.find((shw) => shw.name == name);
        if (!show) {
          unilog(976, "scrollToSavedShow: show not found", name);
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
      const cell = event.target.closest(".show-name-cell");
      const flexWrap = cell?.firstElementChild;
      const eles = flexWrap
        ? [flexWrap.children[0], flexWrap.children[1]].filter(Boolean)
        : [event.target];
      const saved = eles.map((el) => el.style.backgroundColor);
      for (const el of eles) el.style.backgroundColor = "#f88";
      await navigator.clipboard.writeText(show.name);
      await new Promise((res) => setTimeout(res, 400));
      eles.forEach((el, i) => (el.style.backgroundColor = saved[i]));
    },

    async copySortValToClipboard(show, event) {
      const cell = event.currentTarget;
      const saved = cell.style.backgroundColor;
      cell.style.backgroundColor = "lightpink"; // flash on alt-click copy
      await navigator.clipboard.writeText(
        String(this.getValBySortChoice(show)),
      );
      await new Promise((res) => setTimeout(res, 400));
      cell.style.backgroundColor = saved;
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
          unilog(977, `episodeClick: deletePath failed for ${show.name}`, {
            path,
            err,
          });
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
          .catch((err) =>
            unilog(978, `refreshEmbyItem failed for ${show.name}:`, err),
          );

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
        await srvr.setWatchedEpis({ name: show.name, watchedEpis });
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
          await srvr.setWatchedEpis({ name: show.name, watchedEpis });
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
          await this.seriesMapAction("refresh", show);
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

      const paths = deletableTargets.map(({ path }) => path);
      let pathResults;
      try {
        pathResults = await srvr.deletePaths(paths);
      } catch (err) {
        unilog(
          979,
          `deleteEpisodes: deletePaths call failed for ${show.name}`,
          err,
        );
        window.alert(`Delete failed: ${err?.message || String(err)}`);
        return;
      }

      for (let i = 0; i < deletableTargets.length; i++) {
        const { season, episode } = deletableTargets[i];
        const result = pathResults?.[i];
        if (result?.ok) {
          deletedCount += 1;
          const cell = this.seriesMap?.[season]?.[episode];
          if (cell) {
            cell.path = null;
            cell.noFile = true;
            cell.avail = false;
            cell.error = false;
          }
        } else {
          unilog(980, `deleteEpisodes: deletePaths failed for ${show.name}`, {
            path: paths[i],
            season,
            episode,
            error: result?.error,
          });
          failures.push({
            season,
            episode,
            err: new Error(result?.error || "delete failed"),
          });
        }
      }

      if (deletedCount > 0) {
        this.$emit("show-map", {
          mapShow: this.mapShow,
          hideMapBottom: this.hideMapBottom,
          seriesMapSeasons: this.seriesMapSeasons,
          seriesMapEpis: this.seriesMapEpis,
          seriesMap: this.seriesMap,
          mapError: "",
          noSwitch: true,
        });
      }

      if (deletedCount > 0) {
        this.markShowUpdating(show.name);
        await srvr
          .refreshEmbyItem(show.id, show.name)
          .catch((err) =>
            unilog(981, `refreshEmbyItem failed for ${show.name}:`, err),
          );

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

      unilog(
        982,
        "show:",
        show.name,
        "season:",
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
        unilog(
          983,
          `${show.name} S${sNum} played:`,
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
      unilog(984, `watchedEpis for ${show.name}:`, JSON.stringify(watchedEpis));
      await srvr.setWatchedEpis({ name: show.name, watchedEpis });
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
      // Callers may pass null explicitly, which bypasses the default above.
      options = options || {};
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

      const isRefresh = action === "refresh";
      // Fast first paint: for a plain open of an in-Emby show, load from the
      // server's cached episodeData (no live Emby/disk access) so the map
      // renders immediately. Also used for refreshes driven by a tvdbUpdated
      // push, whose record already carries fresh episodeData — no need for a
      // redundant live Emby/disk scan.
      const useStale =
        (action === "open" && show.inEmby !== false && !options.noSwitch) ||
        options.stale === true;

      this.hideMapBottom = true;
      this.mapShow = show;
      const seriesMapSeasons = [];
      const seriesMapEpis = [];
      const seriesMap = {};
      let errorMessage = "";

      // Prune (destructive): delete watched files via Emby before rebuilding.
      if (action === "prune") {
        try {
          await emby.getSeriesMap(show, true);
        } catch (e) {
          unilog(985, `prune failed for ${show.name}:`, e?.message || e);
        }
        if (mapToken !== this._mapActionToken) return;
      }

      // Build the map from the server's authoritative episodeData. The server
      // refreshes watched (Emby) + files (disk) and returns the seriesMap in
      // the legacy wire shape: [[season, [[ep, {error, played, avail, noFile,
      // unaired, path, id, quality}]], ...], ...].
      let seriesMapIn = [];
      try {
        let resp;
        if (show.inEmby === false) {
          const tvdbId = show.tvdbId;
          if (!tvdbId) {
            errorMessage = "Preview show has no tvdbId.";
          } else {
            resp = await srvr.getSeriesMapFromTvdb({ tvdbId });
          }
        } else {
          resp = await srvr.getSeriesMapFromEmby({
            showName: show.name,
            stale: useStale,
          });
        }
        if (resp?.success && Array.isArray(resp.seriesMap)) {
          seriesMapIn = resp.seriesMap;
          // Sync fresh episodeData into the in-memory cache so the Position
          // filter reflects Emby changes that happened outside our app.
          if (resp.episodeData) {
            show.episodeData = resp.episodeData;
            if (allTvdb?.[show.name]) {
              allTvdb[show.name].episodeData = resp.episodeData;
            }
            if (this.fltrChoice === "Partial") this.refilter();
          }
        } else if (resp) {
          errorMessage =
            resp?.error || "Not in emby and show not found in TVDB.";
        }
      } catch (e) {
        errorMessage = e?.message || "Failed to load series map.";
      }

      // Bail if a newer seriesMapAction started while we were fetching
      if (mapToken !== this._mapActionToken) return;

      if (seriesMapIn.length === 0 && !errorMessage && !useStale) {
        errorMessage = "Not in emby and show not found in TVDB.";
      }

      for (const season of seriesMapIn) {
        const [seasonNum, episodes] = season;
        seriesMapSeasons[seasonNum] = seasonNum;
        const seasonMap = {};
        seriesMap[seasonNum] = seasonMap;
        for (const episode of episodes) {
          const [episodeNum, epiObj] = episode;
          seriesMapEpis[episodeNum] = episodeNum;
          seasonMap[episodeNum] = epiObj;
        }
      }
      this.seriesMapSeasons = seriesMapSeasons.filter((x) => x !== null);
      this.seriesMapEpis = seriesMapEpis.filter((x) => x !== null);
      this.seriesMap = seriesMap;

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
          .catch((err) =>
            unilog(986, `refreshEmbyItem failed for ${show.name}:`, err),
          );
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
      this.shows = sortShowList(
        this.shows,
        this.sortChoice,
        allTvdb,
        this.reversed,
      );
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

      if (this.fltrChoice === "Partial") {
        this.shows = allShows.filter((show) =>
          epd.hasAnyPosition(show.episodeData),
        );
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

      const condFilters = {};
      for (const cond of this.conds) condFilters[cond.name] = cond.filter;
      const filteredShows = filterShowList(
        allShows,
        {
          fltrChoice: this.fltrChoice,
          filterStr: srchStrLc ? this.filterStr : "",
          descrSearchStr: this.descrSearchStr,
          condFilters,
        },
        localAllTvdb,
      );

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

      // Check if current state matches "All" state (only for non-special fltrChoice values)
      if (this.fltrChoice !== "Finished" && this.fltrChoice !== "Playing") {
        const filterStrEmpty = !this.filterStr || this.filterStr.length === 0;
        const noActorFilter = !this.actorFilter && !this.actorSearchParams;
        const noDescrSearch =
          !this.descrSearchStr || this.descrSearchStr.length === 0;

        // Check if all conds are in "All" state (filter === 0, except hasemby which can be 0 or 1)
        const allCondsMatchAll = this.conds.every((cond) => {
          if (cond.name === "hasemby") {
            return cond.filter === 0 || cond.filter === 1;
          }
          return cond.filter === 0;
        });

        const stateMatchesAll =
          filterStrEmpty && noActorFilter && noDescrSearch && allCondsMatchAll;

        if (stateMatchesAll && this.fltrChoice !== "All") {
          this.fltrChoice = "All";
          window.localStorage.setItem("fltrChoice", "All");
        }
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
      actors.sort((a, b) => a.displayName.localeCompare(b.displayName));
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
      unilog(
        988,
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

      unilog(
        989,
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
          unilog(990, "Error searching non-emby shows:", error);
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
            try {
              // Keep the full map populated, but do not switch panes.
              await this.seriesMapAction("open", show, { noSwitch: true });
            } catch (err) {
              unilog(
                991,
                `watchClick: seriesMapAction failed for ${show.name}`,
                err,
              );
            }
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
      unilog(992, "addGapToShow called - gap checking now handled server-side");
    },

    async newShows(isInitialLoad = false) {
      await emby.init();

      const result = await emby.loadAllShows();
      allShows = result.allShows;
      allTvdb = result.allTvdb;
      this.hasLoadedAllShows = true;

      if (!allShows) {
        unilog(1084, "No shows from loadAllShows");
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
        const showTvdbId = String(show?.tvdbId || show?.tvdb_id || "").trim();
        const tvdbRecord = tvdb.getTvdbRecordByNameOrId(
          updatedTvdb,
          showName,
          showTvdbId,
        ).record;

        if (!tvdbRecord) {
          unilog(994, `No tvdb record found for ${showName}`);
          return;
        }

        // Merge the full record IN PLACE (see tvdbUpdated handler)
        if (show) {
          tvdb.mergeTvdbRecord(show, tvdbRecord);
          if (allTvdb) allTvdb[show.name] = show;
          evtBus.emit(
            "intro-count",
            allShows.filter((s) => s.needsIntro).length,
          );

          // If this show is currently displayed on the map, refresh it
          if (this.mapShow && this.mapShow.name === showName) {
            unilog(995, `Refreshing map for ${showName}`);
            await this.seriesMapAction("refresh", show, null);
          }

          // Refresh UI to show updated data
          await this.refilter(false);
        }
      } catch (err) {
        unilog(996, `Error updating ${showName}:`, err);
      }
    },
  },

  /////////////////  MOUNTED  /////////////////
  mounted() {
    this.updateWideLandscape();
    this._onResizeWideLandscape = () => this.updateWideLandscape();
    window.addEventListener("resize", this._onResizeWideLandscape);
    window.addEventListener("orientationchange", this._onResizeWideLandscape);

    this._onEpisodeDataUpdated = ({ showName, episodeData }) => {
      if (showName && allTvdb?.[showName]) {
        allTvdb[showName].episodeData = episodeData;
      }
      const show = allShows.find((s) => s.name === showName);
      if (show) show.episodeData = episodeData;
      if (this.fltrChoice === "Partial") this.refilter();
    };
    evtBus.on("episodeDataUpdated", this._onEpisodeDataUpdated);

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

    // Arrow key navigation for show selection
    this._onArrowKeyNav = (e) => {
      // Skip if filter input is focused
      if (this.filterInputFocused) return;

      const isUp = e.key === "ArrowUp" || e.keyCode === 38;
      const isDown = e.key === "ArrowDown" || e.keyCode === 40;

      if (!isUp && !isDown) return;

      // Skip while the tv remote is open — there up/down are remote buttons.
      if (this.currentPane === "remote") return;

      // Skip if actors list mode is active
      if (this.actorsListMode) return;

      // Skip if no shows or no current selection
      if (!Array.isArray(this.shows) || this.shows.length === 0) return;
      if (!this.highlightName) return;

      // Find current show index in visible shows
      const currentIdx = this.shows.findIndex(
        (s) => s.name === this.highlightName,
      );
      if (currentIdx === -1) return;

      // Calculate new index
      let newIdx = currentIdx;
      if (isUp && currentIdx > 0) {
        newIdx = currentIdx - 1;
      } else if (isDown && currentIdx < this.shows.length - 1) {
        newIdx = currentIdx + 1;
      }

      // If index changed, select the new show
      if (newIdx !== currentIdx) {
        e.preventDefault();
        e.stopPropagation();
        // Only scroll if the new item would be outside the visible viewport
        const needsScroll = this.checkIfScrollNeeded(newIdx);
        this.onSelectShow(this.shows[newIdx], needsScroll);
      }
    };
    window.addEventListener("keydown", this._onArrowKeyNav);

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

    // Listen for server notifications about tvdb updates
    on("tvdbUpdated", async (data) => {
      const { name, record } = data || {};
      if (!name || !record) {
        unilog(1083, "Missing name or record in push data");
        return;
      }
      if (!allTvdb || !allShows) return; // loadAllShows not yet complete, ignore early push
      try {
        // Merge the full pushed record IN PLACE so the allTvdb map and the
        // allShows array keep sharing one object — no field whitelist.
        const show = allShows.find((s) => s.name === name);
        if (show) {
          tvdb.mergeTvdbRecord(show, record);
          allTvdb[name] = show; // heal identity if the map had diverged
          evtBus.emit(
            "intro-count",
            allShows.filter((s) => s.needsIntro).length,
          );
        } else if (allTvdb[name]) {
          tvdb.mergeTvdbRecord(allTvdb[name], record);
        } else {
          allTvdb[name] = tvdb.applyComputedProps(record);
        }

        // If this show is currently in the map pane, rebuild the series map.
        // The pushed record already carries fresh episodeData (the server
        // refreshed emby+disk before pushing), so rebuild from that cached
        // data rather than issuing a redundant live Emby/disk scan.
        if (this.mapShow && this.mapShow.name === name && show) {
          await this.seriesMapAction("refresh", show, { stale: true });
        }

        // Refresh UI
        await this.refilter(false);
      } catch (err) {
        unilog(997, `Failed to handle tvdb push for ${name}:`, err);
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
      unilog(1082, `Disk changed for: ${showName}`);
      // Progress and reload driven by libraryProgress/libraryRefreshDone WS events via App.vue
    });

    // Simple + portrait: Buttons are rendered in App.vue and forward events via evtBus.
    on("simpleModeButtonsClick", (activeButtons) => {
      void this.handleButtonClick(activeButtons);
    });

    on("simpleModeButtonsTop", () => {
      this.topClick();
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
        unilog(998, "seasonDelete: delSeasonFiles failed", {
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
        .catch((err) => unilog(999, "refreshEmbyItem failed:", err));
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
          tvdb.clearCache();
          await this.newShows();
        } else if (diskChangeShowName) {
          // Disk change: targeted update only — no full reload
          await this.updateShowFromDiskChange(diskChangeShowName);
        }
        // Manual scan: triggerEmbySync pushes tvdbUpdated WS events — no reload needed
      } catch (err) {
        unilog(1000, "library-refresh-complete: failed", err);
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
      // GLOBAL-MSG: Qbt
      const count = Array.isArray(titles) ? titles.length : 0;
      if (count > 0)
        setGlobalMessage({ id: "Qbt", text: `Qbt:${count}`, position: 10 });
      else setGlobalMessage({ id: "Qbt", action: "hide" });
    });

    on("activeDownTitles", (titles) => {
      this.updateActiveShowNames("down", titles);
      // GLOBAL-MSG: Down
      const count = Array.isArray(titles) ? titles.length : 0;
      if (count > 0)
        setGlobalMessage({ id: "Down", text: `Dwn:${count}`, position: 11 });
      else setGlobalMessage({ id: "Down", action: "hide" });
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
        unilog(1001, "Mounted:", err);
      }
    })();
  },

  beforeUnmount() {
    if (this._onEpisodeDataUpdated) {
      evtBus.off("episodeDataUpdated", this._onEpisodeDataUpdated);
      this._onEpisodeDataUpdated = null;
    }

    if (this._actorsListClickOutside) {
      document.removeEventListener("click", this._actorsListClickOutside, true);
      this._actorsListClickOutside = null;
    }

    if (this._onArrowKeyNav) {
      window.removeEventListener("keydown", this._onArrowKeyNav);
      this._onArrowKeyNav = null;
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
