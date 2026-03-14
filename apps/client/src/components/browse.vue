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
        :fallbackImage="curFallbackImage"
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
            <button
              @click="handleDebugClick"
              :style="{
                height: '24px',
                backgroundColor: debugFlash ? '#4CAF50' : 'white',
                fontSize: '13px',
                padding: '2px 8px',
                border: '1px solid black',
                borderRadius: '3px',
                cursor: 'pointer',
                transition: 'background-color 0.15s ease',
              }"
            >
              Save Tvdb
            </button>
            <input
              id="browseSearch"
              v-model="manualSearchQuery"
              @keyup.enter="handleManualSearch"
              placeholder="Search"
              :style="{
                border: '1px solid #ccc',
                borderRadius: '3px',
                padding: '2px 5px',
                width: '80px',
              }"
            />
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
            flexWrap: 'wrap',
            gap: '10px',
            padding: '5px',
            marginTop: '8px',
            border: '1px solid #808080',
            borderRadius: '5px',
            marginBottom: '8px',
            width: '100%',
            boxSizing: 'border-box',
          }"
        >
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
              width: '60px',
              backgroundColor: isLoadingNext ? '#d3d3d3' : '',
              border: '1px solid black',
            }"
          >
            Next
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
              border: '1px solid black',
            }"
          >
            Get
          </button>
          <button
            v-if="
              hasTvdbEntry &&
              !existingShowMatch &&
              !isLoadingNext &&
              !suppressButtons
            "
            @click="toggleTvdbInfo"
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
              backgroundColor: showTvdbInfo ? '#d3d3d3' : '#FFCCCB',
              border: '1px solid black',
            }"
          >
            Tvdb
          </button>
          <button
            v-if="existingShowMatch && !isLoadingNext && !suppressButtons"
            @click="handleSelectExisting(existingShowMatch.Name)"
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
          ><span
            v-if="hasAnyRemoteButton &amp;&amp; !isLoadingNext &amp;&amp; !suppressButtons"
            :style="{ lineHeight: '18px', fontSize: '12px' }"
          >
            |</span
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
              border: '1px solid black',
            }"
          >
            Official</button
          ><span
            v-if="loadingRemotesCount &gt; 0 &amp;&amp; !isLoadingNext"
            :style="{
              marginLeft: '10px',
              color: '#888',
              fontStyle: 'italic',
              display: 'inline-flex',
              alignItems: 'center',
            }"
            >&lt;loading remotes ({{ loadingRemotesCount }})&gt;</span
          ><span
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
          <div
            v-if="showTvdbInfo && matchingTvdbEntry"
            :style="{
              display: 'flex',
              flexDirection: 'column',
              textAlign: 'center',
              fontWeight: 'bold',
              lineHeight: '1.2',
            }"
          >
            <div
              :style="{
                border: '1px solid #ccc',
                borderRadius: '5px',
                padding: '5px',
                width: '100%',
                boxSizing: 'border-box',
              }"
            >
              <div
                v-if="tvdbInfo.dates"
                style="
                  min-height: 24px;
                  white-space: normal;
                  display: -webkit-box;
                  -webkit-box-orient: vertical;
                  -webkit-line-clamp: 2;
                  line-clamp: 2;
                  overflow: hidden;
                "
              >
                {{ tvdbInfo.dates }}
              </div>
              <div
                v-if="tvdbInfo.status"
                v-html="tvdbInfo.status"
                style="
                  min-height: 20px;
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                "
              ></div>
              <div
                v-if="tvdbInfo.seasons"
                v-html="tvdbInfo.seasons"
                style="
                  min-height: 24px;
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  margin-top: 5px;
                "
              ></div>
              <!-- <div
                v-if="tvdbInfo.cntryLangLeft || tvdbInfo.cntryLangRight"
                style="
                  min-height: 20px;
                  display: flex;
                  flex-wrap: wrap;
                  justify-content: center;
                  column-gap: 8px;
                  margin-top: 5px;
                "
              >
                <div
                  v-if="tvdbInfo.cntryLangLeft"
                  style="white-space: nowrap"
                >
                  {{ tvdbInfo.cntryLangLeft }}
                </div>
                <div
                  v-if="tvdbInfo.cntryLangRight"
                  style="
                    white-space: normal;
                    overflow-wrap: anywhere;
                    word-break: break-word;
                  "
                >
                  {{ tvdbInfo.cntryLangRight }}
                </div>
              </div> -->
              <!-- <div
                v-if="tvdbInfo.watched"
                style="
                  min-height: 20px;
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  margin-top: 5px;
                "
              >
                {{ tvdbInfo.watched }}
              </div> -->
              <div
                v-if="tvdbInfo.runtime"
                style="
                  min-height: 20px;
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  margin-top: 5px;
                "
              >
                {{ tvdbInfo.runtime }}
              </div>
              <div
                v-if="tvdbInfo.inEmby === false"
                style="
                  min-height: 20px;
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  margin-top: 5px;
                  color: red;
                "
              >
                Not in Emby
              </div>
              <div
                v-if="tvdbInfo.existingShowName"
                style="
                  display: flex;
                  justify-content: flex-start;
                  margin-top: 5px;
                "
              >
                <button
                  @click="handleSelectExisting(tvdbInfo.existingShowName)"
                  style="font-size: 14px; padding: 2px 8px; cursor: pointer"
                >
                  Select
                </button>
              </div>
            </div>
          </div>
          <div v-else-if="curTvdb">{{ curTvdb.overview }}</div>
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
import { getAllTvdb, getRemotes, applyTvdbPush } from "../tvdb.js";

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
    const srchStr = ref("friends");
    const manualSearchQuery = ref("");

    const handleManualSearch = async () => {
      const query = manualSearchQuery.value.trim();
      if (!query) return;

      const nextTitle = query;
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
        suppressButtons.value = false;
      }
      selectedTitleIdx.value = -1;
    };

    const curTitle = ref("");
    const curTvdb = ref(null);
    const shouldAutoAdvance = ref(false);
    const getRemotesResults = ref([]);
    const _lastRemotesKey = ref("");
    const debugFlash = ref(false);
    const titleStrings = ref([]);
    const selectedTitleIdx = ref(-1);
    const titlesPane = ref(null);
    const _titlesPopulated = ref(false);
    const _didStartBrowse = ref(false);
    const _startedWithShows = ref(false);
    const _didInitialVisibleScroll = ref(false);
    const _startBrowsePromise = ref(null);
    const isLoadingNext = ref(false);
    const justFetchedNext = ref(false);
    const isLoadingRemotesMsg = ref(false);
    const loadingRemotesCount = ref(0);
    const suppressButtons = ref(false);
    const previewMode = ref(false);
    const allTvdbData = ref(null);
    const showTvdbInfo = ref(false);
    const loadingShowSelection = ref(false);
    const loadingShowName = ref("");

    onMounted(async () => {
      try {
        allTvdbData.value = await getAllTvdb();
      } catch (e) {
        console.error("Failed to load allTvdbData:", e);
      }
    });

    const onPreviewMode = (active) => {
      previewMode.value = !!active;
    };
    evtBus.on("previewMode", onPreviewMode);

    const onBrowseTabClicked = () => {
      showTvdbInfo.value = false;
    };
    evtBus.on("browseTabClicked", onBrowseTabClicked);

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
      const curName = String(cur.name || cur.Name || "").trim();
      const curId = String(cur.tvdb_id || cur.tvdbId || cur.id || "").trim();
      const recordId = String(record.tvdbId || record.tvdb_id || "").trim();
      const matches =
        name === curName || (curId && recordId && curId === recordId);
      if (!matches) return;
      _lastRemotesKey.value = "";
      await loadRemotesForTvdb(cur);
    };
    evtBus.on("tvdbUpdated", onTvdbUpdated);

    onUnmounted(() => {
      evtBus.off("previewMode", onPreviewMode);
      evtBus.off("browseTabClicked", onBrowseTabClicked);
      evtBus.off("showSelected", onShowSelected);
      evtBus.off("tvdbUpdated", onTvdbUpdated);
    });
    const lastLoadedTvdbId = ref(null);

    const handleScaledWheel = (event) => {
      if (!event) return;
      const el = event.currentTarget;
      if (!el) return;
      const dy = event.deltaY || 0;
      const scaledDy = dy * 0.125;
      const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      el.scrollTop = Math.max(0, Math.min(max, (el.scrollTop || 0) + scaledDy));
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
        titlesPane.value.scrollTop = titlesPane.value.scrollHeight;
      }
    };

    const scrollTitlesPaneToBottom = async () => {
      await nextTick();
      if (titlesPane.value) {
        titlesPane.value.scrollTop = titlesPane.value.scrollHeight;
      }
    };

    const getAllShowNames = () => {
      const src = Array.isArray(props.allShows) ? props.allShows : [];
      const names = src
        .map((s) => {
          if (!s) return "";
          if (typeof s === "string") return s;
          return String(
            s.Name || s.name || s.title || s.showName || s.seriesName || "",
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

          const nextParsed = nextTitles.map((str) => {
            const parts = str.split("|");
            return parts[1] ? parts[1].trim() : parts[0].trim();
          });

          // remove any matching title from earlier in the list to avoid duplication
          // when receiving full history from server
          current = current.filter((s) => {
            const parts = s.split("|");
            const title = parts[1] ? parts[1].trim() : parts[0].trim();
            return !nextParsed.includes(title);
          });

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
        console.log("startBrowse failed:", msg);
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
      shouldAutoAdvance.value = false;
      if (previewMode.value) {
        evtBus.emit("exitPreviewMode");
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
        const added = toTitleArray(data);

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

          // Auto-advance if we just loaded items and the resulting selection has no info
          shouldAutoAdvance.value = true;

          // await scrollTitlesToBottom(); // allow watcher to handle this
        } else {
          shouldAutoAdvance.value = false;
          // If none returned, ensure the sentinel exists (once).
          const hasNoMore = titleStrings.value.some(
            (s) => String(s) === NO_MORE_ENTRY,
          );
          if (!hasNoMore) {
            titleStrings.value = [...titleStrings.value, NO_MORE_ENTRY];
          } else {
            // Force a new array assignment so the UI updates consistently.
            titleStrings.value = [...titleStrings.value];
          }

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
        console.log("getBrowseShow failed:", msg);
        titleStrings.value = [...titleStrings.value, `error|${msg}`];
        await scrollTitlesToBottom();
        await nextTick();
        suppressButtons.value = false;
      } finally {
        isLoadingNext.value = false;
      }
    };

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

    const matchingTvdbEntry = computed(() => {
      const all = allTvdbData.value;
      const t = curTvdb.value;
      if (!all || !t) return null;

      const currentTvdbId = String(t.tvdb_id || t.tvdbId || t.id || "").trim();
      const currentName = String(
        t.name || t.Name || t.seriesName || t.title || "",
      ).trim();

      if (!currentTvdbId && !currentName) return null;

      const getEntryTvdbId = (entry) =>
        String(
          entry?.tvdb_id || entry?.tvdbId || entry?.TvdbId || entry?.id || "",
        ).trim();

      const isRealTvdbEntry = (entry) => {
        if (!entry || typeof entry !== "object") return false;
        return !!getEntryTvdbId(entry);
      };

      if (currentTvdbId) {
        for (const entry of Object.values(all)) {
          if (!entry || typeof entry !== "object") continue;
          if (!isRealTvdbEntry(entry)) continue;
          if (getEntryTvdbId(entry) === currentTvdbId) return entry;
        }
      }

      if (!currentName) return null;
      const byName = all[currentName] || null;
      if (!isRealTvdbEntry(byName)) return null;

      if (!currentTvdbId) return byName;
      return getEntryTvdbId(byName) === currentTvdbId ? byName : null;
    });

    const hasTvdbEntry = computed(() => !!matchingTvdbEntry.value);

    const existingShowMatch = computed(() => {
      const t = curTvdb.value;
      if (!t) return null;

      const tId = String(t.tvdb_id || t.tvdbId || t.id || "").trim();
      const name = String(t.name || t.Name || t.seriesName || t.title || "")
        .trim()
        .toLowerCase();

      if (!name && !tId) return null;

      return (props.allShows || []).find((s) => {
        const sTvdb = String(s.TvdbId || s.tvdbId || s.tvdb_id || "").trim();
        if (sTvdb && tId && sTvdb === tId) return true;
        const sName = String(s.Name || s.name || "")
          .trim()
          .toLowerCase();
        return sName === name;
      });
    });

    const toggleTvdbInfo = () => {
      const t = curTvdb.value;
      if (t) {
        const name = t.name || t.Name || t.seriesName || t.title;
        if (name) {
          const tvdbId = String(t.tvdb_id || t.tvdbId || t.id || "").trim();
          handleSelectExisting(name, { tvdbId });
          return;
        }
      }
      showTvdbInfo.value = !showTvdbInfo.value;
    };

    const watchedStatus = computed(() => {
      const data = matchingTvdbEntry.value;
      if (!data) return "";

      if ((data.episodeCount ?? 0) > 0) {
        let wCount = data.watchedCount ?? 0;
        if (data.Id && data.inEmby === false) wCount = 0;
        const total = data.episodeCount;
        if (wCount === total) {
          return `Watched all ${total} episodes`;
        } else {
          return `Watched ${wCount} of ${total}`;
        }
      }
      return "";
    });

    const tvdbInfo = computed(() => {
      const data = matchingTvdbEntry.value;
      if (!data) return {};

      const info = {};

      const {
        firstAired,
        lastAired,
        status,
        seasonCount,
        originalCountry,
        originalLanguage,
        originalNetwork,
        averageRuntime,
        inEmby,
        tvdb_id,
        tvdbId,
      } = data;

      const fa = firstAired || "";
      const la = lastAired || "";
      const st = status || "";
      if (fa && la) info.dates = `${fa} - ${la}`;
      else if (fa) info.dates = `${fa}`;
      else if (la) info.dates = `${la}`;

      info.status = st ? ` &nbsp; ${st}` : "";

      let seasonsTxt = "";
      switch (seasonCount) {
        case 0:
          break;
        case 1:
          seasonsTxt = "1 Season";
          break;
        default:
          seasonsTxt = `${seasonCount} Seasons`;
      }
      info.seasons = seasonsTxt ? ` &nbsp; ${seasonsTxt}` : "";

      const capWords = (raw) => {
        const s = String(raw || "").trim();
        if (!s) return "";
        if (s === "UK") return "UK";
        return s
          .toLowerCase()
          .split(/\s+/)
          .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
          .join(" ");
      };

      let oc = String(originalCountry || "")
        .trim()
        .toUpperCase();
      if (oc === "GBR" || oc === "gbr") oc = "UK";

      const ol = capWords(originalLanguage);
      let on = String(originalNetwork || "");
      if (on.includes("Amazon")) on = "Amazon";
      if (on.includes("Paramount+")) on = "Paramount+";
      on = on.trim().toUpperCase();

      // const left = `${oc}${oc ? "/" : ""}${ol}`.trim();
      // if (left) info.cntryLangLeft = left;
      // if (on) info.cntryLangRight = on;

      if (averageRuntime) info.runtime = `${averageRuntime} Mins`;

      if (inEmby === false) info.inEmby = false;

      if (data.name && allTvdbData.value) {
        const local = allTvdbData.value[data.name];
        if (local && (local.episodeCount ?? 0) > 0) {
          let wCount = local.watchedCount ?? 0;
          if (local.Id && local.inEmby === false) wCount = 0;
          const total = local.episodeCount;
          if (wCount === total) {
            info.watched = `Watched all ${total} episodes`;
          } else {
            info.watched = `Watched ${wCount} of ${total}`;
          }
        }
      }

      const tId = String(tvdb_id || tvdbId || "").trim();
      if (data.name || tId) {
        if (existingShowMatch.value) {
          info.existingShowName = existingShowMatch.value.Name;
        }
      }

      return info;
    });

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
        window.open(u, "_blank");
      } catch (e) {
        console.log("openUrl failed:", e?.message || String(e));
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
          const sTvdb = String(s.TvdbId || s.tvdbId || s.tvdb_id || "").trim();
          if (sTvdb && tvdbId && sTvdb === tvdbId) return true;
          const sName = String(s.Name || s.name || "")
            .trim()
            .toLowerCase();
          return sName === name.toLowerCase();
        });

        if (matchingShow) {
          showContext = {
            inEmby: matchingShow.inEmby,
            Id: matchingShow.Id,
          };
        }

        // Use centralized cache function with show context
        const results = await getRemotes(name, tvdbId, remoteIds, showContext);

        if (_lastRemotesKey.value === key) {
          getRemotesResults.value = results;
        }
      } catch (e) {
        if (e !== "cancelled")
          console.log("getRemotes failed:", e?.message || String(e));
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

    const handleDebugClick = async () => {
      try {
        if (!curTvdb.value) {
          console.log("No show selected in gallery");
          return;
        }

        const tvdbId =
          curTvdb.value.tvdb_id || curTvdb.value.tvdbId || curTvdb.value.id;
        const name = curTvdb.value.name;

        if (!tvdbId) {
          console.log("Selected show has no TvdbId:", name);
          return;
        }

        console.log("Fetching TVDB API data for:", name, "TvdbId:", tvdbId);

        debugFlash.value = true;
        setTimeout(() => {
          debugFlash.value = false;
        }, 300);

        const result = await srvr.debugTvdb({
          name: name,
          tvdbId: tvdbId,
        });

        console.log("Debug result:", result);
      } catch (e) {
        console.error("debugClick failed:", e);
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

      const name = String(t.name || t.Name || "").trim();
      if (!name) return;

      // Check if show already exists
      const tvdbId = String(t.tvdbId || t.tvdb_id || t.id || "").trim();
      const exists = (props.allShows || []).some((s) => {
        const sTvdb = String(s.TvdbId || s.tvdbId || s.tvdb_id || "").trim();
        if (sTvdb && tvdbId && sTvdb === tvdbId) return true;
        const sName = String(s.Name || s.name || "")
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
          t.overview || t.overviewText || t.overview_txt || t.Overview || "",
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
        if (!isActive) showTvdbInfo.value = false;
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

      if (browseItem?.data?.genres?.length) {
        line += ` | ${browseItem.data.genres.join(", ")}`;
      }
      return line;
    });

    const galleryTitleLine = computed(() => {
      const t = curTvdb.value;
      if (t) {
        return String(t.name || t.Name || t.seriesName || t.title || "").trim();
      }
      if (
        selectedTitleIdx.value >= 0 &&
        parsedTitles.value[selectedTitleIdx.value]
      ) {
        return parsedTitles.value[selectedTitleIdx.value].titleString;
      }
      return "";
    });

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
    const handleGallerySelect = (tvdb) => {
      curTvdb.value = tvdb;
    };

    const handleSearchComplete = (tvdb) => {
      if (shouldAutoAdvance.value) {
        shouldAutoAdvance.value = false;
        if (!tvdb) {
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
        showTvdbInfo.value = false;
        void loadRemotesForTvdb(val);
        await nextTick();
        if (titlesPane.value) {
          if (
            justFetchedNext.value ||
            selectedTitleIdx.value >= titleStrings.value.length - 2
          ) {
            titlesPane.value.scrollTop = titlesPane.value.scrollHeight;
            justFetchedNext.value = false;
          }
        }
      },
      { deep: true },
    );

    // Handle title selection
    const selectTitle = async (idx, fromUser = false) => {
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
          if (!curTvdb.value) {
            void handleNext();
          } else {
            suppressButtons.value = false;
          }
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
          titlesPane.value.scrollTop = titlesPane.value.scrollHeight;
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
      // console.log('reel.vue onAllShows:', val?.length, '_startedWithShows:', _startedWithShows.value);
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
      handleDebugClick,
      debugFlash,
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
      showTvdbInfo,
      watchedStatus,
      manualSearchQuery,
      handleManualSearch,
      existingShowMatch,
      curFallbackImage,
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
