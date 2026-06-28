<template>
  <div
    id="meta"
    style="height: 95dvh; padding: 0; margin: 0; display: flex"
  >
    <div style="border: 0.5px solid gray">name: {{ show.name }}</div>
    <div id="poster"></div>
  </div>
</template>

<script>
import evtBus from "../evtBus.js";
import { unilog } from "../log.js";

const images = ["/poster.jpg", "/landscape.jpg", "/clearlogo.png"];

export default {
  name: "Meta",
  data() {
    return {
      show: { name: "<No Show Selected>" },
    };
  },

  methods: {
    setPoster() {
      const img = new Image();
      let imgIdx = 0;
      const tryImg = () => {
        console.log("Meta: trying img:", images[imgIdx]);
        img.src =
          "https://hahnca.com/tv/" + encodeURI(this.show.name) + images[imgIdx];
      };
      tryImg();
      img.onload = () => {
        console.log("Meta: showing img:", images[imgIdx]);
        document.getElementById("poster").replaceChildren(img);
      };
      img.onerror = () => {
        console.log("Meta: no img:", images[imgIdx]);
        if (++imgIdx == images.length) {
          unilog(165, "Meta: no image found"); // log-id: 165
          return;
        }
        tryImg();
      };
    },
  },

  mounted() {
    evtBus.on("showSelected", (show) => {
      console.log("Meta: showSelected:", show.name);
      this.show = show;
      this.setPoster();
    });
  },
};
</script>
