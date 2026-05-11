<template>
  <div
    id="actors"
    @click.stop
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
      position: 'relative',
    }"
  >
    <div
      id="header"
      class="pane-header-title"
      :style="{
        position: 'sticky',
        top: '-10px',
        zIndex: 100,
        backgroundColor: '#fafafa',
        paddingTop: '15px',
        paddingLeft: '10px',
        paddingRight: '10px',
        paddingBottom: '15px',
        marginLeft: '-10px',
        marginRight: '-10px',
        marginTop: '-10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }"
    >
      <!-- Single header: top row switches between default and actor-selected state -->
      <div style="width: 100%; display: flex; flex-direction: column; gap: 8px">
        <!-- Top row: show name + controls (default) OR actor name + action buttons -->
        <div
          style="
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
          "
        >
          <div
            style="
              margin-left: 20px;
              margin-right: 10px;
              flex: 1 1 auto;
              min-width: 0;
              white-space: normal;
              overflow-wrap: anywhere;
              word-break: break-word;
              display: flex;
              align-items: center;
              gap: 12px;
              flex-wrap: wrap;
            "
          >
            <span v-if="!(selectedActor && showingCredits)">{{
              showName
            }}</span>
            <span v-else>{{
              selectedActor.personName || selectedActor.name
            }}</span>
          </div>
          <!-- Default right: search input + arrows -->
          <div
            v-if="!selectedActor"
            style="
              margin-left: 20px;
              margin-right: 15px;
              flex: 0 0 auto;
              display: flex;
              align-items: center;
              gap: 12px;
              font-weight: normal;
            "
          >
            <input
              v-model="actorSearchText"
              @click.stop
              @keydown.enter.prevent="handleActorSearch"
              type="text"
              placeholder="Search actors..."
              style="
                width: 120px;
                padding: 2px 6px;
                font-size: 13px;
                border: 1px solid #ccc;
                border-radius: 3px;
              "
            />
            <button
              @click.stop="handleLeftArrow"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 5px;
                padding: 2px 8px;
                margin-right: 5px;
              "
            >
              ◄
            </button>
            <button
              @click.stop="handleRightArrow"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 5px;
                padding: 2px 8px;
              "
            >
              ►
            </button>
          </div>
          <!-- Actor-selected right: action buttons + Done -->
          <div
            v-else
            style="
              margin-right: 15px;
              flex: 0 0 auto;
              display: flex;
              align-items: center;
              gap: 8px;
              font-weight: normal;
              flex-wrap: wrap;
            "
          >
            <span
              v-if="showingCredits && credits.length > 0"
              style="font-size: 15.6px; font-weight: bold; color: #666"
            >
              {{ credits.length }} credit{{ credits.length !== 1 ? "s" : "" }}
            </span>
            <button
              @click.stop="handleShowsButton"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 5px;
                padding: 4px 10px;
              "
            >
              Shows
            </button>
            <button
              @click.stop="handleAllCreditsButton"
              :disabled="creditsLoading"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 5px;
                padding: 4px 10px;
              "
            >
              {{
                creditsLoading
                  ? "Loading..."
                  : showingCredits
                    ? "Hide Credits"
                    : "All Credits"
              }}
            </button>
            <button
              @click.stop="handleVipButton"
              :style="{
                fontSize: '13px',
                cursor: 'pointer',
                borderRadius: '5px',
                padding: '4px 10px',
                '--btn-bg': isSelectedActorVip ? 'lightpink' : 'whitesmoke',
              }"
            >
              VIP
            </button>
            <button
              v-if="actorPageUrl"
              @click.stop="handleImdbButton"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 5px;
                padding: 4px 10px;
              "
            >
              IMDb
            </button>
            <button
              @click.stop="handleWikipediaButton"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 5px;
                padding: 4px 10px;
              "
            >
              Wikipedia
            </button>
            <button
              @click.stop="handleDoneButton"
              style="
                font-size: 13px;
                cursor: pointer;
                border-radius: 5px;
                padding: 4px 10px;
              "
            >
              Done
            </button>
          </div>
        </div>
        <!-- Bottom row: always visible -->
        <div
          style="
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            gap: 12px;
            margin-right: 20px;
            margin-left: 20px;
            font-weight: normal;
          "
        >
          <button
            @click.stop="handleRegularClick"
            :style="getRegularButtonStyle()"
          >
            Regulars
          </button>
          <button
            @click.stop="handleGuestClick"
            :style="getGuestsButtonStyle()"
          >
            Guests
          </button>
          <input
            v-model="seasonNum"
            @click.stop
            @keydown.enter.prevent="handleGuestClick"
            @blur.stop="handleSeasonEpisodeBlur"
            type="text"
            maxlength="2"
            placeholder="Season"
            style="
              width: 50px;
              padding: 2px 4px;
              font-size: 14px;
              text-align: center;
              border: 1px solid #ccc;
              border-radius: 3px;
              margin-left: 10px;
            "
          />
          <input
            v-model="episodeNum"
            @click.stop
            @keydown.enter.prevent="handleGuestClick"
            @blur.stop="handleSeasonEpisodeBlur"
            type="text"
            maxlength="2"
            placeholder="Episode"
            style="
              width: 55px;
              padding: 2px 4px;
              font-size: 14px;
              text-align: center;
              border: 1px solid #ccc;
              border-radius: 3px;
              margin-left: 5px;
            "
          />
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
    </div>
    <div
      id="error-message"
      v-if="errorMessage"
      style="text-align: center; color: red; margin-top: 50px; font-size: 16px"
    >
      <div>{{ errorMessage }}</div>
    </div>

    <!-- Credits list -->
    <div
      v-else-if="showingCredits"
      id="credits-list"
      style="
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 5px;
        overflow-y: auto;
        overflow-x: hidden;
        flex: 1;
        min-height: 0;
      "
    >
      <div
        v-if="creditsLoading"
        style="
          text-align: center;
          color: #666;
          margin-top: 50px;
          font-size: 16px;
        "
      >
        Loading credits...
      </div>
      <div
        v-else-if="creditsError"
        style="
          text-align: center;
          color: red;
          margin-top: 50px;
          font-size: 16px;
        "
      >
        {{ creditsError }}
      </div>
      <div
        v-else
        v-for="credit in credits"
        :key="credit.imdbId"
        @click.stop="handleCreditCardClick(credit)"
        style="
          display: flex;
          width: 100%;
          background-color: #f5f5f5;
          border: 1px solid #ddd;
          border-radius: 6px;
          padding: 10px;
          cursor: pointer;
          transition: background-color 0.15s;
        "
        @mouseover="$event.currentTarget.style.backgroundColor = '#e8e8e8'"
        @mouseout="$event.currentTarget.style.backgroundColor = '#f5f5f5'"
      >
        <img
          v-if="credit.imageUrl"
          :src="credit.imageUrl"
          :srcset="credit.imageSrcset"
          :alt="credit.title"
          style="
            width: 80px;
            height: 120px;
            object-fit: cover;
            border-radius: 4px;
            margin-right: 15px;
            flex-shrink: 0;
          "
        />
        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px">
          <!-- Line 1: title -->
          <div style="font-weight: bold; font-size: 16px">
            {{ unescapeHtml(credit.title) }}
          </div>

          <!-- Line 2: year -->
          <div
            v-if="credit.year"
            style="font-size: 14px; color: #666"
          >
            {{ credit.year }}
          </div>

          <!-- Line 3: episodeCount -->
          <div
            v-if="credit.episodeCount"
            style="font-size: 13px; color: #666"
          >
            {{ credit.episodeCount }} Episode{{
              credit.episodeCount !== 1 ? "s" : ""
            }}
          </div>

          <!-- Line 4: rating -->
          <div
            v-if="credit.rating"
            style="font-size: 13px; color: #666"
          >
            ⭐ {{ credit.rating }}
          </div>
        </div>
      </div>
      <div
        v-if="!creditsLoading && !creditsError && credits.length === 0"
        style="
          text-align: center;
          color: #999;
          margin-top: 50px;
          font-size: 16px;
        "
      >
        No credits found
      </div>
    </div>

    <div
      id="actors-grid"
      v-else
      style="
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
        gap: 10px;
        padding: 5px;
      "
    >
      <Actor
        v-for="actor in actors"
        :key="actor.url"
        :actor="actor"
        :is-selected="selectedActor === actor"
        @actor-click="handleActorClick"
      ></Actor>
    </div>

    <!-- Crew section (Creator, Executive Producer, Producer, Writer) -->
    <div
      v-if="!showingCredits && crew.length > 0"
      id="crew-section"
      style="
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
        gap: 10px;
        padding: 5px;
      "
    >
      <div
        v-for="(member, idx) in crew"
        :key="member.type + '|' + member.name + '|' + idx"
        @click.stop="handleCrewClick($event, member)"
        :style="{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          margin: '5px',
          padding: '8px',
          backgroundColor: selectedActor === member ? 'lightgray' : '#f5f5f5',
          borderRadius: '6px',
          border:
            selectedActor === member ? '2px solid #888' : '1px solid #ddd',
          textAlign: 'center',
          cursor: 'pointer',
        }"
      >
        <img
          v-if="member.image"
          :src="member.image"
          :alt="member.name"
          style="
            width: 100px;
            height: 130px;
            object-fit: cover;
            border-radius: 4px;
            margin-bottom: 5px;
          "
        />
        <div style="font-weight: bold; font-size: 14px">{{ member.name }}</div>
        <div style="font-weight: normal; font-size: 12px">
          ({{
            member.type === "Executive Producer"
              ? "Exec Producer"
              : member.type
          }})
        </div>
      </div>
    </div>
    <div
      id="no-actors"
      v-if="!errorMessage &amp;&amp; !isGuestMode &amp;&amp; showName &amp;&amp; actors.length === 0 &amp;&amp; showNoCastMessage"
      style="text-align: center; color: #999; margin-top: 50px; font-size: 16px"
    >
      <div style="margin-bottom: 20px">No cast information available</div>
    </div>
  </div>
</template>

<script>
import Actor from "./actor.vue";
import evtBus from "../evtBus.js";
import * as emby from "../emby.js";
import * as tvdb from "../tvdb.js";
import * as util from "../util.js";
import * as srvr from "../srvr.js";

const DEBUG_ACTORS_MERGE_LOG = false;

const theMan = atob("bXJza2lu");

const CREW_TYPE_ORDER = [
  "VIP",
  "Creator",
  "Producer",
  "Executive Producer",
  "Writer",
];

let _vipActorsLoaded = false;

async function loadVipActors() {
  return srvr.getVipActors();
}

async function saveVipActors(set) {
  try {
    await srvr.setVipActors([...set]);
  } catch {
    /* ignore */
  }
}

export default {
  name: "Actors",

  components: { Actor },

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
      actors: [],
      seriesActors: [], // Cache of original series actors
      showName: "",
      currentShow: null, // Store full show object for getSeriesMap
      previewMode: false,
      previewAddBusy: false,
      previewSrchChoice: null,
      seasonNum: "",
      episodeNum: "",
      errorMessage: "",
      isGuestMode: false,
      showingEpisodeActors: false, // Track if we're showing episode actors
      actorSearchText: "",
      _seriesMapInForArrows: null,
      _seriesMapInForArrowsShowKey: null,
      _seriesMapInForArrowsPromise: null,
      _onShowActors: null,
      _onFillAndSelectEpisode: null,
      _onResetActorsPane: null,
      selectedActor: null, // Currently selected actor
      showingCredits: false, // Whether we're showing credits list
      credits: [], // Actor's filmography credits
      creditsLoading: false, // Loading state for credits
      creditsError: null, // Error message for credits
      creditsCache: {}, // Cache for actor credits {actorName: {credits, actorPageUrl}}
      actorPageUrl: null, // IMDb URL for selected actor
      showNoCastMessage: false, // Controls whether to show "no cast info" message after delay
      noCastMessageTimer: null, // Timer ID for the no cast message delay
      crew: [], // Crew from TVDB (Creator, Executive Producer, Producer, Writer)
      vipActors: new Set(),
    };
  },

  computed: {
    isSelectedActorVip() {
      const name =
        this.selectedActor?.personName || this.selectedActor?.name || "";
      return name ? this.vipActors.has(name) : false;
    },
  },

  methods: {
    unescapeHtml(text) {
      if (!text) return text;
      const textarea = document.createElement("textarea");
      textarea.innerHTML = text;
      return textarea.value;
    },

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
      this.previewAddBusy = false;
    },

    exitPreview() {
      evtBus.emit("exitPreviewMode");
    },

    normalizeSearchText(text) {
      // Remove all non-alpha chars except spaces, then lowercase
      return String(text || "")
        .replace(/[^a-zA-Z\s]/g, "")
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " ");
    },

    matchesSearchTerm(actorName, searchWords) {
      const normActorName = this.normalizeSearchText(actorName);
      const actorWords = normActorName.split(" ");

      // Check if any search word matches any actor name word (exact match only)
      return searchWords.some((searchWord) =>
        actorWords.some((actorWord) => actorWord === searchWord),
      );
    },

    async handleActorSearch() {
      const searchText = this.actorSearchText.trim();
      if (!searchText) return;

      console.log("Actor search:", searchText);

      // Normalize search text
      const normalizedSearch = this.normalizeSearchText(searchText);
      const searchWords = normalizedSearch.split(" ");

      // Emit event to list component with search details
      evtBus.emit("searchActors", {
        searchText: searchText,
        normalizedSearch: normalizedSearch,
        searchWords: searchWords,
        matchesSearchTerm: this.matchesSearchTerm.bind(this),
      });
    },

    getActorsModeButtonStyle(isActive) {
      return {
        fontSize: "13px",
        cursor: "pointer",
        borderRadius: "5px",
        padding: "2px 8px",
        minWidth: "80px",
        border: "1px solid #bbb",
        "--btn-bg": isActive ? "lightgray" : "whitesmoke",
      };
    },

    getRegularButtonStyle() {
      return this.getActorsModeButtonStyle(!this.isGuestMode);
    },

    getGuestsButtonStyle() {
      return this.getActorsModeButtonStyle(!!this.isGuestMode);
    },

    async handleSeasonEpisodeBlur() {
      if (!this.isGuestMode) return;
      const s = String(this.seasonNum || "").trim();
      const e = String(this.episodeNum || "").trim();
      if (!s || !e) return;
      await this.handleGuestClick();
    },
    async handleActorClick({ event, actor }) {
      const name = String(actor?.personName || actor?.name || "").trim();
      if (!name) return;

      // Toggle selection
      if (this.selectedActor && this.selectedActor === actor) {
        // Deselect
        this.selectedActor = null;
        this.showingCredits = false;
        this.credits = [];
        this.creditsError = null;
        evtBus.emit("clearActorFilter");
      } else {
        // Select
        this.selectedActor = actor;
        this.showingCredits = false;
        this.credits = [];
        this.creditsError = null;
        evtBus.emit("actorSelected");
      }
    },

    // Keep for future use (Wikipedia feature):
    /*
    async handleActorClickOpenWikipedia({ event, actor }) {
      const a = actor;

      const name = String(a?.personName || a?.name || "").trim();
      if (!name) return;

      // Open window immediately to avoid popup blocker
      const win = util.openExternalPage("about:blank");

      // Get actor page URL and open it
      const actorName = a?.personName || a?.name;
      if (actorName) {
        try {
          const url = await srvr.getActorPage(actorName);
          if (url && win && !win.closed) {
            win.location.href = url;
          } else {
            win?.close();
          }
        } catch (e) {
          console.error("handleActorClick error:", e);
          win?.close();
        }
      } else {
        win?.close();
      }
    },
    */

    // Keep for future use (filter by actor feature):
    /*
    handleActorLongPress({ event, actor }) {
      const name = String(actor?.personName || actor?.name || "").trim();
      if (!name) return;

      // Emit event to list component to filter shows by this actor
      evtBus.emit("filterByActor", { actorName: name });
    },
    */

    async handleShowsButton() {
      if (!this.selectedActor) return;
      const name = String(
        this.selectedActor?.personName || this.selectedActor?.name || "",
      ).trim();
      if (!name) return;

      // Emit event to list component to filter shows by this actor
      evtBus.emit("filterByActor", { actorName: name });
    },

    async handleAllCreditsButton() {
      console.log(
        "[ACTORS] handleAllCreditsButton called",
        new Date().toISOString(),
      );
      if (!this.selectedActor) return;

      // Toggle off if already showing
      if (this.showingCredits) {
        this.showingCredits = false;
        return;
      }

      const name = String(
        this.selectedActor?.personName || this.selectedActor?.name || "",
      ).trim();
      if (!name) return;
      console.log("[ACTORS] Actor name:", name);

      // Prevent duplicate requests
      if (this.creditsLoading) {
        console.log("[ACTORS] Already loading, returning");
        return;
      }

      // Check cache first
      if (this.creditsCache[name]) {
        console.log("[ACTORS] Using cached credits");
        this.showingCredits = true;
        this.credits = this.creditsCache[name].credits || [];
        this.actorPageUrl = this.creditsCache[name].actorPageUrl || null;
        return;
      }
      console.log("[ACTORS] No cache, fetching from server");

      this.showingCredits = true;
      this.creditsLoading = true;
      this.creditsError = null;
      this.credits = [];
      this.actorPageUrl = null;

      try {
        console.log("[ACTORS] Calling srvr.getActorCredits...");
        const result = await srvr.getActorCredits(name);
        console.log("[ACTORS] Received result from srvr.getActorCredits");
        this.credits = result?.credits || [];
        this.actorPageUrl = result?.actorPageUrl || null;
        this.creditsLoading = false;
        // Cache the results
        this.creditsCache[name] = {
          credits: this.credits,
          actorPageUrl: this.actorPageUrl,
        };
      } catch (e) {
        console.error("Failed to load actor credits:", e);
        this.creditsError = e.message || "Failed to load credits";
        this.creditsLoading = false;
      }
    },

    async handleWikipediaButton() {
      if (!this.selectedActor) return;
      const actor = this.selectedActor;
      const name = String(actor?.personName || actor?.name || "").trim();
      if (!name) return;

      // Open window immediately to avoid popup blocker
      const win = util.openExternalPage("about:blank");

      // Get actor page URL and open it
      const actorName = actor?.personName || actor?.name;
      if (actorName) {
        try {
          const url = await srvr.getActorPage(actorName);
          if (url && win && !win.closed) {
            win.location.href = url;
          } else {
            win?.close();
          }
        } catch (e) {
          console.error("handleWikipediaButton error:", e);
          win?.close();
        }
      } else {
        win?.close();
      }
    },

    async handleVipButton() {
      const name =
        this.selectedActor?.personName || this.selectedActor?.name || "";
      if (!name) return;
      const updated = new Set(this.vipActors);
      if (updated.has(name)) {
        updated.delete(name);
      } else {
        updated.add(name);
      }
      this.vipActors = updated;
      await saveVipActors(updated);
      evtBus.emit("vipActorsChanged", updated);
      // Re-sort crew and actors to reflect VIP status change
      this.crew = [...this.crew].sort((a, b) => {
        const aVip = this.vipActors.has(a.name) ? 0 : 1;
        const bVip = this.vipActors.has(b.name) ? 0 : 1;
        if (aVip !== bVip) return aVip - bVip;
        return (
          CREW_TYPE_ORDER.indexOf(a.type) - CREW_TYPE_ORDER.indexOf(b.type)
        );
      });
      this.actors = [...this.actors].sort((a, b) => {
        const aName = a.personName || a.name || "";
        const bName = b.personName || b.name || "";
        const aVip = this.vipActors.has(aName) ? 0 : 1;
        const bVip = this.vipActors.has(bName) ? 0 : 1;
        return aVip - bVip;
      });
    },

    handleCrewClick(event, member) {
      if (event?.ctrlKey) {
        const name = String(member?.name || "").trim();
        if (name)
          util.openExternalPage(
            `https://${theMan}.com/search/celebs?term=${encodeURIComponent(name)}`,
          );
        return;
      }
      if (this.selectedActor === member) {
        this.selectedActor = null;
        this.showingCredits = false;
        this.credits = [];
        this.creditsError = null;
        evtBus.emit("clearActorFilter");
      } else {
        this.selectedActor = member;
        this.showingCredits = false;
        this.credits = [];
        this.creditsError = null;
        evtBus.emit("actorSelected");
      }
    },

    handleImdbButton() {
      if (!this.actorPageUrl) return;
      util.openExternalPage(this.actorPageUrl);
    },

    handleDoneButton() {
      this.selectedActor = null;
      this.showingCredits = false;
      this.credits = [];
      this.creditsError = null;
      this.actorPageUrl = null;
    },

    async handleCreditCardClick(credit) {
      if (!credit || !credit.title) return;

      let tvdbItem = null;
      if (credit.imdbId) {
        tvdbItem = await tvdb.getTvdbSearchByImdbId(credit.imdbId);
      }

      evtBus.emit("showBrowsePane");
      if (tvdbItem && !tvdbItem.isMovie) {
        evtBus.emit("browseShowByTvdbId", tvdbItem);
      } else {
        const isMovie = !!(tvdbItem && tvdbItem.isMovie);
        const title = (tvdbItem && tvdbItem.name) || credit.title;
        evtBus.emit("browseSearchTitle", { title, isMovie });
      }
    },

    hasAnyImage(actor) {
      return Boolean(actor?.image || actor?.personImgURL);
    },

    async fillMissingImages(list) {
      // list items may use personName/name (actors) or just name (crew)
      await Promise.all(
        list.map(async (item) => {
          if (item.image || item.personImgURL) return;
          const name = item.personName || item.name;
          const cached = tvdb.getPersonImageFromCache(name);
          if (cached) {
            item.image = cached;
            if ("personImgURL" in item) item.personImgURL = cached;
            return;
          }
          try {
            const tmdbImage = await srvr.searchTmdbPerson({ name });
            if (tmdbImage) {
              item.image = tmdbImage;
              if ("personImgURL" in item) item.personImgURL = tmdbImage;
            }
          } catch (_) {
            // no image available
          }
        }),
      );
    },

    normPersonName(name) {
      return String(name || "")
        .trim()
        .toLowerCase();
    },

    mergeTmdbTvdbActors(tmdbIn, tvdbIn) {
      const tmdb = Array.isArray(tmdbIn) ? [...tmdbIn] : [];
      const tvdb = Array.isArray(tvdbIn) ? [...tvdbIn] : [];
      const output = [];

      const tmdbBefore = tmdb.length;
      const tvdbBefore = tvdb.length;

      // Deduplicate each list by actor name (keep first occurrence)
      const deduplicateByActor = (list) => {
        const seen = new Set();
        return list.filter((actor) => {
          const name = this.normPersonName(actor?.personName || actor?.name);
          if (seen.has(name)) return false;
          seen.add(name);
          return true;
        });
      };

      const tmdbUnique = deduplicateByActor(tmdb);
      const tvdbUnique = deduplicateByActor(tvdb);

      // Sort both lists by normalized person name so duplicates align
      tmdbUnique.sort((a, b) => {
        const nameA = this.normPersonName(a?.personName || a?.name);
        const nameB = this.normPersonName(b?.personName || b?.name);
        return nameA.localeCompare(nameB);
      });
      tvdbUnique.sort((a, b) => {
        const nameA = this.normPersonName(a?.personName || a?.name);
        const nameB = this.normPersonName(b?.personName || b?.name);
        return nameA.localeCompare(nameB);
      });

      while (true) {
        if (tmdbUnique.length === 0) {
          tvdbUnique.forEach((actor) => {
            actor.source = actor.source || "tvdb";
            actor.actorSort = actor.sort;
          });
          output.push(...tvdbUnique);
          break;
        }
        if (tvdbUnique.length === 0) {
          tmdbUnique.forEach((actor) => {
            actor.source = actor.source || "tmdb";
          });
          output.push(...tmdbUnique);
          break;
        }

        const t0 = tmdbUnique[0];
        const v0 = tvdbUnique[0];
        const tName = this.normPersonName(t0?.personName || t0?.name);
        const vName = this.normPersonName(v0?.personName || v0?.name);

        const duplicate = tName && vName && tName === vName;
        if (duplicate) {
          const tHasImage = this.hasAnyImage(t0);
          const vHasImage = this.hasAnyImage(v0);

          if (tHasImage !== vHasImage) {
            if (tHasImage) {
              tvdbUnique.shift();
              const actor = tmdbUnique.shift();
              actor.source = actor.source || "tmdb";
              output.push(actor);
            } else {
              tmdbUnique.shift();
              const actor = tvdbUnique.shift();
              actor.source = actor.source || "tvdb";
              actor.actorSort = actor.sort;
              output.push(actor);
            }
          } else {
            tmdbUnique.shift();
            const actor = tvdbUnique.shift();
            actor.source = actor.source || "tvdb";
            actor.actorSort = actor.sort;
            output.push(actor);
          }
        } else {
          if (tName < vName) {
            const actor = tmdbUnique.shift();
            actor.source = actor.source || "tmdb";
            output.push(actor);
          } else {
            const actor = tvdbUnique.shift();
            actor.source = actor.source || "tvdb";
            actor.actorSort = actor.sort;
            output.push(actor);
          }
        }
      }

      // Final sort: VIPs first, then actors with images, then by source/sort
      output.sort((a, b) => {
        const aName = a.personName || a.name || "";
        const bName = b.personName || b.name || "";
        const aVip = this.vipActors.has(aName) ? 0 : 1;
        const bVip = this.vipActors.has(bName) ? 0 : 1;
        if (aVip !== bVip) return aVip - bVip;

        const aSource = a.source || "unknown";
        const bSource = b.source || "unknown";
        const aHasImage = this.hasAnyImage(a);
        const bHasImage = this.hasAnyImage(b);

        // Image presence is highest priority: actors with images come before actors without
        if (aHasImage && !bHasImage) return -1;
        if (!aHasImage && bHasImage) return 1;

        // Both have images or both don't have images - sort by source
        // TVDB comes before TMDB
        if (aSource === "tvdb" && bSource === "tmdb") return -1;
        if (aSource === "tmdb" && bSource === "tvdb") return 1;

        // Both from same source
        if (aSource === "tvdb" && bSource === "tvdb") {
          // Sort TVDB by actorSort ascending
          const aSort = a.actorSort || a.sort || 0;
          const bSort = b.actorSort || b.sort || 0;
          return aSort - bSort;
        }

        if (aSource === "tmdb" && bSource === "tmdb") {
          // Sort TMDB by actorEpiCount descending
          const aCount = a.actorEpiCount || 0;
          const bCount = b.actorEpiCount || 0;
          return bCount - aCount;
        }

        return 0;
      });

      return { output, tmdbBefore, tvdbBefore };
    },

    normPosIntStr(v) {
      const n = parseInt(String(v ?? "").trim(), 10);
      if (!Number.isFinite(n) || n <= 0) return "";
      return String(n);
    },

    normNonNegIntStr(v) {
      const n = parseInt(String(v ?? "").trim(), 10);
      if (!Number.isFinite(n) || n < 0) return "";
      return String(n);
    },

    ensureEpisodeInputs() {
      if (!String(this.seasonNum || "").trim()) this.seasonNum = "1";
      if (!String(this.episodeNum || "").trim()) this.episodeNum = "1";
    },

    resetPane() {
      this.actors = [];
      this.seriesActors = [];
      this.showName = "";
      this.currentShow = null;
      this.seasonNum = "";
      this.episodeNum = "";
      this.errorMessage = "";
      this.isGuestMode = false;
      this.showingEpisodeActors = false;
      this.crew = [];

      this._seriesMapInForArrows = null;
      this._seriesMapInForArrowsShowKey = null;
      this._seriesMapInForArrowsPromise = null;
    },

    prefetchSeriesMapForArrows() {
      const show = this.currentShow;
      if (!show) return;
      const showKey = show?.id || show?.name || null;
      if (!showKey) return;

      if (
        this._seriesMapInForArrowsShowKey === showKey &&
        (this._seriesMapInForArrows || this._seriesMapInForArrowsPromise)
      ) {
        return;
      }

      this._seriesMapInForArrowsShowKey = showKey;
      this._seriesMapInForArrows = null;
      this._seriesMapInForArrowsPromise = (async () => {
        try {
          const in2 = await tvdb.getSeriesMap(show);
          if (this._seriesMapInForArrowsShowKey === showKey) {
            this._seriesMapInForArrows = Array.isArray(in2) ? in2 : [];
          }
        } catch {
          if (this._seriesMapInForArrowsShowKey === showKey) {
            this._seriesMapInForArrows = [];
          }
        } finally {
          if (this._seriesMapInForArrowsShowKey === showKey) {
            this._seriesMapInForArrowsPromise = null;
          }
        }
      })();
    },
    handleMapButton() {
      const show = this.currentShow;
      if (show) {
        evtBus.emit("mapAction", { action: "open", show });
      }
    },

    async handleGuestClick() {
      this.selectedActor = null;
      this.errorMessage = "";
      this.isGuestMode = true;

      // If input boxes are empty, auto-fill from map first
      if (!this.seasonNum || !this.episodeNum) {
        await this.prefillEpisodeInputs();

        // Check if prefill worked
        if (!this.seasonNum || !this.episodeNum) {
          this.errorMessage = "No unwatched episodes found";
          return;
        }
      }

      const season = parseInt(this.seasonNum);
      const episode = parseInt(this.episodeNum);

      if (isNaN(season) || isNaN(episode)) {
        this.errorMessage = "Invalid season or episode";
        return;
      }

      // Load guests from TMDB
      let tmdbList = [];
      try {
        const params = {
          showName: this.showName,
          year: null,
          season: season,
          episode: episode,
        };

        const guestActors = await srvr.getTmdb(params);

        if (Array.isArray(guestActors) && guestActors.length) {
          tmdbList = guestActors.map((actor) => {
            const imageUrl = actor.profile_path
              ? `https://image.tmdb.org/t/p/w185${actor.profile_path}`
              : null;

            return {
              name: actor.character,
              personName: actor.name,
              image: imageUrl,
              personImgURL: imageUrl,
              url: null,
              sort: actor.order,
              isFeatured: false,
            };
          });
        }
      } catch (error) {
        // Silent error handling
      }

      // Load guests from TVDB
      let tvdbList = [];
      try {
        const tvdbGuests = await tvdb.getEpisodeGuests(
          this.showName,
          season,
          episode,
        );
        if (Array.isArray(tvdbGuests) && tvdbGuests.length) {
          tvdbList = tvdbGuests;
        }
      } catch (error) {
        // Silent error handling
      }

      // Remove regulars from both guest lists before merging
      if (this.seriesActors && this.seriesActors.length > 0) {
        const regularNames = new Set(
          this.seriesActors.map((actor) =>
            this.normPersonName(actor?.personName || actor?.name),
          ),
        );

        tmdbList = tmdbList.filter((actor) => {
          const actorName = this.normPersonName(
            actor?.personName || actor?.name,
          );
          return !regularNames.has(actorName);
        });

        tvdbList = tvdbList.filter((actor) => {
          const actorName = this.normPersonName(
            actor?.personName || actor?.name,
          );
          return !regularNames.has(actorName);
        });
      }

      // Merge TMDB and TVDB guest lists
      const mergeResult = this.mergeTmdbTvdbActors(tmdbList, tvdbList);
      this.actors = mergeResult.output;

      // Fill in missing images via cache then TMDB person search
      await this.fillMissingImages(this.actors);

      if (this.actors.length === 0) {
        this.errorMessage = "No guest stars found";
      }

      // Mark that we're showing episode actors
      this.showingEpisodeActors = true;

      // Log summary with before/after counts
      const tvdbAfter = this.actors.filter((a) => a.source === "tvdb").length;
      const tmdbAfter = this.actors.filter((a) => a.source === "tmdb").length;
      const seasonStr = String(season).padStart(2, "0");
      const episodeStr = String(episode).padStart(2, "0");
      if (DEBUG_ACTORS_MERGE_LOG) {
        console.debug(
          `${this.showName} S${seasonStr}E${episodeStr} | TVDB: ${mergeResult.tvdbBefore}, ${tvdbAfter} | TMDB: ${mergeResult.tmdbBefore}, ${tmdbAfter}`,
        );
      }
    },

    handleRegularClick() {
      this.selectedActor = null;
      this.errorMessage = "";
      this.isGuestMode = false;
      this.showingEpisodeActors = false;
      // Restore series actors
      this.actors = [...this.seriesActors];
    },

    async getSeriesMapInForArrows(show) {
      if (!show) return [];
      const showKey = show?.id || show?.name || null;

      // Use cached/prefetched TVDB map for noemby.
      if (
        show?.inEmby === false &&
        showKey &&
        this._seriesMapInForArrowsShowKey === showKey
      ) {
        if (
          Array.isArray(this._seriesMapInForArrows) &&
          this._seriesMapInForArrows.length
        ) {
          return this._seriesMapInForArrows;
        }
        if (this._seriesMapInForArrowsPromise) {
          await this._seriesMapInForArrowsPromise;
          if (
            Array.isArray(this._seriesMapInForArrows) &&
            this._seriesMapInForArrows.length
          ) {
            return this._seriesMapInForArrows;
          }
        }
      }

      // Prefer Emby when available, but for noemby (and other failures),
      // fall back to TVDB (same strategy as map pane).
      try {
        const in1 = await emby.getSeriesMap(show);
        if (in1 && in1.length) return in1;
      } catch {
        // ignore
      }
      try {
        const in2 = await tvdb.getSeriesMap(show);
        if (in2 && in2.length) return in2;
      } catch {
        // ignore
      }
      return [];
    },

    async handleLeftArrow() {
      if (!this.currentShow) return;

      // Arrow navigation always moves through episodes; if in regular mode, switch to guest mode.
      if (!this.isGuestMode) this.isGuestMode = true;

      if (!this.seasonNum || !this.episodeNum) {
        await this.prefillEpisodeInputs();
      }
      this.ensureEpisodeInputs();
      this.seasonNum = this.normNonNegIntStr(this.seasonNum);
      this.episodeNum = this.normPosIntStr(this.episodeNum);
      if (!this.seasonNum || !this.episodeNum) return;

      try {
        const seriesMapIn = await this.getSeriesMapInForArrows(
          this.currentShow,
        );
        if (!seriesMapIn || seriesMapIn.length === 0) {
          // Last-resort fallback: decrement episode.
          const curS = Number(this.seasonNum);
          const curE = Number(this.episodeNum);
          if (!Number.isFinite(curS) || !Number.isFinite(curE)) return;
          if (curS <= 0 && curE <= 1) return;
          if (curS <= 1 && curE <= 1) return;
          if (curE > 1) this.episodeNum = String(curE - 1);
          else {
            this.seasonNum = String(Math.max(0, curS - 1));
            this.episodeNum = "1";
          }
          await this.handleGuestClick();
          return;
        }

        const seriesMap = util.buildSeriesMap(seriesMapIn);
        if (!seriesMap) {
          return;
        }

        // Build flat list of all episodes in order
        const allEpisodes = [];
        const seasons = Object.keys(seriesMap).sort(
          (a, b) => Number(a) - Number(b),
        );

        for (const seasonNum of seasons) {
          const episodes = seriesMap[seasonNum];
          const episodeNums = Object.keys(episodes).sort(
            (a, b) => Number(a) - Number(b),
          );

          for (const episodeNum of episodeNums) {
            allEpisodes.push({ season: seasonNum, episode: episodeNum });
          }
        }

        // Find current episode index
        const curS = Number(this.seasonNum);
        const curE = Number(this.episodeNum);
        const currentIndex = allEpisodes.findIndex(
          (ep) => Number(ep.season) === curS && Number(ep.episode) === curE,
        );

        if (currentIndex > 0) {
          // Go to previous episode
          const prevEpisode = allEpisodes[currentIndex - 1];
          this.seasonNum = this.normNonNegIntStr(prevEpisode.season);
          this.episodeNum = this.normPosIntStr(prevEpisode.episode);
          await this.handleGuestClick();
        }
      } catch (error) {
        // Silently ignore errors
      }
    },

    async handleRightArrow() {
      if (!this.currentShow) return;

      // Arrow navigation always moves through episodes; if in regular mode, switch to guest mode.
      if (!this.isGuestMode) this.isGuestMode = true;

      if (!this.seasonNum || !this.episodeNum) {
        await this.prefillEpisodeInputs();
      }
      this.ensureEpisodeInputs();
      this.seasonNum = this.normNonNegIntStr(this.seasonNum);
      this.episodeNum = this.normPosIntStr(this.episodeNum);
      if (!this.seasonNum || !this.episodeNum) return;

      try {
        const seriesMapIn = await this.getSeriesMapInForArrows(
          this.currentShow,
        );
        if (!seriesMapIn || seriesMapIn.length === 0) {
          // Last-resort fallback: increment episode.
          const curS = Number(this.seasonNum);
          const curE = Number(this.episodeNum);
          if (!Number.isFinite(curS) || !Number.isFinite(curE)) return;
          this.seasonNum = String(curS);
          this.episodeNum = String(Math.min(99, curE + 1));
          await this.handleGuestClick();
          return;
        }

        const seriesMap = util.buildSeriesMap(seriesMapIn);
        if (!seriesMap) {
          return;
        }

        // Build flat list of all episodes in order
        const allEpisodes = [];
        const seasons = Object.keys(seriesMap).sort(
          (a, b) => Number(a) - Number(b),
        );

        for (const seasonNum of seasons) {
          const episodes = seriesMap[seasonNum];
          const episodeNums = Object.keys(episodes).sort(
            (a, b) => Number(a) - Number(b),
          );

          for (const episodeNum of episodeNums) {
            allEpisodes.push({ season: seasonNum, episode: episodeNum });
          }
        }

        // Find current episode index
        const curS = Number(this.seasonNum);
        const curE = Number(this.episodeNum);
        const currentIndex = allEpisodes.findIndex(
          (ep) => Number(ep.season) === curS && Number(ep.episode) === curE,
        );

        if (currentIndex >= 0 && currentIndex < allEpisodes.length - 1) {
          // Go to next episode
          const nextEpisode = allEpisodes[currentIndex + 1];
          this.seasonNum = this.normNonNegIntStr(nextEpisode.season);
          this.episodeNum = this.normPosIntStr(nextEpisode.episode);
          await this.handleGuestClick();
        }
      } catch (error) {
        // Silently ignore errors
      }
    },

    async prefillEpisodeInputs() {
      // Strategy 1: Check if currently playing show matches selected show
      try {
        const devices = await srvr.getDevices();

        // Find a device playing the current show (prioritize chromecast)
        let playingDevice = devices.find(
          (d) => d.deviceName === "chromecast" && d.showName === this.showName,
        );
        if (!playingDevice) {
          playingDevice = devices.find((d) => d.showName === this.showName);
        }

        if (
          playingDevice &&
          playingDevice.seasonNumber &&
          playingDevice.episodeNumber
        ) {
          this.seasonNum = String(playingDevice.seasonNumber);
          this.episodeNum = String(playingDevice.episodeNumber);
          return;
        }
      } catch (error) {
        // Continue to strategy 2
      }

      // Strategy 2: Use seriesMap to find first unwatched episode
      try {
        if (!this.currentShow) {
          return;
        }

        const seriesMapIn = await emby.getSeriesMap(this.currentShow);

        if (!seriesMapIn || seriesMapIn.length === 0) {
          return; // Leave empty (strategy 3)
        }

        const seriesMap = util.buildSeriesMap(seriesMapIn);

        if (!seriesMap) {
          return; // Leave empty (strategy 3)
        }

        // Find first episode that is available and not played
        const seasons = Object.keys(seriesMap).sort(
          (a, b) => Number(a) - Number(b),
        );

        for (const seasonNum of seasons) {
          const episodes = seriesMap[seasonNum];
          const episodeNums = Object.keys(episodes).sort(
            (a, b) => Number(a) - Number(b),
          );

          for (const episodeNum of episodeNums) {
            const epiObj = episodes[episodeNum];

            if (epiObj.avail && !epiObj.played) {
              this.seasonNum = seasonNum;
              this.episodeNum = episodeNum;
              return;
            }
          }
        }
        // If no "first available + not played" episode exists, default to S1E1.
        if (
          !String(this.seasonNum || "").trim() &&
          !String(this.episodeNum || "").trim()
        ) {
          this.seasonNum = "1";
          this.episodeNum = "1";
        }
      } catch (error) {
        // Fall back to S1E1 if we couldn't compute a better default.
        if (
          this.currentShow &&
          !String(this.seasonNum || "").trim() &&
          !String(this.episodeNum || "").trim()
        ) {
          this.seasonNum = "1";
          this.episodeNum = "1";
        }
      }
    },

    async loadCrew(tvdbData, show) {
      const actualData = tvdbData?.response?.data || tvdbData;
      const crewSort = (a, b) => {
        const aVip = this.vipActors.has(a.name) ? 0 : 1;
        const bVip = this.vipActors.has(b.name) ? 0 : 1;
        if (aVip !== bVip) return aVip - bVip;
        return (
          CREW_TYPE_ORDER.indexOf(a.type) - CREW_TYPE_ORDER.indexOf(b.type)
        );
      };
      // If crew field exists AND all entries have images (or it's empty), use as-is
      if (Array.isArray(actualData?.crew)) {
        const hasImageGap =
          actualData.crew.length > 0 &&
          actualData.crew.some((c) => c.image === undefined);
        if (!hasImageGap) {
          this.crew = [...actualData.crew].sort(crewSort);
          await this.fillMissingImages(this.crew);
          return;
        }
      }
      // crew field absent — fetch from TVDB and store back (even if result is empty)
      const tvdbId = show?.tvdbId || actualData?.tvdbId;
      if (!tvdbId) return;
      try {
        const res = await tvdb.fetchExtendedForCrew(tvdbId);
        if (!Array.isArray(res)) return;
        this.crew = [...res].sort(crewSort);
        await this.fillMissingImages(this.crew);
        const showName = actualData?.name || show?.name;
        if (showName) {
          await srvr.setTvdbFields({ name: showName, crew: res });
        }
      } catch {
        // silent
      }
    },

    async updateActors(data) {
      if (!data) {
        this.actors = [];
        this.showName = "";
        this.currentShow = null;
        return;
      }

      // Extract show, tvdbData, and actorSearchParams from the data object
      const tvdbData = data.tvdbData || data;
      this.currentShow = data.show || null;
      const actorSearchParams = data.actorSearchParams || null;

      // Handle both formats: direct data or wrapped in response.data
      const actualData = tvdbData.response?.data || tvdbData;
      this.showName = actualData?.name || this.currentShow?.name || "";

      const characters = actualData?.characters;

      // Load actors from TVDB into a tvdb list
      let tvdbList = [];
      if (Array.isArray(characters) && characters.length) {
        tvdbList = characters.map((char) => ({
          name: char.character,
          personName: char.actor,
          image: char.image,
          personImgURL: char.image,
          url: char.tvdbUrl,
          sort: char.sortOrder,
          isFeatured: char.isFeatured,
        }));
      }

      // Load actors from TMDB into a tmdb list
      let tmdbList = [];
      try {
        // First, get series metadata to extract the series ID
        const seriesParams = {
          showName: this.showName,
          year: null,
        };

        // If we have IMDB ID, add it to the request
        if (this.currentShow?.ProviderIds?.IMDB) {
          seriesParams.imdbId = this.currentShow.ProviderIds.IMDB;
        }

        const seriesData = await srvr.getTmdb(seriesParams);

        // Check if we got series metadata with an ID
        if (seriesData && typeof seriesData === "object" && seriesData.id) {
          const seriesId = seriesData.id;

          // Try to get aggregate_credits using the series ID
          // TMDB API: /tv/{series_id}/aggregate_credits returns all cast across all seasons
          const creditsParams = {
            seriesId: seriesId,
            credits: true,
          };

          // Also include IMDB ID if available, in case server supports that route
          if (this.currentShow?.ProviderIds?.IMDB) {
            creditsParams.imdbId = this.currentShow.ProviderIds.IMDB;
          }

          const creditsData = await srvr.getTmdb(creditsParams);

          // Check if we got cast array
          let castArray = null;
          if (Array.isArray(creditsData)) {
            castArray = creditsData;
          } else if (creditsData && Array.isArray(creditsData.cast)) {
            castArray = creditsData.cast;
          }

          if (castArray && castArray.length) {
            // Filter to only include series regulars (actors who appeared in multiple episodes)
            // Use binary search to find the minimum episode threshold that gives us < 10 regulars
            const TARGET_MAX_REGULARS = 10;

            // Find the max episode count in the data
            const maxEpisodeCount = Math.max(
              ...castArray.map((a) => a.total_episode_count || 0),
            );

            let low = 1;
            let high = maxEpisodeCount;
            let bestThreshold = maxEpisodeCount; // Default to max if we can't get < 10

            while (low <= high) {
              const mid = Math.floor((low + high) / 2);
              const count = castArray.filter(
                (a) => (a.total_episode_count || 0) >= mid,
              ).length;

              if (count < TARGET_MAX_REGULARS) {
                // Few enough actors, save this threshold and try lower to get more
                bestThreshold = mid;
                high = mid - 1;
              } else {
                // Too many actors, need higher threshold
                low = mid + 1;
              }
            }

            const regularsOnly = castArray.filter((actor) => {
              const episodeCount = actor.total_episode_count || 0;
              return episodeCount >= bestThreshold;
            });

            tmdbList = regularsOnly.map((actor) => {
              const imageUrl = actor.profile_path
                ? `https://image.tmdb.org/t/p/w185${actor.profile_path}`
                : null;

              return {
                name: actor.character || actor.roles?.[0]?.character,
                personName: actor.name,
                image: imageUrl,
                personImgURL: imageUrl,
                url: null,
                sort: actor.order,
                isFeatured: false,
                source: "tmdb",
                actorEpiCount: actor.total_episode_count || 0,
              };
            });
          }
        }
      } catch (error) {
        // Silent error handling
      }

      // Merge TMDB and TVDB lists
      const mergeResult = this.mergeTmdbTvdbActors(tmdbList, tvdbList);
      this.actors = mergeResult.output;

      // Persist any TMDB-only actors into the TVDB characters array so that
      // actor-based show filtering (filterShowsByActor) can find them.
      const showKey = this.currentShow?.name || this.showName;
      if (showKey && tmdbList.length > 0) {
        const existingChars = Array.isArray(characters) ? characters : [];
        const existingNames = new Set(
          existingChars.map((c) => this.normPersonName(c.actor)),
        );
        const newChars = tmdbList
          .filter((a) => {
            const n = this.normPersonName(a.personName || a.name);
            return n && !existingNames.has(n);
          })
          .map((a) => ({
            character: a.name || null,
            actor: a.personName || a.name,
            image: a.image || null,
            tvdbUrl: null,
            sortOrder: a.sort ?? 0,
            isFeatured: false,
            source: "tmdb",
          }));
        if (newChars.length > 0 && !this.previewMode) {
          try {
            const updated = await srvr.setTvdbFields({
              name: showKey,
              characters: [...existingChars, ...newChars],
            });
            if (updated && typeof updated === "object") {
              evtBus.emit("tvdbRecordPatched", {
                showName: showKey,
                record: updated,
              });
            }
          } catch (e) {
            // silent
          }
        }
      }

      // If actor search is active, sort to prioritize matching actors
      if (
        actorSearchParams?.searchWords &&
        actorSearchParams?.matchesSearchTerm
      ) {
        const { searchWords, matchesSearchTerm } = actorSearchParams;
        this.actors.sort((a, b) => {
          const aName = a?.personName || a?.name || "";
          const bName = b?.personName || b?.name || "";
          const aMatches = matchesSearchTerm(aName, searchWords);
          const bMatches = matchesSearchTerm(bName, searchWords);

          // Matching actors come first
          if (aMatches && !bMatches) return -1;
          if (!aMatches && bMatches) return 1;

          // If both match or both don't match, maintain existing order
          return 0;
        });
      }

      // Cache series actors for restore
      await this.fillMissingImages(this.actors);
      this.seriesActors = [...this.actors];
      this.isGuestMode = false;
      this.showingEpisodeActors = false;

      // Load crew (Creator, Executive Producer, Producer, Writer)
      void this.loadCrew(tvdbData, this.currentShow);

      // Handle "no cast info" message with 2-second delay
      if (this.noCastMessageTimer) {
        clearTimeout(this.noCastMessageTimer);
      }
      this.showNoCastMessage = false;
      if (this.actors.length === 0) {
        this.noCastMessageTimer = setTimeout(() => {
          this.showNoCastMessage = true;
        }, 2000);
      }

      // Log summary with before/after counts
      const tvdbAfter = this.actors.filter((a) => a.source === "tvdb").length;
      const tmdbAfter = this.actors.filter((a) => a.source === "tmdb").length;
      if (DEBUG_ACTORS_MERGE_LOG) {
        console.debug(
          `${this.showName} | TVDB: ${mergeResult.tvdbBefore}, ${tvdbAfter} | TMDB: ${mergeResult.tmdbBefore}, ${tmdbAfter}`,
        );
      }
    },
  },

  mounted() {
    loadVipActors()
      .then((set) => {
        this.vipActors = set;
      })
      .catch(() => {});

    this._onShowActors = async (data) => {
      await this.updateActors(data);

      // Deselect actor when a new show is selected from the list
      // BUT: preserve credits if we're currently showing them (from getActorCredits)
      if (this.selectedActor && !this.showingCredits) {
        this.selectedActor = null;
        this.showingCredits = false;
        this.credits = [];
        this.creditsError = null;
        this.actorPageUrl = null;
      }

      // For noemby shows, start loading the series map immediately so
      // arrow navigation doesn't wait on TVDB later.
      // Allow callers (e.g. ctrl-click preview) to suppress this so the Map pane isn't populated.
      if (!data?.suppressSeriesMapPrefetch) {
        this.prefetchSeriesMapForArrows();
      }

      // Reset to series actors view
      this.isGuestMode = false;
      this.showingEpisodeActors = false;
      this.errorMessage = "";

      // Pre-fill episode inputs after actors are loaded
      void this.$nextTick(async () => {
        await this.prefillEpisodeInputs();

        // Guard: if inputs are still empty after pane load, force S1/E1.
        this.ensureEpisodeInputs();
      });
    };
    evtBus.on("showActors", this._onShowActors);

    this._onFillAndSelectEpisode = (episodeInfo) => {
      // Fill the input boxes
      this.seasonNum = String(episodeInfo.seasonNumber);
      this.episodeNum = String(episodeInfo.episodeNumber);
      // Do not auto-load guest actors; guest mode only when Guest is clicked.
    };
    evtBus.on("fillAndSelectEpisode", this._onFillAndSelectEpisode);

    this._onResetActorsPane = this.resetPane;
    evtBus.on("resetActorsPane", this._onResetActorsPane);

    this._onSetUpSeries = (show) => {
      // Exit credits mode and deselect actor when show selection changes
      // But don't deselect if the same show is still selected (e.g. after filterByActor)
      if (show && this.currentShow && show.name === this.currentShow.name)
        return;
      if (this.showingCredits || this.selectedActor) {
        this.selectedActor = null;
        this.showingCredits = false;
        this.credits = [];
        this.creditsError = null;
        this.creditsLoading = false;
        this.actorPageUrl = null;
      }
    };
    evtBus.on("setUpSeries", this._onSetUpSeries);

    this._onClearActorSelection = () => {
      this.selectedActor = null;
      this.showingCredits = false;
      this.credits = [];
      this.creditsError = null;
      this.creditsLoading = false;
      this.actorPageUrl = null;
    };
    evtBus.on("clearActorSelection", this._onClearActorSelection);

    evtBus.on("previewMode", this.onPreviewMode);
    evtBus.on("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.on("addPreviewShowDone", this.onAddPreviewShowDone);

    this._onTvdbUpdated = ({ name, record } = {}) => {
      if (!name || !record) return;
      if (name !== this.currentShow?.name) return;
      if (
        Array.isArray(record.crew) &&
        record.crew.length > 0 &&
        this.crew.length === 0
      )
        void this.loadCrew(record, this.currentShow);
    };
    evtBus.on("tvdbUpdated", this._onTvdbUpdated);
  },

  unmounted() {
    if (this.noCastMessageTimer) {
      clearTimeout(this.noCastMessageTimer);
    }

    if (this._onShowActors) evtBus.off("showActors", this._onShowActors);
    if (this._onFillAndSelectEpisode)
      evtBus.off("fillAndSelectEpisode", this._onFillAndSelectEpisode);
    if (this._onResetActorsPane)
      evtBus.off("resetActorsPane", this._onResetActorsPane);
    if (this._onSetUpSeries) evtBus.off("setUpSeries", this._onSetUpSeries);
    if (this._onClearActorSelection)
      evtBus.off("clearActorSelection", this._onClearActorSelection);

    if (this._onTvdbUpdated) evtBus.off("tvdbUpdated", this._onTvdbUpdated);
    evtBus.off("previewMode", this.onPreviewMode);
    evtBus.off("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.off("addPreviewShowDone", this.onAddPreviewShowDone);
  },
};
</script>

<style>
#actors {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

#actors::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}
</style>
