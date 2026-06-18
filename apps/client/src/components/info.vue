<template>
  <div
    id="info"
    @click="handleSeriesClick"
    :style="{
      height: '100%',
      width: '100%',
      padding: '5px',
      margin: 0,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      maxWidth: '100%',
      boxSizing: 'border-box',
      position: 'relative',
    }"
  >
    <div
      id="tvdbRefreshModal"
      v-if="showRefreshDialog"
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
      <div style="font-size: 18px; font-weight: bold">Refreshing Show</div>
      <div style="margin-top: 8px; font-size: 16px">
        {{ refreshDialogShowName }}
      </div>
      <div style="margin-top: 8px; font-size: 14px">
        {{ refreshDialogStatus }}
      </div>
    </div>

    <div
      id="hdr"
      v-if="showHdr"
      class="pane-header-title"
      :style="{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        margin: '0px',
        marginBottom: '10px',
        flexShrink: 0,
      }"
    >
      <div
        :style="{
          display: 'grid',
          gridTemplateColumns: '1fr 3fr 1fr 3fr 1fr',
          alignItems: 'start',
          width: '100%',
        }"
      >
        <div
          :style="{
            gridColumn: '1 / span 2',
            marginLeft: '20px',
            marginRight: '20px',
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            minWidth: '0px',
          }"
        >
          <span :style="{ minWidth: '0px', flex: '1 1 auto' }">{{
            show.name
          }}</span>
        </div>
        <div
          v-if="!previewMode"
          :style="{
            gridColumn: '4 / span 2',
            justifySelf: 'end',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            minWidth: '0px',
          }"
        >
          <button
            @click.stop="refreshTvdb"
            :style="{
              fontSize: '13px',
              cursor: 'pointer',
              marginTop: '3px',
              maxHeight: '24px',
              borderRadius: '7px',
            }"
          >
            Refresh
          </button>
          <button
            @click.stop="introClick"
            :disabled="!hasVideoFiles"
            :style="{
              fontSize: '13px',
              cursor: hasVideoFiles ? 'pointer' : 'default',
              marginTop: '3px',
              maxHeight: '24px',
              borderRadius: '7px',
              opacity: hasVideoFiles ? 1 : 0.4,
            }"
          >
            Intro
          </button>
          <button
            @click.stop="playFirstUnwatched"
            :disabled="!hasVideoFiles"
            :style="{
              fontSize: '13px',
              cursor: hasVideoFiles ? 'pointer' : 'default',
              marginTop: '3px',
              maxHeight: '24px',
              borderRadius: '7px',
              opacity: hasVideoFiles ? 1 : 0.4,
            }"
          >
            Play
          </button>
          <button
            @click.stop="tvClick"
            :disabled="show?.inEmby === false"
            :style="{
              fontSize: '13px',
              cursor: show?.inEmby !== false ? 'pointer' : 'default',
              marginTop: '3px',
              maxHeight: '24px',
              borderRadius: '7px',
              opacity: show?.inEmby !== false ? 1 : 0.4,
            }"
          >
            TV
          </button>
          <button
            v-if="notInEmby"
            @click.stop="loadIntoEmby"
            :style="{
              fontSize: '13px',
              cursor: 'pointer',
              marginTop: '3px',
              maxHeight: '24px',
              borderRadius: '7px',
            }"
          >
            Load
          </button>
          <button
            @click.stop="deleteClick"
            style="
              font-size: 13px;
              cursor: pointer;
              margin-top: 3px;
              max-height: 24px;
              border-radius: 7px;
            "
          >
            Del
          </button>
        </div>
      </div>
    </div>
    <!-- Layout: 1/9 whitespace, 1/3 poster, 1/9 whitespace, 1/3 infobox, 1/9 whitespace-->
    <div
      id="body"
      :style="{
        display: 'grid',
        cursor: 'default',
        width: '100%',
        gridTemplateColumns: '1fr 3fr 1fr 3.6fr 1fr',
        alignItems: 'start',
        flexShrink: 0,
      }"
    >
      <!-- Column 2: poster (1/3)-->
      <div
        id="topLeft"
        @click.stop="handleBodyClick"
        :style="{
          gridColumn: '2',
          minWidth: '0px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          textAlign: 'center',
        }"
      >
        <div
          id="poster"
          :style="{
            width: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
          }"
        ></div>
      </div>
      <!-- Column 4: info box (1/3)-->
      <div
        id="topRight"
        :style="{
          gridColumn: '4 / span 2',
          minWidth: '0px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
        }"
      >
        <div
          id="infoBox"
          v-if="seriesReady"
          @click.stop="handleBodyClick"
          :style="{
            margin: '0px 0 0px 0px',
            width: '100%',
            boxSizing: 'border-box',
            overflow: 'hidden',
            fontSize: sizing.seriesInfoFontSize || '20px',
            lineHeight: sizing.infoBoxLineHeight || '1.2',
            display: 'flex',
            flexDirection: 'column',
            textAlign: 'center',
            fontWeight: 'bold',
          }"
        >
          <div
            style="
              border: 1px solid #ccc;
              border-radius: 5px;
              padding: 5px;
              width: 100%;
              box-sizing: border-box;
            "
          >
            <!-- Dates in one div; allow wrapping up to 2 lines-->
            <div
              id="dates"
              v-if="dates &amp;&amp; String(dates).length &gt; 0"
              style="
                min-height: 24px;
                white-space: normal;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: 2;
                line-clamp: 2;
              "
            >
              {{ dates }}
            </div>
            <div
              id="status"
              v-if="statusTxt.length &gt; 0"
              v-html="statusTxt"
              style="
                min-height: 20px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              "
            ></div>
            <div
              id="seasons"
              v-if="seasonsTxt.length &gt; 0"
              v-html="seasonsTxt"
              style="
                min-height: 24px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              "
            ></div>
            <!-- Split only between "Watched" and the value; allow wrapping between them-->
            <div
              id="watched"
              v-if="!previewMode &amp;&amp; watchedValTxt &amp;&amp; String(watchedValTxt).length &gt; 0"
              style="
                min-height: 24px;
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                column-gap: 8px;
                row-gap: 0px;
              "
            >
              <div style="white-space: nowrap">Watched</div>
              <div
                style="
                  white-space: normal;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  display: -webkit-box;
                  -webkit-box-orient: vertical;
                  -webkit-line-clamp: 2;
                  line-clamp: 2;
                "
              >
                {{ watchedValTxt }}
              </div>
            </div>
            <div
              id="lastwatched"
              v-if="!previewMode && lastWatchedTxt"
              style="min-height: 20px; white-space: nowrap"
            >
              Last watched: {{ lastWatchedTxt }}
            </div>
            <div
              id="cntrylang"
              v-if="(cntryLangLeftTxt &amp;&amp; cntryLangLeftTxt.length &gt; 0) || (cntryLangRightTxt &amp;&amp; cntryLangRightTxt.length &gt; 0)"
              style="
                min-height: 20px;
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                column-gap: 8px;
                row-gap: 0px;
              "
            >
              <div
                v-if="cntryLangLeftTxt &amp;&amp; cntryLangLeftTxt.length &gt; 0"
                style="white-space: nowrap"
              >
                {{ cntryLangLeftTxt }}
              </div>
              <div
                v-if="cntryLangRightTxt &amp;&amp; cntryLangRightTxt.length &gt; 0"
                style="
                  white-space: normal;
                  overflow-wrap: anywhere;
                  word-break: break-word;
                "
              >
                {{ cntryLangRightTxt }}
              </div>
            </div>
            <div
              id="genres"
              v-if="genresTxt &amp;&amp; genresTxt.length > 0"
              style="
                min-height: 20px;
                white-space: normal;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: 2;
                line-clamp: 2;
              "
            >
              {{ genresTxt }}
            </div>
            <div
              id="crew"
              v-if="crewLines && crewLines.length > 0"
            >
              <div
                v-for="line in crewLines"
                :key="line"
                style="
                  min-height: 20px;
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                "
              >
                {{ line }}
              </div>
            </div>
            <div
              id="mins"
              v-if="runtimeTxt.length &gt; 0"
              v-html="runtimeTxt"
              style="
                min-height: 20px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
              "
            ></div>
            <div
              id="collection"
              v-if="collectionName"
              style="
                min-height: 24px;
                white-space: normal;
                overflow-wrap: anywhere;
                word-break: break-word;
              "
            >
              {{ collectionCount > 1 ? "Collections" : "Collection" }}:
              {{ collectionName }}
            </div>
            <div
              v-if="!previewMode &amp;&amp; notInEmby"
              style="
                font-weight: bold;
                color: red;
                font-size: 16px;
                margin-top: 8px;
                white-space: nowrap;
              "
            >
              Not In Emby
            </div>
            <div
              v-if="twoLocalFolders"
              style="color: red !important"
              :style="{
                fontWeight: 'bold',
                fontSize: sizing.seriesInfoFontSize || '20px',
                whiteSpace: 'nowrap',
              }"
            >
              Two local folders
            </div>
            <div
              v-for="device in nowPlayingDevices"
              :key="device"
              style="
                white-space: nowrap;
                font-weight: bold;
                color: green;
                margin-top: 4px;
              "
            >
              Now playing on {{ device }}
            </div>
          </div>
        </div>
      </div>
    </div>
    <div
      id="allButtons"
      style="
        display: flex;
        flex-direction: column;
        margin-top: 15px;
        padding: 0 10px;
        width: 100%;
        flex-shrink: 0;
      "
    >
      <div
        id="remoteButtons"
        v-if="showRemotes"
        style="
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-start;
          width: 100%;
          cursor: default;
        "
      >
        <div
          v-for="remote in remotes"
          :key="remote.name"
          @click.stop="remoteClick(remote)"
          :style="{
            margin: '5px 5px',
            padding: sizing.remoteButtonPadding || '10px',
            backgroundColor: '#eee',
            borderRadius: '7px',
            textAlign: 'center',
            border: '1px solid black',
            fontWeight: 'bold',
            fontSize: sizing.remoteFontSize || 'inherit',
            cursor: 'pointer',
            userSelect: 'none',
          }"
        >
          {{ remote.name }}
        </div>
      </div>
    </div>
    <div
      id="bot"
      :style="{
        overflowY: 'scroll',
        flex: '1 1 0',
        minHeight: '0',
      }"
    >
      <div
        :style="{
          fontSize: sizing.overviewFontSize || '20px',
          padding: '10px',
        }"
      >
        {{ show.overview }}
      </div>
    </div>
  </div>
</template>

<script>
import evtBus from "../evtBus.js";
import * as tvdb from "../tvdb.js";
import * as emby from "../emby.js";
import * as srvr from "../srvr.js";
import * as util from "../util.js";

let allTvdb = null;
let cachedDiskShows = null;
export default {
  name: "Series",

  emits: ["open-intro", "play-episode"],

  props: {
    simpleMode: {
      type: Boolean,
      default: false,
    },
    sizing: {
      type: Object,
      default: () => ({}),
    },
  },

  data() {
    return {
      show: { name: "" },
      showHdr: false,
      seriesReady: false,
      previewMode: false,
      previewAddBusy: false,
      dates: "",
      statusTxt: "",
      remoteShowName: "",
      remotes: [],
      seasonsTxt: "",
      watchedValTxt: "",
      lastWatchedTxt: "",
      cntryLangLeftTxt: "",
      cntryLangRightTxt: "",
      genresTxt: "",
      runtimeTxt: "",
      subs: "",
      subsActive: false,
      showRemotes: false,
      nextUpValTxt: "",
      nextUpSuffixTxt: "",
      nextUpSeason: null,
      nextUpEpisode: null,
      watchButtonTxtArr: [],
      episodeId: "",
      deletedTxt: "",
      notInEmby: false,
      collectionName: "",
      collectionCount: 0,
      currentTvdbData: null,
      previewSrchChoice: null,
      refreshing: false,
      refreshPendingShowName: "",
      showRefreshDialog: false,
      refreshDialogShowName: "",
      refreshDialogStatus: "",
      remoteFetchMode: "fast", // 'fast' or 'full'
      settingUpShowName: null, // Track show currently being set up to prevent duplicate calls
      twoLocalFolders: false,
      nowPlayingDevices: [],
      crewLines: [],
    };
  },

  computed: {
    lastWatchedDate() {
      return (
        util.fmtPlayedDate(this.show?.lastPlayedDate).split(" ")[0] || null
      );
    },
    hasVideoFiles() {
      return (
        Array.isArray(this.show?.filesOnDisk) &&
        this.show.filesOnDisk.some(
          (seasonRow) => Array.isArray(seasonRow) && seasonRow.length > 1,
        )
      );
    },
  },

  methods: {
    onPreviewMode(active) {
      this.previewMode = !!active;
      if (!this.previewMode) {
        this.previewSrchChoice = null;
        this.previewAddBusy = false;
      }
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
      // List will exit preview mode; we just reset busy state.
      this.previewAddBusy = false;
    },

    exitPreview() {
      evtBus.emit("exitPreviewMode");
    },

    onEnterBlur(e) {
      try {
        e?.target?.blur?.();
      } catch {
        /* ignore */
      }
    },

    getMapCounts(seriesMap) {
      try {
        const seasonKeys = Object.keys(seriesMap || {}).filter(
          (s) => seriesMap?.[s] && Object.keys(seriesMap[s]).length > 0,
        );
        const seasonCount = seasonKeys.length;
        const episodeCount = seasonKeys.reduce((sum, s) => {
          const epis = seriesMap?.[s] || {};
          return sum + Object.keys(epis).length;
        }, 0);
        return { seasonCount, episodeCount };
      } catch (e) {
        return { seasonCount: 0, episodeCount: 0 };
      }
    },

    async handleBodyClick() {
      // In preview mode, do not open/switch to Map.
      if (this.previewMode) return;

      // Only toggle to map in simple mode
      if (!this.simpleMode) return;

      // Otherwise open the map
      this.openMap(this.show);
    },

    async handleSeriesClick() {
      // In preview mode, do not open/switch to Map.
      if (this.previewMode) return;

      // Only toggle to map in simple mode
      if (!this.simpleMode) return;

      // Rotate panes: if coming from map, go to actors; otherwise go to map
      // Check if we should go to actors (this will be after map is shown)
      // For now, just open map - the map will handle going to actors
      this.openMap(this.show);
    },

    openMap(show) {
      if (this.previewMode) return;
      if (!show || !show.name) {
        return;
      }
      evtBus.emit("openMap", show);
    },

    async introClick() {
      const hasPlayableIntroFile =
        Array.isArray(this.show?.filesOnDisk) &&
        this.show.filesOnDisk.some(
          (seasonRow) => Array.isArray(seasonRow) && seasonRow.length > 1,
        );
      if (!hasPlayableIntroFile) {
        return;
      }
      try {
        const result = await srvr.introFirstFile(this.show.name);
        if (!result?.ok || !result?.path) {
          window.alert("No playable episode found for Intro.");
          return;
        }
        this.$emit("open-intro", {
          show: this.show,
          path: result.path,
          source: "info",
          season: result.season,
          episode: result.episode,
        });
      } catch (e) {
        console.error("introClick error:", e);
        window.alert("Intro failed to open.");
      }
    },

    buildPlayActionEvent(overrides = {}) {
      return {
        stopPropagation() {},
        preventDefault() {},
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        ...overrides,
      };
    },

    playFirstUnwatched() {
      const filesOnDisk = this.show?.filesOnDisk;
      if (!Array.isArray(filesOnDisk) || filesOnDisk.length === 0) {
        window.alert("No playable episode found.");
        return;
      }
      const firstRow = filesOnDisk[0];
      const season = firstRow[0];
      const episode = firstRow[1];
      if (!Number.isFinite(season) || !Number.isFinite(episode)) {
        window.alert("No playable episode found.");
        return;
      }
      this.$emit(
        "play-episode",
        this.buildPlayActionEvent({ altKey: true }),
        this.show,
        season,
        episode,
      );
    },

    async tvClick() {
      const result = await srvr.embyViewShow(this.show.id, this.show.name);
      if (!result?.found) window.alert("Living Room TV is not active in Emby.");
    },

    deleteClick() {
      console.log("Series, deleteClick:", this.show.name);
      evtBus.emit("deleteShow", this.show);
    },

    torrentsClick() {
      evtBus.emit("showTorrentsPane", this.show);
    },

    mapClick() {
      evtBus.emit("mapAction", { action: "open", show: this.show });
    },

    actorsClick() {
      evtBus.emit("showActorsPane");
    },

    remoteClick(remote) {
      const url = remote.url;
      if (url) util.openExternalPage(url);
    },

    playNextEpisode() {
      if (this.nextUpSeason === null || this.nextUpEpisode === null) return;
      evtBus.emit("playEpisode", {
        show: this.show,
        season: this.nextUpSeason,
        episode: this.nextUpEpisode,
      });
    },

    setDeleted(tvdbData) {
      this.notInEmby = this.show.inEmby === false;
      if (this.notInEmby && tvdbData?.leftEmby) {
        this.deletedTxt = "Deleted " + tvdbData.leftEmby;
      } else {
        this.deletedTxt = "";
      }
    },

    async setPoster(tvdbData, { noAutoShow = false } = {}) {
      const posterEl = document.getElementById("poster");
      if (!posterEl) return;

      const showNameAtStart = this.show?.name;

      const img = new Image();
      img.style.width = "auto";
      img.style.height = "auto";
      img.style.objectFit = "contain";
      img.style.display = "block";
      img.style.visibility = "hidden";

      // Use tvdbData image if available, otherwise use show.imageUrl, fallback to placeholder
      let src = "./question-mark.png";
      if (tvdbData?.image) {
        src = tvdbData.image;
      } else if (this.show?.imageUrl) {
        src = this.show.imageUrl;
      }

      if (!tvdbData) {
        console.warn(
          "setPoster: tvdbData missing, using show.imageUrl or placeholder",
        );
      } else if (!tvdbData.image) {
        console.error("image missing from tvdbData", tvdbData.name);
      }

      await new Promise((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = src;
      });

      if (this.show?.name !== showNameAtStart) return;

      posterEl.replaceChildren(img);

      // Only show the poster if not mid-load (settingUpShowName is cleared in finally)
      // and not explicitly suppressed. This prevents a small→big jump when the image
      // loads before all infoBox content is ready.
      if (!this.settingUpShowName && !noAutoShow) {
        const infoBoxEl = document.getElementById("infoBox");
        if (infoBoxEl && infoBoxEl.clientHeight > 0) {
          console.log(
            `[poster-size] setPoster auto-show: ${infoBoxEl.clientHeight}px for ${this.show?.name}`,
          );
          img.style.maxHeight = infoBoxEl.clientHeight + "px";
          img.style.visibility = "visible";
        }
      }
    },

    async setCrewTxt(tvdbData) {
      this.crewLines = [];
      let crew = null;
      if (Array.isArray(tvdbData?.crew)) {
        crew = tvdbData.crew;
      } else {
        // crew field absent — fetch from TVDB and store back
        const tvdbId = tvdbData?.tvdbId || this.show?.tvdbId;
        if (tvdbId) {
          try {
            const res = await tvdb.fetchExtendedForCrew(tvdbId);
            if (Array.isArray(res)) {
              crew = res;
              const showName = tvdbData?.name || this.show?.name;
              if (showName)
                await srvr.setTvdbFields({ name: showName, crew: res });
            }
          } catch {
            // silent
          }
        }
      }
      if (!Array.isArray(crew) || crew.length === 0) return;
      const vipSet = await srvr.getVipActors().catch(() => new Set());
      const CREW_PREF = ["Creator", "Producer", "Executive Producer", "Writer"];
      const sorted = [...crew].sort((a, b) => {
        const aVip = vipSet.has(a.name) ? 0 : 1;
        const bVip = vipSet.has(b.name) ? 0 : 1;
        if (aVip !== bVip) return aVip - bVip;
        return CREW_PREF.indexOf(a.type) - CREW_PREF.indexOf(b.type);
      });
      const picked = [];
      const seenNames = new Set();
      for (const c of sorted) {
        if (!seenNames.has(c.name)) {
          seenNames.add(c.name);
          picked.push(c);
          if (picked.length === 2) break;
        }
      }
      const abbrev = (t) => (t === "Executive Producer" ? "Exec Producer" : t);
      this.crewLines = picked.map((c) => `${abbrev(c.type)}: ${c.name}`);
    },

    setGenresTxt(tvdbData) {
      this.genresTxt = "";
      let genreArr = [];
      if (this.previewMode) {
        if (tvdbData && tvdbData.genres) {
          genreArr = tvdbData.genres;
        }
      } else {
        if (this.show && this.show.genres) {
          genreArr = this.show.genres;
        } else if (this.show && this.show.genres) {
          genreArr = this.show.genres;
        } else if (tvdbData && tvdbData.genres) {
          genreArr = tvdbData.genres;
        }
      }

      if (Array.isArray(genreArr) && genreArr.length > 0) {
        this.genresTxt = genreArr.join(", ");
      } else if (typeof genreArr === "string" && genreArr.length) {
        this.genresTxt = genreArr;
      }
    },

    setDates(tvdbData) {
      const show = this.show;
      const { firstAired, lastAired, status, lastPlayedDate } = tvdbData;
      const fa = firstAired || "";
      const la = lastAired || "";
      const st = status || "";
      // Dates (start/end) should be on one line and separate from status.
      if (fa && la) this.dates = `${fa} - ${la}`;
      else if (fa) this.dates = `${fa}`;
      else if (la) this.dates = `${la}`;
      else this.dates = "";
      this.statusTxt = st ? ` &nbsp; ${st}` : "";
      this.lastWatchedTxt =
        util.fmtPlayedDate(lastPlayedDate).split(" ")[0] || "";
    },

    async setSeasonsTxt(tvdbData) {
      if (!(tvdbData instanceof Object)) {
        console.error("setSeasonsTxt, tvdbData:", name, { tvdbData });
        return;
      }
      this.seasonsTxt = "";
      this.watchedValTxt = "";
      const show = this.show;
      const name = show.name;

      let epiCounts;
      let watchedCountIsNull = false;
      if (show.inEmby === false) {
        // For non-emby shows, use stored watchedCount from tvdb
        // (watchedCount should be already populated by migration script or previous Emby calculations)
        const watchedCount = tvdbData.watchedCount;
        watchedCountIsNull =
          watchedCount === null || watchedCount === undefined;

        epiCounts = {
          seasonCount: tvdbData.seasonCount || 0,
          episodeCount: tvdbData.episodeCount || 0,
          watchedCount: watchedCountIsNull ? null : watchedCount,
        };
      } else {
        // For emby shows, get counts from Emby API and save to tvdb
        epiCounts = await emby.getEpisodeCounts(show);

        // Save the calculated counts back to tvdb only if they changed
        // dontEnqueue: skip triggering a full background refresh just for count updates
        const prev = tvdbData;
        if (
          epiCounts.seasonCount !== prev.seasonCount ||
          epiCounts.episodeCount !== prev.episodeCount ||
          epiCounts.watchedCount !== prev.watchedCount
        ) {
          const fields = Object.assign({ name, dontEnqueue: true }, epiCounts);
          srvr.setTvdbFields(fields).catch((e) => console.error(e));
        }
      }

      Object.assign(tvdbData, epiCounts);
      tvdb.upsertTvdbCacheRecord(
        allTvdb,
        tvdbData,
        name || this.show?.name || "",
      );
      let seasonsTxt;
      const { episodeCount, seasonCount, watchedCount } = tvdbData;

      // Set watched text first (before potential early return)
      if (episodeCount > 0) {
        if (watchedCountIsNull) {
          // Show "?" when watchedCount is null for non-emby shows
          this.watchedValTxt = `? of ${episodeCount}`;
        } else {
          this.watchedValTxt =
            watchedCount === episodeCount
              ? `all ${episodeCount} episodes`
              : `${watchedCount} of ${episodeCount}`;
        }
      } else if (show.inEmby === false) {
        // For non-emby shows with no episode count yet, still show watched status
        this.watchedValTxt = watchedCountIsNull ? "?" : "0";
      } else {
        this.watchedValTxt = "";
      }

      // Now handle seasons text
      switch (seasonCount) {
        case 0:
          return;
        case 1:
          seasonsTxt = "1 Season";
          break;
        default:
          seasonsTxt = `${seasonCount} Seasons`;
      }
      this.seasonsTxt = ` &nbsp; ${seasonsTxt}`;
    },

    setCntryLangTxt(tvdbData) {
      this.cntryLangLeftTxt = "";
      this.cntryLangRightTxt = "";
      this.runtimeTxt = "";

      let {
        originalCountry,
        originalLanguage,
        averageRuntime,
        originalNetwork,
      } = tvdbData;

      const capWords = (raw) => {
        const s = String(raw || "").trim();
        if (!s) return "";
        // Keep exact-cased tokens like "UK".
        if (s === "UK") return "UK";
        // Capitalize each whitespace-separated word; preserve punctuation like "/" and "+".
        return s
          .toLowerCase()
          .split(/\s+/)
          .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
          .join(" ");
      };

      originalNetwork = String(originalNetwork || "");
      const longNets = ["Amazon", "Paramount+"];
      longNets.forEach((net) => {
        if (originalNetwork.includes(net)) originalNetwork = net;
      });

      if (originalCountry === "gbr") originalCountry = "UK";
      originalCountry = String(originalCountry || "");
      originalLanguage = String(originalLanguage || "");
      originalNetwork = String(originalNetwork || "");

      const countryDisp = String(originalCountry || "")
        .trim()
        .toUpperCase();
      const languageDisp = capWords(originalLanguage);
      const networkDisp = String(originalNetwork || "")
        .trim()
        .toUpperCase();

      const left =
        `${countryDisp}${countryDisp ? "/" : ""}${languageDisp}`.trim();
      const right = `${networkDisp}`.trim();
      if (left) this.cntryLangLeftTxt = left;
      if (right) this.cntryLangRightTxt = right;

      const rt =
        averageRuntime !== undefined && averageRuntime !== null
          ? String(averageRuntime)
          : "";
      if (rt) this.runtimeTxt = `${rt} Mins`;
    },

    async setNextWatch() {
      const afterWatched = await emby.afterLastWatched(this.show);
      const status = afterWatched.status;
      const readyToWatch = status === "ok";
      if (this.show.inEmby !== false && status !== "allWatched") {
        const { seasonNumber, episodeNumber, episodeId } = afterWatched;

        // Defensive: never render "Eundefined" for malformed Emby items (e.g. Sxx.EXTRA).
        if (
          !Number.isFinite(+seasonNumber) ||
          !Number.isFinite(+episodeNumber)
        ) {
          this.nextUpValTxt = "";
          this.nextUpSuffixTxt = "";
          this.episodeId = "";
          // log return but don't forget to timeEnd if we leave?
          // actually this is just internal function return, but we should clear spinner if it was running (it's not)
        } else {
          // wrap rest in else or just let it flow, but if we return early we missed getDevices
          const seaEpiTxt =
            `S${("" + seasonNumber).padStart(2, "0")} ` +
            `E${("" + episodeNumber).padStart(2, "0")}`;
          if (readyToWatch) {
            this.episodeId = episodeId;
            this.nextUpValTxt = seaEpiTxt;
            this.nextUpSuffixTxt = "";
            this.nextUpSeason = seasonNumber;
            this.nextUpEpisode = episodeNumber;
          } else {
            const suffix = status === "missing" ? "No File" : "Unaired";
            this.nextUpValTxt = seaEpiTxt;
            this.nextUpSuffixTxt = suffix;
          }
        }
      } else {
        this.nextUpValTxt = "";
        this.nextUpSuffixTxt = "";
        this.nextUpSeason = null;
        this.nextUpEpisode = null;
      }
      await this.updateWatchButtons(readyToWatch);
    },

    async updateWatchButtons(readyToWatch) {
      const watchButtonTxtArr = [];
      try {
        // don't crash on device fetch fail
        const devices = await srvr.getDevices();
        for (const device of devices) {
          if (!device.showName) {
            if (readyToWatch)
              watchButtonTxtArr.push(`Play on ${device.deviceName}`);
          } else watchButtonTxtArr.push(`Stop ${device.deviceName}`);
        }
        this.watchButtonTxtArr = watchButtonTxtArr.sort();
      } catch (e) {
        console.error("updateWatchButtons Error:", e.message || e);
      }
    },

    async setRemotes() {
      this.remoteShowName = this.show.name;
      this.showRemotes = false;
      this.remotes = [];

      try {
        const tvdbId =
          this.show?.ProviderIds?.Tvdb ??
          this.show?.tvdbId ??
          this.show?.tvdbId ??
          this.show?.tvdb_id;
        const tvdbData = this.currentTvdbData || allTvdb?.[this.show.name];
        const remoteIds = tvdbData?.remote_ids || [];

        // Use centralized cache function, passing show context for inEmby/Id
        const showContext = {
          inEmby: this.show.inEmby,
          id: this.show.id,
        };
        // Use fast mode by default (can be overridden by passing false)
        const fast = this.remoteFetchMode !== "full";
        const results = await tvdb.getRemotes(
          this.show.name,
          tvdbId,
          remoteIds,
          showContext,
          fast,
        );

        const normalizeImdbRemoteName = (remote) => {
          if (!remote || !remote.name || !remote.name.startsWith("IMDB")) {
            return remote;
          }
          // Prefer explicit remote rating, then tvdb flat imdbRatings, then show.ratings.
          const rating =
            remote.ratings ||
            tvdbData?.imdbRatings ||
            tvdbData?.ratings ||
            this.show?.ratings ||
            null;
          if (!rating) return remote;
          if (remote.name.includes("(")) return remote;
          return { ...remote, name: `${remote.name} (${rating})` };
        };

        this.remotes = results.map(normalizeImdbRemoteName);
        this.showRemotes = results.length > 0;
        // Reset fetch mode after use
        this.remoteFetchMode = "fast";
      } catch (err) {
        console.error("setRemotes:", err);
        this.showRemotes = false;
      }
    },

    async watchButtonClick(show, watchButtonTxt) {
      await emby.startStop(show, this.episodeId, watchButtonTxt);
      setTimeout(async () => {
        await this.setNextWatch();
      }, 1000);
    },

    async loadIntoEmby() {
      const show = this.show;
      const name = String(show?.name || "").trim();
      if (!name) return;
      let tvdbId = String(show?.tvdbId || show?.tvdbId || "").trim();
      if (!tvdbId && show?.id) {
        tvdbId = await emby.getTvdbIdFromEmbyItem(show.id);
        if (tvdbId)
          console.log(
            `loadIntoEmby: resolved tvdbId ${tvdbId} from Emby for "${name}"`,
          );
      }
      if (!tvdbId) {
        try {
          const results = await tvdb.srchTvdbData(name);
          if (Array.isArray(results) && results.length > 0) {
            const nameUpper = name.toUpperCase();
            const match =
              results.find(
                (r) => String(r.name || "").toUpperCase() === nameUpper,
              ) || results[0];
            const candidate = String(match?.tvdb_id || match?.id || "").trim();
            if (candidate) {
              tvdbId = candidate;
              console.log(
                `loadIntoEmby: resolved tvdbId ${tvdbId} from TVDB search for "${name}"`,
              );
            }
          }
        } catch (e) {
          console.error(`loadIntoEmby: TVDB search failed for "${name}":`, e);
        }
      }
      const srchChoice = {
        name,
        tvdbId,
        overview: show?.overview || show?.overview || "",
        image: show?.image || show?.image_url || "",
        year: show?.year || "",
        originalCountry: show?.originalCountry || show?.country || "",
      };
      evtBus.emit("reelSearchAction", { srchChoice, action: "add" });
    },

    async antClick() {
      if (!this.show?.name) return;
      const original = !!this.show.anticipating;
      this.show.anticipating = !original;
      try {
        await srvr.setTvdbFields({
          name: this.show.name,
          anticipating: this.show.anticipating,
        });
      } catch (e) {
        console.error("antClick error:", e);
        this.show.anticipating = original;
      }
    },

    async refreshTvdb() {
      const showName = this.show.name;
      if (!showName) return;
      if (this.refreshing) {
        return;
      }
      this.refreshing = true;
      this.refreshPendingShowName = showName;
      this.showRefreshDialog = true;
      this.refreshDialogShowName = showName;
      this.refreshDialogStatus = "Updating TVDB...";
      srvr.triggerShowGapCheck(this.show.id || showName, showName).catch(() => {
        this.refreshing = false;
        this.refreshPendingShowName = "";
        this.refreshDialogStatus = "Error";
        setTimeout(() => {
          this.showRefreshDialog = false;
          this.refreshDialogShowName = "";
          this.refreshDialogStatus = "";
        }, 1200);
      });
    },

    async recheckTwoLocalFolders() {
      const showName = this.show?.name;
      if (!showName) {
        this.twoLocalFolders = false;
        return;
      }
      try {
        cachedDiskShows = await srvr.getShowsFromDisk();
        const folderNames = Object.keys(cachedDiskShows || {});
        const matchCount = folderNames.filter(
          (fn) => util.smartTitleMatch(showName, [fn], null, false) !== null,
        ).length;
        this.twoLocalFolders = matchCount >= 2;
      } catch (e) {
        this.twoLocalFolders = false;
      }
    },

    setupSeriesForRefresh(show) {
      // Wrapper to make onSetUpSeries awaitable for refresh
      return new Promise((resolve) => {
        // Pass completion callback to onSetUpSeries
        this.onSetUpSeries(show, () => {
          this.refreshing = false;
          resolve();
        });
      });
    },

    onSetUpSeries(show, onComplete = null) {
      // Prevent duplicate calls for the same show while already processing
      if (this.settingUpShowName === show?.name) {
        if (onComplete) onComplete();
        return;
      }

      this.settingUpShowName = show?.name;
      this.show = show;
      this.showHdr = true;

      if (this.previewMode) {
        evtBus.emit("previewPanesLoading", true);
      }

      const currentShowName = show.name;
      setTimeout(async () => {
        try {
          if (this.show.name !== currentShowName) return;

          // Force load all shows (including no-emby) by passing hasEmby=0
          // The cache from loadAllShows might only contain emby shows (hasEmby=1)
          allTvdb = await tvdb.getAllTvdb(0);

          if (this.show.name !== currentShowName) return;

          // Update collection badges for the new show
          const collections = [];
          if (show.inToTry) collections.push("To Try");
          if (show.inContinue) collections.push("Continue");
          if (show.inMark) collections.push("Mark");
          if (show.inLinda) collections.push("Linda");
          this.collectionName = collections.join(", ");
          this.collectionCount = collections.length;

          // Check for two local folders on disk - fire-and-forget, only sets twoLocalFolders UI flag
          void this.recheckTwoLocalFolders();
          let tvdbData = allTvdb[show.name];
          const currentTvdbId = String(
            show?.ProviderIds?.Tvdb ??
              show?.tvdbId ??
              show?.tvdbId ??
              show?.tvdb_id ??
              "",
          ).trim();

          if (!tvdbData && currentTvdbId) {
            for (const [key, rec] of Object.entries(allTvdb || {})) {
              const recTvdbId = String(rec?.tvdbId || rec?.tvdbId || "").trim();
              if (recTvdbId && recTvdbId === currentTvdbId) {
                tvdbData = rec;
                if (key !== show.name) {
                  console.info(
                    `Series: resolved tvdbData by tvdbId=${currentTvdbId} key=\"${key}\" for show=\"${show.name}\"`,
                  );
                }
                break;
              }
            }
          }

          // Preview / transient shows may not exist in tvdb.json yet.
          // If we have a TvdbId, fetch tvdbData from the server without creating the show.
          if (!tvdbData) {
            const tvdbId =
              show?.ProviderIds?.Tvdb ??
              show?.tvdbId ??
              show?.tvdbId ??
              show?.tvdb_id;
            if (tvdbId) {
              try {
                const showSeed = {
                  name: show?.name,
                  tvdbId: tvdbId,
                  overview: show?.overview,
                  reject: false,
                };
                const paramObj = {
                  show: showSeed,
                  seasonCount: 0,
                  episodeCount: 0,
                  watchedCount: 0,
                  transient: this.previewMode,
                };
                tvdbData = await srvr.getNewTvdb(paramObj);
                if (tvdbData) {
                  delete tvdbData.deleted;
                  tvdb.upsertTvdbCacheRecord(allTvdb, tvdbData, show?.name);
                }
              } catch (e) {
                console.error("Series: getNewTvdb failed (preview)", {
                  name: show?.name,
                  tvdbId,
                  err: e?.message || e,
                });
              }
            }
          }

          // If still no tvdbData and we have an IMDb ID, try searching by IMDb ID
          if (!tvdbData) {
            const imdbId =
              show?.ProviderIds?.Imdb ??
              show?.ImdbId ??
              show?.imdbId ??
              show?.imdb_id;
            if (imdbId) {
              try {
                console.log("Series: Trying IMDb ID search for", imdbId);
                tvdbData = await srvr.searchTvdbByImdbId({ imdbId });
                if (tvdbData) {
                  console.log(
                    "Series: Found tvdb data via IMDb ID:",
                    tvdbData.name,
                  );
                  delete tvdbData.deleted;
                  // Don't cache this in allTvdb since it's not a full record
                  // But update the show with the tvdbId we found
                  if (tvdbData.tvdbId && !show.tvdbId) {
                    show.tvdbId = tvdbData.tvdbId;
                  }
                }
              } catch (e) {
                console.error("Series: searchTvdbByImdbId failed", {
                  name: show?.name,
                  imdbId,
                  err: e?.message || e,
                });
              }
            }
          }

          this.currentTvdbData = tvdbData; // Store for actors pane
          evtBus.emit("tvdbDataReady", { show, tvdbData }); // Send to App.vue

          if (!tvdbData) {
            console.warn("Series: no tvdbData available for", show?.name);
            // Still show the infobox even without tvdbData, just with limited info
            // Try to set poster from show.imageUrl if available
            void this.setPoster(null);
            this.seriesReady = true;
            return;
          }

          // Update show.overview from tvdbData if available
          if (tvdbData.overview) {
            this.show.overview = tvdbData.overview;
          }

          // If tvdbData exists but has no image, force a refresh
          if (!tvdbData.image && show.tvdbId) {
            const showSeed = {
              name: show?.name,
              tvdbId: show.tvdbId,
              overview: show?.overview,
              reject: false,
            };
            const paramObj = {
              show: showSeed,
              seasonCount: 0,
              episodeCount: 0,
              watchedCount: 0,
              transient: this.previewMode,
            };
            try {
              const freshTvdbData = await srvr.getNewTvdb(paramObj);
              if (freshTvdbData) {
                delete freshTvdbData.deleted;
                tvdb.upsertTvdbCacheRecord(allTvdb, freshTvdbData, show?.name);
                tvdbData = freshTvdbData;
                this.currentTvdbData = freshTvdbData;
              }
            } catch (e) {
              console.error("Series: getNewTvdb image refresh failed:", e);
            }
          }

          await this.setDeleted(tvdbData);

          // Don't await poster!
          void this.setPoster(tvdbData);

          await this.setDates(tvdbData);

          this.setGenresTxt(tvdbData);
          void this.setCrewTxt(tvdbData);

          await this.setSeasonsTxt(tvdbData);

          await this.setCntryLangTxt(tvdbData);

          if (this.previewMode) {
            // Preview should render core info immediately; remotes can populate later.
            this.seriesReady = true;
            void this.$nextTick().then(() => {
              const infoBoxEl = document.getElementById("infoBox");
              const posterImg = document.querySelector("#poster img");
              if (infoBoxEl && posterImg && infoBoxEl.clientHeight > 0) {
                console.log(
                  `[poster-size] preview nextTick: ${infoBoxEl.clientHeight}px for ${this.show?.name}`,
                );
                posterImg.style.maxHeight = infoBoxEl.clientHeight + "px";
                posterImg.style.visibility = "visible";
              }
            });
            void this.setRemotes();
          } else {
            await this.setNextWatch();
            await this.setRemotes();
            // Only show the info box (and email input) once everything is populated.
            this.seriesReady = true;
            await this.$nextTick();
            const infoBoxEl = document.getElementById("infoBox");
            const posterImg = document.querySelector("#poster img");
            if (infoBoxEl && posterImg && infoBoxEl.clientHeight > 0) {
              console.log(
                `[poster-size] seriesReady nextTick: ${infoBoxEl.clientHeight}px for ${this.show?.name}`,
              );
              posterImg.style.maxHeight = infoBoxEl.clientHeight + "px";
              posterImg.style.visibility = "visible";
            }
          }
        } finally {
          evtBus.emit("previewPanesLoading", false);
          this.settingUpShowName = null; // Clear flag when done
          // Call completion callback if provided (used by refresh)
          if (onComplete) onComplete();
        }
      }, 10);
    },

    async onSeriesMapUpdated({ show, seriesMap }) {
      if (!show || !seriesMap) return;
      if (!this.show || this.show.name !== show.name) return;
      if (this.show.inEmby !== false) return;

      const { seasonCount, episodeCount } = this.getMapCounts(seriesMap);
      if (!episodeCount || !seasonCount) return;

      // Check if watchedEpis is null or undefined (unknown/missing watch status)
      const tvdbData = allTvdb?.[show.name];
      const watchedEpisIsNull = tvdbData?.watchedEpis === null;
      const watchedEpisIsUndefined = tvdbData?.watchedEpis === undefined;
      const watchedEpisMissing = watchedEpisIsNull || watchedEpisIsUndefined;

      // Calculate watchedCount from seriesMap
      let watchedCount = 0;
      try {
        const seasonKeys = Object.keys(seriesMap || {});
        for (const seasonKey of seasonKeys) {
          const episodes = seriesMap[seasonKey] || {};
          const episodeKeys = Object.keys(episodes);
          for (const episodeKey of episodeKeys) {
            const epiObj = episodes[episodeKey];
            if (epiObj?.played) {
              watchedCount++;
            }
          }
        }
      } catch (e) {
        console.error("Error calculating watchedCount from seriesMap:", e);
      }

      const seasonsTxt =
        seasonCount === 1 ? "1 Season" : `${seasonCount} Seasons`;
      this.seasonsTxt = " &nbsp; " + seasonsTxt;

      // If watchedEpis is missing (null or undefined), preserve existing watchedCount
      // and show it if available, rather than showing ? or overwriting with 0
      if (watchedEpisMissing) {
        // Preserve the existing watchedCount instead of overwriting with 0
        const existingWatchedCount = tvdbData?.watchedCount;
        if (
          existingWatchedCount != null &&
          existingWatchedCount !== undefined
        ) {
          // We have a stored watchedCount - use it
          watchedCount = existingWatchedCount;
          this.watchedValTxt =
            existingWatchedCount === episodeCount
              ? `all ${episodeCount} episodes`
              : `${existingWatchedCount} of ${episodeCount}`;
        } else {
          // No stored count either - truly unknown
          watchedCount = 0;
          this.watchedValTxt = `? of ${episodeCount}`;
        }
      } else {
        this.watchedValTxt =
          watchedCount > 0
            ? `${watchedCount} of ${episodeCount}`
            : `0 of ${episodeCount}`;
      }

      if (tvdbData && !this.previewMode) {
        try {
          await srvr.setTvdbFields({
            name: show.name,
            seasonCount,
            episodeCount,
            watchedCount,
            dontEnqueue: true,
            dontNotify: true,
          });
        } catch (e) {
          // Non-fatal: UI already corrected.
        }
      }
    },
  },

  /////////////////  MOUNTED  /////////////////
  // series vue component at mounted phase
  // set everything in html
  mounted() {
    evtBus.on("setUpSeries", this.onSetUpSeries);
    evtBus.on("previewMode", this.onPreviewMode);
    evtBus.on("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.on("addPreviewShowDone", this.onAddPreviewShowDone);

    this._onNowPlaying = ({ playing } = {}) => {
      const name = this.show?.name;
      if (!name || !Array.isArray(playing)) {
        this.nowPlayingDevices = [];
        return;
      }
      this.nowPlayingDevices = playing
        .filter((p) => p.showName === name)
        .map((p) => p.device);
    };
    evtBus.on("nowPlaying", this._onNowPlaying);

    // Keep the Series infobox totals in sync with the actual Map grid.
    // This matters for noemby shows where tvdb.json counts can be stale / mismatched.
    evtBus.on("seriesMapUpdated", this.onSeriesMapUpdated);

    // Refresh remotes/buttons when server pushes updated tvdb data (push2 or push3).
    this.onTvdbUpdated = async ({ name, record } = {}) => {
      if (!name) {
        return;
      }

      // Clear refresh state as soon as server confirms an update for the show,
      // even if payload is partial/missing.
      const matchesSelected = this.show?.name === name;
      const matchesPending = this.refreshPendingShowName === name;
      if (matchesSelected || matchesPending) {
        this.refreshDialogStatus = "Finalizing...";
        this.refreshing = false;
        this.refreshPendingShowName = "";
        setTimeout(() => {
          this.showRefreshDialog = false;
          this.refreshDialogShowName = "";
          this.refreshDialogStatus = "";
        }, 350);
      }

      if (!record || !matchesSelected) return;
      tvdb.applyTvdbPush(name, record);

      // Update all infobox fields from the pushed record
      if (this.seriesReady) void this.setRemotes();
      void this.setDates(record);
      this.setGenresTxt(record);
      void this.setCrewTxt(record);
      void this.setSeasonsTxt(record);
      void this.setCntryLangTxt(record);

      // Capture existing poster size before updating image (content changes may alter infoBox height)
      const existingPosterImg = document.querySelector("#poster img");
      const existingMaxHeight =
        existingPosterImg?.style.maxHeight &&
        existingPosterImg.style.visibility === "visible"
          ? parseInt(existingPosterImg.style.maxHeight)
          : 0;

      // Update poster image without auto-show (we'll restore the existing height)
      await this.setPoster(record, { noAutoShow: true });
      const posterImg = document.querySelector("#poster img");
      if (posterImg) {
        const infoBoxEl = document.getElementById("infoBox");
        const newHeight = infoBoxEl?.clientHeight || 0;
        if (existingMaxHeight > 0) {
          // Keep the same size - don't let content changes shrink the poster
          console.log(
            `[poster-size] tvdbUpdated: keeping ${existingMaxHeight}px (infoBox=${newHeight}px) for ${this.show?.name}`,
          );
          posterImg.style.maxHeight = existingMaxHeight + "px";
        } else {
          if (infoBoxEl && newHeight > 0) {
            console.log(
              `[poster-size] tvdbUpdated: ${newHeight}px for ${this.show?.name}`,
            );
            posterImg.style.maxHeight = newHeight + "px";
          }
        }
        posterImg.style.visibility = "visible";
      }
    };
    evtBus.on("tvdbUpdated", this.onTvdbUpdated);

    this.onShowUpdating = ({ name } = {}) => {
      if (!name || !this.refreshing) return;
      if (name !== this.refreshPendingShowName) {
        return;
      }
      this.showRefreshDialog = true;
      this.refreshDialogShowName = name;
      this.refreshDialogStatus = "Updating TVDB...";
    };
    evtBus.on("showUpdating", this.onShowUpdating);

    // Fallback: if queue drains without a usable tvdbUpdated payload, clear state.
    this.onShowQueueEmpty = () => {
      if (!this.refreshing) return;
      this.refreshDialogStatus = "Done";
      this.refreshing = false;
      this.refreshPendingShowName = "";
      setTimeout(() => {
        this.showRefreshDialog = false;
        this.refreshDialogShowName = "";
        this.refreshDialogStatus = "";
      }, 350);
    };
    evtBus.on("showQueueEmpty", this.onShowQueueEmpty);
    evtBus.on("localFoldersChanged", this.recheckTwoLocalFolders);
    this._onPaneChanged = (pane) => {
      if (pane !== "info") return;
      this.$nextTick(() => {
        // Skip if still loading a new show - seriesReady nextTick will handle it
        if (this.settingUpShowName) return;
        const infoBoxEl = document.getElementById("infoBox");
        const posterImg = document.querySelector("#poster img");
        if (infoBoxEl && posterImg && infoBoxEl.clientHeight > 0) {
          console.log(
            `[poster-size] paneChanged: ${infoBoxEl.clientHeight}px for ${this.show?.name}`,
          );
          posterImg.style.maxHeight = infoBoxEl.clientHeight + "px";
          posterImg.style.visibility = "visible";
        }
      });
    };
    evtBus.on("paneChanged", this._onPaneChanged);
  },

  beforeUnmount() {
    evtBus.off("setUpSeries", this.onSetUpSeries);
    evtBus.off("previewMode", this.onPreviewMode);
    evtBus.off("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.off("addPreviewShowDone", this.onAddPreviewShowDone);
    evtBus.off("seriesMapUpdated", this.onSeriesMapUpdated);
    if (this._onNowPlaying) evtBus.off("nowPlaying", this._onNowPlaying);
    if (this.onTvdbUpdated) evtBus.off("tvdbUpdated", this.onTvdbUpdated);
    if (this.onShowUpdating) evtBus.off("showUpdating", this.onShowUpdating);
    if (this.onShowQueueEmpty)
      evtBus.off("showQueueEmpty", this.onShowQueueEmpty);
    evtBus.off("localFoldersChanged", this.recheckTwoLocalFolders);
    if (this._onPaneChanged) evtBus.off("paneChanged", this._onPaneChanged);
  },
};
</script>

<style>
#series {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

#series::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

button {
  cursor: pointer;
}
</style>
