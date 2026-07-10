<template>
  <div
    id="hdrMsg"
    :style="{
      display: 'flex',
      alignItems: 'center',
      width: '100%',
      height: '29px',
      lineHeight: '29px',
      padding: '0 8px',
      boxSizing: 'border-box',
      backgroundColor: loggingDisabled ? '#ffcccc' : '#ddd',
      color: 'rgba(5, 5, 5)',
      fontSize: '17px',
      whiteSpace: 'nowrap',
      maxWidth: '100%',
    }"
  >
    <div
      :style="{
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }"
    >
      {{ text }}
    </div>
    <input
      v-if="loidNeeded"
      v-model="loidInput"
      placeholder="Reddit loid cookie"
      spellcheck="false"
      :style="{
        flex: 'none',
        width: '220px',
        height: '21px',
        marginLeft: '8px',
        fontSize: '13px',
        border: loidError ? '1px solid red' : '1px solid #999',
        borderRadius: '3px',
        padding: '0 4px',
        boxSizing: 'border-box',
      }"
      :title="loidError"
      @keyup.enter="submitLoid"
    />
  </div>
</template>

<script>
import { globalMessages, globalMessageText } from "../globalMessages.js";
import { loggingDisabled, logHere } from "../log.js";
import { loidNeeded } from "../loid.js";
import { setLoidCookie } from "../srvr.js";

export default {
  name: "HdrMsg",

  data() {
    return {
      loidInput: "",
      loidError: "",
    };
  },

  computed: {
    loggingDisabled() {
      return loggingDisabled.value;
    },
    loidNeeded() {
      return loidNeeded.value;
    },
    text() {
      // Touch the reactive Map so this computed re-runs on any change.
      void globalMessages.size;
      return globalMessageText();
    },
  },

  methods: {
    async submitLoid() {
      const cookie = this.loidInput.trim();
      if (!cookie) return;
      this.loidError = "";
      try {
        const res = await setLoidCookie(cookie);
        if (res?.ok) {
          // Server broadcasts loidVerified which hides the box everywhere.
          this.loidInput = "";
        } else {
          this.loidError = res?.error || "verify failed";
        }
      } catch (e) {
        this.loidError = e?.error || e?.message || "verify failed";
        logHere({ lvl: "warn" }, `loid cookie submit failed: ${this.loidError}`);
      }
    },
  },
};
</script>
