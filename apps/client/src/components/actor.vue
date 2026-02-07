<template>
  <div
    class="actor-card"
    @click.stop="handleClick($event)"
    @touchstart.passive="handleTouchStart($event)"
    @touchend="handleTouchEnd($event)"
    @touchmove="handleTouchMove"
    @mousedown="handleMouseDown($event)"
    @mouseup="handleMouseUp($event)"
    @mouseleave="handleMouseLeave"
    @contextmenu.prevent
    :style="{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      margin: '5px',
      padding: '8px',
      backgroundColor: isLongPressing ? '#d0d0ff' : '#f5f5f5',
      borderRadius: '6px',
      border: isLongPressing ? '2px solid #4444ff' : '1px solid #ddd',
      cursor: 'pointer',
      color: 'black',
      textAlign: 'center',
      marginBottom: '3px',
      transition: 'background-color 0.15s, border 0.15s',
    }"
  >
    <img
      v-if="actor.image"
      :src="actor.image"
      :alt="actor.name"
      style="
        width: 100px;
        height: 130px;
        object-fit: cover;
        border-radius: 4px;
        margin-bottom: 5px;
        cursor: pointer;
      "
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

const theMan = Buffer.from("bXJza2lu", "base64").toString();

export default {
  name: "Actor",

  emits: ["actor-click", "actor-long-press"],

  props: {
    actor: {
      type: Object,
      required: true,
    },
  },

  data() {
    return {
      longPressTimer: null,
      isLongPressing: false,
    };
  },

  methods: {
    handleImageClick(e) {
      // Stop event propagation and clear any long-press state
      e.stopPropagation();
      e.preventDefault();
      
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      this.isLongPressing = false;
      
      // Clicking image always opens actor page
      this.$emit("actor-click", { event: e, actor: this.actor });
    },
    handleClick(e) {
      // Don't perform click action if we just completed a long-press
      if (this.isLongPressing) {
        return;
      }

      const name = String(
        this.actor?.personName || this.actor?.name || "",
      ).trim();
      if (!name) return;

      if (e?.ctrlKey) {
        const url = `https://${theMan}.com/search/celebs?term=${encodeURIComponent(name)}`;
        window.open(url, "_blank");
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
    handleTouchStart(e) {
      e.preventDefault(); // Prevent context menu on long press
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
        // Delay resetting to prevent click from firing
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
        // Delay resetting to prevent click from firing
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
  },
  beforeUnmount() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  },
};
</script>
