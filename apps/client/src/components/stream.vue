<template>
  <div
    v-if="visible"
    style="
      z-index: 110;
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 5px;
      padding: 10px 15px;
      margin-top: 4px;
    "
  >
    <div
      v-if="loading"
      style="color: #888; font-size: 14px"
    >
      Loading providers...
    </div>
    <div
      v-else-if="error"
      style="color: #c00; font-size: 14px"
    >
      {{ error }}
    </div>
    <div
      v-else-if="!providers.length"
      style="color: #888; font-size: 14px"
    >
      No streaming providers found
    </div>
    <div v-else>
      <div
        v-for="p in providers"
        :key="p.providerId"
        @click="openProvider(p)"
        style="
          display: flex;
          align-items: center;
          padding: 6px 8px;
          margin-bottom: 4px;
          cursor: pointer;
          border-radius: 5px;
          border: 1px solid #eee;
        "
        @mouseenter="$event.currentTarget.style.backgroundColor = '#f0f0f0'"
        @mouseleave="$event.currentTarget.style.backgroundColor = ''"
      >
        <img
          v-if="p.logoUrl"
          :src="p.logoUrl"
          style="
            width: 40px;
            height: 40px;
            border-radius: 4px;
            margin-right: 10px;
            object-fit: contain;
          "
        />
        <div
          v-else
          style="
            width: 40px;
            height: 40px;
            margin-right: 10px;
            background: #eee;
            border-radius: 4px;
          "
        ></div>
        <span style="font-size: 16px; flex: 1">{{ p.name }}</span>
        <span
          style="
            font-size: 16.5px;
            color: #888;
            background: #f5f5f5;
            border-radius: 3px;
            padding: 2px 6px;
          "
          >{{ p.type }}</span
        >
      </div>
    </div>
  </div>
</template>

<script>
import * as srvr from "../srvr.js";
import * as util from "../util.js";

export default {
  name: "Stream",
  props: {
    show: { type: Object, default: null },
    visible: { type: Boolean, default: false },
  },
  data() {
    return {
      providers: [],
      tmdbLink: null,
      loading: false,
      error: null,
      cache: {},
    };
  },
  watch: {
    visible(v) {
      if (v && this.show) this.fetchProviders();
    },
    show() {
      if (this.visible && this.show) this.fetchProviders();
    },
  },
  methods: {
    async fetchProviders() {
      const name = this.show?.name;
      if (!name) {
        console.log("[Stream] fetchProviders called but no show name");
        return;
      }

      if (this.cache[name]) {
        console.log(
          `[Stream] Cache hit for "${name}" - ${this.cache[name].providers.length} providers`,
        );
        this.providers = this.cache[name].providers;
        this.tmdbLink = this.cache[name].tmdbLink;
        this.error = null;
        return;
      }

      this.loading = true;
      this.error = null;
      this.providers = [];
      try {
        const params = { showName: name };
        if (this.show?.firstAired) {
          const y = String(this.show.firstAired).slice(0, 4);
          if (y.length === 4) params.year = y;
        }
        console.log(
          `[Stream] Fetching providers for "${params.showName}"${
            params.year ? ` (${params.year})` : ""
          }`,
        );
        const res = await srvr.getStreamProviders(params);
        console.log(
          `[Stream] API response: ${res.providers?.length || 0} providers, error: ${res.error || "none"}, tmdbId: ${res.tmdbId || "none"}`,
        );
        this.providers = res.providers || [];
        this.tmdbLink = res.tmdbLink || null;
        this.cache[name] = {
          providers: this.providers,
          tmdbLink: this.tmdbLink,
        };
        if (res.error) this.error = res.error;
      } catch (e) {
        console.error("[Stream] API error:", e);
        this.error = e.message || "Failed to fetch providers";
      } finally {
        this.loading = false;
      }
    },
    openProvider(p) {
      console.log(
        `[Stream] Opening provider "${p.name}" (${p.type}) - link: ${this.tmdbLink}`,
      );
      if (this.tmdbLink) {
        util.openExternalPage(this.tmdbLink);
      }
    },
  },
};
</script>
