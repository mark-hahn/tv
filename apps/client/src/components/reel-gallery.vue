<template>
  <div
    id="reelGallery"
    ref="galleryPane"
    :style="{
      flex: '1',
      minHeight: 0,
      height: '100%',
      overflowY: 'auto',
      overflowX: 'hidden',
      display: 'block',
      padding: '2px',
    }"
    @wheel.stop.prevent="handleScaledWheel"
  >
    <div
      v-for="(tvdb, idx) in tvdbList"
      :key="tvdb.id || idx"
      @click="selectCard(idx)"
      :style="getCardStyle(idx)"
    >
      <div
        v-if="!getImageUrl(tvdb)"
        :style="{
          width: '101px',
          margin: '0 auto',
          backgroundColor: '#e0e0e0',
          borderRadius: '5px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          color: '#666',
          padding: '10px',
        }"
      >
        No Image
      </div>
      <img
        v-else
        :src="getImageUrl(tvdb)"
        :style="{
          width: '101px',
          margin: '0 auto',
          height: 'auto',
          borderRadius: '5px',
          display: 'block',
        }"
        @click.stop="selectCard(idx)"
        @error="handleImageError($event)"
      />
      <div
        :style="{
          padding: '2px',
          fontSize: '12px',
          textAlign: 'center',
          fontWeight: 'bold',
        }"
      >
        {{ tvdb.year }} - {{ tvdb.name }}
      </div>
    </div>
  </div>
</template>

<script>
import { ref, watch, onMounted, nextTick } from "vue";
import { srchTvdbData } from "../tvdb.js";
import { unilog } from "../log.js";

export default {
  name: "ReelGallery",
  props: {
    srchStr: {
      type: String,
      default: "",
    },
    imdbid: {
      type: [String, Number],
      default: null,
    },
    tvdbid: {
      type: [String, Number],
      default: null,
    },
    fallbackImage: {
      type: String,
      default: null,
    },
    explicitList: {
      type: Array,
      default: null,
    },
  },
  emits: ["select", "preview", "search-complete"],
  setup(props, { emit }) {
    const tvdbList = ref([]);
    const selectedIdx = ref(0);
    const galleryPane = ref(null);

    const handleScaledWheel = (event) => {
      if (!event) return;
      const el = event.currentTarget;
      if (!el) return;
      const dy = event.deltaY || 0;
      const scaledDy = dy * 0.125;
      const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      el.scrollTop = Math.max(0, Math.min(max, (el.scrollTop || 0) + scaledDy));
    };

    const TVDB_MISSING_IMAGE_PATH = "/images/missing/";

    const getImageUrl = (tvdb) => {
      if (!tvdb) return null;
      // TVDB search results use `image_url` (full) and `thumbnail` (smaller).
      // Upcoming shows return the missing-image placeholder as image_url while
      // thumbnail can still hold a real poster — skip placeholder urls.
      for (const url of [tvdb.image_url, tvdb.thumbnail, tvdb.image]) {
        if (url && !String(url).includes(TVDB_MISSING_IMAGE_PATH)) return url;
      }
      return null;
    };

    const getPremiereDate = (tvdb) => {
      if (!tvdb) return "";
      const dateStr =
        tvdb.first_aired ||
        tvdb.firstAired ||
        tvdb.premiered ||
        tvdb.released ||
        tvdb.first_air_time ||
        "";
      if (!dateStr) return "";
      // Expecting YYYY-MM-DD
      const parts = String(dateStr).trim().split("-");
      if (parts.length < 3) return "";
      return `${parts[0]}/${parts[1]}/${parts[2]}`;
    };

    const getCardStyle = (idx) => {
      return {
        cursor: "pointer",
        backgroundColor: idx === selectedIdx.value ? "#fffacd" : "white",
        border: "1px solid #ccc",
        borderRadius: "5px",
        overflow: "hidden",
        width: "100%",
        boxSizing: "border-box",
        display: "block",
        position: "relative",
        marginBottom: "4px",
      };
    };

    const selectCard = (idx) => {
      selectedIdx.value = idx;
      emit("select", tvdbList.value[idx]);
    };

    const previewCard = (idx) => {
      selectedIdx.value = idx;
      const tvdb = tvdbList.value[idx];
      emit("select", tvdb);
      emit("preview", tvdb);
    };

    const TVDB_MISSING_HASH =
      "4c59074535f4937221fd78e87a672ad0116a8aa9fb8202fc81dc2d00ab3f3683";

    const hashBlob = async (blob) => {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        return hashHex;
      } catch (e) {
        return "";
      }
    };

    const checkImages = async (items) => {
      if (!props.fallbackImage) return;

      // Only check the top image card
      for (let i = 0; i < items.length && i < 1; i++) {
        const item = items[i];
        const url = getImageUrl(item);
        if (!url || url === props.fallbackImage) continue;

        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const blob = await res.blob();
          const hash = await hashBlob(blob);

          if (hash === TVDB_MISSING_HASH) {
            // Force update with Vue reactivity
            const description = item.overview || item.overviewText || "";
            const updatedItem = {
              ...item,
              image_url: props.fallbackImage,
              thumbnail: props.fallbackImage,
              overview: description + " [USED FALLBACK IMAGE]",
            };
            tvdbList.value.splice(i, 1, updatedItem);
          }
        } catch (e) {
          // Log errors for debugging
          unilog(1032, "checkImages error:", e);
        }
      }
    };

    const loadTvdbData = async () => {
      const currentSrch = props.srchStr;
      if (!currentSrch) return;

      try {
        const data = await srchTvdbData(currentSrch);

        if (props.srchStr !== currentSrch) {
          return;
        }

        if (data && data.length > 0) {
          let sorted = [...data];
          if (props.tvdbid || props.imdbid) {
            const tId = String(props.tvdbid);
            const iId = String(props.imdbid);
            const idx = sorted.findIndex((d) => {
              if (tId && (String(d.id) === tId || String(d.tvdb_id) === tId))
                return true;
              if (
                iId &&
                (String(d.imdb_id) === iId || String(d.imdbId) === iId)
              )
                return true;
              return false;
            });
            if (idx > 0) {
              const [match] = sorted.splice(idx, 1);
              sorted.unshift(match);
            }
          }
          tvdbList.value = sorted;
          void checkImages(sorted);
          await nextTick();
          if (galleryPane.value) {
            galleryPane.value.scrollTop = 0;
          }
          // Auto-select first card
          selectedIdx.value = 0;
          emit("select", sorted[0]);
          emit("search-complete", sorted[0]);
        } else {
          tvdbList.value = [];
          emit("select", null);
          emit("search-complete", null);
        }
      } catch (err) {
        unilog(1033, "Error loading tvdb data:", err);
        tvdbList.value = [];
        emit("search-complete", null);
      }
    };

    const handleImageError = (event) => {
      unilog(1034, "Image failed to load:", event.target.src);
    };

    // Watch for srchStr changes
    watch(
      () => props.srchStr,
      () => {
        if (props.explicitList !== null) return;
        void loadTvdbData();
      },
    );

    // Watch for explicitList changes
    watch(
      () => props.explicitList,
      async (val) => {
        if (val !== null) {
          tvdbList.value = val || [];
          await nextTick();
          if (galleryPane.value) galleryPane.value.scrollTop = 0;
          selectedIdx.value = 0;
          if (val && val.length > 0) {
            emit("select", val[0]);
            emit("search-complete", val[0]);
          } else {
            emit("select", null);
            emit("search-complete", null);
          }
        } else {
          void loadTvdbData();
        }
      },
    );

    // Load on mount
    onMounted(() => {
      if (props.explicitList !== null) {
        tvdbList.value = props.explicitList || [];
        selectedIdx.value = 0;
        if (props.explicitList && props.explicitList.length > 0) {
          emit("select", props.explicitList[0]);
          emit("search-complete", props.explicitList[0]);
        }
      } else {
        void loadTvdbData();
      }
    });

    return {
      tvdbList,
      selectedIdx,
      galleryPane,
      handleScaledWheel,
      getImageUrl,
      getPremiereDate,
      getCardStyle,
      selectCard,
      previewCard,
      handleImageError,
    };
  },
};
</script>

<style scoped>
#reelGallery::-webkit-scrollbar {
  width: 8px;
}

#reelGallery::-webkit-scrollbar-track {
  background: #f1f1f1;
}

#reelGallery::-webkit-scrollbar-thumb {
  background: #888;
  border-radius: 4px;
}

#reelGallery::-webkit-scrollbar-thumb:hover {
  background: #555;
}
</style>
