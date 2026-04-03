<template>
  <div
    id="tvPane"
    style="
      width: 100%;
      height: 100%;
      display: flex;
      align-items: flex-start;
      padding: 10px;
      box-sizing: border-box;
    "
  >
    <button
      @click="onOn"
      style="
        height: 28px;
        font-size: 13px;
        cursor: pointer;
        border-radius: 7px;
        padding: 0 12px;
        border: 1px solid #bbb;
        background-color: whitesmoke;
      "
    >
      On
    </button>
  </div>
</template>

<script>
import { config } from "../config.js";

export default {
  name: "TvPane",

  methods: {
    async onOn() {
      const res = await fetch(`${config.tvTvUrl}/tv/on`);
      const data = await res.json();
      console.log("[TV] turn-on response:", data);
    },
  },
};
</script>
