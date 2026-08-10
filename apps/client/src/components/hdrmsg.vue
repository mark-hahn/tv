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
      fontSize: '18px',
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
  </div>
</template>

<script>
import { globalMessages, globalMessageText } from "../globalMessages.js";
import { loggingDisabled } from "../log.js";

export default {
  name: "HdrMsg",

  computed: {
    loggingDisabled() {
      return loggingDisabled.value;
    },
    text() {
      // Touch the reactive Map so this computed re-runs on any change.
      void globalMessages.size;
      return globalMessageText();
    },
  },
};
</script>
