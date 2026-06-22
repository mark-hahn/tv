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
          style="
            display: flex;
            flex-direction: column;
            border-bottom: 1px solid #ddd;
            background-color: #fafafa;
            flex: 0 0 auto;
          "
        >
          <!-- Top row: always visible in simple and non-simple modes -->
          <div
            id="tabBarTop"
            :style="{
              display: 'flex',
              gap: simpleMode ? '30px' : '0px',
              padding: simpleMode ? '6px 8px' : '6px 0px',
              alignItems: 'center',
            }"
          >
            <button
              v-for="t in topTabs"
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
                  t.key === 'map' && isMapDisabledInPreview
                    ? '#999'
                    : 'inherit',
                opacity: t.key === 'map' && isMapDisabledInPreview ? 0.6 : 1,
              }"
            >
              {{ t.label }}
            </button>
            <!-- Preview controls: in top row -->
            <template v-if="previewMode">
              <button
                @click.stop="addShowFromPreview"
                :disabled="previewAddBusy || !previewSrchChoice"
                :style="{
                  fontSize: '13px',
                  cursor:
                    previewAddBusy || !previewSrchChoice
                      ? 'default'
                      : 'pointer',
                  borderRadius: '7px',
                  padding: '4px 10px',
                  marginTop: '4px',
                  marginLeft: '20px',
                  border: '1px solid #bbb',
                  backgroundColor:
                    previewAddBusy || !previewSrchChoice
                      ? '#eee'
                      : 'whitesmoke',
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
          </div>
          <!-- Bottom row: non-simple mode only -->
          <div
            v-if="!simpleMode"
            id="tabBarBot"
            style="display: flex; padding: 0 0 6px 0; align-items: center"
          >
            <button
              v-for="t in bottomTabs"
              :key="t.key"
              @click.stop="selectTab(t.key)"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                marginLeft: '4px',
                border: '1px solid #bbb',
                backgroundColor:
                  t.key === 'browse' && browseTabHasMore
                    ? '#90ee90'
                    : currentPane === t.key
                      ? '#ddd'
                      : 'whitesmoke',
              }"
            >
              {{ t.label }}
            </button>
            <button
              v-if="chksrtCount > 0"
              @click.stop="clickChksrt"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                marginLeft: '4px',
                border: '1px solid #c88',
                backgroundColor: '#faa',
                color: 'black',
              }"
            >
              Chksrt {{ chksrtCount }}
            </button>
            <button
              v-if="introCount > 0"
              @click.stop="clickIntro"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                marginLeft: '4px',
                border: '1px solid #c88',
                backgroundColor: '#faa',
                color: 'black',
              }"
            >
              Intro {{ introCount }}
            </button>
            <div style="flex: 1"></div>
            <button
              @click.stop="movieMode = !movieMode"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px 10px',
                marginLeft: '4px',
                marginRight: '6px',
                border: '1px solid #bbb',
                backgroundColor: movieMode ? 'lightgray' : 'whitesmoke',
              }"
            >
              {{ movieMode ? "Exit Movie" : "Movie" }}
            </button>
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
            style="display: flex; width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :hideButtonsPane="showSideButtons"
            @play-episode="handlePlayEpisode"
            @open-intro="handleOpenIntro"
          ></Info>
          <Map
            ref="mapComp"
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
            @episode-click="handleEpisodeClick"
            @delete-episodes="handleDeleteEpisodes"
            @play-episode="handlePlayEpisode"
            @season-watched="handleSeasonWatched"
            @season-delete="handleSeasonDelete"
            @open-intro="handleOpenIntro"
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
            v-show="!simpleMode && currentPane === 'browse'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :allShows="allShows"
            :active="currentPane === 'browse'"
          >
          </Browse>
          <Tor
            v-show="!simpleMode && currentPane === 'tor'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :activeShow="currentShow"
            :previewMode="previewMode"
            :movieMode="movieMode"
            :active="currentPane === 'tor'"
          ></Tor>
          <Flex
            v-show="!simpleMode && currentPane === 'flex'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :show="currentShow"
          ></Flex>
          <Qbt
            v-show="!simpleMode && currentPane === 'qbt'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :show="currentShow"
            :movieMode="movieMode"
          ></Qbt>
          <Local
            v-show="!simpleMode && currentPane === 'local'"
            style="width: 100%; height: 100%"
            :active="currentPane === 'local'"
            :show="currentShow"
            :allShows="allShows"
            :movieMode="movieMode"
            @select-show="handleLocalSelectShow"
          ></Local>
          <Usb
            v-show="!simpleMode && currentPane === 'usb'"
            style="width: 100%; height: 100%"
            :active="currentPane === 'usb'"
            :show="currentShow"
            :allShows="allShows"
            :movieMode="movieMode"
          ></Usb>
          <Down
            v-show="!simpleMode && currentPane === 'down'"
            style="width: 100%; height: 100%"
            :simpleMode="simpleMode"
            :sizing="activeSizing"
            :show="currentShow"
            :movieMode="movieMode"
          ></Down>
          <TvPane
            v-show="currentPane === 'remote'"
            style="width: 100%; height: 100%"
          ></TvPane>
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
        :libraryProgressText="libraryProgressText"
        @show-map="handleShowMap"
        @show-tor="handleShowTor"
        @all-shows="handleAllShows"
        @filtered-shows="handleFilteredShows"
        @all-tvdb="handleAllTvdb"
      >
      </List>
    </div>
    <VideoPlayer
      :path="videoPlayerPath"
      :mode="videoPlayerMode"
      :chksrtCount="chksrtCount"
      :introCount="introCount"
      :introShow="videoPlayerIntroShow"
      :introShows="filteredShows"
      :introSeason="videoPlayerMapSeason"
      :introEpisode="videoPlayerMapEpisode"
      :introSource="videoPlayerSource"
      @close="handleVideoPlayerClose"
      @chksrt-next="handleChksrtNext"
      @chksrt-sel="handleChksrtSel"
      @intro-next="handleIntroNext"
    />
    <!-- Help dialog -->
    <div
      v-if="helpDialogOpen"
      @click.stop.prevent="helpDialogOpen = false"
      @pointerdown.stop
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
        style="
          background-color: white;
          border: 2px solid black;
          border-radius: 10px;
          padding: 18px 22px;
          max-width: 500px;
          width: calc(100% - 40px);
          max-height: 85vh;
          overflow: auto;
        "
      >
        <div
          v-html="paneHelpHtml"
          style="
            margin: 0;
            font-family: Arial, sans-serif;
            font-size: 15px;
            font-weight: 400;
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.7;
          "
        ></div>
      </div>
    </div>
    <!-- Missing episode warning modal -->
    <div
      v-if="missingEpWarning"
      @click.stop.prevent
      @pointerdown.stop
      style="
        position: fixed;
        inset: 0;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: 3000;
        display: flex;
        align-items: center;
        justify-content: center;
      "
    >
      <div
        @click.stop.prevent
        @pointerdown.stop
        style="
          background-color: #ffcccc;
          border: 2px solid #cc0000;
          border-radius: 10px;
          padding: 24px 28px;
          max-width: 480px;
          width: calc(100% - 40px);
          font-size: 16px;
          font-weight: bold;
        "
      >
        <div style="margin-bottom: 12px">
          There is an unwatched episode before this one
        </div>
        <div style="margin-bottom: 6px">
          Show: {{ missingEpWarning.showName }}
        </div>
        <div style="margin-bottom: 6px">
          Unwatched: S{{
            String(missingEpWarning.missingSeason).padStart(2, "0")
          }}E{{ String(missingEpWarning.missingEpisode).padStart(2, "0") }}
        </div>
        <div style="margin-bottom: 6px">
          Currently playing: S{{
            String(missingEpWarning.currentSeason).padStart(2, "0")
          }}E{{ String(missingEpWarning.currentEpisode).padStart(2, "0") }}
        </div>
        <div style="margin-bottom: 16px">
          Device: {{ missingEpWarning.device }}
        </div>
        <button
          @click.stop.prevent="missingEpWarning = null"
          @pointerdown.stop.prevent
          style="
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            border-radius: 7px;
            padding: 6px 18px;
            border: 1px solid #cc0000;
            background-color: whitesmoke;
          "
        >
          Close
        </button>
      </div>
    </div>
    <!-- TVDB mismatch detail modal (OK-only)-->
    <div
      id="tvdbMismatchModal"
      v-if="tvdbMismatchOpen"
      @click.stop.prevent
      @pointerdown.stop
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
        @pointerdown.stop
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
          {{ tvdbMismatchTitle }}
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
import VideoPlayer from "./video-player.vue";
import Tor from "./tor.vue";
import Flex from "./flex.vue";
import Qbt from "./qbt.vue";
import Down from "./down.vue";
import Usb from "./usb.vue";
import Local from "./local.vue";
import Trailer from "./trailer.vue";
import TvPane from "./tvpane.vue";
import evtBus from "../evtBus.js";
import * as tvdb from "../tvdb.js";
import * as emby from "../emby.js";
import * as srvr from "../srvr.js";
import { config } from "../config.js";
import paneHelp from "../paneHelp.js";
import * as urls from "../urls.js";
import * as util from "../util.js";

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
    TvPane,
    VideoPlayer,
  },
  data() {
    return {
      evtHandlers: {}, // Initialize evtHandlers
      // Must be known before first render so non-simple panes never mount in simple mode.
      simpleMode: new URLSearchParams(window.location.search).has("simple"),
      videoPlayerPath: null,
      videoPlayerMode: null,
      videoPlayerIntroShow: null,
      videoPlayerSource: null,
      videoPlayerMapSeason: null,
      videoPlayerMapEpisode: null,
      chksrtCount: 0,
      introCount: 0,
      browseTabHasMore: false,
      currentPane: "info", // 'info', 'map', 'actors', 'reviews', 'trailer', 'tor', 'flex', 'qbt', 'down'
      movieMode: false,
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
      filteredShows: [],
      allTvdb: {},
      _didRequestNotifications: false,

      // Library Refresh State — progress driven by libraryProgress/libraryRefreshDone WS events
      libraryProgressText: "",

      tvdbMismatchOpen: false,
      tvdbMismatchTitle: "TVDB cache mismatch detected",
      tvdbMismatchText: "",

      missingEpWarning: null,

      helpDialogOpen: false,

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

    topTabs() {
      return [
        { label: "Info", key: "info" },
        { label: "Map", key: "map" },
        { label: "Actors", key: "actors" },
        { label: "Reviews", key: "reviews" },
        { label: "Trailer", key: "trailer" },
        { label: "Remote", key: "remote" },
      ];
    },

    bottomTabs() {
      return [
        { label: "Tor", key: "tor" },
        { label: "Browse", key: "browse" },
        { label: "Flex", key: "flex" },
        { label: "Qbt", key: "qbt" },
        { label: "Down", key: "down" },
        { label: "Usb", key: "usb" },
        { label: "Local", key: "local" },
      ];
    },

    isMapDisabledInPreview() {
      // Map is now enabled in preview mode (fetches from TVDB API)
      return false;
    },

    paneHelpHtml() {
      const raw = (paneHelp[this.currentPane] || "").trim();
      const escaped = raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return escaped.replace(
        /\*([^*]+)\*/g,
        '<b style="font-weight:700">$1</b>',
      );
    },
  },
  unmounted() {
    evtBus.off("downActivePart", this.handleDownActivePart);
    evtBus.off("tvdb-mismatch", this.handleTvdbMismatch);
    if (this._onMissingEpWarning)
      evtBus.off("missingEpisodeWarning", this._onMissingEpWarning);
    evtBus.off("playEpisodePath", this._onPlayEpisodePath);
    evtBus.off("playSimplePath", this._onPlaySimplePath);
    evtBus.off("openChksrt", this._onOpenChksrt);
    evtBus.off("chksrt-count", this._onChksrtCount);
    if (this._onIntroCount) evtBus.off("intro-count", this._onIntroCount);
    if (this._onBrowseHasMoreChanged)
      evtBus.off("browseHasMoreChanged", this._onBrowseHasMoreChanged);
    evtBus.off("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.off("addPreviewShowDone", this.onAddPreviewShowDone);
    evtBus.off("previewPanesLoading", this.onPreviewPanesLoading);
    evtBus.off("setLibraryProgress", this.handleSetLibraryProgress);
    evtBus.off("libraryProgress", this.handleLibraryProgress);
    evtBus.off("libraryRefreshDone", this.handleLibraryRefreshDone);
    evtBus.off("selectMapEpisode");
    if (this._onAppWindowResize)
      window.removeEventListener("resize", this._onAppWindowResize);
    if (this._onDelKey) window.removeEventListener("keydown", this._onDelKey);
    this.stopQbtPolling();
    this.cancelDownInactiveTimer();
    this.stopChksrtPolling();
    this.stopBrowseTabPolling();
  },
  methods: {
    handleVideoPlayerClose() {
      const closingIntro = this.videoPlayerMode === "intro";
      const introShow = this.videoPlayerIntroShow;
      this.videoPlayerPath = null;
      this.videoPlayerMode = null;
      this.videoPlayerIntroShow = null;
      this.videoPlayerSource = null;
      this.videoPlayerMapSeason = null;
      this.videoPlayerMapEpisode = null;
      evtBus.emit("introPaneClosed");
      this.fetchChksrtCount();
      if (closingIntro && introShow) {
        const configured =
          introShow.trimPos != null || introShow.skipDur != null;
        if (configured) {
          introShow.needsIntro = false;
        } else {
          const hasFiles =
            Array.isArray(introShow.filesOnDisk) &&
            introShow.filesOnDisk.length > 0;
          const hasUnwatched =
            Number(introShow.episodeCount ?? 0) >
            Number(introShow.watchedCount ?? 0);
          introShow.needsIntro = !!(
            introShow.inEmby &&
            !introShow.inLinda &&
            hasFiles &&
            hasUnwatched
          );
        }
        this.introCount = this.allShows.filter((s) => s.needsIntro).length;
      }
    },
    async handleChksrtNext() {
      try {
        const list = await srvr.getChksrtList();
        this.chksrtCount = list?.count ?? 0;
        if (list?.path) {
          this.videoPlayerMode = "chksrt";
          this.videoPlayerPath = list.path;
        } else {
          this.videoPlayerPath = null;
          this.videoPlayerMode = null;
        }
      } catch (e) {
        this.videoPlayerPath = null;
        this.videoPlayerMode = null;
        this.fetchChksrtCount();
      }
    },
    handleChksrtSel(path) {
      this.videoPlayerPath = null;
      this.videoPlayerMode = null;
      if (!path) return;
      const TV_DIR = "/mnt/media/tv/";
      const showName = path.startsWith(TV_DIR)
        ? path.slice(TV_DIR.length).split("/")[0]
        : null;
      if (showName) {
        evtBus.emit("selectShowFromCardTitle", showName);
      }
    },
    async fetchChksrtCount() {
      try {
        const list = await srvr.getChksrtList();
        this.chksrtCount = list?.count ?? 0;
      } catch (e) {
        this.chksrtCount = 0;
      }
    },
    fetchBrowseTabHasMore() {
      fetch(`${config.torrentsApiUrl}/api/hasBrowseShow`)
        .then((r) => r.json())
        .then((d) => {
          this.browseTabHasMore = !!d.available;
        })
        .catch(() => {});
    },
    startBrowseTabPolling() {
      this.stopBrowseTabPolling();
      this._browseTabPollTimer = setInterval(() => {
        this.fetchBrowseTabHasMore();
      }, 60000);
    },
    stopBrowseTabPolling() {
      if (this._browseTabPollTimer) {
        clearInterval(this._browseTabPollTimer);
        this._browseTabPollTimer = null;
      }
    },
    startChksrtPolling() {
      this.stopChksrtPolling();
      this._chksrtPollTimer = setInterval(() => {
        this.fetchChksrtCount();
      }, 60000);
    },
    stopChksrtPolling() {
      if (this._chksrtPollTimer) {
        clearInterval(this._chksrtPollTimer);
        this._chksrtPollTimer = null;
      }
    },
    async clickChksrt() {
      if (this.chksrtCount === 0) return;
      try {
        const list = await srvr.getChksrtList();
        this.chksrtCount = list?.count ?? 0;
        if (list?.path) {
          this.videoPlayerMode = "chksrt";
          this.videoPlayerPath = list.path;
        }
      } catch (e) {
        console.error("clickChksrt error:", e);
      }
    },

    async clickIntro() {
      const show = this.filteredShows.find((s) => s.needsIntro);
      if (!show) return;
      try {
        const result = await srvr.introFirstFile(show.name);
        if (result?.ok && result.path) {
          await this.handleOpenIntro({
            show,
            path: result.path,
            source: "info",
            season: result.season ?? null,
            episode: result.episode ?? null,
            embyId: result.id ?? null,
          });
        }
      } catch (e) {
        console.error("clickIntro error:", e);
      }
    },

    async handleOpenIntro({ show, path, source, season, episode, embyId }) {
      // If the video file has a .bif trickplay sidecar, edit intro in the Emby
      // web tab (emby-ui.user.js overlay). Otherwise fall back to the built-in
      // intro video pane.
      let hasBif = false;
      if (path) {
        try {
          const res = await srvr.hasBif(path);
          hasBif = !!res?.hasBif;
        } catch (e) {
          console.error("[intro] hasBif check failed:", e);
        }
      }
      if (hasBif) {
        if (!embyId) {
          console.error("[intro] no Emby item id for", show?.name);
          window.alert("No Emby episode found for Intro.");
          return;
        }
        util.openExternalPage(urls.embyPageUrl(embyId, "intro"));
        return;
      }
      this.videoPlayerIntroShow = show;
      this.videoPlayerPath = path;
      this.videoPlayerMode = "intro";
      this.videoPlayerSource = source || "info";
      this.videoPlayerMapSeason = season != null ? season : null;
      this.videoPlayerMapEpisode = episode != null ? episode : null;
    },

    async handleIntroNext(payload) {
      if (this.videoPlayerSource === "map") {
        const result = this.$refs.mapComp?.getNextEpisodeWithFile(
          this.videoPlayerMapSeason,
          this.videoPlayerMapEpisode,
        );
        if (result) {
          this.videoPlayerPath = result.path;
          this.videoPlayerMapSeason = result.season;
          this.videoPlayerMapEpisode = result.episode;
        }
        return;
      }
      // info pane with epiNext: load next episode in the same show
      if (payload?.epiNext) {
        const showName = this.videoPlayerIntroShow?.name;
        const season = this.videoPlayerMapSeason;
        const episode = this.videoPlayerMapEpisode;
        if (showName != null && season != null && episode != null) {
          try {
            const result = await srvr.introNextFile(showName, season, episode);
            if (result?.ok && result.path) {
              this.videoPlayerPath = result.path;
              this.videoPlayerMapSeason = result.season;
              this.videoPlayerMapEpisode = result.episode;
            }
          } catch {
            // ignore
          }
        }
        return;
      }
      // info pane: find next show in filtered list order that still needs intro
      const current = this.videoPlayerIntroShow;
      const shows = this.filteredShows;
      if (!current || !Array.isArray(shows)) {
        this.videoPlayerPath = null;
        this.videoPlayerMode = null;
        this.videoPlayerIntroShow = null;
        return;
      }
      const idx = shows.findIndex((s) => s.name === current.name);
      for (let i = idx + 1; i < shows.length; i++) {
        const s = shows[i];
        const hasPlayableIntroFile =
          Array.isArray(s?.filesOnDisk) &&
          s.filesOnDisk.some(
            (seasonRow) => Array.isArray(seasonRow) && seasonRow.length > 1,
          );
        const hasNoPlayableIntroFile = !hasPlayableIntroFile;
        if (
          s.trimPos != null ||
          s.skipDur != null ||
          s.inEmby === false ||
          s.inLinda ||
          hasNoPlayableIntroFile
        ) {
          continue;
        }
        try {
          const result = await srvr.introFirstFile(s.name);
          if (result?.ok && result.path) {
            this.videoPlayerIntroShow = s;
            this.videoPlayerPath = result.path;
            this.videoPlayerMapSeason =
              result.season != null ? result.season : null;
            this.videoPlayerMapEpisode =
              result.episode != null ? result.episode : null;
            return;
          }
        } catch {
          // ignore and continue scanning
        }
      }

      this.videoPlayerPath = null;
      this.videoPlayerMode = null;
      this.videoPlayerIntroShow = null;
      this.videoPlayerSource = null;
      this.videoPlayerMapSeason = null;
      this.videoPlayerMapEpisode = null;
    },
    openTvdbMismatchModal(title, text, payload = null) {
      this.tvdbMismatchTitle = title || "TVDB cache mismatch detected";
      this.tvdbMismatchText = text == null ? "" : String(text);
      this.tvdbMismatchOpen = true;

      console.error(
        `[tvdbMismatchModal] title="${this.tvdbMismatchTitle}"\n${this.tvdbMismatchText}`,
      );
      if (payload !== null && payload !== undefined) {
        console.error("[tvdbMismatchModal] payload:", payload);
      }
    },

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

    startLibraryRefresh() {
      srvr
        .requestEmbyLibraryRefresh()
        .catch((err) =>
          console.error("requestEmbyLibraryRefresh failed:", err),
        );
    },

    async checkLibraryRefreshStatus() {
      try {
        const status = await srvr.getEmbyLibraryRefreshStatus();
        if (status?.running && status?.progress?.pct != null) {
          this.libraryProgressText = `${Number(status.progress.pct).toFixed(0)}%`;
        }
      } catch (err) {
        console.error("checkLibraryRefreshStatus failed:", err);
      }
    },

    handleSetLibraryProgress(txt) {
      const s = String(txt || "");
      if (!s || s.includes("%")) this.libraryProgressText = s;
    },

    handleLibraryProgress(data) {
      if (data?.pct != null) {
        this.libraryProgressText = `${Number(data.pct).toFixed(0)}%`;
      }
    },

    handleLibraryRefreshDone(data) {
      this.libraryProgressText = "";
      const showNames = Array.isArray(data?.showNames) ? data.showNames : [];

      srvr
        .triggerEmbySync()
        .catch((err) => console.error("triggerEmbySync failed:", err));

      if (showNames.length > 0) {
        evtBus.emit("library-refresh-complete", {
          diskChangeShowName: showNames[0],
        });
        srvr
          .triggerShowSelect(showNames[0])
          .catch((err) => console.error("triggerShowSelect failed:", err));
      } else {
        evtBus.emit("library-refresh-complete");
      }
    },

    handleTvdbMismatch(payload) {
      if (this.simpleMode) return;

      this.tvdbMismatchTitle = "TVDB cache mismatch detected";

      if (payload && typeof payload === "object") {
        const reason = payload?.reason != null ? String(payload.reason) : "";
        const action = payload?.action != null ? String(payload.action) : "";

        if (!reason || !action) {
          this.tvdbMismatchTitle = "Legacy mismatch payload blocked";
          const lines = [];
          lines.push("What happened");
          lines.push(
            "- A tvdb-mismatch payload was received without required fields (reason/action).",
          );
          lines.push(
            "- Legacy fallback handling was blocked to avoid unsafe or ambiguous behavior.",
          );
          lines.push("");
          lines.push("Required fields");
          lines.push(`- reason: ${reason || "<missing>"}`);
          lines.push(`- action: ${action || "<missing>"}`);
          lines.push("");
          lines.push("Raw details");
          try {
            lines.push(JSON.stringify(payload, null, 2));
          } catch {
            lines.push(String(payload));
          }
          this.openTvdbMismatchModal(
            this.tvdbMismatchTitle,
            lines.join("\n"),
            payload,
          );
          return;
        }

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
        const existingKey =
          payload?.existing?.key != null ? String(payload.existing.key) : "";
        const existingName =
          payload?.existing?.name != null ? String(payload.existing.name) : "";
        const existingInEmby =
          payload?.existing?.inEmby != null
            ? String(payload.existing.inEmby)
            : "";
        const likelyById =
          payload?.details?.likelyById != null
            ? String(payload.details.likelyById)
            : "";

        const lines = [];
        if (
          reason === "likely-same-show-candidate" &&
          action === "blocked-create"
        ) {
          this.tvdbMismatchTitle =
            "Likely same-show candidate (creation blocked)";
          lines.push("What happened");
          lines.push(
            "- A likely same-show candidate already exists in TVDB cache.",
          );
          lines.push(
            "- New record creation was blocked to prevent duplicate entries.",
          );
          lines.push("");
          lines.push("Incoming show (from Emby)");
          lines.push(`- Show name key (show.name): ${name}`);
          lines.push(`- Emby show Id (show.id): ${showId}`);
          lines.push(`- TVDB series Id on show (show.tvdbId): ${tvdbId}`);
          lines.push("");
          lines.push("Likely same-show candidate (from server TVDB cache)");
          lines.push(`- Cache key: ${existingKey}`);
          lines.push(`- Cached name: ${existingName}`);
          lines.push(`- Cached showId (tvdb.showId): ${existingShowId}`);
          lines.push(`- Cached tvdbId (tvdb.tvdbId): ${existingTvdbId}`);
          lines.push(`- Cached inEmby: ${existingInEmby}`);
          lines.push(`- Matched by TVDB id: ${likelyById}`);
        } else if (
          reason === "cache-mismatch-blocked" &&
          action === "blocked-create"
        ) {
          this.tvdbMismatchTitle = "TVDB cache mismatch (creation blocked)";
          const mismatchType =
            payload?.details?.mismatchType != null
              ? String(payload.details.mismatchType)
              : "";
          lines.push("What happened");
          lines.push(
            "- A cached TVDB record conflicts with the Emby show identity.",
          );
          lines.push(
            "- Creation/update was blocked to prevent duplicate or cross-linked records.",
          );
          lines.push("");
          lines.push("Current show (from Emby)");
          lines.push(`- Show name key (show.name): ${name}`);
          lines.push(`- Emby show Id (show.id): ${showId}`);
          lines.push(`- TVDB series Id on show (show.tvdbId): ${tvdbId}`);
          lines.push("");
          lines.push("Existing cached record");
          lines.push(`- Cache key: ${existingKey}`);
          lines.push(`- Cached name: ${existingName}`);
          lines.push(`- Cached showId (tvdb.showId): ${existingShowId}`);
          lines.push(`- Cached tvdbId (tvdb.tvdbId): ${existingTvdbId}`);
          lines.push(`- Cached inEmby: ${existingInEmby}`);
          lines.push(`- Mismatch type: ${mismatchType}`);
        } else if (
          reason === "add-aborted-no-create" &&
          action === "blocked-create"
        ) {
          this.tvdbMismatchTitle = "Show add blocked (no fallback create)";
          const hasMapData =
            payload?.details?.hasMapData != null
              ? String(payload.details.hasMapData)
              : "";
          const createdFolder =
            payload?.details?.createdFolder != null
              ? String(payload.details.createdFolder)
              : "";
          const seriesMapSeasons = Array.isArray(
            payload?.details?.seriesMapSeasons,
          )
            ? payload.details.seriesMapSeasons.join(", ")
            : "";
          lines.push("What happened");
          lines.push(
            "- Add flow was blocked because Emby creation/discovery did not complete reliably.",
          );
          lines.push("- No no-emby fallback record was created (by design).");
          lines.push("");
          lines.push("Requested show");
          lines.push(`- Show name: ${name}`);
          lines.push(`- TVDB id: ${tvdbId}`);
          lines.push(`- Has TVDB map data: ${hasMapData}`);
          lines.push(`- Emby folder created: ${createdFolder}`);
          lines.push(`- Seasons from map: ${seriesMapSeasons}`);
          lines.push("");
          lines.push("Create result");
          try {
            lines.push(
              JSON.stringify(payload?.details?.createResult ?? {}, null, 2),
            );
          } catch {
            lines.push(String(payload?.details?.createResult ?? ""));
          }
        } else {
          this.tvdbMismatchTitle = "Unknown mismatch payload type blocked";
          lines.push("What happened");
          lines.push(
            "- A tvdb-mismatch payload was received with an unknown reason/action combination.",
          );
          lines.push(
            "- Processing was blocked to avoid unsafe fallback behavior.",
          );
          lines.push("");
          lines.push("Payload fields");
          lines.push(`- reason: ${reason}`);
          lines.push(`- action: ${action}`);
          lines.push(`- name: ${name}`);
          lines.push(`- showId: ${showId}`);
          lines.push(`- tvdbId: ${tvdbId}`);
          lines.push(`- existing.key: ${existingKey}`);
          lines.push(`- existing.name: ${existingName}`);
          lines.push(`- existing.showId: ${existingShowId}`);
          lines.push(`- existing.tvdbId: ${existingTvdbId}`);
        }
        lines.push("");
        lines.push("Raw details");
        try {
          lines.push(JSON.stringify(payload, null, 2));
        } catch {
          lines.push(String(payload));
        }

        this.openTvdbMismatchModal(
          this.tvdbMismatchTitle,
          lines.join("\n"),
          payload,
        );
      } else {
        this.openTvdbMismatchModal(
          this.tvdbMismatchTitle,
          String(payload),
          payload,
        );
      }
    },

    closeTvdbMismatch() {
      this.tvdbMismatchOpen = false;
      this.tvdbMismatchTitle = "TVDB cache mismatch detected";
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

    handleFilteredShows(shows) {
      this.filteredShows = Array.isArray(shows) ? shows : [];
    },
    handleAllTvdb(tvdbData) {
      this.allTvdb = tvdbData || {};
    },
    selectTab(key) {
      const k = String(key || "");
      if (!k) return;

      // --- Guard layer ---
      // Preview mode: tabs to the right of AI are disabled.
      if (
        this.previewMode &&
        ["flex", "qbt", "usb", "down", "local"].includes(k)
      )
        return;
      // Simple mode: only a small set of panes are available.
      if (
        this.simpleMode &&
        !["info", "map", "actors", "reviews", "trailer", "remote"].includes(k)
      )
        return;

      // --- Resolve + Emit layer ---
      // Special cases that have side effects beyond a plain pane switch:
      if (k === "info") {
        this.handleActorsClose();
        return;
      }
      if (k === "map") {
        if (this.currentShow?.name !== this.mapShow?.name) {
          this.mapShow = null;
          this.seriesMapSeasons = [];
          this.seriesMapEpis = [];
          this.seriesMap = {};
          this.mapError = "";
        }
        this.currentPane = "map";
        if (this.currentShow)
          evtBus.emit("mapAction", { action: "open", show: this.currentShow });
        evtBus.emit("paneChanged", this.currentPane);
        return;
      }
      if (k === "actors") {
        this.handleShowActors();
        return;
      }
      if (k === "remote") {
        this.currentPane = "remote";
        evtBus.emit("paneChanged", this.currentPane);
        evtBus.emit("tvCloseKeybd");
        return;
      }
      if (k === "browse") {
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
      if (k === "down") {
        // Prompt for desktop notification permission (Firefox requires user gesture).
        this.requestNotificationsOnce();
        this.handleShowTvproc();
        return;
      }

      // Default: reviews, trailer, flex, qbt, usb, local — plain pane switch.
      this.currentPane = k;
      evtBus.emit("paneChanged", this.currentPane);
    },
    handleShowMap(data) {
      // --- Data update (always) ---
      this.mapShow = data.mapShow;
      this.hideMapBottom = data.hideMapBottom;
      this.seriesMapSeasons = data.seriesMapSeasons;
      this.seriesMapEpis = data.seriesMapEpis;
      this.seriesMap = data.seriesMap;
      this.mapError = data.mapError || "";

      // --- Emit: let Series pane derive counts from the same map ---
      if (this.mapShow) {
        evtBus.emit("seriesMapUpdated", {
          show: this.mapShow,
          seriesMap: this.seriesMap,
        });
      }

      // --- Guard: noSwitch means data update only, no pane change ---
      if (data.noSwitch) return;

      // --- Resolve + Emit: pick next pane ---
      this.currentPane = data.mapShow !== null ? "map" : "info";
      evtBus.emit("paneChanged", this.currentPane);
    },
    handleLocalSelectShow(showName) {
      if (!showName) return;
      evtBus.emit("selectShowFromCardTitle", showName);
    },

    onMovieModeChange(val) {
      this.movieMode = val;
    },

    handleShowActors() {
      const showKey = this.currentShow?.id || this.currentShow?.name || null;
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
      evtBus.emit("showActors", {
        show: this.currentShow,
        tvdbData: this.currentTvdbData,
        actorSearchParams: this._actorSearchParams,
      });
      this._actorsInitialized = true;
      this._actorsShowKey = showKey;
    },
    handleActorsClose() {
      this.currentPane = "info";
      this.mapShow = null;
      evtBus.emit("paneChanged", this.currentPane);
    },
    handleShowTor(show) {
      if (this.simpleMode) return;
      const showKey = show?.id || show?.name || null;

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

      this._torrentsInitialized = true;
      this._torrentsShowKey = showKey;
      this.currentPane = "tor";
      evtBus.emit("paneChanged", this.currentPane);
      evtBus.emit("setTorShow", show);
    },

    handleShowQbt() {
      this.currentPane = "qbt";
      evtBus.emit("paneChanged", this.currentPane);
    },

    handleShowTvproc() {
      this.currentPane = "down";
      evtBus.emit("paneChanged", this.currentPane);
    },

    handleMapAction(action, show) {
      evtBus.emit("mapAction", { action, show });
    },
    handleEpisodeClick(e, show, season, episode, setWatched = null) {
      evtBus.emit("episodeClick", { e, show, season, episode, setWatched });
    },
    handleDeleteEpisodes(show, targets) {
      evtBus.emit("deleteEpisodes", { show, targets });
    },
    handlePlayEpisode(e, show, season, episode) {
      evtBus.emit("playEpisode", { show, season, episode });
    },
    handleSeasonWatched(e, show, season, episodeStates) {
      evtBus.emit("seasonWatched", { e, show, season, episodeStates });
    },
    handleSeasonDelete(e, show, season) {
      evtBus.emit("seasonDelete", { e, show, season });
    },
    updateFaviconBadge() {
      const shouldShowBadge =
        this.browseTabHasMore || this.introCount > 0 || this.chksrtCount > 0;

      // Remove any existing favicon links
      const oldLinks = document.querySelectorAll("link[rel*='icon']");
      oldLinks.forEach((oldLink) => oldLink.remove());

      // Create canvas for favicon
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d");

      if (shouldShowBadge) {
        // Draw background circle
        ctx.fillStyle = "#1a73e8"; // Blue background
        ctx.beginPath();
        ctx.arc(16, 16, 16, 0, 2 * Math.PI);
        ctx.fill();

        // Draw red badge circle in top-right
        ctx.fillStyle = "#f00";
        ctx.beginPath();
        ctx.arc(24, 8, 8, 0, 2 * Math.PI);
        ctx.fill();
      } else {
        // Draw TV icon
        // TV screen (rectangle)
        ctx.fillStyle = "#333";
        ctx.fillRect(6, 10, 20, 16);

        // TV screen inner (lighter)
        ctx.fillStyle = "#4a9eff";
        ctx.fillRect(8, 12, 16, 12);

        // Antenna left
        ctx.strokeStyle = "#666";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(12, 10);
        ctx.lineTo(8, 4);
        ctx.stroke();

        // Antenna right
        ctx.beginPath();
        ctx.moveTo(20, 10);
        ctx.lineTo(24, 4);
        ctx.stroke();

        // Stand base
        ctx.fillStyle = "#333";
        ctx.fillRect(13, 26, 6, 2);
        ctx.fillRect(15, 24, 2, 4);
      }

      // Create new favicon link with canvas data
      const link = document.createElement("link");
      link.type = "image/x-icon";
      link.rel = "shortcut icon";
      link.href = canvas.toDataURL("image/png");
      document.getElementsByTagName("head")[0].appendChild(link);
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

    this._onDelKey = (e) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (document.activeElement?.isContentEditable) return;
      if (this.currentPane === "map") {
        this.$refs.mapComp?.handleSelectedDelete();
      } else if (this.currentPane === "info") {
        evtBus.emit("infoDelKey");
      } else if (this.currentPane === "down") {
        evtBus.emit("downDelKey");
      } else if (this.currentPane === "local") {
        evtBus.emit("localDelKey");
      }
    };
    window.addEventListener("keydown", this._onDelKey);

    this.loadSplitPrefs();
    this.$nextTick(() => {
      this.applySplitPrefsToOverrides();
    });

    // Derive downActive and schedule deferred Tor restarts.
    evtBus.on("downActivePart", this.handleDownActivePart);
    evtBus.on("tvdb-mismatch", this.handleTvdbMismatch);
    this._onMissingEpWarning = (data) => {
      this.missingEpWarning = data;
    };
    evtBus.on("missingEpisodeWarning", this._onMissingEpWarning);
    this._onPlayEpisodePath = (path) => {
      this.videoPlayerMode = null;
      this.videoPlayerPath = path;
    };
    evtBus.on("playEpisodePath", this._onPlayEpisodePath);
    this._onPlaySimplePath = (path) => {
      this.videoPlayerMode = "simple";
      this.videoPlayerPath = path;
    };
    evtBus.on("playSimplePath", this._onPlaySimplePath);
    this._onOpenChksrt = (path) => {
      this.videoPlayerMode = "chksrt";
      this.videoPlayerPath = path;
    };
    evtBus.on("openChksrt", this._onOpenChksrt);
    this._onChksrtCount = (count) => {
      const prev = this.chksrtCount;
      this.chksrtCount = Number(count) || 0;
      if (prev === 0 && this.chksrtCount > 0) {
        new Notification("Chksrt", {
          body: `${this.chksrtCount} subtitle(s) ready to check`,
        });
      }
    };
    evtBus.on("chksrt-count", this._onChksrtCount);
    this._onIntroCount = (count) => {
      this.introCount = Number(count) || 0;
    };
    evtBus.on("intro-count", this._onIntroCount);
    this.fetchChksrtCount();
    this.startChksrtPolling();
    this.startQbtPolling();

    this._onBrowseHasMoreChanged = (val) => {
      this.browseTabHasMore = !!val;
    };
    evtBus.on("browseHasMoreChanged", this._onBrowseHasMoreChanged);
    this.fetchBrowseTabHasMore();
    this.startBrowseTabPolling();

    // Watch for changes to badge-triggering states and update favicon
    this.$watch("browseTabHasMore", () => {
      this.updateFaviconBadge();
    });
    this.$watch("introCount", () => {
      this.updateFaviconBadge();
    });
    this.$watch("chksrtCount", () => {
      this.updateFaviconBadge();
    });
    // Initial badge update
    this.$nextTick(() => {
      this.updateFaviconBadge();
    });

    // Refresh space display once on app load.
    this.requestSpaceAvailRefresh("app load");

    // Check if library refresh is already running on app load
    this.checkLibraryRefreshStatus();

    if (
      this.simpleMode &&
      !["info", "map", "actors"].includes(this.currentPane)
    ) {
      this.currentPane = "info";
    }

    // Listen for pane navigation events
    evtBus.on("showActorsPane", () => {
      this.handleShowActors();
    });

    evtBus.on("showActorsPaneWithEpisode", (episodeInfo) => {
      this.handleShowActors();
      // Emit event to actors pane with episode info
      evtBus.emit("fillAndSelectEpisode", episodeInfo);
    });

    evtBus.on("showTorrentsPane", (show) => {
      this.handleShowTor(show);
    });

    evtBus.on("showInfoPane", () => {
      this.currentPane = "info";
      evtBus.emit("paneChanged", this.currentPane);
    });

    // Map navigation is centralized through list.vue via mapAction('open')

    evtBus.on("showSeriesPane", () => {
      if (this.currentPane === "map") {
        return;
      }
      this.handleActorsClose();
    });

    evtBus.on("selectTab", (tabKey) => {
      this.selectTab(tabKey);
    });

    evtBus.on("showBrowsePane", () => {
      if (this.simpleMode) return;
      this.currentPane = "browse";
      evtBus.emit("paneChanged", this.currentPane);
    });

    evtBus.on("showLocalPane", () => {
      if (this.simpleMode) return;
      this.currentPane = "local";
      evtBus.emit("paneChanged", this.currentPane);
    });

    // Select episode in map component (from watchClick) after map props update.
    evtBus.on("selectMapEpisode", async ({ season, episode }) => {
      if (season == null || episode == null) return;
      await this.$nextTick();
      this.$refs.mapComp?.selectSingleEpisode(season, episode);
    });

    // Preview mode: driven by ctrl-click in the web search dropdown.
    evtBus.on("previewMode", (active) => {
      this.previewMode = !!active;

      if (!this.previewMode) {
        // --- preview-exited ---
        // Reset preview UI state (always).
        this.previewSrchChoice = null;
        this.previewAddBusy = false;
        this.previewPanesLoading = false;

        // Guard: nothing to restore if no pane was saved.
        if (!this.savedPane) return;

        // Resolve: restore the pane that was active before preview.
        this.currentPane = this.savedPane;
        this.savedPane = null;

        // Emit.
        // restoringPreviewPane suppresses the setUpSeries→info fallback for 500ms.
        // Removed in step 4 when show-selected is layered.
        this.restoringPreviewPane = true;
        setTimeout(() => {
          this.restoringPreviewPane = false;
        }, 500);
        evtBus.emit("paneChanged", this.currentPane);
        if (this.currentShow) evtBus.emit("setUpSeries", this.currentShow);
        return;
      }

      // --- preview-entered ---
      // Save current pane so preview-exited can restore it.
      this.savedPane = this.currentPane;

      // Guard + Resolve: if on a pane disabled during preview, snap to info.
      const previewAllowed = new Set([
        "info",
        "actors",
        "reviews",
        "trailer",
        "browse",
        "tor",
      ]);
      if (!previewAllowed.has(this.currentPane)) {
        this.currentPane = "info";
        evtBus.emit("paneChanged", this.currentPane);
      }
    });

    evtBus.on("previewPanesLoading", this.onPreviewPanesLoading);

    evtBus.on("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.on("addPreviewShowDone", this.onAddPreviewShowDone);

    evtBus.on("startLibraryRefresh", this.startLibraryRefresh);
    evtBus.on("setLibraryProgress", this.handleSetLibraryProgress);
    evtBus.on("libraryProgress", this.handleLibraryProgress);
    evtBus.on("libraryRefreshDone", this.handleLibraryRefreshDone);

    evtBus.on("showStreamPane", (show) => {
      this.currentPane = "tor";
      evtBus.emit("paneChanged", this.currentPane);
      evtBus.emit("openStream", show);
    });

    // show-selected: fired when the user picks a new show from the list.
    evtBus.on("setUpSeries", (show) => {
      // --- State update (always) ---
      this.currentShow = show;
      this.currentTvdbData = null; // stale until series pane publishes new data
      this._torrentsInitialized = false;
      this._torrentsShowKey = null;

      const prevPane = this.currentPane;
      const actorSearchActive = !!this._actorSearchParams;

      if (!actorSearchActive) {
        evtBus.emit("resetActorsPane");
        this._actorsInitialized = false;
        this._actorsShowKey = null;
      }

      // --- Guard layer (keep current pane, no switch) ---
      // Priority 1: map — list.vue handles map content update separately.
      if (prevPane === "map") return;

      // Priority 2: panes that always keep their content on show change.
      const keepContentPanes = new Set([
        "local",
        "usb",
        "qbt",
        "down",
        "reviews",
        "trailer",
        "actors",
      ]);
      if (keepContentPanes.has(prevPane)) return;

      // Priority 3: preview-exit re-emit — pane was just restored, don't override it.
      // (Decoupled from setUpSeries in a future step.)
      if (this.restoringPreviewPane) return;

      // --- Resolve + Emit layer ---
      // Tor: stay on tor and start a new search for the new show.
      if (prevPane === "tor") {
        const showKey = this.currentShow?.id || this.currentShow?.name || null;
        evtBus.emit("showTorrents", this.currentShow);
        this._torrentsInitialized = true;
        this._torrentsShowKey = showKey;
        return;
      }

      // Actor search active on a non-keepPane: switch to actors.
      if (actorSearchActive) {
        this.currentPane = "actors";
        evtBus.emit("paneChanged", this.currentPane);
        const showKey = this.currentShow?.id || this.currentShow?.name || null;
        evtBus.emit("showActors", {
          show: this.currentShow,
          tvdbData: this.currentTvdbData,
          actorSearchParams: this._actorSearchParams,
        });
        this._actorsInitialized = true;
        this._actorsShowKey = showKey;
        return;
      }

      // Default: return to the Series pane.
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
        incomingShow?.id != null ? String(incomingShow.id) : "";
      const incomingName =
        incomingShow?.name != null ? String(incomingShow.name) : "";

      const currentId =
        this.currentShow?.id != null ? String(this.currentShow.id) : "";
      const currentName =
        this.currentShow?.name != null ? String(this.currentShow.name) : "";

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
        const showKey = this.currentShow?.id || this.currentShow?.name || null;
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

#tor span.sel-count,
#qbt span.sel-count,
#down span.sel-count {
  color: green !important;
}

/* Force light-gray button backgrounds only in the right-side panes */
#info button,
#map button,
#actors button,
#reviews button,
#tor button,
.torrents-container button,
#qbt button,
#down button,
#tvPane button {
  background-color: var(--btn-bg, whitesmoke) !important;
}

/* Disabled/no-selection button state — matches flex pane's native opacity look */
.btn-disabled {
  opacity: 0.5 !important;
  cursor: default !important;
}

.pane-header-title {
  color: #000;
  font-weight: bold;
  font-size: v-bind('activeSizing.seriesFontSize || "25px"');
}
</style>
