<template>
  <div
    class="torrents-container"
    :style="{
      height: '100%',
      width: '100%',
      display: 'flex',
      justifyContent: 'flex-start',
    }"
  >
    <div
      id="tor"
      ref="scroller"
      :style="{
        height: '100%',
        width: '100%',
        padding: '10px',
        margin: 0,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        overflowX: 'hidden',
        maxWidth: '100%',
        boxSizing: 'border-box',
        backgroundColor: '#fafafa',
      }"
      @wheel.stop.prevent="handleScaledWheel"
    >
      <div
        id="header"
        :style="{
          position: 'sticky',
          top: '-10px',
          zIndex: 100,
          backgroundColor: '#fafafa',
          paddingTop: '15px',
          paddingLeft: '10px',
          paddingRight: '10px',
          paddingBottom: '10px',
          marginLeft: '0px',
          marginRight: '0px',
          marginTop: '-10px',
          marginBottom: '0px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
        }"
        class="pane-header-title"
      >
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
          "
        >
          <div style="margin-left: 20px">{{ headerShowName }}</div>
          <div style="display: flex; gap: 8px; margin-left: auto">
            <span
              v-if="loading"
              style="font-size: 13px; color: #666; align-self: center"
              >Searching</span
            >
            <button
              v-if="selectedTorrent"
              @click.stop="
                showStream = false;
                continueDownload();
              "
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Get
            </button>
            <button
              v-if="selectedTorrent"
              @click.stop="
                showStream = false;
                openDetails();
              "
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Tab
            </button>
            <input
              v-model="seasonFilter"
              @keydown.stop
              @click.stop
              placeholder="Season"
              style="
                width: 60px;
                font-size: 13px;
                padding: 4px;
                border: 1px solid #bbb;
                border-radius: 7px;
              "
            />
            <button
              @click.stop="
                showStream = false;
                searchClick();
              "
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Search
            </button>
            <button
              @click.stop="
                showStream = false;
                moreClick();
              "
              :disabled="hasMoreProviders"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              More
            </button>
            <button
              @click.stop="
                showStream = false;
                forceClick();
              "
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Force
            </button>
            <button
              @click.stop="
                showStream = false;
                openTorTabs();
              "
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Tabs
            </button>
            <button
              @click.stop="showStream = !showStream"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '7px',
                padding: '4px',
                border: '1px solid #bbb',
                '--btn-bg': showStream ? 'lightgray' : 'whitesmoke',
              }"
            >
              Stream
            </button>
            <button
              @click.stop="
                showStream = false;
                toggleCookieInputs();
              "
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 7px;
                padding: 4px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Cookies
            </button>
          </div>
        </div>
        <div
          style="
            height: 1px;
            width: 100%;
            background-color: #000;
            margin-top: 6px;
          "
        ></div>
        <div
          v-if="!showStream"
          style="
            margin-left: 0;
            margin-right: 20px;
            margin-top: 6px;
            font-weight: normal;
            font-size: 15px;
            color: #666;
            line-height: 1.1;
            overflow: visible;
            display: flex;
            align-items: center;
            justify-content: space-between;
            white-space: nowrap;
          "
        >
          <span
            ><strong>USB</strong>: {{ spaceUsbGb }} GB {{ spaceUsbPct }} |
            <strong>SRVR</strong>: {{ spaceSrvrGb }} GB {{ spaceSrvrPct }}</span
          >
          <span
            v-if="providerStats && Object.keys(providerStats).length > 0"
            style="color: #888; margin-left: 16px"
            v-html="headerIdsLine"
          ></span>
        </div>
        <div
          v-if="!showStream"
          style="
            height: 1px;
            width: 100%;
            background-color: #000;
            margin-top: 6px;
          "
        ></div>
      </div>
      <div
        id="unaired"
        v-if="!showStream && unaired"
        style="
          text-align: center;
          color: #666;
          margin-top: 50px;
          font-size: 18px;
        "
      >
        <div>Show not aired yet</div>
      </div>
      <Stream
        :show="currentShow"
        :visible="showStream"
      />
      <div
        id="cookie-inputs"
        @click.stop
        v-if="
          !showStream &&
          !loading &&
          ((isCookieRelatedError && !dismissCookieInputs) || showCookieInputs)
        "
        style="
          position: sticky;
          top: 120px;
          zindex: 120;
          padding: 15px 20px 15px 20px;
          margin-bottom: 10px;
          background: #fff;
          border-radius: 5px;
          border: 1px solid #ddd;
        "
      >
        <div style="margin-bottom: 10px">
          <label
            style="
              display: block;
              font-size: 12px;
              font-weight: bold;
              margin-bottom: 3px;
              color: #555;
            "
            >IPTorrents cf_clearance:</label
          >
          <input
            v-model="iptCfClearance"
            type="text"
            placeholder="Paste cf_clearance cookie value"
            style="
              width: 100%;
              padding: 6px;
              font-size: 12px;
              border: 1px solid #ccc;
              border-radius: 3px;
              box-sizing: border-box;
            "
          />
        </div>
        <div style="margin-bottom: 10px">
          <label
            style="
              display: block;
              font-size: 12px;
              font-weight: bold;
              margin-bottom: 3px;
              color: #555;
            "
            >TorrentLeech cf_clearance:</label
          >
          <input
            v-model="tlCfClearance"
            type="text"
            placeholder="Paste cf_clearance cookie value"
            style="
              width: 100%;
              padding: 6px;
              font-size: 12px;
              border: 1px solid #ccc;
              border-radius: 3px;
              box-sizing: border-box;
            "
          />
        </div>
        <div style="margin-top: 10px">
          <button
            @click.stop="saveCookies"
            :disabled="loading"
            style="
              padding: 8px 20px;
              font-size: 13px;
              font-weight: bold;
              cursor: pointer;
              border-radius: 5px;
              background: #4caf50;
              color: white;
              border: none;
              width: 100%;
            "
          >
            Save Cookies
          </button>
        </div>
      </div>
      <div
        id="debug-panel"
        @click.stop
        v-if="!loading &amp;&amp; showDebug"
        style="
          position: sticky;
          top: 120px;
          zindex: 119;
          padding: 12px 16px;
          margin-bottom: 10px;
          background: #fff;
          border-radius: 5px;
          border: 1px solid #ddd;
          font-weight: normal;
        "
      >
        <div
          style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
          "
        >
          <div style="font-weight: bold; color: #444; font-size: 12px">
            Debug
          </div>
          <div style="display: flex; gap: 8px; align-items: center">
            <button
              v-if="lastSearchUrl"
              @click.stop="copyDebugUrl"
              style="
                font-size: 12px;
                cursor: pointer;
                border-radius: 6px;
                padding: 2px 8px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Copy URL
            </button>
            <button
              @click.stop="showDebug = false"
              style="
                font-size: 12px;
                cursor: pointer;
                border-radius: 6px;
                padding: 2px 8px;
                border: 1px solid #bbb;
                background-color: whitesmoke;
              "
            >
              Close
            </button>
          </div>
        </div>
        <div
          style="
            font-size: 12px;
            color: #555;
            line-height: 1.35;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          "
        >
          <div
            v-if="debugCopyMsg"
            style="color: #2b6; margin-bottom: 6px"
          >
            {{ debugCopyMsg }}
          </div>
          <div v-if="lastSearchShow">
            <span style="font-weight: bold">show:</span> {{ lastSearchShow }}
          </div>
          <div v-if="lastSearchNeeded">
            <span style="font-weight: bold">needed:</span>
            {{ lastSearchNeeded }}
          </div>
          <div v-if="lastSearchUrl">
            <span style="font-weight: bold">url:</span> {{ lastSearchUrl }}
          </div>
          <div v-if="lastApiCount !== null">
            <span style="font-weight: bold">api count:</span> {{ lastApiCount }}
          </div>
          <div v-if="lastRawProviderCounts">
            <span style="font-weight: bold">rawProviderCounts:</span>
            {{ formatJsonInline(lastRawProviderCounts) }}
          </div>
          <div v-if="lastReturnedProviderCounts">
            <span style="font-weight: bold">returnedProviderCounts:</span>
            {{ formatJsonInline(lastReturnedProviderCounts) }}
          </div>
          <div v-if="lastWarningSummary">
            <span style="font-weight: bold">warningSummary:</span>
            {{ formatJsonInline(lastWarningSummary) }}
          </div>
        </div>
      </div>

      <div
        id="error"
        v-if="!unaired &amp;&amp; error"
        style="
          text-align: center;
          color: #c00;
          margin-top: 50px;
          font-size: 16px;
          white-space: pre-line;
          padding: 0 20px;
        "
      >
        <div>Error: {{ error }}</div>
      </div>
      <div
        id="warning"
        v-if="!unaired &amp;&amp; !error &amp;&amp; providerWarning"
        style="
          text-align: center;
          color: #b36b00;
          margin-top: 20px;
          font-size: 14px;
          white-space: pre-line;
          padding: 0 20px;
        "
      >
        <div>{{ providerWarning }}</div>
      </div>
      <div
        id="no-torrents-needed"
        v-if="!showStream && !unaired && noTorrentsNeeded && !loading && !error"
        style="
          text-align: center;
          color: #666;
          margin-top: 50px;
          font-size: 18px;
        "
      >
        <div>No torrents needed.</div>
      </div>
      <div
        id="torrents-list"
        v-if="
          !showStream &&
          !unaired &&
          (!loading || torrents.length > 0) &&
          !noTorrentsNeeded
        "
        style="
          padding: 10px;
          font-size: 14px;
          font-family: sans-serif;
          font-weight: normal;
        "
      >
        <div
          v-if="hasSearched &amp;&amp; filteredTorrents.length === 0 &amp;&amp; !error"
          style="text-align: center; color: #999; margin-top: 50px"
        >
          <div>No torrents found.</div>
        </div>
        <div
          v-for="(torrent, index) in filteredTorrents"
          :key="getTorrentCardKey(torrent, index)"
          @click="handleTorrentClick($event, torrent)"
          @click.stop
          :style="getCardStyle(torrent)"
          @mouseenter="
            $event.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)'
          "
          @mouseleave="$event.currentTarget.style.boxShadow = 'none'"
        >
          <div
            v-if="isClicked(torrent)"
            style="
              position: absolute;
              top: 8px;
              right: 8px;
              color: #4caf50;
              font-size: 20px;
              font-weight: bold;
            "
          >
            ✓
          </div>
          <div
            v-if="isDownloadedBefore(torrent)"
            :style="getDownloadedBeforeIconStyle(torrent)"
            title="Downloaded before"
          >
            🕘
          </div>
          <div
            v-if="getDownloadStatus(torrent)"
            :title="getDownloadStatusTooltip(torrent)"
            style="
              position: absolute;
              bottom: 8px;
              right: 8px;
              font-size: 11px;
              color: #666;
              max-width: 70%;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            "
          >
            {{ getDownloadStatusLabel(torrent) }}
          </div>
          <div
            v-if="SHOW_TITLE &amp;&amp; torrent.raw"
            style="
              font-size: 14px;
              font-weight: bold;
              color: #888;
              margin-bottom: 4px;
              white-space: normal;
              overflow-wrap: anywhere;
              word-break: break-word;
              font-family: sans-serif;
            "
          >
            {{ getDisplayTitleWithProvider(torrent) }}
          </div>
          <div
            v-if="getTorrentWarnings(torrent).length &gt; 0"
            style="
              font-size: 11px;
              color: #a33;
              margin-bottom: 4px;
              white-space: normal;
              overflow-wrap: anywhere;
              word-break: break-word;
            "
          >
            {{ formatTorrentWarnings(torrent) }}
          </div>
          <div
            style="
              margin-top: 8px;
              font-size: 13px;
              font-family: sans-serif;
              color: #333;
            "
          >
            <span style="color: blue !important">{{
              getDisplaySeasonEpisode(torrent)
            }}</span
            ><span style="color: rgba(0, 0, 0, 0.5) !important"
              >:
              {{ fmtSize(torrent.raw?.size) || torrent.raw?.size || "N/A" }} |
              {{ torrent.raw?.seeds || 0 }} seeds<span
                v-if="torrent.raw?.provider"
                style="color: rgba(0, 0, 0, 0.5) !important"
                >&nbsp;|&nbsp;{{ formatProvider(torrent.raw.provider) }}</span
              ><span
                v-if="torrent.parsed?.resolution"
                style="color: rgba(0, 0, 0, 0.5) !important"
                >&nbsp;|&nbsp;{{ torrent.parsed.resolution }}</span
              ><span
                v-if="torrent.parsed?.group"
                style="color: rgba(0, 0, 0, 0.5) !important"
                >&nbsp;|&nbsp;{{ formatGroup(torrent.parsed.group) }}</span
              ></span
            >
          </div>
          <div
            v-if="
              getDownloadStatus(torrent)?.status === 'error' &&
              getDownloadStatus(torrent)?.message
            "
            style="
              margin-top: 6px;
              font-size: 11px;
              color: #c00;
              white-space: normal;
              overflow-wrap: anywhere;
              word-break: break-word;
            "
          >
            {{ getDownloadStatus(torrent).message }}
          </div>
        </div>
      </div>
    </div>
    <div
      id="download-modal"
      v-if="showModal"
      @click.stop="showModal = false"
      style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      "
    >
      <div
        id="modal-content"
        @click.stop
        style="
          background: white;
          padding: 30px;
          border-radius: 10px;
          max-width: 500px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        "
      >
        <div style="font-size: 16px; margin-bottom: 20px; line-height: 1.5">
          Is it OK to download file
          <span style="font-weight: bold">{{
            selectedTorrent?.raw?.title || "Unknown"
          }}</span
          >?
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end">
          <button
            @click.stop="cancelDownload"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            Cancel
          </button>
          <button
            @click.stop="continueDownload"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            OK
          </button>
        </div>
      </div>
    </div>
    <div
      id="error-modal"
      v-if="showErrorModal"
      @click.stop="closeErrorModal"
      style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      "
    >
      <div
        id="modal-content"
        @click.stop
        style="
          background: white;
          padding: 30px;
          border-radius: 10px;
          max-width: 520px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        "
      >
        <div
          style="
            font-size: 16px;
            margin-bottom: 20px;
            line-height: 1.5;
            white-space: pre-line;
          "
        >
          {{ errorModalMsg }}
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end">
          <button
            @click.stop="closeErrorModal"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            OK
          </button>
        </div>
      </div>
    </div>
    <div
      id="existing-delete-modal"
      v-if="showExistingDeleteModal"
      @click.stop="cancelExistingDelete"
      style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
      "
    >
      <div
        id="modal-content"
        @click.stop
        style="
          background: white;
          padding: 30px;
          border-radius: 10px;
          max-width: 520px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        "
      >
        <div
          style="
            font-size: 16px;
            margin-bottom: 20px;
            line-height: 1.5;
            white-space: pre-line;
          "
        >
          {{ existingDeleteModalMsg }}
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end">
          <button
            @click.stop="cancelExistingDelete"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            Cancel
          </button>
          <button
            @click.stop="confirmExistingDelete"
            style="
              padding: 8px 20px;
              font-size: 14px;
              cursor: pointer;
              border-radius: 5px;
              border: 1px solid #ccc;
              background: white;
            "
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import evtBus from "../evtBus.js";
import * as emby from "../emby.js";
import * as util from "../util.js";
import { config } from "../config.js";
import Stream from "./stream.vue";

export default {
  name: "Torrents",
  components: { Stream },

  props: {
    simpleMode: {
      type: Boolean,
      default: false,
    },
    activeShow: {
      type: Object,
      default: null,
    },
    sizing: {
      type: Object,
      default: () => ({}),
    },
  },

  data() {
    return {
      torrents: [],
      showName: "",
      loading: false,
      error: null,
      hasSearched: false,
      providerWarning: "",
      maxResults: 500, // Constant for maximum results to fetch
      seasonFilter: "",
      iptCfClearance: "",
      tlCfClearance: "",
      currentShow: null,
      SHOW_TITLE: true, // Show torrent title on card
      selectedTorrent: null, // Currently selected torrent
      showModal: false, // Show download confirmation modal
      showErrorModal: false,
      errorModalMsg: "",

      showExistingDeleteModal: false,
      existingDeleteModalMsg: "",
      existingDeleteWrapper: null,
      existingDeleteResolve: null,
      clickedTorrents: new Set(), // Track which torrents have been clicked
      downloadedTorrents: new Set(), // Track which torrents have been downloaded via Get button
      noTorrentsNeeded: false, // Flag when needed array is empty
      showCookieInputs: false, // Manual toggle for cookie input boxes
      dismissCookieInputs: false,
      showStream: false,
      unaired: false,

      lastNeeded: null,

      downloadedByHash: {},

      // Space display cells (2x2): rows USB/SRVR, cols GB/%.
      spaceUsbGb: "--",
      spaceUsbPct: "--%",
      spaceSrvrGb: "--",
      spaceSrvrPct: "--%",

      _didInitialScroll: false,

      lastAutoSearchedShowId: null,

      // Debug: last search request/response metadata
      showDebug: false,
      lastSearchUrl: "",
      lastSearchShow: "",
      lastSearchNeeded: "",
      lastRawProviderCounts: null,
      lastReturnedProviderCounts: null,
      lastApiCount: null,
      lastWarningSummary: null,
      debugCopyMsg: "",

      // Download queue/state (avoid dropped requests + show per-torrent results)
      downloadQueue: [],
      downloadQueueRunning: false,
      downloadStatus: {},

      // More providers (TPB/LIM/EZT) state
      hasMoreProviders: false,
      providerStats: null,
      resultsShowId: null,
    };
  },

  computed: {
    headerShowName() {
      const name =
        this.showName || this.currentShow?.Name || this.activeShow?.Name || "";
      if (!name) return "";
      const hasYear = /\(\d{4}\)/.test(name);
      if (!hasYear) {
        const firstAired =
          this.currentShow?.firstAired || this.activeShow?.firstAired || "";
        const year = firstAired ? firstAired.substring(0, 4) : "";
        if (year) return `${name} (${year})`;
      }
      return name;
    },
    headerIdsLine() {
      if (this.providerStats && Object.keys(this.providerStats).length > 0) {
        return Object.entries(this.providerStats)
          .map(
            ([code, { filtered, total }]) =>
              `<strong>${code}</strong>: ${filtered}/${total}`,
          )
          .join("  |  ");
      }
      return "";
    },
    filteredTorrents() {
      // Use season filter if present
      const sVal = parseInt(this.seasonFilter, 10);
      const hasSeasonFilter =
        !isNaN(sVal) && sVal >= 0 && String(this.seasonFilter).trim() !== "";

      const asNumber = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      const hasWarn = (t) => this.getTorrentWarnings(t).length > 0;

      const getSeason = (t) => {
        if (t.seasonRange && t.seasonRange.isRange)
          return asNumber(t.seasonRange.startSeason);
        if (
          t.parsed &&
          t.parsed.season !== undefined &&
          t.parsed.season !== null
        )
          return asNumber(t.parsed.season);
        return 999999;
      };

      const getType = (t) => {
        // Season Range
        if (t.seasonRange && t.seasonRange.isRange) return 1;

        // Check for parsed structure
        if (t.parsed) {
          // Note: 0 is a valid season/episode, check against undefined/null
          const hasSeason =
            t.parsed.season !== undefined && t.parsed.season !== null;
          const hasEpisode =
            t.parsed.episode !== undefined && t.parsed.episode !== null;

          if (hasSeason && !hasEpisode) return 2; // Season Pack
          if (hasSeason && hasEpisode) return 3; // Individual Episode
        }

        return 4; // Other
      };

      let list = Array.isArray(this.torrents) ? this.torrents : [];

      if (hasSeasonFilter) {
        list = list.filter((t) => {
          if (t.seasonRange && t.seasonRange.isRange) {
            const s = Number(t.seasonRange.startSeason);
            const e = Number(t.seasonRange.endSeason);
            return (
              Number.isFinite(s) && Number.isFinite(e) && sVal >= s && sVal <= e
            );
          }
          if (
            t.parsed &&
            t.parsed.season !== undefined &&
            t.parsed.season !== null
          ) {
            return Number(t.parsed.season) === sVal;
          }
          return false;
        });
      }

      return list.slice().sort((a, b) => {
        // 1. Highest Priority: Warnings (non-warned items first)
        const wa = hasWarn(a) ? 1 : 0;
        const wb = hasWarn(b) ? 1 : 0;
        if (wa !== wb) return wa - wb;

        // 2. Second Priority: Season
        const sA = getSeason(a);
        const sB = getSeason(b);
        if (sA !== sB) return sA - sB; // Ascending

        // 3. Third Priority: Type
        // Season Ranges (1) -> Season Packs (2) -> Individual Episodes (3) -> Other (4)
        const typeA = getType(a);
        const typeB = getType(b);
        if (typeA !== typeB) return typeA - typeB;

        // 4. Type-specific secondary
        if (typeA === 1) {
          // Season Range
          // Then by last in reverse order
          const s2A = asNumber(a.seasonRange?.endSeason);
          const s2B = asNumber(b.seasonRange?.endSeason);
          if (s2A !== s2B) return s2B - s2A; // Descending
        } else if (typeA === 3) {
          // Individual Episode
          // Then by episode
          const eA = asNumber(a.parsed?.episode);
          const eB = asNumber(b.parsed?.episode);
          if (eA !== eB) return eA - eB; // Ascending
        }

        // 5. Rest of priorities (Seeds -> Title)
        const sd = asNumber(b?.raw?.seeds) - asNumber(a?.raw?.seeds);
        if (sd !== 0) return sd;

        const ta = String(a?.raw?.title || a?.title || "");
        const tb = String(b?.raw?.title || b?.title || "");
        return ta.localeCompare(tb);
      });
    },
    trackerCounts() {
      const counts = {};
      this.torrents.forEach((torrent) => {
        const provider = torrent.raw?.provider || "Unknown";
        counts[provider] = (counts[provider] || 0) + 1;
      });
      return counts;
    },
    isCookieRelatedError() {
      // Also show for explicit cookie-related errors even if we got some results
      if (this.error) {
        const errorLower = this.error.toLowerCase();
        return (
          errorLower.includes("cf_clearance") ||
          errorLower.includes("access denied") ||
          errorLower.includes("403") ||
          errorLower.includes("401") ||
          errorLower.includes("forbidden")
        );
      }

      return false;
    },
  },

  mounted() {
    evtBus.on("paneChanged", this.onPaneChanged);
    evtBus.on("showTorrents", this.searchTorrents);
    evtBus.on("resetTorrentsPane", this.resetPane);
    evtBus.on("refreshSpaceAvail", this.onRefreshSpaceAvail);
    evtBus.on("openStream", this.onOpenStream);

    this.loadDownloadedHistory();

    // App-load refresh: populate space strings as soon as the component mounts.
    void this.updateSpaceAvail();

    // Establish an initial "bottom" baseline on app load.
    // v-show preserves scroll position even when hidden.
    void this.$nextTick(() => {
      this.scrollToBottom();
    });
  },

  unmounted() {
    evtBus.off("paneChanged", this.onPaneChanged);
    evtBus.off("showTorrents", this.searchTorrents);
    evtBus.off("resetTorrentsPane", this.resetPane);
    evtBus.off("refreshSpaceAvail", this.onRefreshSpaceAvail);
    evtBus.off("openStream", this.onOpenStream);
  },

  methods: {
    toggleDebug() {
      this.showDebug = !this.showDebug;
    },
    async copyDebugUrl() {
      const text = String(this.lastSearchUrl || "").trim();
      if (!text) return;

      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        this.debugCopyMsg = "Copied URL to clipboard";
      } catch {
        this.debugCopyMsg = "Copy failed (clipboard blocked)";
      }

      window.clearTimeout(this._debugCopyTimer);
      this._debugCopyTimer = window.setTimeout(() => {
        this.debugCopyMsg = "";
      }, 1500);
    },
    formatJsonInline(obj) {
      try {
        return JSON.stringify(obj);
      } catch {
        return String(obj);
      }
    },
    getTorrentWarnings(torrent) {
      const w = torrent?.warnings ?? torrent?.raw?.warnings;
      return Array.isArray(w) ? w : [];
    },
    formatTorrentWarnings(torrent) {
      const warnings = this.getTorrentWarnings(torrent);
      if (!warnings.length) return "";

      const codes = warnings.map((w) => w.code);
      const lowRes = codes.includes("low_res_480");
      const noSeeds = codes.includes("zero_seeds");

      if (lowRes && noSeeds) return "Warning: Low Resolution and No Seeds";
      if (lowRes) return "Warning: Low Resolution";
      if (noSeeds) return "Warning: No Seeds";

      return warnings
        .map((w) => {
          const code = String(w?.code || "").trim();
          const msg = String(w?.message || "").trim();
          if (code && msg && msg.toLowerCase() !== code.toLowerCase())
            return `${code} (${msg})`;
          return code || msg || "";
        })
        .filter(Boolean)
        .join(", ");
    },
    fmtSize(bytesOrHumanString) {
      return util.fmtBytesSize(bytesOrHumanString);
    },
    handleScaledWheel(event) {
      if (!event) return;
      const el = event.currentTarget;
      if (!el) return;
      const dy = event.deltaY || 0;
      const scaledDy = dy * 0.125;
      const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      el.scrollTop = Math.max(0, Math.min(max, (el.scrollTop || 0) + scaledDy));
    },

    onPaneChanged(pane) {
      if (pane === "tor") {
        // Keep space info fresh whenever Tor pane is shown.
        void this.updateSpaceAvail();
        // Auto-search when pane becomes active, but only once per show.
        const showId = this.activeShow?.Id || this.activeShow?.Name || null;
        if (showId && showId !== this.lastAutoSearchedShowId) {
          this.lastAutoSearchedShowId = showId;
          void this.searchTorrents(this.activeShow);
        }
      }
    },

    onRefreshSpaceAvail() {
      void this.updateSpaceAvail();
    },
    openDetails() {
      const url = this.selectedTorrent?.detailUrl;
      if (url) window.open(url, "_blank");
    },

    showError(msg) {
      this.errorModalMsg = String(msg || "");
      this.showErrorModal = true;
    },

    closeErrorModal() {
      this.showErrorModal = false;
      this.errorModalMsg = "";
    },

    confirmExistingDownloads(msg, wrapper) {
      this.existingDeleteModalMsg = String(msg || "");
      this.existingDeleteWrapper =
        wrapper && typeof wrapper === "object" ? wrapper : null;
      this.showExistingDeleteModal = true;
      return new Promise((resolve) => {
        this.existingDeleteResolve = resolve;
      });
    },

    cancelExistingDelete() {
      this.showExistingDeleteModal = false;
      this.existingDeleteModalMsg = "";
      this.existingDeleteWrapper = null;
      const resolve = this.existingDeleteResolve;
      this.existingDeleteResolve = null;
      if (typeof resolve === "function") resolve(false);
    },

    confirmExistingDelete() {
      this.showExistingDeleteModal = false;
      const resolve = this.existingDeleteResolve;
      this.existingDeleteResolve = null;
      if (typeof resolve === "function") resolve(true);
    },

    async deleteProcids(wrapper) {
      const payload = wrapper && typeof wrapper === "object" ? wrapper : null;
      if (!payload) return false;

      const procIds = Array.isArray(payload.procIds)
        ? payload.procIds
        : Array.isArray(payload.procids)
          ? payload.procids
          : Array.isArray(payload.existingProcids)
            ? payload.existingProcids
            : [];

      const merged = Array.from(
        new Set(
          procIds.filter(
            (v) => v !== null && v !== undefined && String(v) !== "",
          ),
        ),
      );
      if (merged.length === 0) return false;

      const url = `${config.tvDownUrl}/deleteProcids`;
      let res;
      try {
        res = await this.fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ procIds: merged }),
          },
          60000,
        );
      } catch (e) {
        this.showError(e?.message || String(e));
        return false;
      }

      if (!res?.ok) {
        let detail = "";
        try {
          const ct = (res?.headers?.get?.("content-type") || "").toLowerCase();
          if (ct.includes("application/json")) {
            const j = await res.json();
            detail = j?.error
              ? String(j.error)
              : j?.message
                ? String(j.message)
                : JSON.stringify(j);
          } else {
            detail = await res.text();
          }
        } catch {
          // ignore
        }
        this.showError(
          detail ||
            `HTTP ${res?.status || ""}: ${res?.statusText || "delete failed"}`,
        );
        return false;
      }

      return true;
    },
    getScroller() {
      return this.$refs.scroller || null;
    },

    scrollToBottom() {
      const el = this.getScroller();
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    },
    downloadHistoryKey() {
      return "downloadedTorrentHashes";
    },

    downloadHistoryWindowMs() {
      return 60 * 24 * 60 * 60 * 1000;
    },

    loadDownloadedHistory() {
      let parsed = {};
      try {
        const raw = localStorage.getItem(this.downloadHistoryKey());
        if (raw) {
          const j = JSON.parse(raw);
          if (j && typeof j === "object" && !Array.isArray(j)) parsed = j;
        }
      } catch {
        // ignore
      }
      this.downloadedByHash = parsed;
      this.pruneDownloadedHistory();
    },

    saveDownloadedHistory() {
      try {
        localStorage.setItem(
          this.downloadHistoryKey(),
          JSON.stringify(this.downloadedByHash || {}),
        );
      } catch {
        // ignore
      }
    },

    pruneDownloadedHistory() {
      const now = Date.now();
      const cutoff = now - this.downloadHistoryWindowMs();
      const map =
        this.downloadedByHash && typeof this.downloadedByHash === "object"
          ? this.downloadedByHash
          : {};
      const next = {};
      for (const [k, ts] of Object.entries(map)) {
        const t = Number(ts);
        if (Number.isFinite(t) && t >= cutoff) next[k] = t;
      }
      const changed = Object.keys(next).length !== Object.keys(map).length;
      if (changed) this.downloadedByHash = next;
      if (changed) this.saveDownloadedHistory();
    },

    extractBtih(str) {
      const s = String(str || "");
      if (!s) return "";
      const m =
        /xt=urn:btih:([a-zA-Z0-9]+)/.exec(s) || /btih:([a-zA-Z0-9]+)/.exec(s);
      return m?.[1] ? String(m[1]).toLowerCase() : "";
    },

    getTorrentHash(torrent) {
      const direct =
        torrent?.raw?.infoHash ||
        torrent?.raw?.info_hash ||
        torrent?.raw?.hash ||
        torrent?.hash;
      if (typeof direct === "string" && direct) return direct.toLowerCase();

      const magnet =
        torrent?.raw?.magnet || torrent?.raw?.magnetLink || torrent?.raw?.link;
      if (typeof magnet === "string" && magnet) {
        const h = this.extractBtih(magnet);
        if (h) return h;
      }
      return "";
    },

    buildTorrentUploadFilename(torrent, fallbackTitle) {
      // qBittorrent's "watched folder" can miss modified/overwritten files.
      // Ensure each upload writes a *new* file by suffixing a stable unique token.
      const baseIn = String(
        torrent?.raw?.filename ||
          fallbackTitle ||
          torrent?.raw?.title ||
          torrent?.title ||
          "download",
      ).trim();
      const hash = this.getTorrentHash(torrent);
      const suffix = hash
        ? hash.slice(0, 10)
        : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

      // Windows-safe filename (server may run on Windows and write to disk).
      let base = baseIn
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/[\u0000-\u001f]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Remove extension so we can control it.
      base = base.replace(/\.torrent$/i, "");
      if (!base) base = "download";

      // Keep filenames reasonably short to avoid filesystem/path limits.
      const maxBaseLen = 150;
      if (base.length > maxBaseLen) base = base.slice(0, maxBaseLen).trim();

      return `${base}-${suffix}.torrent`;
    },

    getTorrentHistoryKey(torrent) {
      // Prefer hash; fall back to the title (as-is).
      const hash = this.getTorrentHash(torrent);
      if (hash) return hash;

      const title = torrent?.raw?.title || torrent?.title || "";
      const titleStr = typeof title === "string" ? title : String(title || "");
      const provider = String(torrent?.raw?.provider || "")
        .trim()
        .toLowerCase();

      // Titles can collide across providers (IPT/TL). Include provider in the identity.
      return provider ? `${titleStr}::${provider}` : titleStr;
    },

    getTorrentHistoryKeys(torrent) {
      const keys = [];
      const add = (k) => {
        const s = String(k || "");
        if (!s) return;
        if (!keys.includes(s)) keys.push(s);
      };

      const hash = this.getTorrentHash(torrent);
      if (hash) add(hash);

      const titleRaw = torrent?.raw?.title || torrent?.title || "";
      const titleStr =
        typeof titleRaw === "string" ? titleRaw : String(titleRaw || "");
      const titleTrim = titleStr.trim();
      const provider = String(torrent?.raw?.provider || "")
        .trim()
        .toLowerCase();

      // Legacy keys (historically stored as-is).
      if (provider) add(`${titleStr}::${provider}`);
      add(titleStr);

      // Normalized variants (fixes missing history icons when titles differ only by
      // punctuation/separators/case/whitespace or when provider field is missing).
      const norm = this.normalizeQbtNameForMatch(titleTrim);
      if (provider && norm) add(`${norm}::${provider}`);
      if (provider && titleTrim) add(`${titleTrim}::${provider}`);
      if (titleTrim) add(titleTrim);
      if (norm) add(norm);

      return keys;
    },

    getTorrentNowKey(torrent) {
      // Key used for "downloaded now" highlighting. Must disambiguate identical titles across providers.
      return this.getTorrentHistoryKey(torrent);
    },

    getTorrentCardKey(torrent, index) {
      // Stable key to prevent DOM reuse glitches when multiple providers return the same title.
      // Always include index as suffix to guarantee uniqueness (detailUrl may be a shared search URL).
      const base = torrent?.detailUrl || this.getTorrentNowKey(torrent) || "";
      return `${base}|${index}`;
    },

    getDisplayTitleWithProvider(torrent) {
      const title = String(torrent?.raw?.title || torrent?.title || "").trim();
      return title;
    },

    rememberDownloadedTorrent(torrent) {
      const keys = this.getTorrentHistoryKeys(torrent);
      if (!keys.length) return;
      const now = Date.now();
      const map =
        this.downloadedByHash && typeof this.downloadedByHash === "object"
          ? this.downloadedByHash
          : {};
      // Reassign for reliable reactivity.
      const next = { ...map };
      for (const k of keys) next[k] = now;
      this.downloadedByHash = next;
      this.pruneDownloadedHistory();
      this.saveDownloadedHistory();
    },

    isDownloadedBefore(torrent) {
      const keys = this.getTorrentHistoryKeys(torrent);
      if (!keys.length) return false;
      const cutoff = Date.now() - this.downloadHistoryWindowMs();
      for (const k of keys) {
        const ts = Number(this.downloadedByHash?.[k]);
        if (Number.isFinite(ts) && ts >= cutoff) return true;
      }
      return false;
    },

    getDownloadedBeforeIconStyle(torrent) {
      const right = this.isClicked(torrent) ? 32 : 8;
      return {
        position: "absolute",
        top: "10px",
        right: `${right}px`,
        color: "#888",
        fontSize: "16px",
      };
    },
    resetPane() {
      this.selectedTorrent = null;
      this.showModal = false;
      this.clickedTorrents.clear();
      this.torrents = [];
      this.showName = "";
      this.loading = false;
      this.error = null;
      this.providerWarning = "";
      this.currentShow = null;
      this.noTorrentsNeeded = false;
      this.showCookieInputs = false;
      this.dismissCookieInputs = false;
      this.unaired = false;
      this.iptCfClearance = "";
      this.tlCfClearance = "";

      this._didInitialScroll = false;
      this.lastAutoSearchedShowId = null;
    },

    handleClose() {
      // Do not reset pane state on close.
      this.$emit("close");
    },

    async getSpaceAvail() {
      const url = new URL(`${config.torrentsApiUrl}/api/space/avail`);
      const res = await fetch(url.toString());
      if (!res.ok) {
        let detail = "";
        try {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            const j = await res.json();
            detail = j?.error ? String(j.error) : JSON.stringify(j);
          } else {
            detail = await res.text();
          }
        } catch {
          // ignore parse errors
        }
        throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
      }
      return res.json();
    },

    async getSpaceUsb() {
      const url = new URL(`${config.torrentsApiUrl}/api/space/usb`);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },

    async getSpaceSrvr() {
      const url = new URL(`${config.torrentsApiUrl}/api/space/srvr`);
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },

    pctUsed(total, used) {
      const t = Number(total);
      const u = Number(used);
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return "--%";
      const pct = Math.ceil((u / t) * 100);
      return `${Math.max(0, Math.min(100, pct))}%`;
    },

    pctAvail(total, used) {
      const t = Number(total);
      const u = Number(used);
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return "--%";
      const avail = Math.max(0, t - u);
      const pct = Math.floor((avail / t) * 100);
      return `${Math.max(0, Math.min(100, pct))}%`;
    },

    fmtAvailGb(total, used) {
      const t = Number(total);
      const u = Number(used);
      if (!Number.isFinite(t) || !Number.isFinite(u) || t <= 0) return "--";
      const avail = Math.max(0, t - u);
      // df-style GB: df reports 1K-blocks; dividing by 1e6 yields “GB”.
      // Our API returns bytes, so bytes / 1_024_000_000 matches that convention.
      return String(Math.round(avail / 1_024_000_000));
    },

    async updateSpaceAvail() {
      const hasAnyDigits = (txt) => /\d/.test(String(txt || ""));

      const applyUsb = (s) => {
        if (
          Number.isFinite(Number(s?.usbSpaceTotal)) &&
          Number.isFinite(Number(s?.usbSpaceUsed))
        ) {
          this.spaceUsbPct = this.pctAvail(s.usbSpaceTotal, s.usbSpaceUsed);
          this.spaceUsbGb = this.fmtAvailGb(s.usbSpaceTotal, s.usbSpaceUsed);
        }
      };

      const applySrvr = (s) => {
        if (
          Number.isFinite(Number(s?.mediaSpaceTotal)) &&
          Number.isFinite(Number(s?.mediaSpaceUsed))
        ) {
          this.spaceSrvrPct = this.pctAvail(
            s.mediaSpaceTotal,
            s.mediaSpaceUsed,
          );
          this.spaceSrvrGb = this.fmtAvailGb(
            s.mediaSpaceTotal,
            s.mediaSpaceUsed,
          );
        }
      };

      const usbPromise = this.getSpaceUsb()
        .then(applyUsb)
        .catch(() => {
          if (!hasAnyDigits(this.spaceUsbGb)) this.spaceUsbGb = "???";
          if (!hasAnyDigits(this.spaceUsbPct)) this.spaceUsbPct = "???%";
        });

      const srvrPromise = this.getSpaceSrvr()
        .then(applySrvr)
        .catch(() => {
          if (!hasAnyDigits(this.spaceSrvrGb)) this.spaceSrvrGb = "???";
          if (!hasAnyDigits(this.spaceSrvrPct)) this.spaceSrvrPct = "???%";
        });

      await Promise.all([usbPromise, srvrPromise]);
    },

    saveCookies() {
      // Save only; do not start any torrent loading.
      const iptCf = this.extractCfClearance(this.iptCfClearance);
      const tlCf = this.extractCfClearance(this.tlCfClearance);

      // Also persist to local torrents server so Node/Playwright tools can use it.
      // Best-effort; ignore errors.
      try {
        void fetch(`${config.torrentsApiUrl}/api/cf_clearance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ipt_cf: iptCf || "",
            tl_cf: tlCf || "",
          }),
        });
      } catch {
        // ignore
      }

      // Always close the inputs when clicked, even if empty.
      this.showCookieInputs = false;
      this.dismissCookieInputs = true;

      // Don't retain potentially-stale values in UI state.
      this.iptCfClearance = "";
      this.tlCfClearance = "";
    },

    toggleCookieInputs() {
      this.dismissCookieInputs = false;
      this.showCookieInputs = !this.showCookieInputs;
    },

    onOpenStream(show) {
      this.currentShow = show;
      this.showStream = true;
    },

    handleMapButton() {
      const show = this.currentShow;
      if (show) {
        evtBus.emit("mapAction", { action: "open", show });
      }
    },

    async searchTorrents(show) {
      // Track this show so onPaneChanged doesn't re-trigger when switching panes.
      this.lastAutoSearchedShowId = show?.Id || show?.Name || null;

      // Reset state when switching shows
      this.torrents = [];
      this.error = null;
      this.hasSearched = false;
      this.selectedTorrent = null;
      this.clickedTorrents.clear();
      this.noTorrentsNeeded = false;
      this.providerWarning = "";
      this.loading = false;
      this.dismissCookieInputs = false;
      this.lastNeeded = null;
      this._didInitialScroll = false;

      // Kick off space fetch ASAP; don't wait for torrent searching.
      void this.updateSpaceAvail();

      this.unaired = !!show?.S1E1Unaired;
      if (this.unaired) {
        // Short-circuit: show only the unaired message
        this.currentShow = show;
        this.showName = show?.Name || "";
        return;
      }

      // (space fetch already started above)

      // Store the show for later use with Load button
      this.currentShow = show;
      if (show && show.Name) {
        this.showName = show.Name;
      }

      // Get series map and calculate needed episodes
      const needed = await this.calculateNeeded(show);
      this.lastNeeded = needed;

      // Check if needed array is truly empty (not 'loadall')
      if (needed.length === 0) {
        this.noTorrentsNeeded = true;
        return;
      }

      // Kick off the actual search now that needed is ready.
      await this.searchClick();
    },

    async searchClick() {
      if (
        (!this.currentShow || !this.currentShow.Name) &&
        this.activeShow?.Name
      ) {
        this.currentShow = this.activeShow;
        this.showName = this.activeShow?.Name || this.showName;
      }

      if (!this.currentShow || !this.currentShow.Name) {
        this.error = "No show selected";
        return;
      }

      if (this.unaired) {
        return;
      }

      // Reset so a fresh first search is always performed
      this.lastNeeded = null;

      // Check if season filter is active
      const sVal = parseInt(this.seasonFilter, 10);
      const hasSeasonFilter =
        !isNaN(sVal) && sVal >= 0 && String(this.seasonFilter).trim() !== "";

      if (hasSeasonFilter) {
        this.noTorrentsNeeded = false;
        this.providerWarning = "";
        this.hasSearched = true;
        const seasonStr = `S${String(sVal).padStart(2, "0")}`;
        await this.loadTorrents([seasonStr]);
        return;
      }

      this.noTorrentsNeeded = false;
      this.providerWarning = "";

      if (!Array.isArray(this.lastNeeded)) {
        try {
          this.lastNeeded = await this.calculateNeeded(this.currentShow);
        } catch {
          this.lastNeeded = [];
        }
      }

      if (Array.isArray(this.lastNeeded) && this.lastNeeded.length === 0) {
        this.noTorrentsNeeded = true;
        return;
      }

      this.hasSearched = true;
      await this.loadTorrents(this.lastNeeded || []);
    },

    async moreClick() {
      if (this.hasMoreProviders) return; // already showing all providers
      if (
        (!this.currentShow || !this.currentShow.Name) &&
        this.activeShow?.Name
      ) {
        this.currentShow = this.activeShow;
        this.showName = this.activeShow?.Name || this.showName;
      }
      if (!this.currentShow?.Name) return;
      if (this.unaired) return;

      if (!Array.isArray(this.lastNeeded)) {
        try {
          this.lastNeeded = await this.calculateNeeded(this.currentShow);
        } catch {
          this.lastNeeded = [];
        }
      }
      this.hasSearched = true;
      await this.loadTorrents(this.lastNeeded || [], true);
    },

    openTorTabs() {
      const name = String(this.currentShow?.Name || "")
        .replace(/\([^)]+\)\s*$/, "")
        .replace(/[?.]+\s*$/g, "")
        .trim();
      const searchQ = encodeURIComponent(name);
      const eztQ = name.replace(/\s+/g, "+");
      const urls = [
        `https://thepiratebay.org/search.php?q=${searchQ}&cat=205`,
        `https://www.limetorrents.lol/search/tv/${searchQ}/`,
        `https://eztvx.to/search/${eztQ}`,
        `https://iptorrents.com/tv?q=${searchQ}`,
        `https://www.torrentleech.org/torrents/browse/index/query/${searchQ}`,
      ];
      for (const url of urls) {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    },

    async forceClick() {
      if (
        (!this.currentShow || !this.currentShow.Name) &&
        this.activeShow?.Name
      ) {
        this.currentShow = this.activeShow;
        this.showName = this.activeShow?.Name || this.showName;
      }

      if (!this.currentShow || !this.currentShow.Name) {
        this.error = "No show selected";
        return;
      }
      if (this.unaired) return;

      this.noTorrentsNeeded = false;
      this.providerWarning = "";
      this.hasSearched = true;
      // Force search IPT/TL first, then add more providers
      await this.loadTorrents(["force"]);
      await this.loadTorrents(["force"], true);
    },

    async calculateNeeded(show) {
      const needed = [];

      // If not in Emby, return special marker
      if (!show || !show.Id || show.inEmby === false) {
        return ["noemby"];
      }

      try {
        // Get series map (same way as list.vue does)
        const seriesMapIn = await emby.getSeriesMap(show);
        if (!seriesMapIn || seriesMapIn.length === 0) {
          return needed;
        }

        // (debug logging removed)

        // Build seriesMap object from array
        const seriesMap = util.buildSeriesMap(seriesMapIn);
        if (!seriesMap) {
          return needed;
        }

        // Scan for needed episodes
        let hasStartedWatching = false;

        // Check if ANY episode in the entire series has been watched
        const anyEpisodeWatched = Object.values(seriesMap).some((episodes) =>
          Object.values(episodes).some((epiObj) => epiObj.played),
        );

        // If nothing watched, start collecting from first episode with no file
        if (!anyEpisodeWatched) {
          hasStartedWatching = true;
        }

        for (const [seasonNumStr, episodes] of Object.entries(seriesMap)) {
          const seasonNum = parseInt(seasonNumStr);
          if (isNaN(seasonNum)) continue;

          // Check if season has any episodes with state
          const seasonHasState = Object.values(episodes).some((epiObj) => {
            const { played, noFile, unaired, avail, deleted, error } = epiObj;
            return played || noFile || unaired || avail || deleted || error;
          });

          // Skip this entire season if no episodes have any state
          if (!seasonHasState) {
            continue;
          }

          const seasonNeeded = [];
          let allNeeded = true;
          let hasUnaired = false;
          let hasNoFile = false;

          // First pass: check if season has both unaired AND no file episodes
          for (const [episodeNumStr, epiObj] of Object.entries(episodes)) {
            const episodeNum = parseInt(episodeNumStr);
            if (isNaN(episodeNum)) continue;

            const { noFile, unaired } = epiObj;
            if (unaired) hasUnaired = true;
            if (noFile) hasNoFile = true;
          }

          // Determine if we should include individual episodes for this season
          const includeIndividualEpisodes = hasUnaired && hasNoFile;

          for (const [episodeNumStr, epiObj] of Object.entries(episodes)) {
            const episodeNum = parseInt(episodeNumStr);
            if (isNaN(episodeNum)) continue;

            const { played, noFile, unaired } = epiObj;

            // Stop if we hit an unaired episode (unless this season needs individual episodes)
            if (unaired) {
              // Process any accumulated season if any episodes were needed
              if (seasonNeeded.length > 0) {
                if (includeIndividualEpisodes) {
                  // Include all individual episodes for this season
                  seasonNeeded.forEach((ep) => needed.push(ep));
                } else if (allNeeded) {
                  needed.push(`S${seasonNum.toString().padStart(2, "0")}`);
                } else {
                  needed.push(`S${seasonNum.toString().padStart(2, "0")}`);
                  seasonNeeded.forEach((ep) => needed.push(ep));
                }
              }
              return needed; // Stop scanning
            }

            // Track if we've started watching
            if (played) {
              hasStartedWatching = true;
            }

            // Episode is needed if: started watching AND not played AND no file
            const isNeeded = hasStartedWatching && !played && noFile;

            if (isNeeded) {
              const epStr = `S${seasonNum.toString().padStart(2, "0")}E${episodeNum.toString().padStart(2, "0")}`;
              seasonNeeded.push(epStr);
            } else {
              allNeeded = false;
            }
          }

          // Add season if any episodes were needed
          if (seasonNeeded.length > 0 && hasStartedWatching) {
            if (includeIndividualEpisodes) {
              // Include all individual episodes (no season marker)
              seasonNeeded.forEach((ep) => needed.push(ep));
            } else if (allNeeded) {
              // All episodes in season are needed - just add season
              needed.push(`S${seasonNum.toString().padStart(2, "0")}`);
            } else {
              // Some episodes needed - add season AND individual episodes
              needed.push(`S${seasonNum.toString().padStart(2, "0")}`);
              seasonNeeded.forEach((ep) => needed.push(ep));
            }
          }
        }
      } catch (err) {
        // ignore
      }
      return needed;
    },

    extractCfClearance(input) {
      // Accept formats:
      // 1. cf_clearance:"value"
      // 2. cf_clearance: "value"
      // 3. "value"
      // 4. value
      if (!input) return "";

      const trimmed = input.trim();

      // Check for cf_clearance:"..." or cf_clearance: "..." format
      const match = trimmed.match(/^cf_clearance\s*:\s*"(.+)"$/);
      if (match) {
        return match[1];
      }

      // Check for quoted value
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
      }

      // Return as-is
      return trimmed;
    },

    async loadTorrents(needed = [], more = false) {
      if (!this.currentShow || !this.currentShow.Name) {
        this.error = "No show selected";
        return;
      }

      this.loading = true;
      this.error = null;
      this.providerWarning = "";
      if (!more) {
        this.torrents = [];
      }
      this.noTorrentsNeeded = false;

      // Reset more-providers state on each new load
      this.hasMoreProviders = false;
      if (!more) {
        this.providerStats = null;
      }

      // Reset debug metadata for this request
      this.lastRawProviderCounts = null;
      this.lastReturnedProviderCounts = null;
      this.lastApiCount = null;
      this.lastWarningSummary = null;

      try {
        // Some shows include trailing punctuation (e.g. "Can You Keep a Secret?")
        // that can hurt provider matching. For torrent searching, strip trailing ?/.
        const rawShowName = String(this.currentShow.Name || "").trim();
        const showNameForSearch = rawShowName.replace(/[?.]+\s*$/g, "").trim();

        let url = `${config.torrentsApiUrl}/api/search?show=${encodeURIComponent(showNameForSearch)}&limit=${this.maxResults}`;
        const showTvdbId = String(
          this.currentShow.TvdbId || this.currentShow.tvdbId || "",
        ).trim();
        if (showTvdbId) url += `&tvdbId=${encodeURIComponent(showTvdbId)}`;
        if (needed.length > 0) {
          url += `&needed=${encodeURIComponent(JSON.stringify(needed))}`;
        }
        if (more) {
          url += `&more=true`;
        }

        // Debug info
        this.lastSearchUrl = url;
        this.lastSearchShow = showNameForSearch;
        this.lastSearchNeeded = Array.isArray(needed)
          ? JSON.stringify(needed)
          : String(needed);

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Debug info from response
        this.lastApiCount = typeof data?.count === "number" ? data.count : null;
        this.lastWarningSummary =
          data && typeof data.warningSummary === "object"
            ? data.warningSummary
            : null;

        // Set torrents first; some server versions may omit rawProviderCounts.
        this.torrents = data.torrents || [];
        if (!more) {
          this._didInitialScroll = true;
          this.$nextTick(() => {
            const el = this.$refs.scroller;
            if (el) el.scrollTop = 0;
          });
        }

        // Store more-providers state and per-provider stats from response
        this.hasMoreProviders = Boolean(data?.hasMoreProviders);
        if (data?.tpbError) {
          this.providerWarning = this.providerWarning
            ? `${this.providerWarning}\n\nTPB unavailable: apibay.org returned an error (likely down or blocking this server).`
            : "TPB unavailable: apibay.org returned an error (likely down or blocking this server).";
        }
        if (
          data?.providerStats &&
          typeof data.providerStats === "object" &&
          Object.keys(data.providerStats).length > 0
        ) {
          // Merge with existing stats (preserves TL/IPT when loading more providers)
          this.providerStats = Object.assign(
            {},
            this.providerStats || {},
            data.providerStats,
          );
        } else if (!more) {
          this.providerStats = null;
        }
        this.resultsShowId = this.currentShow?.Id || null;

        // (debug logging removed)

        // Provider hit counts.
        // Prefer backend-reported rawProviderCounts when present, but fall back to deriving counts from
        // returned torrents because some server versions omit rawProviderCounts.
        const counts =
          data && typeof data.rawProviderCounts === "object"
            ? data.rawProviderCounts || {}
            : {};
        this.lastRawProviderCounts =
          Object.keys(counts).length > 0 ? counts : null;

        const toCount = (v) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : 0;
        };

        const iptCountFromApi = toCount(
          counts.IpTorrents ??
            counts.IPTorrents ??
            counts.iptorrents ??
            counts.ipt ??
            counts.IPT ??
            counts.Iptorrents ??
            0,
        );
        const tlCountFromApi = toCount(
          counts.TorrentLeech ??
            counts.torrentleech ??
            counts.TL ??
            counts.tl ??
            counts.TorrentLeach ??
            0,
        );

        let iptCount = iptCountFromApi;
        let tlCount = tlCountFromApi;

        // Fallback: infer from returned torrents if counts were not provided.
        if (
          iptCount + tlCount === 0 &&
          Array.isArray(this.torrents) &&
          this.torrents.length > 0
        ) {
          for (const t of this.torrents) {
            const providerRaw = String(
              t?.raw?.provider || t?.provider || "",
            ).toLowerCase();
            if (!providerRaw) continue;
            if (providerRaw.includes("torrentleech") || providerRaw === "tl") {
              tlCount += 1;
            } else if (
              providerRaw.includes("iptorrents") ||
              providerRaw === "ipt" ||
              providerRaw.includes("ipt")
            ) {
              iptCount += 1;
            }
          }

          // When we infer counts, populate the debug display so it's obvious what happened.
          this.lastRawProviderCounts = {
            inferred: true,
            IpTorrents: iptCount,
            TorrentLeech: tlCount,
          };
        }

        // If the backend reports raw provider hits but returns none, call it out explicitly.
        // This typically means results exist on IPT/TL but were filtered out server-side
        // (commonly because all hits have 0 seeds, or title parsing/matching rejected them).
        if (
          Array.isArray(this.torrents) &&
          this.torrents.length === 0 &&
          (iptCount > 0 || tlCount > 0)
        ) {
          const parts = [];
          if (iptCount > 0) parts.push(`IPTorrents: ${iptCount}`);
          if (tlCount > 0) parts.push(`TorrentLeech: ${tlCount}`);
          this.providerWarning = `Providers reported hits (${parts.join(", ")}), but none were returned. This is usually because all hits were filtered out (often 0 seeds) or title matching failed. Try Force, or check the provider site directly.`;
        }

        // Returned-per-provider counts (what the user actually sees in the list).
        const inferProvider = (torrent) => {
          const providerRaw = String(
            torrent?.raw?.provider || torrent?.provider || "",
          ).toLowerCase();
          const detailUrlLower = String(
            torrent?.detailUrl || torrent?.raw?.desc || "",
          ).toLowerCase();
          if (
            providerRaw.includes("torrentleech") ||
            detailUrlLower.includes("torrentleech") ||
            providerRaw === "tl"
          )
            return "torrentleech";
          if (
            providerRaw.includes("iptorrents") ||
            detailUrlLower.includes("iptorrents") ||
            providerRaw === "ipt"
          )
            return "iptorrents";
          return providerRaw || "unknown";
        };

        const returnedCounts = { iptorrents: 0, torrentleech: 0, unknown: 0 };
        if (Array.isArray(this.torrents)) {
          for (const t of this.torrents) {
            const p = inferProvider(t);
            if (p === "iptorrents") returnedCounts.iptorrents += 1;
            else if (p === "torrentleech") returnedCounts.torrentleech += 1;
            else returnedCounts.unknown += 1;
          }
        }
        this.lastReturnedProviderCounts = returnedCounts;

        // If exactly one provider returned results and the other returned none, show a cookie warning.
        const iptReturned = returnedCounts.iptorrents;
        const tlReturned = returnedCounts.torrentleech;
        const iptZero = iptReturned === 0;
        const tlZero = tlReturned === 0;
        const iptHas = iptReturned > 0;
        const tlHas = tlReturned > 0;

        if (
          Array.isArray(this.torrents) &&
          this.torrents.length > 0 &&
          ((iptHas && tlZero) || (tlHas && iptZero))
        ) {
          const missing = [];
          if (iptZero) missing.push("IPTorrents");
          if (tlZero) missing.push("TorrentLeech");
          const cookieWarning = `Warning: No results from ${missing.join(" and ")}. Check cookies for that provider.`;

          this.providerWarning = this.providerWarning
            ? `${this.providerWarning}\n\n${cookieWarning}`
            : cookieWarning;
        }
      } catch (err) {
        // Handle both Error objects and rejected promise values
        const errorMessage =
          err?.message ||
          err?.result ||
          err?.error ||
          (typeof err === "string" ? err : JSON.stringify(err));
        this.error = errorMessage;
      } finally {
        this.loading = false;
      }
    },

    async forceLoadTorrents() {
      // Force load all torrents by sending 'force' marker
      await this.loadTorrents(["force"]);
    },

    handleTorrentClick(event, torrent) {
      // Select the card
      this.selectedTorrent = torrent;

      const alreadyClicked = this.isClicked(torrent);
      // Add to clicked set
      this.clickedTorrents.add(torrent);

      // Only open the detail tab the first time (no auto-open if it already has a checkmark).
      const isAltClick = Boolean(event?.altKey);
      const isCtrlClick = Boolean(event?.ctrlKey || event?.metaKey);

      // Ctrl-click should behave like clicking the Get button.
      // Alt-click behaves like ctrl-click but forces download (bypass server-side "already downloaded" checks).
      if (isAltClick || isCtrlClick) {
        void this.enqueueDownload(torrent, { forceDownload: isAltClick });
        return;
      }

      if (!alreadyClicked && torrent.detailUrl) {
        window.open(torrent.detailUrl, "_blank");
      }
    },

    isClicked(torrent) {
      return this.clickedTorrents.has(torrent);
    },

    getCardStyle(torrent) {
      const isSelected = this.selectedTorrent === torrent;
      const isDownloaded = this.isDownloadedNow(torrent);
      const hasWarnings = this.getTorrentWarnings(torrent).length > 0;
      let bgColor = "#fff";
      if (isDownloaded) {
        bgColor = "#ffcccb"; // Light red for downloaded
      } else if (isSelected) {
        bgColor = "#fffacd"; // Light yellow for selected
      } else if (hasWarnings) {
        bgColor = "#fff0f0"; // Light red/pink for warnings
      }
      return {
        padding: "10px",
        background: bgColor,
        borderRadius: "5px",
        border: "1px solid #ddd",
        cursor: "pointer",
        transition: "all 0.2s",
        position: "relative",
      };
    },

    isDownloadedNow(torrent) {
      const key = this.getTorrentNowKey(torrent);
      if (!key) return false;
      return this.downloadedTorrents.has(key);
    },

    showDownloadModal() {
      this.showModal = true;
    },

    cancelDownload() {
      this.showModal = false;
      // Keep card selected
    },

    continueDownload() {
      // Keep the existing template bindings, but route through the queue.
      this.showModal = false;
      void this.enqueueDownload(this.selectedTorrent);
    },

    statusKeyForTorrent(torrent) {
      return (
        this.getTorrentHistoryKey(torrent) ||
        this.getTorrentCardKey(torrent, 0) ||
        ""
      );
    },

    getDownloadStatus(torrent) {
      const key = this.statusKeyForTorrent(torrent);
      if (!key) return null;
      return this.downloadStatus?.[key] || null;
    },

    getDownloadStatusLabel(torrent) {
      const st = this.getDownloadStatus(torrent);
      if (!st) return "";
      const s = String(st.status || "");
      if (s === "queued") return "Queued";
      if (s === "sending") return "Sending…";
      if (s === "ok") return "OK";
      if (s === "warn") return "Sent (verify pending)";
      if (s === "error") return "Error";
      return s;
    },

    getDownloadStatusTooltip(torrent) {
      const st = this.getDownloadStatus(torrent);
      if (!st) return "";
      const msg = String(st.message || "").trim();
      return msg
        ? `${this.getDownloadStatusLabel(torrent)}: ${msg}`
        : this.getDownloadStatusLabel(torrent);
    },

    setDownloadStatus(torrent, status, message) {
      const key = this.statusKeyForTorrent(torrent);
      if (!key) return;
      const next = {
        ...(this.downloadStatus && typeof this.downloadStatus === "object"
          ? this.downloadStatus
          : {}),
        [key]: {
          status,
          message: message ? String(message) : "",
          ts: Date.now(),
        },
      };
      this.downloadStatus = next;
    },

    async fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
      const ms = Math.max(0, Number(timeoutMs) || 0);
      if (!ms) return fetch(url, options);

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), ms);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(t);
      }
    },

    enqueueDownload(torrent, options = {}) {
      if (!torrent) return;

      const opts = options && typeof options === "object" ? options : {};
      const forceDownload = Boolean(opts.forceDownload);

      const key = this.statusKeyForTorrent(torrent);
      if (!key) return;

      const existing = this.downloadStatus?.[key]?.status;
      if (existing === "queued" || existing === "sending") return;

      this.downloadQueue.push({ torrent, key, forceDownload });
      this.setDownloadStatus(torrent, "queued", "");
      void this.processDownloadQueue();
    },

    normalizeQbtNameForMatch(name) {
      let s = String(name || "").toLowerCase();
      if (!s) return "";
      // Drop the provider suffix we add in display titles.
      s = s.replace(/\s*\|\s*(tl|ipt)\s*$/i, "");
      // Normalize common separators.
      s = s.replace(/[\._\-]+/g, " ");
      // Remove brackets/parentheses but keep the content.
      s = s.replace(/[\[\]\(\){}]/g, " ");
      // Collapse whitespace.
      s = s.replace(/\s+/g, " ").trim();
      return s;
    },

    async processDownloadQueue() {
      if (this.downloadQueueRunning) return;
      this.downloadQueueRunning = true;

      try {
        while (this.downloadQueue.length > 0) {
          const item = this.downloadQueue.shift();
          const torrent = item?.torrent;
          const forceDownload = Boolean(item?.forceDownload);
          if (!torrent) continue;

          this.setDownloadStatus(torrent, "sending", "");
          const torrentTitle = String(
            torrent?.raw?.title || torrent?.title || "Unknown",
          );

          try {
            const result = await this.downloadTorrentInternal(torrent, {
              forceDownload,
            });
            if (result?.ok) {
              this.setDownloadStatus(torrent, "ok", result?.message || "");

              // Only mark "downloaded" after the server indicates success.
              this.rememberDownloadedTorrent(torrent);
            } else {
              const msg = result?.message || `Failed to add: ${torrentTitle}`;
              this.setDownloadStatus(torrent, "error", msg);
            }
          } catch (err) {
            const msg = err?.message || String(err);
            this.setDownloadStatus(torrent, "error", msg);
          }
        }
      } finally {
        this.downloadQueueRunning = false;
      }
    },

    async downloadTorrentInternal(torrent, options = {}) {
      // Mark as downloaded immediately to change card color ("now" highlighting)
      const nowKey = this.getTorrentNowKey(torrent);
      if (nowKey) {
        this.downloadedTorrents.add(nowKey);
      }

      const opts = options && typeof options === "object" ? options : {};
      const forceDownload = Boolean(opts.forceDownload);

      const torrentTitle = torrent?.raw?.title || "Unknown";
      const isAlreadyInQbtMessage = (msg) =>
        /qbit\s*torrent\s+already\s+downloaded/i.test(String(msg || ""));

      // Mark as downloaded immediately to change card color
      try {
        const providerRaw = String(torrent?.raw?.provider || "").toLowerCase();
        const detailUrl = String(torrent?.detailUrl || "");
        const detailUrlLower = detailUrl.toLowerCase();
        const provider =
          providerRaw.includes("torrentleech") ||
          detailUrlLower.includes("torrentleech")
            ? "torrentleech"
            : providerRaw.includes("iptorrents") ||
                detailUrlLower.includes("iptorrents")
              ? "iptorrents"
              : providerRaw.includes("thepiratebay") ||
                  providerRaw.includes("piratebay") ||
                  providerRaw === "thepiratesbay"
                ? "thepiratebay"
                : providerRaw.includes("limetorrents")
                  ? "limetorrents"
                  : providerRaw.includes("eztv")
                    ? "eztv"
                    : providerRaw || "unknown";

        // For public providers (TPB/LIM/EZT), use the /api/torrent-file endpoint
        const isPublicProvider = [
          "thepiratebay",
          "limetorrents",
          "eztv",
        ].includes(provider);
        if (isPublicProvider) {
          const showName = String(
            torrent?.raw?.title || this.currentShow?.Name || "",
          ).trim();
          const magnet =
            torrent?.raw?.magnet ||
            torrent?.raw?.magnetLink ||
            torrent?.raw?.link;
          const magnetParam =
            typeof magnet === "string" && magnet.startsWith("magnet:")
              ? `&magnet=${encodeURIComponent(magnet)}`
              : "";
          const linkParam =
            typeof magnet === "string" && magnet.startsWith("http")
              ? `&link=${encodeURIComponent(magnet)}`
              : "";
          const url = `${config.torrentsApiUrl}/api/torrent-file?show=${encodeURIComponent(showName)}${magnetParam}${linkParam}`;
          const res = await this.fetchWithTimeout(url, {}, 60000);
          if (!res.ok) {
            let detail = "";
            try {
              const ct = res.headers.get("content-type") || "";
              if (ct.includes("application/json")) {
                const j = await res.json();
                detail = j?.error ? String(j.error) : JSON.stringify(j);
              } else {
                detail = await res.text();
              }
            } catch {} // ignore
            return {
              ok: false,
              message: detail || `HTTP ${res.status}: ${res.statusText}`,
            };
          }
          return { ok: true, message: "" };
        }
        // tv-api /downloads now returns a wrapper:
        // - existingTitles: array of titles (same as old raw array)
        // - existingProcids: matching procids
        // - errorTitles: array of titles/objects that had download errors
        // - errors/forced results are additional props
        const normalizeDownloadsWrapper = (payload) => {
          if (Array.isArray(payload)) {
            return { existingTitles: payload, existingProcids: [] };
          }
          if (!payload || typeof payload !== "object") return null;

          const existingTitles = Array.isArray(payload.existingTitles)
            ? payload.existingTitles
            : Array.isArray(payload.alreadyDownloaded)
              ? payload.alreadyDownloaded
              : Array.isArray(payload.alreadyDownloadedTitles)
                ? payload.alreadyDownloadedTitles
                : Array.isArray(payload.downloads)
                  ? payload.downloads
                  : Array.isArray(payload.titles)
                    ? payload.titles
                    : Array.isArray(payload.already)
                      ? payload.already
                      : [];

          const existingProcids = Array.isArray(payload.existingProcids)
            ? payload.existingProcids
            : Array.isArray(payload.procids)
              ? payload.procids
              : [];

          const rawErrorTitles = Array.isArray(payload.errorTitles)
            ? payload.errorTitles
            : [];

          // errorTitles can be either:
          // - string[] (legacy: filenames)
          // - { title, procId }[] (new)
          const errorTitleItems = rawErrorTitles;
          const errorTitles = rawErrorTitles
            .map((x) => {
              if (x && typeof x === "object" && !Array.isArray(x)) {
                return x.title ?? x.Title ?? "";
              }
              return String(x ?? "");
            })
            .map((s) => String(s || "").trim())
            .filter(Boolean);

          const errorProcIds = rawErrorTitles
            .map((x) =>
              x && typeof x === "object" && !Array.isArray(x)
                ? (x.procId ?? x.procid ?? x.proc_id ?? x.procID ?? null)
                : null,
            )
            .filter((v) => v !== null && v !== undefined && String(v) !== "");

          return {
            ...payload,
            existingTitles,
            existingProcids,
            errorTitles,
            errorTitleItems,
            errorProcIds,
          };
        };

        const formatAlreadyDownloadedDialog = (titles) => {
          const unique = Array.from(
            new Set(
              (Array.isArray(titles) ? titles : [])
                .map((t) => String(t || "").trim())
                .filter(Boolean),
            ),
          );
          return (
            "No torrents sent to qbitTorrent.  these files have already been downloaded\n\n" +
            unique.join("\n") +
            "\n\nDo you want to delete these files?"
          );
        };

        const formatErrorDownloadsDialog = (titles) => {
          const unique = Array.from(
            new Set(
              (Array.isArray(titles) ? titles : [])
                .map((t) => String(t || "").trim())
                .filter(Boolean),
            ),
          );
          return (
            "The following files have download errors.  Click delete to remove the files.\n\n" +
            unique.join("\n")
          );
        };

        const normalizeErrorTitleItems = (items) => {
          const arr = Array.isArray(items) ? items : [];
          return arr
            .map((item) => {
              if (typeof item === "string") {
                return { title: item, procId: null };
              }
              if (item && typeof item === "object") {
                return {
                  title:
                    item.title ??
                    item.Title ??
                    item.name ??
                    item.file ??
                    item.filename ??
                    item.torrentTitle ??
                    "",
                  procId:
                    item.procId ??
                    item.procid ??
                    item.proc_id ??
                    item.procID ??
                    item.pid ??
                    item.id ??
                    null,
                  procIds: item.procIds ?? item.procids ?? null,
                };
              }
              return { title: "", procId: null };
            })
            .filter((x) => String(x.title || "").trim() || x.procId);
        };

        const collectProcIdsFromErrorTitles = (wrapper, errorItems) => {
          const procIds = [];

          const w = wrapper && typeof wrapper === "object" ? wrapper : null;
          const fromNormalized = Array.isArray(w?.errorProcIds)
            ? w.errorProcIds
            : [];
          for (const pid of fromNormalized) procIds.push(pid);

          const fromWrapper = Array.isArray(w?.errorProcIds)
            ? w.errorProcIds
            : Array.isArray(w?.errorProcids)
              ? w.errorProcids
              : [];
          for (const pid of fromWrapper) procIds.push(pid);

          const items = Array.isArray(errorItems) ? errorItems : [];
          for (const item of items) {
            if (!item || typeof item !== "object") continue;
            if (Array.isArray(item.procIds)) {
              for (const pid of item.procIds) procIds.push(pid);
            }
            if (item.procId !== null && item.procId !== undefined)
              procIds.push(item.procId);
          }

          return procIds
            .filter((v) => v !== null && v !== undefined && String(v) !== "")
            .map((v) => v);
        };

        let downloadsRes = null;
        try {
          const downloadsUrl = `${config.torrentsApiUrl}/downloads`;

          const dlShowName = String(this.currentShow?.Name || "").trim();
          const dlTvdbId = String(
            this.currentShow?.TvdbId || this.currentShow?.tvdbId || "",
          ).trim();
          const downloadsPayload =
            provider === "torrentleech"
              ? {
                  tl: { torrent },
                  ...(forceDownload ? { forceDownload: true } : {}),
                  ...(dlShowName ? { showName: dlShowName } : {}),
                  ...(dlTvdbId ? { tvdbId: dlTvdbId } : {}),
                }
              : {
                  torrent,
                  ...(forceDownload ? { forceDownload: true } : {}),
                  ...(dlShowName ? { showName: dlShowName } : {}),
                  ...(dlTvdbId ? { tvdbId: dlTvdbId } : {}),
                };

          let downloadsBody = "";
          try {
            downloadsBody = JSON.stringify(downloadsPayload);
          } catch (e) {
            console.log("downloads request JSON stringify failed", {
              error: e?.message || String(e),
            });
            throw e;
          }

          downloadsRes = await this.fetchWithTimeout(
            downloadsUrl,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: downloadsBody,
            },
            60000,
          );
        } catch {
          downloadsRes = null;
        }

        if (downloadsRes && downloadsRes.ok) {
          const ct = (
            downloadsRes.headers.get("content-type") || ""
          ).toLowerCase();
          const payload = ct.includes("application/json")
            ? await downloadsRes.json().catch(() => null)
            : await downloadsRes.text().catch(() => "");

          const wrapper = normalizeDownloadsWrapper(payload);
          const alreadyTitles = wrapper?.existingTitles;
          const errorTitlesRaw =
            wrapper?.errorTitleItems ?? wrapper?.errorTitles;

          const hadAlreadyTitles =
            Array.isArray(alreadyTitles) && alreadyTitles.length > 0;
          const procIdsToDelete = new Set();
          let existingDeleteClicked = false;
          let errorDeleteClicked = false;

          if (hadAlreadyTitles) {
            const confirmed = await this.confirmExistingDownloads(
              formatAlreadyDownloadedDialog(alreadyTitles),
              wrapper,
            );
            existingDeleteClicked = Boolean(confirmed);
            if (existingDeleteClicked) {
              const existing = Array.isArray(wrapper?.existingProcids)
                ? wrapper.existingProcids
                : [];
              for (const pid of existing) {
                if (pid !== null && pid !== undefined && String(pid) !== "")
                  procIdsToDelete.add(pid);
              }
            }
          }

          // After checking already-downloaded titles (regardless of deletion), offer to delete any error titles.
          const errorItems = normalizeErrorTitleItems(errorTitlesRaw);
          const hadErrorTitles = errorItems.length > 0;
          if (hadErrorTitles) {
            const titlesForDialog = errorItems
              .map((x) => x.title)
              .filter(Boolean);
            const confirmed = await this.confirmExistingDownloads(
              formatErrorDownloadsDialog(titlesForDialog),
              wrapper,
            );
            errorDeleteClicked = Boolean(confirmed);
            if (errorDeleteClicked) {
              const errorProcIds = collectProcIdsFromErrorTitles(
                wrapper,
                errorItems,
              );
              for (const pid of errorProcIds) procIdsToDelete.add(pid);
            }
          }

          // Call deleteProcids once if either dialog had Delete clicked.
          if (existingDeleteClicked || errorDeleteClicked) {
            if (procIdsToDelete.size > 0) {
              const ok = await this.deleteProcids({
                procIds: Array.from(procIdsToDelete),
              });
              if (!ok) {
                // deleteProcids already surfaced the error
              }
            } else {
              // Only show this if user explicitly requested deletion but we have no IDs.
              this.showError(
                "Cannot delete because the server did not return any procId values for these entries.",
              );
            }
          }

          // If the server returned errorTitles, we've already surfaced them via the dialog.
          // Avoid also showing a generic error modal like "Download Error" from wrapper.error/message.
          if (hadErrorTitles) {
            return {
              ok: false,
              message: String(
                wrapper?.error || wrapper?.message || "Download Error",
              ),
            };
          }

          if (hadAlreadyTitles) {
            return { ok: true, message: "Already downloaded" };
          }

          // If the endpoint returned a wrapper with success/result state, honor it.
          if (wrapper && typeof wrapper === "object") {
            if (
              wrapper.success ||
              wrapper.result === true ||
              wrapper.ok === true
            ) {
              return { ok: true, message: "" };
            }

            const errorMsg = wrapper.error || wrapper.message;
            if (errorMsg) {
              if (isAlreadyInQbtMessage(errorMsg)) {
                this.showError(
                  `QbitTorrent already downloaded the torrent ${torrentTitle}`,
                );
                return { ok: true, message: "Already in qBittorrent" };
              }

              const isCloudflare =
                Boolean(
                  payload &&
                  typeof payload === "object" &&
                  (payload.isCloudflare || payload.stage === "cloudflare"),
                ) ||
                /cloudflare|just a moment|checking your browser/i.test(
                  String(errorMsg || ""),
                );

              if (isCloudflare && provider === "iptorrents") {
                const label = "IPTorrents";
                const cookieBox = "IPT";

                let popupBlocked = false;
                if (detailUrl) {
                  try {
                    const w = window.open(detailUrl, "_blank");
                    popupBlocked = !w;
                  } catch {
                    popupBlocked = true;
                  }
                }

                this.showError(
                  `${label} blocked the server request with a Cloudflare challenge page ("Just a moment...").\n\n` +
                    (detailUrl
                      ? popupBlocked
                        ? "Note: Browser blocked the popup tab.\n\n"
                        : "Opened the detail page in a new tab.\n\n"
                      : "") +
                    "Try:\n" +
                    `- Complete any “verify you are human” step in the detail tab.\n` +
                    `- Copy the latest cf_clearance cookie into the ${cookieBox} box and Save, then retry.\n` +
                    "- If it still fails, Cloudflare is likely fingerprinting requests from this network/IP.\n\n" +
                    (detailUrl ? `Detail URL:\n${detailUrl}` : ""),
                );
                return {
                  ok: false,
                  message: "Cloudflare challenge blocked server request",
                };
              }

              this.showError(errorMsg);
              return { ok: false, message: String(errorMsg) };
            }
          }
          // Unknown successful payload shape; fall back to legacy endpoint.
        } else if (downloadsRes && downloadsRes.status !== 404) {
          let detail = "";
          try {
            const ct = downloadsRes.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              const j = await downloadsRes.json();
              detail = j?.error
                ? String(j.error)
                : j?.message
                  ? String(j.message)
                  : JSON.stringify(j);
            } else {
              detail = await downloadsRes.text();
            }
          } catch {
            // ignore
          }

          if (isAlreadyInQbtMessage(detail)) {
            this.showError(
              `QbitTorrent already downloaded the torrent ${torrentTitle}`,
            );
            return { ok: true, message: "Already in qBittorrent" };
          }

          throw new Error(
            detail || `HTTP ${downloadsRes.status}: ${downloadsRes.statusText}`,
          );
        }

        // Legacy server-side pipeline.
        const response = await this.fetchWithTimeout(
          `${config.torrentsApiUrl}/api/download`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              torrent,
            }),
          },
          60000,
        );

        if (!response.ok) {
          let detail = "";
          try {
            const ct = response.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              const j = await response.json();
              detail = j?.error ? String(j.error) : JSON.stringify(j);
            } else {
              detail = await response.text();
            }
          } catch {
            // ignore
          }
          throw new Error(
            detail || `HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = await response.json();

        // Check if download was successful
        if (data.success || data.result === true) {
          return { ok: true, message: "" };
        } else {
          const errorMsg = data.error || data.message || "Unknown error";
          const isCloudflare =
            Boolean(
              data &&
              typeof data === "object" &&
              (data.isCloudflare || data.stage === "cloudflare"),
            ) ||
            /cloudflare|just a moment|checking your browser/i.test(
              String(errorMsg || ""),
            );

          if (isCloudflare && provider === "iptorrents") {
            const label = "IPTorrents";
            const cookieBox = "IPT";

            let popupBlocked = false;
            if (detailUrl) {
              try {
                const w = window.open(detailUrl, "_blank");
                popupBlocked = !w;
              } catch {
                popupBlocked = true;
              }
            }

            this.showError(
              `${label} blocked the server request with a Cloudflare challenge page ("Just a moment...").\n\n` +
                (detailUrl
                  ? popupBlocked
                    ? "Note: Browser blocked the popup tab.\n\n"
                    : "Opened the detail page in a new tab.\n\n"
                  : "") +
                "Try:\n" +
                `- Complete any “verify you are human” step in the detail tab.\n` +
                `- Copy the latest cf_clearance cookie into the ${cookieBox} box and Save, then retry.\n` +
                "- If it still fails, Cloudflare is likely fingerprinting requests from this network/IP.\n\n" +
                (detailUrl ? `Detail URL:\n${detailUrl}` : ""),
            );
            return {
              ok: false,
              message: "Cloudflare challenge blocked server request",
            };
          } else {
            this.showError(errorMsg);
            return { ok: false, message: String(errorMsg) };
          }
        }
      } catch (error) {
        const errorMsg = error.message || String(error);
        this.showError(errorMsg);
        return { ok: false, message: String(errorMsg) };
      }
    },

    formatSeasonEpisode(seasonEpisode) {
      if (!seasonEpisode) return "";
      // Convert S01E02 to 1/2 without leading zeros
      const match = seasonEpisode.match(/S(\d+)(?:E(\d+))?/);
      if (!match) return seasonEpisode;

      const season = parseInt(match[1], 10);
      const episode = match[2] ? parseInt(match[2], 10) : null;

      if (episode !== null) {
        return `${season}/${episode}`;
      } else {
        return String(season);
      }
    },

    getDisplaySeasonEpisode(torrent) {
      // Handle dummy torrents
      if (torrent.notorrent) {
        return this.formatSeasonEpisode(torrent.notorrent);
      }

      // Check if torrent has parsed data
      if (!torrent.parsed) {
        return torrent.title || "";
      }

      // If this torrent represents a season range, show "start...end"
      if (torrent.seasonRange && torrent.seasonRange.isRange) {
        const start = Number(torrent.seasonRange.startSeason);
        const end = Number(torrent.seasonRange.endSeason);
        if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
          return `${start}...${end}`;
        }
      }

      // Log what we're working with
      // console.log('Torrent display data:', {
      //   title: torrent.parsed.title,
      //   season: torrent.parsed.season,
      //   episode: torrent.parsed.episode,
      //   seasonEpisode: torrent.parsed.seasonEpisode,
      //   rawTitle: torrent.raw?.title
      // });

      // If seasonEpisode is already set, use it
      if (torrent.parsed.seasonEpisode) {
        return this.formatSeasonEpisode(torrent.parsed.seasonEpisode);
      }

      // Otherwise construct from parsed season/episode
      const season = torrent.parsed.season;
      const episode = torrent.parsed.episode;

      if (season !== undefined && season !== null) {
        let result = `S${String(season).padStart(2, "0")}`;
        if (episode !== undefined && episode !== null) {
          result += `E${String(episode).padStart(2, "0")}`;
        }
        return this.formatSeasonEpisode(result);
      }

      // Fallback to title if no season info
      return torrent.parsed.title || "";
    },

    formatProvider(provider) {
      if (!provider) return "";
      const p = provider.toLowerCase();
      if (p === "iptorrents") return "IPT";
      if (p === "torrentleech") return "TL";
      if (p === "thepiratebay") return "TPB";
      if (p === "limetorrents") return "LIM";
      if (p === "eztv") return "EZT";
      return provider;
    },

    formatGroup(group) {
      if (!group) return "";
      return group.toLowerCase();
    },
  },
};
</script>
