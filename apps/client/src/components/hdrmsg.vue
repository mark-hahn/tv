<template>
  <div
    id="hdrMsg"
    style="
      width: 100%;
      height: 29px;
      line-height: 29px;
      padding: 0 8px;
      box-sizing: border-box;
      background-color: #ddd;
      color: #000;
      font-size: 17px;
      font-weight: bold;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    "
  >
    {{ text }}
  </div>
</template>

<script>
import { globalMessages, globalMessageText } from "../globalMessages.js";

export default {
  name: "HdrMsg",

  computed: {
    text() {
      // Touch the reactive Map so this computed re-runs on any change.
      void globalMessages.size;
      return globalMessageText();
    },
  },
};
</script>
