<template>
  <div
    id="trailer"
    @click.stop
    :style="{
      height: '100%',
      width: '100%',
      padding: '10px',
      boxSizing: 'border-box',
      overflowY: 'auto',
      backgroundColor: '#fafafa',
      position: 'relative',
    }"
  >
    <div
      v-if="err"
      style="color: red; margin: 10px; border: 1px solid red; padding: 10px"
    >
      <b>Error:</b>
      <pre>{{ err }}</pre>
    </div>
    <div
      v-if="!showName"
      style="padding: 20px; text-align: center; color: #666"
    >
      No show selected.
    </div>
    <template v-else>
      <div
        class="pane-header-title"
        :style="{
          marginBottom: '15px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
        }"
      >
        <span>{{ showName }}</span>
      </div>
      <div
        style="
          height: 1px;
          width: 100%;
          background-color: #000;
          margin-top: 6px;
        "
      ></div>
      <!-- content wrapper to allow refresh-->
      <div
        v-if="shownTrailers.length === 0 && !loadingImdb"
        style="padding: 20px; text-align: center; color: #666"
      >
        No trailers found.
      </div>
      <div
        v-else-if="showContent"
        style="display: flex; flex-direction: column; gap: 20px"
      >
        <div
          v-for="(t, idx) in shownTrailers"
          :key="t.id || t.url"
          style="
            background: white;
            padding: 10px;
            border: 1px solid #ccc;
            border-radius: 5px;
          "
        >
          <div
            v-if="!isImdbVideo(t.url)"
            :style="{ fontWeight: 'bold', marginBottom: '5px' }"
          >
            {{ t.name ? t.name.replace(/Trailer/gi, "").trim() : "" }}
          </div>
          <template v-if="getYoutubeId(t.url)">
            <div style="position: relative; display: inline-block">
              <div :id="'yt-player-' + idx"></div>
              <button
                @click="streamTrailer(t.url, idx)"
                :style="{
                  backgroundColor:
                    streamFlash === idx ? 'lightgreen' : 'whitesmoke',
                  opacity: streamFlash === idx ? 0.95 : 0.8,
                  position: 'absolute',
                  top: '10px',
                  right: '10px',
                  padding: '6px 12px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  border: '1px solid #999',
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  zIndex: 9999,
                  pointerEvents: 'auto',
                }"
              >
                TV
              </button>
            </div>
          </template>
          <template v-else-if="isVideoFile(t.url)">
            <div style="position: relative; display: inline-block">
              <video
                controls
                ref="htmlVideos"
                width="100%"
                style="max-width: 560px"
                :src="t.url"
                :data-url="t.url"
                @error="onHtmlVideoError(t.url)"
              ></video>
              <button
                @click="streamTrailer(t.url, idx)"
                :style="{
                  backgroundColor:
                    streamFlash === idx ? 'lightgreen' : 'whitesmoke',
                  opacity: streamFlash === idx ? 0.95 : 0.8,
                  position: 'absolute',
                  top: '10px',
                  right: '10px',
                  padding: '6px 12px',
                  fontSize: '13px',
                  cursor: 'pointer',
                  border: '1px solid #999',
                  borderRadius: '4px',
                  fontWeight: 'bold',
                  zIndex: 10,
                }"
              >
                TV
              </button>
            </div>
          </template>
          <div v-else>
            <a
              :href="t.url"
              @click.prevent="openExternalTrailerUrl(t.url)"
              >{{ t.url }}</a
            >
          </div>
        </div>
      </div>
      <!-- Loading message for IMDB trailer -->
      <div
        v-if="loadingImdb"
        style="
          background: white;
          padding: 10px;
          border: 1px solid #ccc;
          border-radius: 5px;
          text-align: center;
          color: #444;
          font-size: 13px;
        "
      >
        Loading IMDB trailer...
      </div>
    </template>
  </div>
</template>

<script>
import evtBus from "../evtBus.js";
import { nextTick } from "vue";
import * as util from "../util.js";
import { config } from "../config.js";
import { unilog } from "../log.js";

const IMDB_URL_EXPIRY_SAFETY_MS = 2 * 60 * 1000;

export default {
  name: "Trailer",
  props: {
    simpleMode: { type: Boolean, default: false },
    active: { type: Boolean, default: false },
  },
  data() {
    return {
      showName: "",
      trailers: [],
      err: "",
      showContent: true, // Controls rendering of video list
      loadingImdb: false, // Loading state for IMDB video fetch

      previewMode: false,
      previewAddBusy: false,
      previewSrchChoice: null,

      // State tracking
      ytPlayers: new Map(), // idx -> YT.Player
      failedVideoUrls: new Set(),
      savedTimes: new Map(), // key -> seconds
      lastPlayingKey: null, // "yt-idx" or "html-url"
      streamFlash: null, // Track which video is flashing (idx)
    };
  },
  openExternalTrailerUrl(url) {
    util.openExternalPage(url);
  },
  computed: {
    /**
     * The trailers that get a card. One that cannot be played is not shown at
     * all and does not count: an HLS file, which no browser here plays, or one
     * whose video element has already failed to load — imdb hands out signed
     * urls its own CDN then answers 403 for.
     */
    shownTrailers() {
      return (this.trailers || []).filter(
        (t) => !this.isHlsFile(t?.url) && !this.isFailedVideo(t?.url),
      );
    },
  },
  watch: {
    active(val) {
      if (!val) {
        // Tab hidden: Save state and destroy
        this.saveState();
        this.showContent = false;
      } else {
        // Tab shown: Re-render and restore
        this.showContent = true;
        void nextTick(() => {
          this.initPlayers(); // Re-init YT players
          this.restoreState();
        });
      }
    },
    trailers() {
      // If trailers change while active, init players
      if (this.active && this.showContent) {
        void nextTick(() => this.initPlayers());
      }
    },
  },
  errorCaptured(err, vm, info) {
    this.err = `${err.toString()}\nInfo: ${info}`;
    return false; // prevent error from bubbling up further
  },
  methods: {
    async streamTrailer(url, idx) {
      if (!url) {
        return;
      }
      this.streamFlash = idx;
      setTimeout(() => {
        this.streamFlash = null;
      }, 300);
      try {
        await fetch(
          `${config.tvTvUrl}/tv/playvideo?url=${encodeURIComponent(url)}`,
        );
      } catch (err) {
        unilog(1040, "Failed to stream trailer:", err);
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

    saveState() {
      // Save HTML5
      if (this.$refs.htmlVideos) {
        // refs might be single element or array or absent
        const vids = Array.isArray(this.$refs.htmlVideos)
          ? this.$refs.htmlVideos
          : [this.$refs.htmlVideos];
        vids.forEach((v) => {
          if (!v) return;
          const url = v.getAttribute("data-url");
          if (url && !v.paused) {
            this.savedTimes.set("html-" + url, v.currentTime);
            this.lastPlayingKey = "html-" + url;
          }
        });
      }

      // Save YT
      this.ytPlayers.forEach((player, idx) => {
        try {
          if (
            player &&
            player.getPlayerState &&
            player.getPlayerState() === 1
          ) {
            // 1 = playing
            const time = player.getCurrentTime();
            this.savedTimes.set("yt-" + idx, time);
            this.lastPlayingKey = "yt-" + idx;
          } else {
            // Also save paused state position just in case? No, only resume what was playing.
          }
          // Destroy player instance to clean up
          player.destroy();
        } catch (e) {
          /* ignore */
        }
      });
      this.ytPlayers.clear();
    },

    restoreState() {
      // Restore HTML5
      if (this.$refs.htmlVideos) {
        const vids = Array.isArray(this.$refs.htmlVideos)
          ? this.$refs.htmlVideos
          : [this.$refs.htmlVideos];
        vids.forEach((v) => {
          if (!v) return;
          const url = v.getAttribute("data-url");
          const key = "html-" + url;
          if (key === this.lastPlayingKey && this.savedTimes.has(key)) {
            v.currentTime = this.savedTimes.get(key);
            v.play().catch((e) => unilog(1041, "Resume blocked", e));
          }
        });
      }

      // YT restoration happens optionally in onPlayerReady or via initialization params
    },

    initPlayers() {
      if (!window.YT || !window.YT.Player) return; // Wait for API

      this.shownTrailers.forEach((t, idx) => {
        const ytid = this.getYoutubeId(t.url);
        if (ytid) {
          const divId = "yt-player-" + idx;
          const key = "yt-" + idx;
          // Check if we need to resume this one
          const shouldPlay = key === this.lastPlayingKey;
          const startSeconds = shouldPlay ? this.savedTimes.get(key) || 0 : 0;

          try {
            // If player already exists (shouldn't happen with v-if), destroy it (handled in saveState usually)
            if (document.getElementById(divId)) {
              const player = new window.YT.Player(divId, {
                height: "315",
                width: "100%",
                videoId: ytid,
                playerVars: {
                  playsinline: 1,
                  start: Math.floor(startSeconds),
                  autoplay: shouldPlay ? 1 : 0,
                  origin: window.location.origin,
                },
              });
              this.ytPlayers.set(idx, player);

              // Style fix for the iframe generated by YT API
              // It replaces the div, but might miss some styles or attributes.
              // We can style the container or just let it be.
            }
          } catch (e) {
            unilog(1042, "YT init error", e);
          }
        }
      });
    },

    loadYoutubeApi() {
      if (window.YT && window.YT.Player) {
        return;
      }
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

      this._onYouTubeIframeAPIReady = () => {
        if (this.active && this.showContent) {
          this.initPlayers();
        }
      };
      window.onYouTubeIframeAPIReady = this._onYouTubeIframeAPIReady;
    },

    getOrigin() {
      return window.location.origin;
    },
    getYoutubeId(url) {
      if (!url) return null;
      try {
        const regExp =
          /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return match && match[2].length === 11 ? match[2] : null;
      } catch (e) {
        return null;
      }
    },
    isVideoFile(url) {
      if (!url) return false;
      // Include IMDB direct video files
      return (
        /\.(mp4|webm|ogg|mov)$/i.test(url) ||
        /imdb-video\.media-imdb\.com.*\.(mp4|m3u8)/i.test(url) ||
        this.isHlsFile(url)
      );
    },
    isHlsFile(url) {
      if (!url) return false;
      return /\.m3u8(\?|$)/i.test(url);
    },
    isFailedVideo(url) {
      if (!url) return false;
      return this.failedVideoUrls.has(url);
    },
    onHtmlVideoError(url) {
      if (!url) return;
      const next = new Set(this.failedVideoUrls);
      next.add(url);
      this.failedVideoUrls = next;
    },
    isImdbVideo(url) {
      if (!url) return false;
      // Match IMDB page URLs only (not direct video files)
      return (
        /imdb\.com\/video\/vi\d+/i.test(url) &&
        !/imdb-video\.media-imdb\.com/i.test(url)
      );
    },
    isExpiredImdbMediaUrl(url) {
      if (!url || !/imdb-video\.media-imdb\.com/i.test(url)) return false;
      try {
        const parsed = new URL(url);
        const expiresSec = Number(parsed.searchParams.get("Expires") || "");
        if (!Number.isFinite(expiresSec) || expiresSec <= 0) return false;
        const expiresMs = expiresSec * 1000;
        return expiresMs <= Date.now() + IMDB_URL_EXPIRY_SAFETY_MS;
      } catch {
        return false;
      }
    },
    hasAnyImdbVideo(trailers) {
      // Check if any trailer is from IMDB
      return trailers.some((t) => {
        const url = t?.url || "";
        if (!url && !(t?.name && /imdb/i.test(t.name))) return false;
        if (/imdb-video\.media-imdb\.com/i.test(url)) {
          return !this.isExpiredImdbMediaUrl(url);
        }
        return /imdb/i.test(url) || (t?.name && /imdb/i.test(t.name));
      });
    },
    onSetUpSeries(show) {
      this.err = "";
      this.showName = show?.name || "";
      this.trailers = [];
      this.failedVideoUrls = new Set();
      this.savedTimes.clear();
      this.lastPlayingKey = null;
      this.showContent = true; // Reset
      this.loadingImdb = false; // Reset loading state
    },
    async onTvdbDataReady(data) {
      this.err = "";
      if (this.showName && data?.show?.name !== this.showName) return;

      const tvdbData = data?.tvdbData;
      if (tvdbData && Array.isArray(tvdbData.trailers)) {
        this.trailers = tvdbData.trailers;
      } else {
        this.trailers = [];
      }

      // Check if IMDB video is missing and fetch it
      const hasImdbVideo = this.hasAnyImdbVideo(this.trailers);
      if (!hasImdbVideo && data?.show && tvdbData) {
        this.loadingImdb = true;
        try {
          const srvr = await import("../srvr.js");
          const remotes = await srvr.getRemotesCmd({
            show: {
              name: data.show.name,
              id: data.show.id,
            },
            tvdbRemotes: tvdbData.remote_ids || [],
            fast: true,
          });

          // Bail out if the user switched shows while we were awaiting
          if (this.showName && data.show.name !== this.showName) return;

          // Find IMDB remote with video
          const imdbRemote = remotes?.find(
            (r) => r.name && r.name.startsWith("IMDB"),
          );
          if (imdbRemote?.video) {
            const newTrailer = {
              name: "IMDB Video",
              url: imdbRemote.video,
              language: "eng",
            };
            this.trailers.push(newTrailer);
            // Snapshot trailers now so a later show-switch can't corrupt the save
            const trailersSnapshot = [...this.trailers];

            // Update tvdb record immediately on server
            if (!this.previewMode) {
              await srvr.setTvdbFields({
                name: data.show.name,
                trailers: trailersSnapshot,
              });
            }
          }
        } catch (err) {
          unilog(
            1043,
            `Failed to fetch IMDB video for ${data.show.name}:`,
            err,
          );
        } finally {
          this.loadingImdb = false;
        }
      }
      // trailers watcher will handle init
    },
  },
  mounted() {
    this.loadYoutubeApi(); // Start loading API
    evtBus.on("setUpSeries", this.onSetUpSeries);
    evtBus.on("tvdbDataReady", this.onTvdbDataReady);

    evtBus.on("previewMode", this.onPreviewMode);
    evtBus.on("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.on("addPreviewShowDone", this.onAddPreviewShowDone);
  },
  unmounted() {
    evtBus.off("setUpSeries", this.onSetUpSeries);
    evtBus.off("tvdbDataReady", this.onTvdbDataReady);

    evtBus.off("previewMode", this.onPreviewMode);
    evtBus.off("previewSrchChoice", this.onPreviewSrchChoice);
    evtBus.off("addPreviewShowDone", this.onAddPreviewShowDone);
    this.saveState();
    if (window.onYouTubeIframeAPIReady === this._onYouTubeIframeAPIReady) {
      delete window.onYouTubeIframeAPIReady;
    }
  },
};
</script>
