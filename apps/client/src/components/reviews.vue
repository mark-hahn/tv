<template>
  <div
    id="reviews"
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
    <!-- Header Section-->
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
        paddingBottom: '15px',
        marginLeft: '-10px',
        marginRight: '-10px',
        marginTop: '-10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        borderBottom: '1px solid #ddd',
      }"
    >
      <!-- Top Row: Show Title + Loading + Stats -->
      <div
        style="
          width: 100%;
          display: flex;
          align-items: center;
          margin-bottom: 5px;
        "
      >
        <div
          class="pane-header-title"
          :style="{
            marginLeft: '10px',
            marginRight: '10px',
            flex: '1 1 auto',
            minWidth: 0,
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }"
        >
          <span>{{ showName }}</span>
        </div>
        <div
          style="
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-right: 10px;
            flex-wrap: wrap;
          "
        >
          <div
            v-if="isLoading"
            style="
              font-size: 14px;
              color: #aaa !important;
              margin-left: 8px;
              font-weight: bold;
            "
          >
            &lt;Loading&gt;
          </div>
          <div
            v-if="imdbStats &amp;&amp; !simpleMode"
            style="
              font-size: 13px;
              color: #555;
              margin-left: 8px;
              display: flex;
              gap: 10px;
              white-space: nowrap;
            "
          >
            <span>Imdb {{ imdbStats.accepted }}/{{ imdbStats.checked }}</span>
          </div>
        </div>
      </div>
      <!-- Error Row -->
      <div
        v-if="errorMessage"
        style="
          font-size: 13px;
          color: #c00;
          padding: 2px 10px;
          white-space: pre-line;
          line-height: 1.4;
        "
      >
        {{ errorMessage }}
      </div>
      <!-- Second Row: Histogram Only-->
      <div style="width: 100%; display: flex; align-items: stretch">
        <div
          v-if="reviews.length > 0"
          style="
            flex: 1;
            display: flex;
            align-items: flex-end;
            padding: 0 10px;
            height: 60px;
            border-bottom: 2px solid #333;
            position: relative;
          "
        >
          <template
            v-for="(bucket, idx) in histogramBuckets"
            :key="idx"
          >
            <!-- Tick before each bar -->
            <div
              style="
                width: 2px;
                height: 5px;
                background-color: #333;
                flex-shrink: 0;
                align-self: flex-end;
                margin-bottom: -2px;
              "
            ></div>
            <!-- Bar -->
            <div
              style="
                flex: 1;
                height: 100%;
                display: flex;
                flex-direction: column;
                justify-content: flex-end;
                align-items: center;
              "
            >
              <div
                :style="{
                  width: '100%',
                  height: bucket.height + '%',
                  backgroundColor: '#4a90e2',
                  borderRadius: '2px 2px 0 0',
                  minHeight: bucket.count > 0 ? '2px' : '0',
                }"
              ></div>
            </div>
          </template>
          <!-- Final tick at the right end -->
          <div
            style="
              width: 2px;
              height: 5px;
              background-color: #333;
              flex-shrink: 0;
              align-self: flex-end;
              margin-bottom: -2px;
            "
          ></div>
        </div>
      </div>
    </div>
    <!-- Body: Two Scrolling Panes-->
    <div
      id="body"
      style="
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        gap: 10px;
        margin-top: 10px;
      "
    >
      <div
        v-if="checkedRemotes && !imdbId"
        style="
          width: 100%;
          text-align: center;
          color: #666;
          margin-top: 50px;
          font-size: 16px;
        "
      >
        Show not found at IMDB.
      </div>
      <div
        v-else-if="!isLoading &amp;&amp; stats &amp;&amp; reviews.length === 0"
        style="
          width: 100%;
          text-align: center;
          color: #666;
          margin-top: 50px;
          font-size: 16px;
        "
      >
        No reviews found.
      </div>
      <template v-else>
        <!-- Left Column: Descending Sort (High Scores)-->
        <div
          ref="leftReviewsPane"
          style="
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 10px;
            overflow-y: auto;
            overflow-x: hidden;
            height: 100%;
          "
        >
          <div
            v-for="(review, idx) in leftColumnReviews"
            :key="idx"
            :style="cardStyle"
          >
            <!-- Card Header-->
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 5px;
              "
            >
              <div style="font-weight: bold; font-size: 14px">
                <span>{{ review.author }}</span>
              </div>
              <div style="font-size: 14px; white-space: nowrap">
                <template v-if="review.numStars !== -1"
                  ><i
                    v-for="(starClass, idx) in getStarClasses(review.numStars)"
                    :key="idx"
                    :class="starClass"
                    style="color: #ffa500; margin-left: 2px; font-size: 12px"
                  ></i
                ></template>
              </div>
            </div>
            <div
              style="
                border-bottom: 1px solid #000;
                width: 100%;
                margin-bottom: 5px;
              "
            ></div>
            <!-- Card Text-->
            <div
              :style="{
                fontSize: '15px',
                lineHeight: '1.4',
              }"
            >
              <span>{{ review.text }}</span>
            </div>
          </div>
        </div>
        <!-- Right Column: Ascending Sort (Low Scores)-->
        <div
          ref="rightReviewsPane"
          style="
            flex: 1;
            display: flex;
            flex-direction: column;
            gap: 10px;
            overflow-y: auto;
            overflow-x: hidden;
            height: 100%;
          "
        >
          <div
            v-for="(review, idx) in rightColumnReviews"
            :key="idx"
            :style="cardStyle"
          >
            <!-- Card Header-->
            <div
              style="
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                margin-bottom: 5px;
              "
            >
              <div style="font-weight: bold; font-size: 14px">
                <span>{{ review.author }}</span>
              </div>
              <div style="font-size: 14px; white-space: nowrap">
                <template v-if="review.numStars !== -1"
                  ><i
                    v-for="(starClass, idx) in getStarClasses(review.numStars)"
                    :key="idx"
                    :class="starClass"
                    style="color: #ffa500; margin-left: 2px; font-size: 12px"
                  ></i
                ></template>
              </div>
            </div>
            <div
              style="
                border-bottom: 1px solid #ddd;
                width: 100%;
                margin-bottom: 5px;
              "
            ></div>
            <!-- Card Text-->
            <div
              :style="{
                fontSize: '15px',
                lineHeight: '1.4',
              }"
            >
              <span>{{ review.text }}</span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script>
import evtBus from "../evtBus.js";
import * as srvr from "../srvr.js";

export default {
  name: "Reviews",

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
      reviews: [],
      stats: null,
      imdbStats: null,
      showName: "",
      imdbId: "",
      imdbUrl: "",
      previewMode: false,
      previewAddBusy: false,
      previewSrchChoice: null,
      isLoading: false,
      checkedRemotes: false,
      pendingLoad: false,
      errorMessage: "",
    };
  },

  computed: {
    leftColumnReviews() {
      // Split list in 2 equal halves.
      // Put higher scores in left column and sort descending.
      if (!this.reviews.length) return [];

      const getVal = (r) => (r.numStars === -1 ? 2.5 : r.numStars);

      const all = [...this.reviews];
      // Sort all by score descending first to identify "higher scores"
      all.sort((a, b) => getVal(b) - getVal(a));

      const mid = Math.ceil(all.length / 2);
      const left = all.slice(0, mid);

      // Sort Descending
      left.sort((a, b) => getVal(b) - getVal(a));
      return left;
    },
    rightColumnReviews() {
      // Put lower scores in right column and sort ascending.
      if (!this.reviews.length) return [];

      const getVal = (r) => (r.numStars === -1 ? 2.5 : r.numStars);

      const all = [...this.reviews];
      all.sort((a, b) => getVal(b) - getVal(a));

      const mid = Math.ceil(all.length / 2);
      const right = all.slice(mid);

      // Sort Ascending
      right.sort((a, b) => getVal(a) - getVal(b));
      return right;
    },
    cardStyle() {
      return {
        backgroundColor: "white",
        border: "1px solid #ccc",
        borderRadius: "5px",
        padding: "10px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
      };
    },
    histogramBuckets() {
      // Create 10 buckets for discrete scores: 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0
      const buckets = Array(10)
        .fill(0)
        .map(() => ({ count: 0 }));

      this.reviews.forEach((review) => {
        const score = review.numStars;
        if (score === -1 || score < 0.5) return; // Skip reviews without scores or below 0.5

        // Map score to bucket index: 0.5→0, 1.0→1, 1.5→2, ..., 5.0→9
        const bucketIndex = Math.round(score * 2 - 1);
        if (bucketIndex >= 0 && bucketIndex < 10) {
          buckets[bucketIndex].count++;
        }
      });

      // Find max count to scale heights
      const maxCount = Math.max(...buckets.map((b) => b.count), 1);

      // Calculate height percentages (scale to 90% max to leave some room at top)
      buckets.forEach((bucket) => {
        bucket.height = (bucket.count / maxCount) * 90;
      });

      return buckets;
    },
  },

  mounted() {
    // Listen for show changes
    evtBus.on("setUpSeries", this.onSetUpSeries);

    // Listen for TVDB details to get existing Remotes (including IMDB URL)
    evtBus.on("tvdbDataReady", this.onTvdbDataReady);

    evtBus.on("previewMode", this.onPreviewMode);
    evtBus.on("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.on("addPreviewShowDone", this.onAddPreviewShowDone);
    evtBus.on("paneChanged", this.onPaneChanged);
  },

  beforeUnmount() {
    evtBus.off("setUpSeries", this.onSetUpSeries);
    evtBus.off("tvdbDataReady", this.onTvdbDataReady);
    evtBus.off("previewMode", this.onPreviewMode);
    evtBus.off("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.off("addPreviewShowDone", this.onAddPreviewShowDone);
    evtBus.off("paneChanged", this.onPaneChanged);
  },

  methods: {
    onPaneChanged(pane) {
      if (pane !== "reviews") return;
      if (this.pendingLoad) {
        this.pendingLoad = false;
        void this.loadAllReviews();
      }
    },

    onSetUpSeries(show) {
      void show?.name;
      this.showName = show?.name || "";
      this.reviews = [];
      this.stats = null;
      this.imdbId = "";
      this.imdbUrl = "";
      this.checkedRemotes = false;
      this.pendingLoad = false;
      this.imdbStats = null;
      this.errorMessage = "";
      this.scrollReviewPanesToTop();
    },

    onTvdbDataReady(data) {
      this.checkedRemotes = true;
      const tvdbData = data?.tvdbData;

      if (tvdbData) {
        // First try the runtime-built remotes array (populated when show is freshly fetched)
        if (tvdbData.remotes && tvdbData.remotes.length > 0) {
          const imdbRemote = tvdbData.remotes.find(
            (r) =>
              r.name &&
              r.name.toLowerCase().includes("imdb") &&
              r.url &&
              r.url.includes("imdb.com"),
          );
          if (imdbRemote && imdbRemote.url) {
            this.imdbUrl = imdbRemote.url;
            const match = imdbRemote.url.match(/\/title\/(tt\d+)/);
            if (match) {
              this.imdbId = match[1];
            }
          }
        }

        // Fall back to persisted flat url props when remotes array is empty
        if (!this.imdbUrl && tvdbData.imdbUrl) {
          this.imdbUrl = tvdbData.imdbUrl;
          const match = tvdbData.imdbUrl.match(/\/title\/(tt\d+)/);
          if (match) {
            this.imdbId = match[1];
          }
        }
        if (!this.imdbId && tvdbData.imdbId) {
          this.imdbId = tvdbData.imdbId;
        }

        // Defer load until the reviews pane is actually visible
        if (this.imdbId) {
          this.pendingLoad = true;
        }
      }
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
      this.scrollReviewPanesToTop();
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

    scrollReviewPanesToTop() {
      this.$nextTick(() => {
        const getPane = (paneRef) => {
          const pane = this.$refs[paneRef];
          return Array.isArray(pane) ? pane[0] : pane;
        };

        const resetBoth = () => {
          const leftPane = getPane("leftReviewsPane");
          const rightPane = getPane("rightReviewsPane");
          if (leftPane) leftPane.scrollTop = 0;
          if (rightPane) rightPane.scrollTop = 0;
        };

        resetBoth();
        requestAnimationFrame(resetBoth);
      });
    },

    async loadAllReviews() {
      this.reviews = [];
      this.stats = null;
      this.imdbStats = null;
      this.errorMessage = "";
      this.isLoading = true;
      try {
        const errors = [];
        const allReviews = [];

        if (this.imdbId) {
          try {
            const data = await srvr.getImdbReviews(this.imdbId);
            // The server answers 200 with ok:false when the fetch failed, so
            // show that instead of a silent empty result.
            if (data.ok === false && data.error) {
              errors.push("IMDB: " + data.error);
            }
            this.imdbStats = {
              accepted: (data.reviews || []).length,
              checked: data.numChecked || 0,
            };
            for (const r of data.reviews || []) {
              allReviews.push({ ...r, author: r.author + " (i)" });
            }
          } catch (e) {
            errors.push("IMDB: " + (e?.message || "failed"));
          }
        }

        this.errorMessage = errors.join("\n");
        this.reviews = allReviews;
        this.stats = { numChecked: allReviews.length };
        this.scrollReviewPanesToTop();
      } finally {
        this.isLoading = false;
      }
    },

    getStarClasses(numStars) {
      // 0 to 5 stars
      const stars = [];
      const val = Number(numStars) || 0;

      for (let i = 1; i <= 5; i++) {
        if (val >= i) {
          stars.push("fa-solid fa-star");
        } else if (val >= i - 0.5) {
          stars.push("fa-solid fa-star-half-stroke");
        } else {
          stars.push("fa-regular fa-star");
        }
      }
      return stars;
    },
  },
};
</script>
