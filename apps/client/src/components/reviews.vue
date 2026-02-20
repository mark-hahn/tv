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
      <!-- Top Row: Show Title-->
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
      </div>
      <!-- Second Row: Filter Radio Buttons and Histogram-->
      <div style="width: 100%; display: flex; align-items: stretch; gap: 8px">
        <!-- Left side: Buttons and Info-->
        <div
          style="
            flex: 1;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-left: 10px;
            flex-wrap: wrap;
          "
        >
          <button
            v-for="btn in filterButtons"
            :key="btn.label"
            @click="handleButtonClick(btn.label)"
            :style="getButtonStyle(selectedButton === btn.label, btn.label)"
            :disabled="isButtonDisabled(btn.label)"
          >
            {{ btn.label }}
          </button>
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
            v-if="stats &amp;&amp; !simpleMode"
            style="
              font-size: 14px;
              color: #555;
              margin-left: 8px;
              white-space: nowrap;
            "
          >
            {{ reviews.length }}/{{ stats.numChecked }}
          </div>
        </div>
        <!-- Right side: Histogram-->
        <div
          v-if="reviews.length > 0"
          style="
            flex: 0 0 50%;
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
        v-if="checkedRemotes && !rottenUrl && !imdbId"
        style="
          width: 100%;
          text-align: center;
          color: #666;
          margin-top: 50px;
          font-size: 16px;
        "
      >
        Show not found at Rotten Tomatoes or IMDB.
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
      showName: "",
      rottenUrl: "",
      rottenLabel: "",
      imdbId: "",
      imdbUrl: "",
      previewMode: false,
      previewAddBusy: false,
      previewSrchChoice: null,
      selectedButton: "Rotten",
      isLoading: false,
      checkedRemotes: false,
      filterButtons: [{ label: "IMDB" }, { label: "Rotten" }],
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

    // Listen for TVDB details to get existing Remotes (including Rotten button URL)
    evtBus.on("tvdbDataReady", this.onTvdbDataReady);

    evtBus.on("previewMode", this.onPreviewMode);
    evtBus.on("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.on("addPreviewShowDone", this.onAddPreviewShowDone);

    // Also listen for explicit "showReviews" if added later, but logic above should suffice for now.
  },

  beforeUnmount() {
    evtBus.off("setUpSeries", this.onSetUpSeries);
    evtBus.off("tvdbDataReady", this.onTvdbDataReady);
    evtBus.off("previewMode", this.onPreviewMode);
    evtBus.off("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.off("addPreviewShowDone", this.onAddPreviewShowDone);
  },

  methods: {
    onSetUpSeries(show) {
      this.showName = show?.Name || "";
      this.reviews = [];
      this.stats = null;
      this.rottenUrl = "";
      this.rottenLabel = "";
      this.imdbId = "";
      this.imdbUrl = "";
      this.selectedButton = "Rotten";
      this.checkedRemotes = false;
      this.scrollReviewPanesToTop();
    },

    onTvdbDataReady(data) {
      this.checkedRemotes = true;
      const tvdbData = data?.tvdbData;

      if (tvdbData && tvdbData.remotes) {
        const rottenRemote = tvdbData.remotes.find(
          (r) => r.name && r.name.toLowerCase().includes("rotten"),
        );
        if (rottenRemote) {
          this.rottenLabel = rottenRemote.name; // Use the name from remote object which contains ratings
          this.rottenUrl = rottenRemote.url; // Assuming remote object has { name, url }
        }

        // Extract IMDB ID from IMDB remote
        const imdbRemote = tvdbData.remotes.find(
          (r) =>
            r.name &&
            r.name.toLowerCase().includes("imdb") &&
            r.url &&
            r.url.includes("imdb.com"),
        );
        if (imdbRemote && imdbRemote.url) {
          this.imdbUrl = imdbRemote.url;
          // Extract imdbId from URL like https://www.imdb.com/title/tt13567344
          const match = imdbRemote.url.match(/\/title\/(tt\d+)/);
          if (match) {
            this.imdbId = match[1];
          }
        }

        // Load initial reviews - prioritize IMDB if available, otherwise Rotten Tomatoes
        if (this.imdbId) {
          this.selectedButton = "IMDB";
          void this.loadReviews(this.imdbId, "IMDB");
        } else if (this.rottenUrl) {
          this.selectedButton = "Rotten";
          void this.loadReviews(this.rottenUrl, "Rotten");
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

    getButtonStyle(isSelected, label) {
      const isDisabled = this.isButtonDisabled(label);
      return {
        fontSize: "13px",
        cursor: isDisabled ? "not-allowed" : "pointer",
        borderRadius: "5px",
        padding: "4px 12px",
        border: "1px solid #bbb",
        "--btn-bg": isSelected ? "lightgray" : "whitesmoke",
        color: isDisabled ? "#ccc" : "black",
        opacity: isDisabled ? 0.5 : 1,
      };
    },

    isButtonDisabled(label) {
      if (label === "IMDB") {
        return !this.imdbId;
      } else {
        return !this.rottenUrl;
      }
    },

    handleButtonClick(label) {
      this.selectedButton = label;
      if (label === "IMDB") {
        if (this.imdbId) {
          void this.loadReviews(this.imdbId, "IMDB");
        }
      } else {
        if (this.rottenUrl) {
          void this.loadReviews(this.rottenUrl, this.selectedButton);
        }
      }
    },

    scrollReviewPanesToTop() {
      this.$nextTick(() => {
        const leftPane = this.$refs.leftReviewsPane;
        const rightPane = this.$refs.rightReviewsPane;
        if (leftPane) leftPane.scrollTop = 0;
        if (rightPane) rightPane.scrollTop = 0;
      });
    },

    async loadReviews(urlOrId, buttonName) {
      this.scrollReviewPanesToTop();
      this.reviews = [];
      this.stats = null;
      this.isLoading = true;
      try {
        let data;
        if (buttonName === "IMDB") {
          // Call IMDB reviews API
          data = await srvr.getImdbReviews(urlOrId);
        } else {
          // Call Rotten Tomatoes reviews API - map "Rotten" to "Audience"
          const rtButtonName =
            buttonName === "Rotten" ? "Audience" : buttonName;
          data = await srvr.getReviews(urlOrId, rtButtonName);
        }

        if (data) {
          if (data.reviews && Array.isArray(data.reviews)) {
            this.reviews = data.reviews;
          } else {
            this.reviews = [];
          }

          this.stats = {
            numChecked: data.numChecked,
            notEnglishCount: data.notEnglishCount,
            noReviewCount: data.noReviewCount,
            smallTextCount: data.smallTextCount,
          };
        }
      } catch (err) {
        console.error("Failed to load reviews:", err);
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
