<template>
  <div
    class="actor-card"
    @click.stop="handleClick($event)"
    @contextmenu.prevent
    :style="{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      margin: '5px',
      padding: '8px',
      backgroundColor: '#f5f5f5',
      borderRadius: '6px',
      border: isSelected ? '3px solid red' : '1px solid #ddd',
      cursor: 'pointer',
      color: 'black',
      textAlign: 'center',
      marginBottom: '3px',
      transition: 'border 0.15s',
    }"
  >
    <img
      v-if="actor.image"
      :src="actor.image"
      :alt="actor.name"
      :style="{
        width: '100px',
        height: '130px',
        objectFit: 'cover',
        borderRadius: '4px',
        marginBottom: '5px',
        cursor: 'pointer',
      }"
      @click="handleImageClick($event)"
      @error="handleImageError"
    />
    <div
      class="person-name"
      v-if="actor.personName"
      style="font-weight: bold; font-size: 14px"
    >
      {{ actor.personName }}
    </div>
    <div
      class="actor-name"
      v-if="actor.name"
      style="font-weight: normal; font-size: 12px"
    >
      ({{ actor.name }})
    </div>
  </div>
</template>

<script>
import { Buffer } from "buffer";
import * as util from "../util.js";

const theMan = Buffer.from("bXJza2lu", "base64").toString();

export default {
  name: "Actor",

  emits: ["actor-click"],

  props: {
    actor: {
      type: Object,
      required: true,
    },
    isSelected: {
      type: Boolean,
      default: false,
    },
  },

  data() {
    return {
      // Keep for future use:
      // longPressTimer: null,
      // isLongPressing: false,
    };
  },

  methods: {
    handleImageClick(e) {
      if (e.ctrlKey) return;
      e.stopPropagation();
      e.preventDefault();

      // Just emit click to select/deselect actor
      this.$emit("actor-click", { event: e, actor: this.actor });
    },
    handleClick(e) {
      const name = String(
        this.actor?.personName || this.actor?.name || "",
      ).trim();
      if (!name) return;

      if (e?.altKey) {
        navigator.clipboard.writeText(name);
        return;
      }

      if (e?.ctrlKey) {
        const url = `https://${theMan}.com/search/celebs?term=${encodeURIComponent(name)}`;
        util.openExternalPage(url);
        return;
      }

      this.$emit("actor-click", { event: e, actor: this.actor });
    },
    handleImageError(e) {
      // If image fails to load, try personImgURL as fallback
      if (this.actor.personImgURL && e.target.src !== this.actor.personImgURL) {
        e.target.src = this.actor.personImgURL;
      } else {
        // Hide image if both fail
        e.target.style.display = "none";
      }
    },

    // Keep these methods for future use (long-press feature):
    /*
    handleTouchStart(e) {
      this.isLongPressing = false;
      this.longPressTimer = setTimeout(() => {
        this.isLongPressing = true;
        this.triggerLongPress(e);
      }, 500);
    },
    handleTouchEnd(e) {
      const wasLongPressing = this.isLongPressing;
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      if (wasLongPressing) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => {
          this.isLongPressing = false;
        }, 100);
      }
    },
    handleTouchMove() {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      this.isLongPressing = false;
    },
    handleMouseDown(e) {
      this.isLongPressing = false;
      this.longPressTimer = setTimeout(() => {
        this.isLongPressing = true;
        this.triggerLongPress(e);
      }, 500);
    },
    handleMouseUp(e) {
      const wasLongPressing = this.isLongPressing;
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      if (wasLongPressing) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(() => {
          this.isLongPressing = false;
        }, 100);
      }
    },
    handleMouseLeave() {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      this.isLongPressing = false;
    },
    triggerLongPress(e) {
      const name = String(
        this.actor?.personName || this.actor?.name || "",
      ).trim();
      if (!name) return;

      this.$emit("actor-long-press", { event: e, actor: this.actor });
    },
    */

    // Keep for future use (Wikipedia feature):
    /*
    async openActorPage(actor) {
      const name = String(actor?.personName || actor?.name || "").trim();
      if (!name) return;

      // Open window immediately to avoid popup blocker
      const win = window.open("", "_blank");

      // Get actor page URL and open it
      const actorName = actor?.personName || actor?.name;
      if (actorName) {
        try {
          const srvr = await import("../srvr.js");
          const url = await srvr.getActorPage(actorName);
          if (url && win && !win.closed) {
            win.location.href = url;
          } else {
            win?.close();
          }
        } catch (e) {
          console.error("openActorPage error:", e);
          win?.close();
        }
      } else {
        win?.close();
      }
    },
    */
  },
};
</script>
