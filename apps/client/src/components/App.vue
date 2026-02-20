<template>
  <div
    id="all"
    :style="{
      width: '100%',
      height: '97dvh',
      boxSizing: 'border-box',
      padding: 0,
      margin: 0,
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'stretch',
    }"
  >
    <div
      id="simpleButtonsPane"
      v-show="showSideButtons"
      :style="{
        flex: '0 0 auto',
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#ccc',
      }"
    >
      <Buttons
        style="width: 105px; flex: 1 1 auto"
        :sizing="sideButtonsSizing"
        @button-click="onSideButtonsClick"
        @top-click="onSideButtonsTop"
      ></Buttons>
    </div>
    <div
      id="mainStack"
      :style="{
        flex: '1 1 auto',
        minWidth: '0px',
        height: '100%',
        display: 'flex',
        flexDirection: isPortrait ? 'column' : 'row',
      }"
    >
      <!-- In portrait, put the right-side pane (Series/Map/etc) above the List.-->
      <div
        id="tabArea"
        :style="tabAreaStyle"
      >
        <div
          id="tabBar"
          :style="{
            display: 'flex',
            gap: simpleMode ? '30px' : '0px',
            padding: simpleMode ? '6px 8px' : '6px 0px',
            alignItems: 'center',
            borderBottom: '1px solid #ddd',
            backgroundColor: '#fafafa',
            flex: '0 0 auto',
            flexWrap: 'wrap',
          }"
        >
          <button
            v-for="t in tabs"
            :key="t.key"
            @click.stop="selectTab(t.key)"
            :disabled="t.key === 'map' && isMapDisabledInPreview"
            :style="{
              fontSize: '13px',
              cursor:
                t.key === 'map' && isMapDisabledInPreview
                  ? 'not-allowed'
                  : 'pointer',
              borderRadius: '7px',
              padding: '4px 10px',
              marginLeft: '4px',
              border: '1px solid #bbb',
              backgroundColor:
                currentPane === t.key
                  ? '#ddd'
                  : t.key === 'map' && isMapDisabledInPreview
                    ? '#e8e8e8'
                    : 'whitesmoke',
              color:
                t.key === 'map' && isMapDisabledInPreview ? '#999' : 'inherit',
              opacity: t.key === 'map' && isMapDisabledInPreview ? 0.6 : 1,
            }"
          >
            {{ t.label }}
          </button>
          <!-- Preview controls: immediately after the rightmost tab button (before progress)-->
          <template v-if="previewMode">
            <button
              @click.stop="addShowFromPreview"
              :disabled="previewAddBusy || !previewSrchChoice"
              :style="{
                fontSize: '13px',
                cursor:
                  previewAddBusy || !previewSrchChoice ? 'default' : 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                marginTop: '4px',
                marginLeft: '20px',
                border: '1px solid #bbb',
                backgroundColor:
                  previewAddBusy || !previewSrchChoice ? '#eee' : 'whitesmoke',
              }"
            >
              Add show to Emby
            </button>
            <button
              @click.stop="exitPreview"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                marginTop: '4px',
                marginLeft: '4px',
                border: '1px solid #bbb',
                backgroundColor: 'whitesmoke',
              }"
            >
              Exit Preview
            </button>
            <span
              class="pane-header-title"
              style="margin-left: 10px"
              >preview mode</span
            >
            <span
              v-if="previewPanesLoading"
              :style="{
                marginLeft: '10px',
                color: '#aaa',
                fontWeight: 'bold',
                fontSize: '13px',
                whiteSpace: 'nowrap',
              }"
              >&lt;Loading&gt;</span
            >
          </template>
          <div style="flex: 1"></div>
          <div
            v-if="!simpleMode && libraryProgressText"
            style="
              display: flex;
              align-items: center;
              margin-left: 10px;
              padding-right: 10px;
            "
          >
            <div
              style="
                font-size: 12px;
                color: #555;
                white-space: nowrap;
                padding-right: 8px;
              "
            >
              {{ libraryProgressText }}
            </div>
          </div>
        </div>
        <div
          id="tabBody"
          :style="{
            flex: '1 1 auto',
            minHeight: '0px',
            position: 'relative',
            width: '100%',
          }"
        >
          <Info
            v-show="currentPane === 'info'"
            style="display: block; width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :hideButtonsPane="showSideButtons"
          ></Info>
          <Map
            v-show="currentPane === 'map'"
            :mapShow="mapShow"
            :hideMapBottom="hideMapBottom"
            :seriesMapSeasons="seriesMapSeasons"
            :seriesMapEpis="seriesMapEpis"
            :seriesMap="seriesMap"
            :mapError="mapError"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            @reload-shows="triggerShowReload"
            @prune="handleMapAction('prune', $event)"
            @set-date="handleMapAction('date', $event)"
            @close="handleMapAction('close')"
            @show-actors="() => handleShowActors(false)"
            @episode-click="handleEpisodeClick"
            @season-delete="handleSeasonDelete"
          ></Map>
          <Actors
            v-show="currentPane === 'actors'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
          ></Actors>
          <Reviews
            v-show="currentPane === 'reviews'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
          ></Reviews>
          <Trailer
            v-show="currentPane === 'trailer'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :active="currentPane === 'trailer'"
          ></Trailer>
          <Browse
            v-if="!simpleMode"
            v-show="currentPane === 'browse'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :allShows="allShows"
            :active="currentPane === 'browse'"
          >
          </Browse>
          <Tor
            v-if="!simpleMode"
            v-show="currentPane === 'tor'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :activeShow="currentShow"
          ></Tor>
          <Flex
            v-if="!simpleMode"
            v-show="currentPane === 'flex'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :show="currentShow"
          ></Flex>
          <Qbt
            v-if="!simpleMode"
            v-show="currentPane === 'qbt'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :show="currentShow"
          ></Qbt>
          <Local
            v-if="!simpleMode"
            v-show="currentPane === 'local'"
            style="width: 100%; height: 100%"
            :active="currentPane === 'local'"
            :show="currentShow"
            :allShows="allShows"
            @select-show="handleLocalSelectShow"
          ></Local>
          <Usb
            v-if="!simpleMode"
            v-show="currentPane === 'usb'"
            style="width: 100%; height: 100%"
            :active="currentPane === 'usb'"
            :show="currentShow"
            :allShows="allShows"
          ></Usb>
          <Down
            v-if="!simpleMode"
            v-show="currentPane === 'down'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :show="currentShow"
          ></Down>
        </div>
      </div>
      <!-- Draggable divider between panes: vertical in landscape, horizontal in portrait.-->
      <div
        id="paneDivider"
        @pointerdown.stop.prevent="startPaneResize"
        @pointermove.stop.prevent="onPaneResizeMove"
        @pointerup.stop.prevent="stopPaneResize"
        @pointercancel.stop.prevent="stopPaneResize"
        @lostpointercapture.stop.prevent="stopPaneResize"
        :style="paneDividerStyle"
        title="Drag to resize panes"
      ></div>
      <List
        :style="listStyle"
        :simpleMode="simpleMode"
        :sizing="activeSizing"
        :hideButtonsPane="showSideButtons"
        @show-map="handleShowMap"
        @hide-map="handleHideMap"
        @show-actors="handleShowActors"
        @show-tor="handleShowTor"
        @all-shows="handleAllShows"
        @all-tvdb="handleAllTvdb"
      >
      </List>
    </div>
    <!-- TVDB mismatch detail modal (OK-only)-->
    <div
      id="tvdbMismatchModal"
      v-if="tvdbMismatchOpen"
      @click.stop.prevent
      @pointerdown.stop.prevent
      style="
        position: fixed;
        inset: 0;
        background-color: rgba(0, 0, 0, 0.35);
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
      "
    >
      <div
        id="tvdbMismatchBox"
        @click.stop.prevent
        @pointerdown.stop.prevent
        style="
          background-color: white;
          border: 2px solid black;
          border-radius: 10px;
          padding: 18px 22px;
          max-width: 900px;
          width: calc(100% - 40px);
          max-height: 85vh;
          overflow: auto;
        "
      >
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 10px">
          TVDB cache mismatch detected
        </div>
        <pre
          style="
            margin: 0;
            font-size: 12px;
            white-space: pre-wrap;
            word-break: break-word;
          "
          >{{ tvdbMismatchText }}</pre
        >
        <div style="display: flex; justify-content: flex-end; margin-top: 12px">
          <button
            @click.stop.prevent="closeTvdbMismatch"
            @pointerdown.stop.prevent
            style="
              font-size: 13px;
              cursor: pointer;
              border-radius: 7px;
              padding: 4px 12px;
              border: 1px solid #bbb;
              background-color: whitesmoke;
            "
          >
            OK
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import List from "./list.vue";
import Info from "./info.vue";
import Map from "./map.vue";
import Actors from "./actors.vue";
import Reviews from "./reviews.vue";
import Buttons from "./buttons.vue";
import Browse from "./browse.vue";
import Tor from "./tor.vue";
import Flex from "./flex.vue";
import Qbt from "./qbt.vue";
import Down from "./down.vue";
import Usb from "./usb.vue";
import Local from "./local.vue";
import Trailer from "./trailer.vue";
import evtBus from "../evtBus.js";
import * as tvdb from "../tvdb.js";
import * as emby from "../emby.js";
import * as srvr from "../srvr.js";
import { config } from "../config.js";

// Hardwired split percentages for simple mode.
// These control the List pane size (and TabArea gets the rest minus divider).
// Values are percentages (e.g. 50 means 50%).
const SIMPLE_LANDSCAPE_SPLIT = 50;
const SIMPLE_PORTRAIT_SPLIT = 35;

export default {
  name: "App",
  components: {
    List,
    Info,
    Map,
    Actors,
    Reviews,
    Buttons,
    Browse,
    Tor,
    Flex,
    Qbt,
    Usb,
    Local,
    Down,
    Trailer,
  },
  data() {
    return {
      evtHandlers: {}, // Initialize evtHandlers
      // Must be known before first render so non-simple panes never mount in simple mode.
      simpleMode: new URLSearchParams(window.location.search).has("simple"),
      currentPane: "info", // 'info', 'map', 'actors', 'reviews', 'trailer', 'tor', 'flex', 'qbt', 'down'
      savedPane: null,
      restoringPreviewPane: false,
      previewMode: false,
      previewPanesLoading: false,
      previewAddBusy: false,
      previewSrchChoice: null,
      currentTvdbData: null,
      currentShow: null,
      _torrentsInitialized: false,
      _torrentsShowKey: null,
      _actorsInitialized: false,
      _actorsShowKey: null,
      _actorSearchParams: null, // Store actor search params for sorting
      mapShow: null,
      hideMapBottom: true,
      seriesMapSeasons: [],
      seriesMapEpis: [],
      seriesMap: {},
      mapError: "",
      allShows: [],
      allTvdb: {},
      _didRequestNotifications: false,

      // Library Refresh State
      _libBusy: false,
      _libTaskId: null,
      _libPollTimer: null,
      _diskChangeShowName: null,
      libraryProgressText: "",

      tvdbMismatchOpen: false,
      tvdbMismatchText: "",

      _downActiveQbt: false,
      _downActiveDown: false,
      _downActive: false,
      _downInactiveTimer: null,
      _qbtPollTimer: null,
      _qbtPolling: false,
      // TABLET SIZING CONFIGURATION - SIMPLE MODE - Tweak these values
      sizing: {
        // List pane
        listWidth: "730px", // narrower list pane

        // Series pane
        seriesWidth: "450px", // series pane width
        mapWidth: "450px", // map pane width
        posterWidth: "180px", // smaller poster
        posterHeight: "210px",
        seriesFontSize: "18px", // smaller title
        seriesInfoFontSize: "15px", // smaller info text
        seriesInfoWidth: "250px", // narrower info box
        infoBoxLineHeight: "1.8", // line spacing in info box (default: 1.2)
        remotesWidth: "210px", // narrower remotes area
        remoteButtonPadding: "6px", // smaller remote buttons
        remoteFontSize: "13px",
        watchButtonPadding: "8px 12px", // smaller watch buttons
        watchButtonFontSize: "13px",
        emailWidth: "170px", // narrower email box
        overviewFontSize: "16px", // overview text at bottom of series pane (default: 20px)

        // Buttons pane
        buttonHeight: "32px", // button height (text will be vertically centered)
        buttonFontSize: "15px",
        buttonMarginBottom: "6px",
        buttonTopMargin: "0px", // margin above top button
        buttonContainerPadding: "12px", // padding around entire button container (default: 5px with 0 bottom)
      },
      // TABLET SIZING CONFIGURATION - NON-SIMPLE MODE - Tweak these values
      sizingNonSimple: {
        // List pane
        listWidth: "900px",

        // Series pane
        seriesWidth: "450px",
        mapWidth: "450px",
        posterWidth: "180px",
        posterHeight: "210px",
        seriesFontSize: "18px",
        seriesInfoFontSize: "15px",
        seriesInfoWidth: "250px",
        infoBoxLineHeight: "1.8",
        remotesWidth: "210px",
        remoteButtonPadding: "6px",
        remoteFontSize: "13px",
        watchButtonPadding: "8px 12px",
        watchButtonFontSize: "13px",
        emailWidth: "170px",
        overviewFontSize: "16px",

        // Buttons pane (not used in non-simple mode)
        buttonHeight: "32px",
        buttonFontSize: "15px",
        buttonMarginBottom: "6px",
        buttonTopMargin: "0px",
        buttonContainerPadding: "12px",
      },

      // Drag-resize state for List vs right-side panes
      windowW: window.innerWidth,
      windowH: window.innerHeight,
      tabAreaWidthOverridePx: null,
      tabAreaHeightOverridePx: null,
      paneResizeActive: false,
      paneResizeAxis: "x",
      paneResizeStartX: 0,
      paneResizeStartY: 0,
      paneResizeStartTabW: 0,
      paneResizeStartTabH: 0,

      // Persisted split percentages (0..1). Stored separately for landscape vs portrait.
      splitTabWidthPct: null,
      splitTabHeightPct: null,
    };
  },
  computed: {
    isPortrait() {
      return Number(this.windowH) > Number(this.windowW);
    },

    showSideButtons() {
      return !!(this.simpleMode && this.isPortrait);
    },

    sideButtonsSizing() {
      const scalePx = (val, scale) => {
        if (typeof val !== "string") return val;
        const m = val.trim().match(/^([0-9]+(?:\.[0-9]+)?)px$/);
        if (!m) return val;
        const n = Math.round(Number(m[1]) * scale);
        return `${n}px`;
      };

      const scale = 0.75;
      const base = this.activeSizing || {};
      return {
        ...base,
        buttonHeight: scalePx(base.buttonHeight || "40px", scale),
        buttonFontSize: scalePx(base.buttonFontSize || "15px", scale),
        buttonMarginBottom: scalePx(base.buttonMarginBottom || "8px", scale),
        buttonTopMargin: scalePx(base.buttonTopMargin || "10px", scale),
        buttonContainerPadding: scalePx(
          base.buttonContainerPadding || "5px",
          scale,
        ),
      };
    },

    activeSizing() {
      const base = this.simpleMode ? this.sizing : this.sizingNonSimple;

      // List pane should flex; keep internal list content at 100% of its container.
      return { ...base, listWidth: "100%" };
    },

    tabAreaWidth() {
      if (
        typeof this.tabAreaWidthOverridePx === "number" &&
        Number.isFinite(this.tabAreaWidthOverridePx)
      ) {
        return `${Math.max(0, this.tabAreaWidthOverridePx)}px`;
      }
      const base = this.simpleMode ? this.sizing : this.sizingNonSimple;
      const toPx = (val) => {
        if (typeof val === "number" && Number.isFinite(val)) return val;
        if (typeof val !== "string") return null;
        const m = val.trim().match(/^([0-9]+(?:\.[0-9]+)?)px$/);
        return m ? Number(m[1]) : null;
      };

      const seriesPx = toPx(base?.seriesWidth);
      const mapPx = toPx(base?.mapWidth);

      // If both are explicit px values, keep the old behavior: use the larger,
      // so switching tabs doesn't change the outer width.
      if (seriesPx != null && mapPx != null) {
        const tabW = Math.max(seriesPx, mapPx) || 450;
        return `${tabW}px`;
      }

      // Otherwise allow "variable" CSS widths (vw, %, auto, calc, etc.).
      // Prefer an explicit series width first, then map.
      return base?.seriesWidth || base?.mapWidth || "450px";
    },

    tabAreaHeight() {
      if (
        typeof this.tabAreaHeightOverridePx === "number" &&
        Number.isFinite(this.tabAreaHeightOverridePx)
      ) {
        return `${Math.max(0, this.tabAreaHeightOverridePx)}px`;
      }
      // Default portrait split if no override: half the available height.
      return "50%";
    },

    tabAreaStyle() {
      if (this.isPortrait) {
        if (this.simpleMode) {
          const h = 100 - SIMPLE_PORTRAIT_SPLIT;
          return {
            width: "100%",
            height: `calc(${h}% - 2px)`,
            flex: "0 0 auto",
            minWidth: "0px",
            minHeight: "0px",
            display: "flex",
            flexDirection: "column",
            marginRight: "0px",
            order: 0,
            boxSizing: "border-box",
            paddingLeft: "0px",
          };
        }
        return {
          width: "100%",
          height: this.tabAreaHeight,
          flex: "0 0 auto",
          minWidth: "0px",
          minHeight: "0px",
          display: "flex",
          flexDirection: "column",
          marginRight: "0px",
          order: 0,
          boxSizing: "border-box",
          paddingLeft: this.simpleMode ? "0px" : "10px",
        };
      }
      if (this.simpleMode) {
        const w = 100 - SIMPLE_LANDSCAPE_SPLIT;
        return {
          width: `calc(${w}% - 2px)`,
          height: "100%",
          flex: "0 0 auto",
          minWidth: "0px",
          display: "flex",
          flexDirection: "column",
          marginRight: "0px",
          order: 2,
          boxSizing: "border-box",
          paddingLeft: "0px",
        };
      }
      return {
        width: this.tabAreaWidth,
        height: "100%",
        flex: "0 0 auto",
        minWidth: "0px",
        display: "flex",
        flexDirection: "column",
        marginRight: "10px",
        order: 2,
        boxSizing: "border-box",
        paddingLeft: this.simpleMode ? "0px" : "10px",
      };
    },

    listStyle() {
      if (this.isPortrait) {
        if (this.simpleMode) {
          return {
            height: `calc(${SIMPLE_PORTRAIT_SPLIT}% - 2px)`,
            width: "100%",
            flex: "0 0 auto",
            minHeight: "0px",
            order: 2,
          };
        }
        return { flex: "1 1 auto", minHeight: "0px", width: "100%", order: 2 };
      }
      if (this.simpleMode) {
        return {
          width: `calc(${SIMPLE_LANDSCAPE_SPLIT}% - 2px)`,
          flex: "0 0 auto",
          minWidth: "0px",
          order: 0,
        };
      }
      return { flex: "1 1 auto", minWidth: "0px", order: 0 };
    },

    paneDividerStyle() {
      if (this.isPortrait) {
        return {
          height: "4px",
          width: "100%",
          cursor: "row-resize",
          backgroundColor: "#ddd",
          flex: "0 0 auto",
          order: 1,
        };
      }
      return {
        width: "4px",
        cursor: "col-resize",
        backgroundColor: "#ddd",
        flex: "0 0 auto",
        order: 1,
      };
    },

    tabs() {
      const allTabs = [
        { label: "Info", key: "info" },
        { label: "Map", key: "map" },
        { label: "Actors", key: "actors" },
        { label: "Reviews", key: "reviews" },
        { label: "Trailer", key: "trailer" },
        { label: "Tor", key: "tor" },
        { label: "Browse", key: "browse" },
        { label: "Flex", key: "flex" },
        { label: "Qbt", key: "qbt" },
        { label: "Usb", key: "usb" },
        { label: "Down", key: "down" },
        { label: "Local", key: "local" },
      ];

      if (!this.simpleMode) return allTabs;
      const allowed = new Set(["info", "map", "actors", "reviews", "trailer"]);
      return allTabs.filter((t) => allowed.has(t.key));
    },

    isMapDisabledInPreview() {
      // Map is now enabled in preview mode (fetches from TVDB API)
      return false;
      // Legacy: Map used to be disabled in preview mode if there's no tvdb data to fetch from
      // if (!this.previewMode) return false;
      // if (!this.currentShow?.Name) return true;
      // const tvdbRecord = this.allTvdb?.[this.currentShow.Name];
      // Can fetch map if we have a tvdbId
      const canFetchMap = tvdbRecord?.tvdbId;
      return !canFetchMap;
    },
  },
  unmounted() {
    evtBus.off("downActivePart", this.handleDownActivePart);
    evtBus.off("tvdb-mismatch", this.handleTvdbMismatch);
    evtBus.off("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.off("addPreviewShowDone", this.onAddPreviewShowDone);
    evtBus.off("previewPanesLoading", this.onPreviewPanesLoading);
    if (this._onAppWindowResize)
      window.removeEventListener("resize", this._onAppWindowResize);
    this.stopQbtPolling();
    this.cancelDownInactiveTimer();
    this.stopLibraryPolling();
  },
  methods: {
    onPreviewPanesLoading(active) {
      this.previewPanesLoading = !!active;
    },
    onPreviewSrchChoice(srchChoice) {
      this.previewSrchChoice = srchChoice || null;
    },

    addShowFromPreview() {
      if (!this.previewSrchChoice) return;
      if (this.previewAddBusy) return;
      this.previewAddBusy = true;
      evtBus.emit("addPreviewShow", {
        srchChoice: this.previewSrchChoice,
        fromPreview: true,
      });
    },

    onAddPreviewShowDone() {
      this.previewAddBusy = false;
    },

    exitPreview() {
      evtBus.emit("exitPreviewMode");
    },

    async startLibraryRefresh() {
      if (this._libBusy) return;

      this.stopLibraryPolling();
      this.libraryProgressText = "";
      this._libTaskId = null;
      this._libBusy = true;

      let res = null;
      try {
        res = await emby.refreshLib();
      } catch (e) {
        this._libBusy = false;
        this.libraryProgressText = "error";
        return;
      }

      if (res?.status === "hasTask") {
        this._libTaskId = res.taskId;
        this.libraryProgressText = "Refreshing...";
        void this.pollLibraryStatus();
        return;
      }

      this._libBusy = false;
      if (res?.status && res.status !== "notask") {
        this.libraryProgressText = String(res.status);
      }
    },

    stopLibraryPolling() {
      if (this._libPollTimer) {
        clearTimeout(this._libPollTimer);
        this._libPollTimer = null;
      }
    },

    handleDiskChangeLibraryRefresh(payload) {
      if (!payload || !payload.taskId) return;
      if (this._libBusy) return;

      this.stopLibraryPolling();
      this._libTaskId = payload.taskId;
      this._diskChangeShowName = payload.showName || null;
      this._libBusy = true;
      this.libraryProgressText = "Scanning...";
      void this.pollLibraryStatus();
    },

    async pollLibraryStatus() {
      if (!this._libTaskId) {
        this._libBusy = false;
        return;
      }

      let res = null;
      try {
        res = await emby.taskStatus(this._libTaskId);
      } catch (e) {
        this._libBusy = false;
        this._libTaskId = null;
        this.libraryProgressText = "error";
        return;
      }
      if (res?.status === "refreshing") {
        if (Number.isFinite(Number(res?.progress))) {
          this.libraryProgressText = `${Number(res.progress).toFixed(0)}%`;
        } else if (res?.taskStatus) {
          this.libraryProgressText = String(res.taskStatus);
        } else {
          this.libraryProgressText = "Refreshing...";
        }

        this._libPollTimer = setTimeout(() => {
          void this.pollLibraryStatus();
        }, 2000);
        return;
      }

      this._libBusy = false;
      this._libTaskId = null;
      if (res?.status === "refreshdone") {
        this.libraryProgressText = "100%";
        if (this._diskChangeShowName) {
          evtBus.emit("library-refresh-complete", {
            diskChangeShowName: this._diskChangeShowName,
          });
          this._diskChangeShowName = null;
        } else {
          evtBus.emit("library-refresh-complete");
        }

        // Trigger full gap check after library scan completes
        srvr
          .triggerFullGapCheck()
          .catch((err) => console.error("triggerFullGapCheck failed:", err));

        // Debounce clearing to avoid flicker
        setTimeout(() => {
          if (this.libraryProgressText === "100%")
            this.libraryProgressText = "";
        }, 5000);
      } else if (res?.status) {
        this.libraryProgressText = String(res.status);
      }
    },

    handleTvdbMismatch(payload) {
      if (this.simpleMode) return;

      if (payload && typeof payload === "object") {
        const name = payload?.name != null ? String(payload.name) : "";
        const showId = payload?.showId != null ? String(payload.showId) : "";
        const tvdbId = payload?.tvdbId != null ? String(payload.tvdbId) : "";
        const existingShowId =
          payload?.existing?.showId != null
            ? String(payload.existing.showId)
            : "";
        const existingTvdbId =
          payload?.existing?.tvdbId != null
            ? String(payload.existing.tvdbId)
            : "";

        const lines = [];
        lines.push("What happened");
        lines.push(
          "- A cached TVDB entry exists for this show name, but it does not match the currently loaded Emby show.",
        );
        lines.push(
          "- The client will rebuild/update the cache entry via getNewTvdb().",
        );
        lines.push("");
        lines.push("Current show (from Emby)");
        lines.push(`- Show name key (show.Name): ${name}`);
        lines.push(`- Emby show Id (show.Id): ${showId}`);
        lines.push(`- TVDB series Id on show (show.TvdbId): ${tvdbId}`);
        lines.push("");
        lines.push(
          "Existing cached entry (from server TVDB cache: allTvdb[show.Name])",
        );
        lines.push(`- Cached showId (tvdb.showId): ${existingShowId}`);
        lines.push(`- Cached tvdbId (tvdb.tvdbId): ${existingTvdbId}`);
        lines.push("");
        lines.push("Raw details");
        try {
          lines.push(JSON.stringify(payload, null, 2));
        } catch {
          lines.push(String(payload));
        }

        this.tvdbMismatchText = lines.join("\n");
      } else {
        this.tvdbMismatchText = String(payload);
      }
      this.tvdbMismatchOpen = true;
    },

    closeTvdbMismatch() {
      this.tvdbMismatchOpen = false;
    },

    triggerShowReload() {
      evtBus.emit("library-refresh-complete", { showReloadDialog: true });
    },
    onSideButtonsClick(activeButtons) {
      evtBus.emit("simpleModeButtonsClick", activeButtons);
    },

    onSideButtonsTop() {
      evtBus.emit("simpleModeButtonsTop");
    },
    loadSplitPrefs() {
      const readNum = (key) => {
        try {
          const raw = window.localStorage.getItem(key);
          if (raw == null) return null;
          const n = Number(raw);
          return Number.isFinite(n) ? n : null;
        } catch {
          return null;
        }
      };

      const w = readNum("tv.split.tabWidthPct");
      const h = readNum("tv.split.tabHeightPct");
      this.splitTabWidthPct = w != null && w > 0 && w < 1 ? w : null;
      this.splitTabHeightPct = h != null && h > 0 && h < 1 ? h : null;
    },

    persistSplitPrefs() {
      const writeNum = (key, val) => {
        try {
          if (typeof val !== "number" || !Number.isFinite(val)) return;
          window.localStorage.setItem(key, String(val));
        } catch {
          // ignore
        }
      };

      writeNum("tv.split.tabWidthPct", this.splitTabWidthPct);
      writeNum("tv.split.tabHeightPct", this.splitTabHeightPct);
    },

    applySplitPrefsToOverrides() {
      // Convert stored percentages into px overrides for the current container size.
      const root = this.$el;
      if (!root) return;

      const baseW = root.clientWidth || window.innerWidth;
      const baseH = root.clientHeight || window.innerHeight;

      if (this.isPortrait) {
        if (
          typeof this.splitTabHeightPct === "number" &&
          Number.isFinite(this.splitTabHeightPct)
        ) {
          const desired = Math.round(this.splitTabHeightPct * baseH);
          const minTabH = 220;
          const maxTabH = Math.max(minTabH, Math.floor(baseH * 0.9));
          this.tabAreaHeightOverridePx = Math.max(
            minTabH,
            Math.min(maxTabH, desired),
          );
        }
        return;
      }

      if (
        typeof this.splitTabWidthPct === "number" &&
        Number.isFinite(this.splitTabWidthPct)
      ) {
        const desired = Math.round(this.splitTabWidthPct * baseW);
        const minTabW = 320;
        const maxTabW = Math.max(minTabW, Math.floor(baseW * 0.9));
        this.tabAreaWidthOverridePx = Math.max(
          minTabW,
          Math.min(maxTabW, desired),
        );
      }
    },

    updateSplitPrefsFromDom() {
      const root = this.$el;
      const tab = root?.querySelector?.("#tabArea");
      if (!root || !tab) return;

      const baseW = root.clientWidth || window.innerWidth;
      const baseH = root.clientHeight || window.innerHeight;
      const rect = tab.getBoundingClientRect?.();
      if (!rect) return;

      if (this.isPortrait) {
        if (!baseH) return;
        const pct = rect.height / baseH;
        if (Number.isFinite(pct) && pct > 0 && pct < 1) {
          this.splitTabHeightPct = pct;
        }
      } else {
        if (!baseW) return;
        const pct = rect.width / baseW;
        if (Number.isFinite(pct) && pct > 0 && pct < 1) {
          this.splitTabWidthPct = pct;
        }
      }

      this.persistSplitPrefs();
    },

    startPaneResize(e) {
      if (!e) return;
      const divider = e.currentTarget;
      const tab = this.$el?.querySelector?.("#tabArea");
      if (!divider || !tab) return;

      this.paneResizeActive = true;

      const rect = tab.getBoundingClientRect?.();
      if (this.isPortrait) {
        // Measure current rendered height so drag works even if height is %.
        const h = rect && Number.isFinite(rect.height) ? rect.height : null;
        if (!h) {
          this.paneResizeActive = false;
          return;
        }
        this.paneResizeAxis = "y";
        this.paneResizeStartY = Number(e.clientY) || 0;
        this.paneResizeStartTabH = h;
      } else {
        // Measure current rendered width so drag works even if width is vw/%.
        const w = rect && Number.isFinite(rect.width) ? rect.width : null;
        if (!w) {
          this.paneResizeActive = false;
          return;
        }
        this.paneResizeAxis = "x";
        this.paneResizeStartX = Number(e.clientX) || 0;
        this.paneResizeStartTabW = w;
      }

      try {
        if (
          typeof divider.setPointerCapture === "function" &&
          e.pointerId != null
        ) {
          divider.setPointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    },

    onPaneResizeMove(e) {
      if (!this.paneResizeActive) return;
      if (!e) return;

      if (this.paneResizeAxis === "y") {
        const dy =
          (Number(e.clientY) || 0) - (Number(this.paneResizeStartY) || 0);
        // Drag down => divider down => tab area taller.
        const next = (Number(this.paneResizeStartTabH) || 0) + dy;
        const minTabH = 220;
        const maxTabH = Math.max(minTabH, Math.floor(window.innerHeight * 0.9));
        const clamped = Math.max(minTabH, Math.min(maxTabH, next));
        this.tabAreaHeightOverridePx = Math.round(clamped);
        return;
      }

      const dx =
        (Number(e.clientX) || 0) - (Number(this.paneResizeStartX) || 0);
      // Drag right => divider right => tab area smaller.
      const next = (Number(this.paneResizeStartTabW) || 0) - dx;

      const minTabW = 320;
      const maxTabW = Math.max(minTabW, Math.floor(window.innerWidth * 0.9));
      const clamped = Math.max(minTabW, Math.min(maxTabW, next));
      this.tabAreaWidthOverridePx = Math.round(clamped);
    },

    stopPaneResize() {
      this.paneResizeActive = false;
      // Save final split as a percentage for future sessions.
      this.updateSplitPrefsFromDom();
    },

    cancelDownInactiveTimer() {
      if (this._downInactiveTimer) {
        clearTimeout(this._downInactiveTimer);
        this._downInactiveTimer = null;
      }
    },

    requestSpaceAvailRefresh(reason = "") {
      if (this.simpleMode) return;
      evtBus.emit("refreshSpaceAvail", { reason: String(reason || "") });
    },

    recomputeDownActive() {
      const prev = !!this._downActive;
      const next = !!(this._downActiveQbt || this._downActiveDown);
      if (prev === next) return;
      this._downActive = next;

      if (next) {
        // Downloads became active again; cancel any pending restart.
        this.cancelDownInactiveTimer();
        return;
      }

      // Falling edge: true -> false. Restart only after 60s of sustained inactivity.
      this.cancelDownInactiveTimer();
      this._downInactiveTimer = setTimeout(() => {
        this._downInactiveTimer = null;
        if (this._downActiveQbt || this._downActiveDown) return;
        this.requestSpaceAvailRefresh("downActive idle 60s");
      }, 60000);
    },

    handleDownActivePart(payload) {
      const src = payload?.source;
      const active = !!payload?.active;
      if (src === "down") {
        this._downActiveDown = active;
        this.recomputeDownActive();
      }
    },

    async pollQbtActiveOnce() {
      try {
        const url = new URL(`${config.torrentsApiUrl}/api/qbt/info`);
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const torrents = await res.json();
        if (!Array.isArray(torrents)) return;

        const active = torrents.some((t) => {
          const st = String(t?.state || "")
            .trim()
            .toLowerCase();
          return st === "downloading";
        });

        if (active !== this._downActiveQbt) {
          this._downActiveQbt = active;
          this.recomputeDownActive();
        }
      } catch {
        // ignore
      }
    },

    scheduleNextQbtPoll(delayMs) {
      if (!this._qbtPolling) return;
      if (this._qbtPollTimer) {
        clearTimeout(this._qbtPollTimer);
        this._qbtPollTimer = null;
      }
      this._qbtPollTimer = setTimeout(
        async () => {
          if (!this._qbtPolling) return;
          await this.pollQbtActiveOnce();
          this.scheduleNextQbtPoll(5000);
        },
        Math.max(0, Number(delayMs) || 0),
      );
    },

    startQbtPolling() {
      if (this._qbtPolling || this.simpleMode) return;
      this._qbtPolling = true;
      this.scheduleNextQbtPoll(0);
    },

    stopQbtPolling() {
      this._qbtPolling = false;
      if (this._qbtPollTimer) {
        clearTimeout(this._qbtPollTimer);
        this._qbtPollTimer = null;
      }
    },
    requestNotificationsOnce() {
      try {
        if (this._didRequestNotifications) return;
        this._didRequestNotifications = true;
        if (typeof window === "undefined") return;
        if (!("Notification" in window)) return;
        if (Notification.permission !== "default") return;
        // Must be triggered by a user gesture (e.g., this tab click) to prompt in Firefox.
        void Notification.requestPermission();
      } catch {
        // ignore
      }
    },
    handleAllShows(shows) {
      this.allShows = Array.isArray(shows) ? shows : [];
    },
    handleAllTvdb(tvdbData) {
      this.allTvdb = tvdbData || {};
    },
    selectTab(key) {
      const k = String(key || "");
      if (!k) return;

      // Preview mode: Map is now enabled, but tabs to the right of AI are disabled.
      if (this.previewMode) {
        const disabledKeys = new Set([
          "tor",
          "flex",
          "qbt",
          "usb",
          "down",
          "local",
        ]);
        if (disabledKeys.has(k)) {
          return;
        }
      }

      // In simple mode, only Series/Map/Actors exist.
      if (
        this.simpleMode &&
        !["info", "map", "actors", "reviews", "trailer"].includes(k)
      ) {
        return;
      }

      if (k === "info") {
        this.handleActorsClose();
        return;
      }

      if (k === "map") {
        this.currentPane = "map";
        evtBus.emit("paneChanged", this.currentPane);
        if (this.currentShow) {
          evtBus.emit("mapAction", { action: "open", show: this.currentShow });
        }
        return;
      }

      if (k === "actors") {
        this.handleShowActors(false);
        return;
      }

      if (k === "reviews") {
        this.currentPane = "reviews";
        evtBus.emit("paneChanged", this.currentPane);
        return;
      }

      if (k === "trailer") {
        this.currentPane = "trailer";
        evtBus.emit("paneChanged", this.currentPane);
        return;
      }

      if (k === "browse") {
        if (this.simpleMode) return;
        this.currentPane = "browse";
        evtBus.emit("paneChanged", this.currentPane);
        evtBus.emit("browseTabClicked");
        return;
      }

      if (k === "tor") {
        if (this.currentShow) this.handleShowTor(this.currentShow);
        else {
          this.currentPane = "tor";
          evtBus.emit("paneChanged", this.currentPane);
        }
        return;
      }

      if (k === "flex") {
        if (this.simpleMode) return;
        this.currentPane = "flex";
        evtBus.emit("paneChanged", this.currentPane);
        return;
      }

      if (k === "qbt") {
        this.handleShowQbt();
        return;
      }

      if (k === "usb") {
        if (this.simpleMode) return;
        this.currentPane = "usb";
        evtBus.emit("paneChanged", this.currentPane);
        return;
      }

      if (k === "local") {
        if (this.simpleMode) return;
        this.currentPane = "local";
        evtBus.emit("paneChanged", this.currentPane);
        return;
      }

      if (k === "down") {
        // Prompt for desktop notification permission (Firefox requires user gesture).
        this.requestNotificationsOnce();
        this.handleShowTvproc();
        return;
      }
    },
    handleShowMap(data) {
      this.mapShow = data.mapShow;
      this.hideMapBottom = data.hideMapBottom;
      this.seriesMapSeasons = data.seriesMapSeasons;
      this.seriesMapEpis = data.seriesMapEpis;
      this.seriesMap = data.seriesMap;
      this.mapError = data.mapError || "";

      // Let Series pane derive counts from the same map it shows.
      if (this.mapShow) {
        evtBus.emit("seriesMapUpdated", {
          show: this.mapShow,
          seriesMap: this.seriesMap,
        });
      }

      // Only switch to map pane if noSwitch flag is not set
      if (!data.noSwitch) {
        this.currentPane = data.mapShow !== null ? "map" : "info";
        evtBus.emit("paneChanged", this.currentPane);
      }
    },
    handleHideMap() {
      this.currentPane = "info";
      this.mapShow = null;
      evtBus.emit("paneChanged", this.currentPane);
    },
    handleLocalSelectShow(showName) {
      if (!showName) return;
      evtBus.emit("selectShowFromCardTitle", showName);
    },

    handleShowActors(fromMap = false) {
      // If called from map click, show series pane instead
      if (fromMap) {
        this.currentPane = "info";
        this.mapShow = null;
        evtBus.emit("paneChanged", this.currentPane);
        evtBus.emit("mapAction", { action: "close", show: null });
      } else {
        const showKey = this.currentShow?.Id || this.currentShow?.Name || null;
        // Switching panes should not reset actors; only reset when show selection changes.
        if (
          this._actorsInitialized &&
          this._actorsShowKey &&
          showKey &&
          this._actorsShowKey === showKey
        ) {
          this.currentPane = "actors";
          evtBus.emit("paneChanged", this.currentPane);
          return;
        }

        this.currentPane = "actors";
        evtBus.emit("paneChanged", this.currentPane);
        // Emit event to actors component with current tvdbData and show
        evtBus.emit("showActors", {
          show: this.currentShow,
          tvdbData: this.currentTvdbData,
          actorSearchParams: this._actorSearchParams,
        });
        this._actorsInitialized = true;
        this._actorsShowKey = showKey;
      }
    },
    handleActorsClose() {
      this.currentPane = "info";
      this.mapShow = null;
      evtBus.emit("paneChanged", this.currentPane);
      // Clear mapShow in list component via event
      evtBus.emit("mapAction", { action: "close", show: null });
    },
    handleShowTor(show) {
      if (this.simpleMode) return;
      const showKey = show?.Id || show?.Name || null;

      // Switching panes should not restart searching; only restart when show selection changes.
      if (
        this._torrentsInitialized &&
        this._torrentsShowKey &&
        showKey &&
        this._torrentsShowKey === showKey
      ) {
        this.currentPane = "tor";
        evtBus.emit("paneChanged", this.currentPane);
        return;
      }

      this.currentPane = "tor";
      evtBus.emit("paneChanged", this.currentPane);
      // Emit event to torrents component with show data
      evtBus.emit("showTorrents", show);
      this._torrentsInitialized = true;
      this._torrentsShowKey = showKey;
    },

    handleShowQbt() {
      if (this.simpleMode) return;
      this.currentPane = "qbt";
      evtBus.emit("paneChanged", this.currentPane);
    },

    handleShowTvproc() {
      if (this.simpleMode) return;
      this.currentPane = "down";
      evtBus.emit("paneChanged", this.currentPane);
    },

    handleHistoryToTor() {
      // Do not reload/emit showTorrents when just switching panes.
      if (this._torrentsInitialized) {
        this.currentPane = "tor";
        evtBus.emit("paneChanged", this.currentPane);
        return;
      }

      // Fallback: if torrents was never initialized, open it with current show.
      if (this.currentShow) {
        this.handleShowTor(this.currentShow);
      } else {
        this.currentPane = "tor";
        evtBus.emit("paneChanged", this.currentPane);
      }
    },

    handleHistoryToInfo() {
      this.currentPane = "info";
      this.mapShow = null;
      evtBus.emit("paneChanged", this.currentPane);
      evtBus.emit("mapAction", { action: "close", show: null });
    },

    handleHistoryToMap() {
      if (this.currentShow) {
        evtBus.emit("mapAction", { action: "open", show: this.currentShow });
      }
    },

    handleTvprocToTor() {
      if (this._torrentsInitialized) {
        this.currentPane = "tor";
        evtBus.emit("paneChanged", this.currentPane);
        return;
      }

      if (this.currentShow) {
        this.handleShowTor(this.currentShow);
      } else {
        this.currentPane = "tor";
        evtBus.emit("paneChanged", this.currentPane);
      }
    },

    handleTvprocToQbt() {
      this.currentPane = "qbt";
      evtBus.emit("paneChanged", this.currentPane);
    },

    handleTvprocToInfo() {
      this.currentPane = "info";
      this.mapShow = null;
      evtBus.emit("paneChanged", this.currentPane);
      evtBus.emit("mapAction", { action: "close", show: null });
    },

    handleTvprocToMap() {
      if (this.currentShow) {
        evtBus.emit("mapAction", { action: "open", show: this.currentShow });
      }
    },
    handleTorrentsClose() {
      this.currentPane = "info";
      this.mapShow = null;
      evtBus.emit("paneChanged", this.currentPane);
      // Clear mapShow in list component via event
      evtBus.emit("mapAction", { action: "close", show: null });
    },
    handleMapAction(action, show) {
      if (action === "close") {
        this.handleHideMap();
      }
      evtBus.emit("mapAction", { action, show });
    },
    handleEpisodeClick(e, show, season, episode, setWatched = null) {
      evtBus.emit("episodeClick", { e, show, season, episode, setWatched });
    },
    handleSeasonDelete(e, show, season) {
      evtBus.emit("seasonDelete", { e, show, season });
    },
  },
  mounted() {
    this._onAppWindowResize = () => {
      this.windowW = window.innerWidth;
      this.windowH = window.innerHeight;
      // Keep px overrides in sync with stored percentages.
      if (!this.paneResizeActive) {
        this.applySplitPrefsToOverrides();
      }
    };
    window.addEventListener("resize", this._onAppWindowResize);
    this._onAppWindowResize();

    this.loadSplitPrefs();
    this.$nextTick(() => {
      this.applySplitPrefsToOverrides();
    });

    // Derive downActive and schedule deferred Tor restarts.
    evtBus.on("downActivePart", this.handleDownActivePart);
    evtBus.on("tvdb-mismatch", this.handleTvdbMismatch);
    this.startQbtPolling();

    // Refresh space display once on app load.
    this.requestSpaceAvailRefresh("app load");

    if (
      this.simpleMode &&
      !["info", "map", "actors"].includes(this.currentPane)
    ) {
      this.currentPane = "info";
    }

    // Listen for pane navigation events
    evtBus.on("showActorsPane", () => {
      this.handleShowActors(false);
    });

    evtBus.on("showActorsPaneWithEpisode", (episodeInfo) => {
      this.handleShowActors(false);
      // Emit event to actors pane with episode info
      evtBus.emit("fillAndSelectEpisode", episodeInfo);
    });

    evtBus.on("showTorrentsPane", (show) => {
      this.handleShowTor(show);
    });

    // Map navigation is centralized through list.vue via mapAction('open')

    evtBus.on("showSeriesPane", () => {
      this.handleActorsClose();
    });

    // Preview mode: driven by ctrl-click in the web search dropdown.
    evtBus.on("previewMode", (active) => {
      this.previewMode = !!active;
      if (!this.previewMode) {
        this.previewSrchChoice = null;
        this.previewAddBusy = false;
        this.previewPanesLoading = false;
        if (this.savedPane) {
          this.currentPane = this.savedPane;
          this.savedPane = null;
          this.restoringPreviewPane = true;
          // Prevent setUpSeries from resetting pane to 'info' when list.vue triggers it shortly
          setTimeout(() => {
            this.restoringPreviewPane = false;
          }, 500);
          evtBus.emit("paneChanged", this.currentPane);

          if (this.currentShow) {
            evtBus.emit("setUpSeries", this.currentShow);
          }
        }
      }
      if (this.previewMode) {
        this.savedPane = this.currentPane;
        // If currently on a disabled pane, snap back to Series.
        const allowed = new Set([
          "info",
          "actors",
          "reviews",
          "trailer",
          "browse",
        ]);
        if (!allowed.has(this.currentPane)) {
          this.currentPane = "info";
          evtBus.emit("paneChanged", this.currentPane);
        }
      }
    });

    evtBus.on("previewPanesLoading", this.onPreviewPanesLoading);

    evtBus.on("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.on("addPreviewShowDone", this.onAddPreviewShowDone);

    evtBus.on("startLibraryRefresh", this.startLibraryRefresh);
    evtBus.on("diskChangeLibraryRefresh", this.handleDiskChangeLibraryRefresh);

    // Close torrents or actors pane when a different show is selected
    evtBus.on("setUpSeries", (show) => {
      // Keep currentShow synced to the list selection immediately.
      // tvdbDataReady may arrive later; that's fine.
      this.currentShow = show;

      // If currently on Map, do not force-switch panes.
      // list.vue will separately update the map content.
      if (this.currentPane === "map") {
        return;
      }

      const prevPane = this.currentPane;

      // Check if actor search is active - if so, keep actors pane visible
      const actorSearchActive = !!this._actorSearchParams;

      // New show selection should reset Actors state (unless in actor search mode)
      if (!actorSearchActive) {
        evtBus.emit("resetActorsPane");
        this._actorsInitialized = false;
        this._actorsShowKey = null;
      }

      // Clear stale TVDB data until the series pane publishes the new show data.
      this.currentTvdbData = null;

      // New show selection should allow torrents pane to reinitialize.
      this._torrentsInitialized = false;
      this._torrentsShowKey = null;

      // When currently viewing Local, stay on Local.
      // When in actor search mode and on actors pane, stay on Actors.
      const keepContentPanes = new Set([
        "local",
        "usb",
        "qbt",
        "down",
        "tor",
        "reviews",
        "trailer",
        "actors",
      ]);
      if (keepContentPanes.has(prevPane)) {
        return;
      }

      // If in actor search mode, switch to actors pane instead of info
      if (actorSearchActive) {
        this.currentPane = "actors";
        evtBus.emit("paneChanged", this.currentPane);

        // Immediately show actors with search params for the new show
        // This ensures matching actors are sorted to the top right away
        const showKey = this.currentShow?.Id || this.currentShow?.Name || null;
        evtBus.emit("showActors", {
          show: this.currentShow,
          tvdbData: this.currentTvdbData,
          actorSearchParams: this._actorSearchParams,
        });
        this._actorsInitialized = true;
        this._actorsShowKey = showKey;
        return;
      }

      // If we are just restoring the previous pane after preview mode,
      // do not fallback to 'info' pane.
      if (this.restoringPreviewPane) {
        return;
      }

      // Otherwise, return to the Series pane.
      this.currentPane = "info";
      this.mapShow = null;
      evtBus.emit("paneChanged", this.currentPane);
    });

    // Store actor search params from list component
    evtBus.on("actorSearchActive", (searchParams) => {
      this._actorSearchParams = searchParams;
    });

    evtBus.on("actorSearchCleared", () => {
      this._actorSearchParams = null;
    });

    // Listen for tvdbData updates from series pane
    evtBus.on("tvdbDataReady", (data) => {
      const incomingShow = data?.show || null;
      const incomingId =
        incomingShow?.Id != null ? String(incomingShow.Id) : "";
      const incomingName =
        incomingShow?.Name != null ? String(incomingShow.Name) : "";

      const currentId =
        this.currentShow?.Id != null ? String(this.currentShow.Id) : "";
      const currentName =
        this.currentShow?.Name != null ? String(this.currentShow.Name) : "";

      // Ignore late/stale tvdbDataReady events for a previously selected show.
      // setUpSeries is the source of truth for current selection.
      if (this.currentShow && incomingShow) {
        const sameId = incomingId && currentId && incomingId === currentId;
        const sameName =
          !incomingId &&
          !currentId &&
          incomingName &&
          currentName &&
          incomingName === currentName;
        if (!sameId && !sameName) return;
      }

      // Keep currentShow as-is (already set by setUpSeries). Only update TVDB data.
      this.currentTvdbData = data?.tvdbData ?? null;

      // If Actors pane is currently showing, refresh it with the newly loaded tvdbData.
      if (this.currentPane === "actors") {
        const showKey = this.currentShow?.Id || this.currentShow?.Name || null;
        evtBus.emit("showActors", {
          show: this.currentShow,
          tvdbData: this.currentTvdbData,
          actorSearchParams: this._actorSearchParams,
        });
        this._actorsInitialized = true;
        this._actorsShowKey = showKey;
      }
    });
  },
};
</script>

<style>
html,
body {
  width: 100%;
  height: 97dvh;
  margin: 0;
  padding: 0;
}

/* Force black text only in the right-side panes */
#info,
#info *,
#map,
#map *,
#actors,
#actors *,
#reviews,
#reviews *,
#tor,
#tor *,
#qbt,
#qbt *,
#down,
#down * {
  color: #000 !important;
}

/* Force light-gray button backgrounds only in the right-side panes */
#info button,
#map button,
#actors button,
#reviews button,
#tor button,
.torrents-container button,
#qbt button,
#down button {
  background-color: var(--btn-bg, whitesmoke) !important;
}

.pane-header-title {
  color: #000;
  font-weight: bold;
  font-size: v-bind('activeSizing.seriesFontSize || "25px"');
}
</style>
