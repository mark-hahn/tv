<template>
  <div
    id="browsePane"
    @click="handleBackgroundClick"
    :style="{
      height: '100%',
      width: '100%',
      padding: '5px',
      margin: 0,
      display: 'flex',
      flexDirection: 'row',
      overflowY: 'hidden',
      overflowX: 'hidden',
      maxWidth: '100%',
      boxSizing: 'border-box',
      gap: '10px',
    }"
  >
    <div
      id="browseLeft"
      :style="{
        flex: '0 0 125px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }"
    >
      <reel-gallery
        :style="{ flex: '1', minHeight: 0 }"
        :srchStr="srchStr"
        :imdbid="curImdbId"
        :tvdbid="curTvdbId"
        :fallbackImage="manualSearchQuery ? null : curFallbackImage"
        :explicitList="
          creditShowList !== null
            ? creditShowList
            : unSnoozeMode
              ? snoozeList
              : null
        "
        @select="handleGallerySelect"
        @preview="handleGalleryPreview"
        @search-complete="handleSearchComplete"
      ></reel-gallery>
    </div>
    <div
      id="browseRight"
      :style="{
        flex: '1 1 0',
        minWidth: 0,
        minHeight: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '0',
      }"
    >
      <div
        id="browseInfo"
        :style="{
          padding: '5px 5px 0 5px',
          backgroundColor: '#f5f5f5',
          borderRadius: '5px',
          fontSize: '14px',
          textTransform: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }"
      >
        <div
          :style="{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '10px',
          }"
        >
          <div
            :style="{
              fontWeight: 'bold',
              fontSize: '16px',
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }"
          >
            {{ galleryTitleLine }}
          </div>
          <div
            :style="{
              flex: '0 0 auto',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
            }"
          >
            <input
              id="browseSearch"
              v-model="manualSearchQuery"
              @keyup.enter="handleManualSearch"
              placeholder="Search"
              :style="{
                border: '1px solid #ccc',
                borderRadius: '3px',
                padding: '2px 5px',
                width: '120px',
              }"
            />
            <span
              v-if="streamNotFound"
              style="color: red; font-weight: bold; font-size: 13px"
              >Stream not found</span
            >
            <button
              @click="handleStream"
              :style="{
                height: '24px',
                fontSize: '13px',
                padding: '2px 8px',
                border: '1px solid black',
                borderRadius: '3px',
                cursor: 'pointer',
              }"
            >
              Stream
            </button>
          </div>
        </div>
        <div
          :style="{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            minHeight: '27px',
          }"
        >
          <div
            :style="{
              flex: '0 1 auto',
              fontSize: '15px',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }"
          >
            {{ infoLine }}
          </div>
          <div
            v-if="watchedStatus"
            :style="{
              fontSize: '14px',
              backgroundColor: '#dfd',
              fontWeight: 'bold',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              padding: '2px 5px',
              borderRadius: '3px',
            }"
          >
            {{ watchedStatus }}
          </div>
        </div>
      </div>
      <!-- keep zero gap between description and buttons-->
      <div
        id="browseDescrButtons"
        :style="{
          flex: '0 0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0',
        }"
      >
        <div
          id="browseButtons"
          :style="{
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            padding: '5px',
            marginTop: '8px',
            border: '1px solid #808080',
            borderRadius: '5px',
            marginBottom: '8px',
            width: '100%',
            boxSizing: 'border-box',
          }"
        >
          <!-- Row 1: action buttons -->
          <div :style="{ display: 'flex', flexWrap: 'wrap', gap: '10px' }">
            <button
              @click="handleNext"
              :style="{
                height: '18px',
                margin: '0',
                padding: '0 2px',
                lineHeight: '18px',
                fontSize: '15px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '70px',
                backgroundColor: isLoadingNext
                  ? '#d3d3d3'
                  : browseHasMore
                    ? '#90ee90'
                    : '',
                border: '1px solid black',
              }"
            >
              Next
            </button>
            <button
              v-if="curTvdb"
              @click="handleSnooze"
              :style="{
                height: '18px',
                margin: '0',
                padding: '0 2px',
                lineHeight: '18px',
                fontSize: '15px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '70px',
                border: '1px solid black',
                backgroundColor: snoozeFlash ? '#90ee90' : '',
                cursor: 'pointer',
              }"
            >
              {{ unSnoozeMode ? "Unsnooze" : "Snooze" }}
            </button>
            <button
              v-if="snoozeList.length > 0"
              @click="unSnoozeMode ? (unSnoozeMode = false) : handleUnSnooze()"
              :style="{
                height: '18px',
                margin: '0',
                padding: '0 2px',
                lineHeight: '18px',
                fontSize: '15px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '101px',
                border: '1px solid black',
                backgroundColor: unSnoozeMode ? 'lightblue' : '',
                cursor: 'pointer',
              }"
            >
              Snoozed {{ snoozeList.length }}
            </button>
            <button
              v-if="curTvdb &amp;&amp; !isLoadingNext &amp;&amp; !suppressButtons"
              @click="handlePreview"
              :style="{
                height: '18px',
                margin: '0',
                padding: '0 2px',
                lineHeight: '18px',
                fontSize: '15px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '70px',
                border: '1px solid black',
              }"
            >
              Preview
            </button>
            <button
              v-if="curTvdb &amp;&amp; !isLoadingNext &amp;&amp; !suppressButtons"
              @click="handleGet"
              :style="{
                height: '18px',
                margin: '0',
                padding: '0 2px',
                lineHeight: '18px',
                fontSize: '15px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '70px',
                border: '1px solid black',
              }"
            >
              Get
            </button>
            <button
              v-if="existingShowMatch && !isLoadingNext && !suppressButtons"
              @click="handleSelectExisting(existingShowMatch.name)"
              :style="{
                height: '18px',
                margin: '0',
                marginLeft: '5px',
                padding: '0 2px',
                lineHeight: '18px',
                fontSize: '15px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '70px',
                backgroundColor: '#dfd',
                border: '1px solid black',
              }"
            >
              Select
            </button>
            <span
              v-if="isLoadingNext"
              :style="{
                marginLeft: '10px',
                color: '#888',
                fontStyle: 'italic',
                display: 'inline-flex',
                alignItems: 'center',
              }"
              >&lt;loading shows&gt;</span
            >
            <span
              v-if="!curTvdb &amp;&amp; !isLoadingNext &amp;&amp; !suppressButtons"
              :style="{
                marginLeft: '10px',
                color: '#888',
                fontStyle: 'italic',
                display: 'inline-flex',
                alignItems: 'center',
              }"
              >&lt;no show info&gt;</span
            >
            <span
              v-if="showNoMoreMsg && !isLoadingNext"
              :style="{
                marginLeft: '10px',
                color: 'red',
                fontWeight: 'bold',
                display: 'inline-flex',
                alignItems: 'center',
              }"
              >No more shows</span
            >
          </div>
          <!-- Row 2: remote buttons -->
          <div
            v-if="hasAnyRemoteButton &amp;&amp; !isLoadingNext &amp;&amp; !suppressButtons || (loadingRemotesCount > 0 &amp;&amp; !isLoadingNext)"
            :style="{ display: 'flex', flexWrap: 'wrap', gap: '10px' }"
          >
            <button
              v-if="imdbResult &amp;&amp; !isLoadingNext &amp;&amp; !suppressButtons"
              @click="handleImdb"
              :style="{
                height: '18px',
                margin: '0',
                padding: '0 2px',
                lineHeight: '18px',
                fontSize: '15px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '70px',
                border: '1px solid black',
              }"
            >
              {{ imdbButtonLabel }}
            </button>
            <button
              v-if="rtResult &amp;&amp; !isLoadingNext &amp;&amp; !suppressButtons"
              @click="handleRt"
              :style="{
                height: '18px',
                margin: '0',
                padding: '0 2px',
                lineHeight: '18px',
                fontSize: '15px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '70px',
                border: '1px solid black',
              }"
            >
              {{ rtButtonLabel }}
            </button>
            <button
              v-if="googleResult &amp;&amp; !isLoadingNext &amp;&amp; !suppressButtons"
              @click="handleGoogle"
              :style="{
                height: '18px',
                margin: '0',
                padding: '0 2px',
                lineHeight: '18px',
                fontSize: '15px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '70px',
                border: '1px solid black',
              }"
            >
              Google
            </button>
            <button
              v-if="wikiResult &amp;&amp; !isLoadingNext &amp;&amp; !suppressButtons"
              @click="handleWiki"
              :style="{
                height: '18px',
                margin: '0',
                padding: '0 2px',
                lineHeight: '18px',
                fontSize: '15px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '70px',
                border: '1px solid black',
              }"
            >
              Wiki
            </button>
            <button
              v-if="officialResult &amp;&amp; !isLoadingNext &amp;&amp; !suppressButtons"
              @click="handleOfficial"
              :style="{
                height: '18px',
                margin: '0',
                padding: '0 2px',
                lineHeight: '18px',
                fontSize: '15px',
                boxSizing: 'border-box',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '70px',
                border: '1px solid black',
              }"
            >
              Official
            </button>
            <span
              v-if="loadingRemotesCount &gt; 0 &amp;&amp; !isLoadingNext"
              :style="{
                marginLeft: '10px',
                color: '#888',
                fontStyle: 'italic',
                display: 'inline-flex',
                alignItems: 'center',
              }"
              >&lt;loading remotes ({{ loadingRemotesCount }})&gt;</span
            >
          </div>
        </div>
        <div
          id="browseDescr"
          :style="{
            flex: '0 0 auto',
            height: '180px',
            padding: '10px',
            backgroundColor: '#f5f5f5',
            borderRadius: '5px',
            overflowY: 'auto',
            fontSize: '16px',
            lineHeight: '1.5',
          }"
          @wheel.stop.prevent="handleScaledWheel"
          @click.stop
        >
          <div v-if="curTvdb">
            <div
              v-if="isCurrentSnoozed"
              style="color: red; margin-bottom: 4px"
            >
              Snoozed
            </div>
            {{ curTvdb.overview }}
          </div>
          <div v-else-if="curTitle && !isLoadingNext">
            <div style="color: red; margin-bottom: 4px">
              {{ creditIsMovie ? curTitle + " is a movie." : "Not in tvdb" }}
            </div>
            <div v-if="curTvmazeMeta">
              <div
                v-if="curTvmazeMeta.genres && curTvmazeMeta.genres.length"
                style="margin-bottom: 2px"
              >
                <b>Genres:</b> {{ curTvmazeMeta.genres.join(", ") }}
              </div>
              <div
                v-if="curTvmazeMeta.premiered"
                style="margin-bottom: 2px"
              >
                <b>Premiered:</b> {{ curTvmazeMeta.premiered }}
              </div>
              <div
                v-if="curTvmazeMeta.status"
                style="margin-bottom: 2px"
              >
                <b>Status:</b> {{ curTvmazeMeta.status }}
              </div>
              <div
                v-if="curTvmazeMeta.network || curTvmazeMeta.webChannel"
                style="margin-bottom: 2px"
              >
                <b>Network:</b>
                {{ (curTvmazeMeta.network || curTvmazeMeta.webChannel)?.name }}
              </div>
              <div
                v-if="curTvmazeMeta.summary"
                style="margin-top: 4px"
                v-html="curTvmazeMeta.summary"
              ></div>
            </div>
          </div>
        </div>
      </div>
      <div
        id="browseTitles"
        ref="titlesPane"
        :style="{
          flex: '1',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0',
          minHeight: '0',
          paddingBottom: '25px',
        }"
        @wheel.stop.prevent="handleScaledWheel"
      >
        <div
          v-for="(item, idx) in parsedTitles"
          :key="idx"
          @click="selectTitle(idx, true)"
          :style="getTitleCardStyle(idx)"
        >
          <template v-if="item.rejectStatus === 'msg'">
            <div
              :style="{
                width: '100%',
                textAlign: 'center',
                color: 'rgba(0,0,0,0.6)',
              }"
            >
              {{ item.titleString }}
            </div>
          </template>
          <template v-else-if="item.rejectStatus === 'ok'">
            <div>{{ item.titleString }}</div>
          </template>
          <template v-else>
            <div :style="{ display: 'flex' }">
              <div
                :style="{
                  width: '80px',
                  flexShrink: 0,
                  backgroundColor: '#ffcccc',
                  padding: '5px',
                }"
              >
                {{ item.rejectStatus }}
              </div>
              <div
                :style="{
                  flex: 1,
                  padding: '5px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  minWidth: 0,
                }"
              >
                {{ item.titleString }}
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
    <div
      v-if="toastMessage"
      :style="{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: 'rgba(0,0,0,0.8)',
        color: 'white',
        padding: '10px 20px',
        borderRadius: '5px',
        zIndex: 10000,
        pointerEvents: 'none',
        fontSize: '16px',
      }"
    >
      {{ toastMessage }}
    </div>
    <div
      v-if="loadingShowSelection"
      :style="{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: 'white',
        color: 'black',
        padding: '20px 30px',
        borderRadius: '8px',
        zIndex: 10001,
        pointerEvents: 'none',
        fontSize: '18px',
        fontWeight: 'bold',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }"
    >
      Loading {{ loadingShowName }}...
    </div>
  </div>
</template>

<script>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import ReelGallery from "./reel-gallery.vue";
import { config } from "../config.js";
import evtBus from "../evtBus.js";
import * as srvr from "../srvr.js";
import * as util from "../util.js";
import {
  getAllTvdb,
  getRemotes,
  applyTvdbPush,
  srchTvdbData,
  getGenresByTvdbId,
} from "../tvdb.js";
import { unilog } from "../log.js";

export default {
  name: "BrowsePane",
  components: {
    ReelGallery,
  },
  props: {
    active: {
      type: Boolean,
      default: false,
    },
    allShows: {
      type: Array,
      default: () => [],
    },
    sizing: {
      type: Object,
      default: () => ({}),
    },
  },
  setup(props) {
    const srchStr = ref("");
    const manualSearchQuery = ref("");

    const handleManualSearch = async () => {
      const query = manualSearchQuery.value.trim();
      if (!query) return;

      const norm = (s) =>
        String(s || "")
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase();

      // Only change the gallery — do not touch the titles list
      if (norm(query) !== norm(srchStr.value)) {
        srchStr.value = query;
      }
    };

    const curTitle = ref("");
    const curTvdb = ref(null);

    const shouldAutoAdvance = ref(false);
    const getRemotesResults = ref([]);
    const _lastRemotesKey = ref("");
    const titleStrings = ref([]);
    const selectedTitleIdx = ref(-1);
    const titlesPane = ref(null);
    const _titlesPopulated = ref(false);
    const _didStartBrowse = ref(false);
    const _startedWithShows = ref(false);
    const _didInitialVisibleScroll = ref(false);
    const _startBrowsePromise = ref(null);
    const isLoadingNext = ref(false);
    const browseHasMore = ref(false);
    const justFetchedNext = ref(false);
    const isLoadingRemotesMsg = ref(false);
    const loadingRemotesCount = ref(0);
    const suppressButtons = ref(false);
    const previewMode = ref(false);
    const allTvdbData = ref(null);
    const loadingShowSelection = ref(false);
    const loadingShowName = ref("");
    const snoozeList = ref([]);
    const unSnoozeMode = ref(false);
    const snoozeFlash = ref(false);
    const creditShowList = ref(null);
    const creditIsMovie = ref(false);
    const streamNotFound = ref(false);

    onMounted(async () => {
      try {
        allTvdbData.value = await getAllTvdb();
      } catch (e) {
        unilog(911, "Failed to load allTvdbData:", e);
      }
      try {
        const res = await fetch(`${config.tvSrvrUrl}/api/snooze-list`);
        if (res.ok) snoozeList.value = await res.json();
      } catch (e) {
        unilog(912, "Failed to load snooze list:", e);
      }
    });

    const onPreviewMode = (active) => {
      previewMode.value = !!active;
    };
    evtBus.on("previewMode", onPreviewMode);

    const onBrowseTabClicked = () => {
      creditIsMovie.value = false;
      creditShowList.value = null;
    };
    evtBus.on("browseTabClicked", onBrowseTabClicked);

    const onBrowseShowByTvdbId = (tvdbItem) => {
      if (!tvdbItem) return;
      creditShowList.value = [tvdbItem];
      shouldAutoAdvance.value = false;
    };
    evtBus.on("browseShowByTvdbId", onBrowseShowByTvdbId);

    const onBrowseSearchTitle = async ({ title, isMovie } = {}) => {
      if (!title) return;
      creditShowList.value = null;
      creditIsMovie.value = !!isMovie;
      await ensureBrowseStarted();
      manualSearchQuery.value = title;
      await handleManualSearch();
    };
    evtBus.on("browseSearchTitle", onBrowseSearchTitle);

    const onShowSelected = () => {
      loadingShowSelection.value = false;
      loadingShowName.value = "";
    };
    evtBus.on("showSelected", onShowSelected);

    const onTvdbUpdated = async (data) => {
      const { name, record } = data || {};
      if (!name || !record) return;
      applyTvdbPush(name, record);
      const cur = curTvdb.value;
      if (!cur) return;
      const curName = String(cur.name || cur.name || "").trim();
      const curId = String(cur.tvdb_id || cur.tvdbId || cur.id || "").trim();
      const recordId = String(record.tvdbId || record.tvdb_id || "").trim();
      const matches =
        name === curName || (curId && recordId && curId === recordId);
      void (name, matches, selectedTitleIdx.value, titleStrings.value.length);
      if (!matches) return;
      _lastRemotesKey.value = "";
      await loadRemotesForTvdb(cur);
    };
    evtBus.on("tvdbUpdated", onTvdbUpdated);

    const onSnoozeListUpdated = (list) => {
      if (Array.isArray(list)) snoozeList.value = list;
    };
    evtBus.on("snoozeListUpdated", onSnoozeListUpdated);

    const checkBrowseHasMore = () => {
      fetch(`${config.torrentsApiUrl}/api/hasBrowseShow`)
        .then((r) => r.json())
        .then((d) => {
          browseHasMore.value = !!d.available;
        })
        .catch(() => {});
    };
    watch(browseHasMore, (val) => {
      evtBus.emit("browseHasMoreChanged", val);
    });
    watch(
      () => props.active,
      (isActive) => {
        if (isActive) {
          checkBrowseHasMore();
        }
      },
      { immediate: true },
    );

    onUnmounted(() => {
      evtBus.off("previewMode", onPreviewMode);
      evtBus.off("browseTabClicked", onBrowseTabClicked);
      evtBus.off("browseShowByTvdbId", onBrowseShowByTvdbId);
      evtBus.off("browseSearchTitle", onBrowseSearchTitle);
      evtBus.off("showSelected", onShowSelected);
      evtBus.off("tvdbUpdated", onTvdbUpdated);
      evtBus.off("snoozeListUpdated", onSnoozeListUpdated);
    });
    const lastLoadedTvdbId = ref(null);

    const handleScaledWheel = (event) => {
      if (!event) return;
      const el = event.currentTarget;
      if (!el) return;
      const dy = event.deltaY || 0;
      const scaledDy = dy * 0.125;
      const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      const before = el.scrollTop || 0;
      el.scrollTop = Math.max(0, Math.min(max, before + scaledDy));
      void (dy, before, el.scrollTop, max);
    };

    const NO_MORE_ENTRY = "msg|-- no more titles --";

    const toTitleArray = (data) => {
      if (Array.isArray(data)) return data.map(String);
      if (data && typeof data === "object") {
        const msg = data.errmsg || data.error || data.message || data.status;
        if (msg) return [`error|${String(msg)}`];
      }
      if (typeof data === "string" && data.trim())
        return [`error|${data.trim()}`];
      return [];
    };

    const scrollTitlesToBottom = async () => {
      await nextTick();
      if (titleStrings.value.length > 0) {
        let idx = titleStrings.value.length - 1;
        if (titleStrings.value[idx] === NO_MORE_ENTRY && idx > 0) {
          idx--;
        }
        await selectTitle(idx);
      }
      await nextTick();
      if (titlesPane.value) {
        titlesPane.value.scrollTop = titlesPane.value.scrollHeight + 1000;
      }
    };

    const scrollTitlesPaneToBottom = async () => {
      await nextTick();
      if (titlesPane.value) {
        titlesPane.value.scrollTop = titlesPane.value.scrollHeight + 1000;
      }
    };

    const getAllShowNames = () => {
      const src = Array.isArray(props.allShows) ? props.allShows : [];
      const names = src
        .map((s) => {
          if (!s) return "";
          if (typeof s === "string") return s;
          return String(
            s.name || s.name || s.title || s.showName || s.seriesName || "",
          );
        })
        .map((s) => s.trim())
        .filter(Boolean);
      return Array.from(new Set(names));
    };

    const startBrowseAndLoadTitles = async () => {
      try {
        let data;
        try {
          const res = await fetch(`${config.torrentsApiUrl}/api/getAllBrowse`);
          if (!res.ok) {
            const txt = await res.text();
            throw new Error(`HTTP ${res.status}: ${txt}`);
          }
          data = await res.json();
        } catch (e) {
          throw e;
        }

        const nextTitles = toTitleArray(data);

        // Always append: starting/restarting the reel should not wipe what the user already has.
        // If we get new entries, remove the "no more" sentinel and append the new titles.
        if (nextTitles.length > 0) {
          let current = titleStrings.value.filter(
            (s) => String(s) !== NO_MORE_ENTRY,
          );

          const parseTitleStr = (str) => {
            try {
              if (str.trim().startsWith("{")) {
                const o = JSON.parse(str);
                if (o.title) return o.title;
              }
            } catch (e) {
              /* ignore */
            }
            const parts = str.split("|");
            return parts[1] ? parts[1].trim() : parts[0].trim();
          };

          const nextParsed = nextTitles.map(parseTitleStr);

          // remove any matching title from earlier in the list to avoid duplication
          // when receiving full history from server
          current = current.filter(
            (s) => !nextParsed.includes(parseTitleStr(s)),
          );

          titleStrings.value = [...current, ...nextTitles];
        } else if (titleStrings.value.length === 0) {
          titleStrings.value = [NO_MORE_ENTRY];
        } else {
          // Force a new array assignment so the UI updates consistently.
          titleStrings.value = [...titleStrings.value];
        }

        _titlesPopulated.value = true;
        _didStartBrowse.value = true;
        // if (showTitles.length > 0) {
        //   _startedWithShows.value = true;
        // }
        // always assume started successfully if we got here
        _startedWithShows.value = true;

        if (props.active) {
          if (nextTitles.length > 0) await scrollTitlesToBottom();
          else await scrollTitlesPaneToBottom();
        }
      } catch (e) {
        const msg = e?.message || String(e);
        titleStrings.value = [...titleStrings.value, `error|${msg}`];
        _titlesPopulated.value = true;
      }
    };

    const ensureBrowseStarted = async () => {
      if (_didStartBrowse.value) return true;

      if (_startBrowsePromise.value) {
        try {
          await _startBrowsePromise.value;
        } catch (e) {
          void e;
        }
        return _didStartBrowse.value;
      }

      _startBrowsePromise.value = (async () => {
        await startBrowseAndLoadTitles();
      })().finally(() => {
        _startBrowsePromise.value = null;
      });

      try {
        await _startBrowsePromise.value;
      } catch (e) {
        void e;
      }
      return _didStartBrowse.value;
    };

    const handleNext = async () => {
      if (unSnoozeMode.value) {
        unSnoozeMode.value = false;
      }
      creditShowList.value = null;
      creditIsMovie.value = false;
      shouldAutoAdvance.value = false;
      if (previewMode.value) {
        evtBus.emit("exitPreviewMode");
      }

      // If a manual search is active, clear it and restore gallery to the current title card
      if (manualSearchQuery.value) {
        manualSearchQuery.value = "";
        const title = curTitle.value;
        if (title) {
          srchStr.value = title + " ";
          await nextTick();
          srchStr.value = title;
        }
        return;
      }

      isLoadingNext.value = true;
      justFetchedNext.value = true;
      suppressButtons.value = true;
      lastLoadedTvdbId.value =
        curTvdb.value?.tvdb_id ||
        curTvdb.value?.tvdbId ||
        curTvdb.value?.id ||
        "-1";

      // Clear artifacts to prevent flash of old buttons
      getRemotesResults.value = [];
      _lastRemotesKey.value = "";

      try {
        if (!_didStartBrowse.value) {
          await ensureBrowseStarted();
        }

        const hasNoMore = titleStrings.value.some(
          (s) => String(s) === NO_MORE_ENTRY,
        );
        if (hasNoMore) {
          await startBrowseAndLoadTitles();
        }

        const fetchGetBrowseShow = async () => {
          const res = await fetch(`${config.torrentsApiUrl}/api/getBrowseShow`);
          if (!res.ok) {
            const txt = await res.text();
            throw new Error(`HTTP ${res.status}: ${txt}`);
          }
          return res.json();
        };

        let data;
        try {
          data = await fetchGetBrowseShow();
        } catch (e) {
          const msg = e?.message || String(e);
          if (
            /getBrowseShow\s+first/i.test(msg) ||
            /home\s*page\s+not\s+loaded/i.test(msg)
          ) {
            await ensureBrowseStarted();
            data = await fetchGetBrowseShow();
          } else {
            throw e;
          }
        }
        const added = toTitleArray(data?.titles ?? data);
        const pendingBrowsedId = data?.pendingBrowsedId ?? null;

        // If we get new entries, remove the "no more" sentinel.
        if (added.length > 0) {
          titleStrings.value = titleStrings.value.filter(
            (s) => String(s) !== NO_MORE_ENTRY,
          );

          const parseTitleHelper = (str) => {
            try {
              if (str.trim().startsWith("{")) {
                const o = JSON.parse(str);
                if (o.title) return o.title;
              }
            } catch (e) {}
            const parts = str.split("|");
            return parts[1] ? parts[1].trim() : parts[0].trim();
          };

          const addedParsed = added.map(parseTitleHelper);

          // remove any matching title from earlier in the list
          titleStrings.value = titleStrings.value.filter((s) => {
            const title = parseTitleHelper(s);
            return !addedParsed.includes(title);
          });

          titleStrings.value = [...titleStrings.value, ...added];

          if (pendingBrowsedId != null) {
            fetch(`${config.torrentsApiUrl}/api/ackBrowsed`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tvmazeId: pendingBrowsedId }),
            }).catch(() => {});
          }

          // Auto-advance if we just loaded items and the resulting selection has no info
          shouldAutoAdvance.value = true;

          // await scrollTitlesToBottom(); // allow watcher to handle this
        } else {
          shouldAutoAdvance.value = false;
          if (_noMoreMsgTimer) clearTimeout(_noMoreMsgTimer);
          showNoMoreMsg.value = true;
          _noMoreMsgTimer = setTimeout(() => {
            showNoMoreMsg.value = false;
          }, 1000);

          // Always scroll to the bottom even if the msg card already exists;
          // if we just added it, wait for it to render first.
          await scrollTitlesPaneToBottom();

          // If we are not moving to a new show, we need to re-enable the current show.
          // Since we cleared remotes at the start, we must reload them.
          lastLoadedTvdbId.value = null;
          await nextTick();
          if (curTvdb.value) {
            void loadRemotesForTvdb(curTvdb.value);
          } else {
            suppressButtons.value = false;
          }
        }
      } catch (e) {
        const msg = e?.message || String(e);
        titleStrings.value = [...titleStrings.value, `error|${msg}`];
        await scrollTitlesToBottom();
        await nextTick();
        suppressButtons.value = false;
      } finally {
        isLoadingNext.value = false;
        checkBrowseHasMore();
      }
    };

    const handleSnooze = async () => {
      if (unSnoozeMode.value) {
        // In snoozed mode: unsnooze selected show, stay in snoozed mode
        if (!curTvdb.value) return;
        const tvdbId = String(
          curTvdb.value.tvdbId ||
            curTvdb.value.tvdb_id ||
            curTvdb.value.id ||
            "",
        );
        if (!tvdbId) return;
        try {
          await fetch(`${config.torrentsApiUrl}/api/unackBrowsed`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tvdbId }),
          });
          const res = await fetch(`${config.tvSrvrUrl}/api/unsnooze`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tvdbId }),
          });
          if (res.ok) snoozeList.value = await res.json();
        } catch (e) {
          unilog(913, "handleSnooze unsnooze error:", e);
        }
        const unsnoozeTitle = String(curTvdb.value?.name || "")
          .trim()
          .toLowerCase();
        if (unsnoozeTitle) {
          titleStrings.value = titleStrings.value.filter((s) => {
            try {
              const str = String(s);
              if (str.trim().startsWith("{")) {
                const o = JSON.parse(str);
                return (
                  String(o.title || "")
                    .trim()
                    .toLowerCase() !== unsnoozeTitle
                );
              } else {
                const parts = str.split("|");
                const t = parts[1] ? parts[1].trim() : parts[0].trim();
                return t.toLowerCase() !== unsnoozeTitle;
              }
            } catch (e) {}
            return true;
          });
        }
        creditShowList.value = null;
        creditIsMovie.value = false;
        return;
      }
      if (!curTvdb.value) return;
      const tvdbId = String(
        curTvdb.value.tvdb_id || curTvdb.value.tvdbId || curTvdb.value.id || "",
      );
      if (!tvdbId) return;
      const name = curTvdb.value.name || "";
      const image =
        curTvdb.value.image_url ||
        curTvdb.value.thumbnail ||
        curTvdb.value.image ||
        "";
      const year = curTvdb.value.year || "";
      try {
        const res = await fetch(`${config.tvSrvrUrl}/api/snooze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tvdbId, name, image, year }),
        });
        if (res.ok) snoozeList.value = await res.json();
      } catch (e) {
        unilog(914, "handleSnooze error:", e);
      }
      // Remove from browse-cards.json on api server so it won't reappear as a fresh card
      fetch(`${config.torrentsApiUrl}/api/removeBrowseCard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tvdbId: tvdbId || null, name }),
      }).catch(() => {});
      // Remove the snoozed show from titleStrings
      const normName = (s) =>
        String(s || "")
          .trim()
          .toLowerCase();
      const snoozeTitle = normName(name);
      titleStrings.value = titleStrings.value.filter((s) => {
        try {
          const str = String(s);
          if (str.trim().startsWith("{")) {
            const o = JSON.parse(str);
            if (normName(o.title) === snoozeTitle) return false;
          } else {
            const parts = str.split("|");
            const t = parts[1] ? parts[1].trim() : parts[0].trim();
            if (normName(t) === snoozeTitle) return false;
          }
        } catch (e) {}
        return true;
      });
      snoozeFlash.value = true;
      setTimeout(() => {
        snoozeFlash.value = false;
      }, 400);
    };

    const handleUnSnooze = () => {
      // Only enters snoozed mode — the Snoozed N button calls this only when not in snoozed mode
      creditShowList.value = null;
      creditIsMovie.value = false;
      unSnoozeMode.value = true;
    };

    const isCurrentSnoozed = computed(() => {
      if (!curTvdb.value || snoozeList.value.length === 0) return false;
      const curId = String(
        curTvdb.value.tvdb_id || curTvdb.value.tvdbId || curTvdb.value.id || "",
      ).trim();
      const curName = String(curTvdb.value.name || "").trim();
      return snoozeList.value.some((s) => {
        const sid = String(s.tvdbId || "").trim();
        return (
          (curId && sid && curId === sid) ||
          (curName && curName === String(s.name || "").trim())
        );
      });
    });

    const googleResult = computed(() => {
      const arr = Array.isArray(getRemotesResults.value)
        ? getRemotesResults.value
        : [];
      return arr.find((r) => r && r.name === "Google" && r.url) || null;
    });

    const imdbResult = computed(() => {
      const arr = Array.isArray(getRemotesResults.value)
        ? getRemotesResults.value
        : [];
      return (
        arr.find(
          (r) =>
            r &&
            typeof r.name === "string" &&
            r.name.toUpperCase().startsWith("IMDB") &&
            r.url,
        ) || null
      );
    });

    const matchingTvdbEntry = computed(() => null);
    const hasTvdbEntry = computed(() => false);

    const existingShowMatch = computed(() => {
      const t = curTvdb.value;
      if (!t) return null;

      const tId = String(t.tvdb_id || t.tvdbId || t.id || "").trim();
      const name = String(t.name || t.name || t.seriesName || t.title || "")
        .trim()
        .toLowerCase();

      if (!name && !tId) return null;

      return (props.allShows || []).find((s) => {
        const sTvdb = String(s.tvdbId || s.tvdbId || s.tvdb_id || "").trim();
        if (sTvdb && tId && sTvdb === tId) return true;
        const sName = String(s.name || s.name || "")
          .trim()
          .toLowerCase();
        return sName === name;
      });
    });

    const toggleTvdbInfo = () => {};
    const watchedStatus = computed(() => "");
    const tvdbInfo = computed(() => ({}));

    const handleSelectExisting = async (name, options = {}) => {
      if (!name) {
        return;
      }
      loadingShowSelection.value = true;
      loadingShowName.value = name;
      const tvdbId = String(options?.tvdbId || "").trim();
      if (tvdbId) {
        evtBus.emit("selectShowFromCardTitle", {
          rawTitle: name,
          tvdbId,
        });
      } else {
        evtBus.emit("selectShowFromCardTitle", name);
      }

      // Wait for the selection to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      loadingShowSelection.value = false;
      loadingShowName.value = "";
    };

    const rtResult = computed(() => {
      const arr = Array.isArray(getRemotesResults.value)
        ? getRemotesResults.value
        : [];
      return (
        arr.find((r) => {
          const name = String(r?.name || "")
            .trim()
            .toLowerCase();
          const url = String(r?.url || "")
            .trim()
            .toLowerCase();

          const nameLooksRt =
            name === "rotten tomatoes" ||
            name === "rottentomatoes" ||
            name.includes("rotten") ||
            name.includes("tomatoes");
          const urlLooksRt = url.includes("rottentomatoes.com");

          return !!(r?.url && (nameLooksRt || urlLooksRt));
        }) || null
      );
    });

    const wikiResult = computed(() => {
      const arr = Array.isArray(getRemotesResults.value)
        ? getRemotesResults.value
        : [];
      return arr.find((r) => r && r.name === "Wikipedia" && r.url) || null;
    });

    const officialResult = computed(() => {
      const arr = Array.isArray(getRemotesResults.value)
        ? getRemotesResults.value
        : [];
      return (
        arr.find((r) => r && r.name === "Official Website" && r.url) || null
      );
    });

    const imdbButtonLabel = computed(() => {
      return imdbResult.value?.name || "Imdb";
    });

    const rtButtonLabel = computed(() => {
      return rtResult.value?.name || "Rotten Tomatoes";
    });

    const openUrl = (url) => {
      const u = String(url || "").trim();
      if (!u) return;
      try {
        util.openExternalPage(u);
      } catch (e) {
        unilog(915, "openUrl failed:", e?.message || String(e));
      }
    };

    const handleGoogle = () => {
      openUrl(googleResult.value?.url);
    };

    const handleImdb = () => {
      openUrl(imdbResult.value?.url);
    };

    const handleRt = () => {
      openUrl(rtResult.value?.url);
    };

    const handleWiki = () => {
      openUrl(wikiResult.value?.url);
    };

    const handleOfficial = () => {
      openUrl(officialResult.value?.url);
    };

    const showNoMoreMsg = ref(false);
    let _noMoreMsgTimer = null;
    const noMoreShows = computed(() =>
      titleStrings.value.some((s) => String(s) === NO_MORE_ENTRY),
    );

    const hasAnyRemoteButton = computed(() => {
      return !!(
        imdbResult.value ||
        rtResult.value ||
        googleResult.value ||
        wikiResult.value ||
        officialResult.value
      );
    });

    const loadRemotesForTvdb = async (tvdb) => {
      isLoadingRemotesMsg.value = false;

      if (!tvdb) {
        getRemotesResults.value = [];
        _lastRemotesKey.value = "";
        await nextTick();
        suppressButtons.value = false;
        return;
      }

      const name = String(tvdb.name || "").trim();
      const tvdbId = String(
        tvdb.tvdb_id || tvdb.tvdbId || tvdb.id || "",
      ).trim();

      // If we are suppressing buttons (fetching next show),
      // check if this is still the old show.
      if (suppressButtons.value && lastLoadedTvdbId.value) {
        const currentId = tvdbId || tvdb.tvdbId || tvdb.id;
        if (String(currentId) === String(lastLoadedTvdbId.value)) {
          // Still the old show. Don't fetch remotes, don't unsuppress.
          return;
        }
      }

      const key = tvdbId || name;
      if (!key) {
        getRemotesResults.value = [];
        _lastRemotesKey.value = "";
        await nextTick();
        suppressButtons.value = false;
        return;
      }

      if (_lastRemotesKey.value === key) {
        await nextTick();
        suppressButtons.value = false;
        return;
      }
      _lastRemotesKey.value = key;

      getRemotesResults.value = [];
      isLoadingRemotesMsg.value = true;
      loadingRemotesCount.value++;

      await nextTick();
      // Only unsuppress if we passed checks
      suppressButtons.value = false;

      try {
        const remoteIds = tvdb.remote_ids || [];

        // Try to find matching show in allShows to get inEmby status and Id
        let showContext = null;
        const matchingShow = (props.allShows || []).find((s) => {
          const sTvdb = String(s.tvdbId || s.tvdbId || s.tvdb_id || "").trim();
          if (sTvdb && tvdbId && sTvdb === tvdbId) return true;
          const sName = String(s.name || s.name || "")
            .trim()
            .toLowerCase();
          return sName === name.toLowerCase();
        });

        if (matchingShow) {
          showContext = {
            inEmby: matchingShow.inEmby,
            id: matchingShow.id,
          };
        }

        // Use centralized cache function with show context
        const results = await getRemotes(name, tvdbId, remoteIds, showContext);

        if (_lastRemotesKey.value === key) {
          getRemotesResults.value = results;
        }
      } catch (e) {
        if (e !== "cancelled")
          unilog(916, "getRemotes failed:", e?.message || String(e));
        if (_lastRemotesKey.value === key) {
          getRemotesResults.value = [];
        }
      } finally {
        loadingRemotesCount.value--;
        if (_lastRemotesKey.value === key) {
          isLoadingRemotesMsg.value = false;
        }
      }
    };

    const toastMessage = ref("");
    let toastTimer = null;

    const showToast = (msg) => {
      toastMessage.value = msg;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastMessage.value = "";
        toastTimer = null;
      }, 5000);
    };

    const handleLoad = () => {
      const t = curTvdb.value;
      if (!t) return;

      const name = String(t.name || t.name || "").trim();
      if (!name) return;

      // Check if show already exists
      const tvdbId = String(t.tvdbId || t.tvdb_id || t.id || "").trim();
      const exists = (props.allShows || []).some((s) => {
        const sTvdb = String(s.tvdbId || s.tvdbId || s.tvdb_id || "").trim();
        if (sTvdb && tvdbId && sTvdb === tvdbId) return true;
        const sName = String(s.name || s.name || "")
          .trim()
          .toLowerCase();
        return sName === name.toLowerCase();
      });

      if (exists) {
        showToast("Show already in show list.");
        return;
      }

      // Route through the exact same flow used by clicking a card in #searchList.
      const srchChoice = {
        name,
        tvdbId: String(t.tvdbId || t.tvdb_id || t.id || "").trim(),
        overview:
          t.overview || t.overviewText || t.overview_txt || t.overview || "",
        image: t.image || t.image_url || t.thumbnail || "",
        year: t.year || "",
        originalCountry: t.originalCountry || t.country || "",
        searchDtlTxt: t.searchDtlTxt || "",
      };
      return srchChoice;
    };

    const handlePreview = () => {
      const srchChoice = handleLoad();
      if (srchChoice) {
        evtBus.emit("reelSearchAction", { srchChoice, action: "preview" });
      }
    };

    const handleGet = () => {
      const srchChoice = handleLoad();
      if (srchChoice) {
        evtBus.emit("reelSearchAction", { srchChoice, action: "add" });
      }
    };

    watch(
      () => props.active,
      async (isActive) => {
        if (!isActive) return;
        if (_didInitialVisibleScroll.value) return;
        if (!_titlesPopulated.value) return;
        _didInitialVisibleScroll.value = true;
        await scrollTitlesToBottom();
      },
    );

    // Parse titleStrings into objects
    const parsedTitles = computed(() => {
      return titleStrings.value.map((str) => {
        // Try new JSON format
        try {
          if (str.trim().startsWith("{")) {
            const o = JSON.parse(str);
            if (o.status) {
              return {
                rejectStatus: o.status,
                titleString: o.title,
                data: o.data,
                imdbid: o.imdbid,
                tvdbid: o.tvdbid,
              };
            }
          }
        } catch (e) {
          // ignore
        }

        const parts = str.split("|");
        // parts[0] is status, parts[1] is title
        // If there's a JSON record, it's after the second pipe.
        // But naive split fails if JSON has '|'.
        // Better parsing:
        let rejectStatus = "";
        let titleString = "";
        let data = null;

        const firstBar = str.indexOf("|");
        if (firstBar === -1) {
          rejectStatus = str;
        } else {
          rejectStatus = str.slice(0, firstBar);
          const rest = str.slice(firstBar + 1);
          const secondBar = rest.indexOf("|");
          if (secondBar === -1) {
            titleString = rest;
          } else {
            titleString = rest.slice(0, secondBar);
            const jsonStr = rest.slice(secondBar + 1);
            try {
              data = JSON.parse(jsonStr);
            } catch (e) {
              // ignore
            }
          }
        }

        return {
          rejectStatus,
          titleString: titleString || parts[1] || parts[0],
          data,
        };
      });
    });

    const curImdbId = computed(() => {
      if (selectedTitleIdx.value < 0) return null;
      return parsedTitles.value[selectedTitleIdx.value]?.imdbid || null;
    });

    const curTvdbId = computed(() => {
      if (selectedTitleIdx.value < 0) return null;
      return parsedTitles.value[selectedTitleIdx.value]?.tvdbid || null;
    });

    const curTvmazeMeta = computed(() => {
      const item = parsedTitles.value[selectedTitleIdx.value];
      return item?.data || null;
    });

    const curFallbackImage = computed(() => {
      const item = parsedTitles.value[selectedTitleIdx.value];
      if (item?.data?.image?.original) {
        return item.data.image.original;
      }
      return null;
    });

    // Format info line from curTvdb
    const infoLine = computed(() => {
      if (!curTvdb.value) return "";
      const t = curTvdb.value;
      let line = `${(t.country || "").toUpperCase()} | ${(t.primary_language || "").toUpperCase()} | ${t.network || ""}`;

      // Inject ID from browse record if available
      const browseItem = parsedTitles.value[selectedTitleIdx.value];
      if (browseItem?.data) {
        const id = browseItem.data.tvmaze_id || browseItem.data.id;
        if (id) {
          line += ` | ${id}`;
        }
      }

      // Try multiple possible property names for premiere date
      const dateStr =
        t.first_aired ||
        t.firstAired ||
        t.premiered ||
        t.released ||
        t.first_air_time ||
        "";

      // console.log("browse infoLine debug:", {
      //   name: t.name,
      //   dateStr,
      //   keys: Object.keys(t),
      //   t,
      // });

      if (dateStr) {
        // Ensure it's a string
        const s = String(dateStr).trim();
        const parts = s.split("-");
        // Expecting YYYY-MM-DD
        if (parts.length >= 3) {
          line += ` | ${parts[0]}/${parts[1]}/${parts[2]}`;
        }
      }

      if (t.genres?.length) {
        line += ` | ${t.genres.join(", ")}`;
      }
      return line;
    });

    const galleryTitleLine = computed(() => {
      const t = curTvdb.value;
      if (t) {
        return String(t.name || t.name || t.seriesName || t.title || "").trim();
      }
      if (
        selectedTitleIdx.value >= 0 &&
        parsedTitles.value[selectedTitleIdx.value]
      ) {
        return parsedTitles.value[selectedTitleIdx.value].titleString;
      }
      return "";
    });

    const handleStream = async () => {
      const t = curTvdb.value;
      const name = galleryTitleLine.value;
      if (!name) return;

      // Pre-fetch providers before switching panes
      let providers = [];
      try {
        const params = { showName: name };
        const res = await srvr.getStreamProviders(params);
        providers = res?.providers || [];
      } catch (e) {
        // treat fetch error as not found
      }

      if (!providers.length) {
        streamNotFound.value = true;
        // Exit preview mode if we had entered it
        if (previewMode.value) {
          evtBus.emit("exitPreviewMode");
        }
        setTimeout(() => {
          streamNotFound.value = false;
        }, 750);
        return;
      }

      // If show exists in list, just emit stream event (App.vue currentShow is already set)
      const tvdbId = String(t?.tvdbId || t?.tvdb_id || t?.id || "").trim();
      const exists = (props.allShows || []).some((s) => {
        const sTvdb = String(s.tvdbId || s.tvdbId || s.tvdb_id || "").trim();
        if (sTvdb && tvdbId && sTvdb === tvdbId) return true;
        const sName = String(s.name || s.name || "")
          .trim()
          .toLowerCase();
        return sName === name.toLowerCase();
      });

      if (!exists) {
        // Enter preview mode so this show becomes currentShow
        const srchChoice = handleLoad();
        if (srchChoice) {
          evtBus.emit("reelSearchAction", { srchChoice, action: "preview" });
        }
      }

      // Small delay to let preview mode set up the show
      setTimeout(
        () => {
          evtBus.emit("showStreamPane", { name: name });
        },
        exists ? 0 : 300,
      );
    };

    const handleBackgroundClick = (event) => {
      const target = event?.target;
      if (!(target instanceof Element)) return;

      // Ignore clicks on buttons/interactive controls.
      if (target.closest("button")) return;

      // Ignore clicks in the title card list.
      if (target.closest("#browseTitles")) return;

      // Ignore clicks in the left gallery (it has its own selection behavior).
      if (target.closest("#browseLeft")) return;

      // Ignore clicks in the info pane header area
      if (target.closest("#browseInfo")) return;

      // Ignore clicks in the buttons/description area
      if (target.closest("#browseDescrButtons")) return;

      const name = String(
        galleryTitleLine.value || curTitle.value || "",
      ).trim();
      if (!name) return;
      evtBus.emit("selectShowFromCardTitle", name);
    };

    // Get style for title card
    const getTitleCardStyle = (idx) => {
      const item = parsedTitles.value[idx];
      let backgroundColor = "white";
      let cursor = "pointer";

      if (idx === selectedTitleIdx.value) {
        backgroundColor = "#fffacd"; // light-yellow
      } else if (item.rejectStatus === "msg") {
        backgroundColor = "#f5f5f5";
        cursor = "default";
      } else if (item.rejectStatus === "ok") {
        backgroundColor = "#90ee90"; // light-green
      }

      return {
        padding: "2px",
        cursor,
        fontSize: "16px",
        backgroundColor,
        border: "1px solid #808080",
        borderRadius: "3px",
        minHeight: "30px",
        display: "flex",
        alignItems: "center",
      };
    };

    // Handle gallery card selection
    const handleGallerySelect = async (tvdb) => {
      if (unSnoozeMode.value && tvdb) {
        const tvdbId = String(tvdb.tvdbId || tvdb.tvdb_id || tvdb.id || "");
        try {
          const results = await srchTvdbData(tvdb.name);
          if (results && results.length > 0) {
            const match = tvdbId
              ? results.find(
                  (r) =>
                    String(r.id) === tvdbId || String(r.tvdb_id) === tvdbId,
                )
              : null;
            curTvdb.value = match || results[0];
          } else {
            curTvdb.value = tvdb;
          }
        } catch (e) {
          curTvdb.value = tvdb;
        }
      } else {
        if (tvdb === null && curTvdb.value === null) {
          suppressButtons.value = false;
        }
        curTvdb.value = tvdb;
      }

      // Attach genres from tvdb.json or fetch from TVDB extended API
      if (curTvdb.value && !curTvdb.value.genres?.length) {
        const tvdbId = String(
          curTvdb.value.tvdb_id ||
            curTvdb.value.tvdbId ||
            curTvdb.value.id ||
            "",
        );
        const name = String(curTvdb.value.name || "");
        let genres = null;
        if (allTvdbData.value) {
          const rec = tvdbId
            ? Object.values(allTvdbData.value).find(
                (r) => String(r.tvdbId || "") === tvdbId,
              )
            : null;
          if (!rec && name) {
            const found = allTvdbData.value[name];
            if (found?.genres?.length) genres = found.genres;
          } else if (rec?.genres?.length) {
            genres = rec.genres;
          }
        }
        if (!genres?.length && tvdbId) {
          genres = await getGenresByTvdbId(tvdbId);
        }
        if (genres?.length) {
          curTvdb.value = { ...curTvdb.value, genres };
        }
      }

      // Removed: postBrowseHistory("browse", curTvdb.value) - caused spam
      if (previewMode.value) {
        handlePreview();
      }
    };

    const handleSearchComplete = (tvdb) => {
      if (shouldAutoAdvance.value) {
        shouldAutoAdvance.value = false;
        const lang = (tvdb?.primary_language || "").toLowerCase();
        if (tvdb && lang && lang !== "eng" && lang !== "spa") {
          void handleNext();
        }
      }
    };

    // Clicking the image should immediately preview the show (same flow as "Get").
    const handleGalleryPreview = (tvdb) => {
      curTvdb.value = tvdb;
      handlePreview();
    };

    watch(
      curTvdb,
      async (val) => {
        void loadRemotesForTvdb(val);
        await nextTick();
        if (titlesPane.value) {
          if (
            justFetchedNext.value ||
            selectedTitleIdx.value >= titleStrings.value.length - 2
          ) {
            void (justFetchedNext.value,
            selectedTitleIdx.value,
            titleStrings.value.length);
            titlesPane.value.scrollTop = titlesPane.value.scrollHeight + 1000;
            justFetchedNext.value = false;
          }
        }
      },
      { deep: true },
    );

    // Handle title selection
    const selectTitle = async (idx, fromUser = false) => {
      if (fromUser && unSnoozeMode.value) {
        unSnoozeMode.value = false;
      }
      if (fromUser) {
        justFetchedNext.value = false;
        shouldAutoAdvance.value = false;
      }
      const item = parsedTitles.value[idx];
      if (item?.rejectStatus === "msg") {
        await nextTick();
        suppressButtons.value = false;
        return;
      }
      selectedTitleIdx.value = idx;
      const nextTitle = String(item?.titleString || "").trim();
      curTitle.value = nextTitle;

      const norm = (s) =>
        String(s || "")
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase();
      if (norm(nextTitle) !== norm(srchStr.value)) {
        srchStr.value = nextTitle;
      } else {
        await nextTick();
        if (shouldAutoAdvance.value) {
          shouldAutoAdvance.value = false;
          suppressButtons.value = false;
        } else {
          suppressButtons.value = false;
        }
      }
    };

    // Scroll to bottom when titleStrings changes
    watch(
      titleStrings,
      async () => {
        await nextTick();
        if (titlesPane.value) {
          titlesPane.value.scrollTop = titlesPane.value.scrollHeight + 1000;
        }

        // Log parsed title cards for debugging
        try {
          parsedTitles.value.forEach((it, i) => {
            void i;
            void it;
          });
        } catch (e) {
          void e;
        }

        // Select last item
        if (titleStrings.value.length > 0) {
          // Wait for DOM
          await nextTick();
          let idx = titleStrings.value.length - 1;
          if (titleStrings.value[idx] === NO_MORE_ENTRY && idx > 0) {
            idx--;
          }
          await selectTitle(idx);
        }
      },
      { deep: true },
    );

    // Initialize with test data
    onMounted(() => {
      // console.log('reel.vue mounted. active:', props.active, 'allShows length:', props.allShows?.length);
      // Logic handled by watch(allShows, ..., { immediate:true }) and watch(active)
    });

    const onAllShows = async (val) => {
      if (_startedWithShows.value) return;
      if (!Array.isArray(val) || val.length === 0) return;
      await startBrowseAndLoadTitles();
    };

    watch(() => props.allShows, onAllShows, { immediate: true });

    watch(
      () => props.active,
      (isActive) => {
        if (_didStartBrowse.value) return;
        void ensureBrowseStarted();
      },
    );

    return {
      sizing: props.sizing,
      srchStr,
      curTitle,
      curTvdb,
      getRemotesResults,
      googleResult,
      imdbResult,
      rtResult,
      wikiResult,
      officialResult,
      imdbButtonLabel,
      handleSelectExisting,
      rtButtonLabel,
      hasAnyRemoteButton,
      noMoreShows,
      showNoMoreMsg,
      titleStrings,
      selectedTitleIdx,
      parsedTitles,
      curImdbId,
      curTvdbId,
      infoLine,
      galleryTitleLine,
      titlesPane,
      handleBackgroundClick,
      handleScaledWheel,
      getTitleCardStyle,
      handleGallerySelect,
      handleSearchComplete,
      handleGalleryPreview,
      handleStream,
      streamNotFound,
      selectTitle,
      handleNext,
      handlePreview,
      handleGet,
      handleGoogle,
      handleImdb,
      handleRt,
      handleWiki,
      handleOfficial,
      isLoadingNext,
      isLoadingRemotesMsg,
      loadingRemotesCount,
      suppressButtons,
      previewMode,
      toastMessage,
      loadingShowSelection,
      loadingShowName,
      matchingTvdbEntry,
      hasTvdbEntry,
      toggleTvdbInfo,
      tvdbInfo,
      showTvdbInfo: ref(false),
      watchedStatus,
      manualSearchQuery,
      handleManualSearch,
      existingShowMatch,
      curFallbackImage,
      curTvmazeMeta,
      snoozeList,
      isCurrentSnoozed,
      unSnoozeMode,
      snoozeFlash,
      handleSnooze,
      handleUnSnooze,
      creditShowList,
      creditIsMovie,
      browseHasMore,
    };
  },
};
</script>

<style scoped>
button {
  padding: 8px 16px;
  cursor: pointer;
  border: 1px solid #ccc;
  border-radius: 5px;
  background-color: white;
}

button:hover {
  background-color: #f0f0f0;
}
</style>
