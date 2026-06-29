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
        unilog(1026, "Meta: trying img:", images[imgIdx]);
        img.src =
          "https://hahnca.com/tv/" + encodeURI(this.show.name) + images[imgIdx];
      };
      tryImg();
      img.onload = () => {
        unilog(1027, "Meta: showing img:", images[imgIdx]);
        document.getElementById("poster").replaceChildren(img);
      };
      img.onerror = () => {
        unilog(1028, "Meta: no img:", images[imgIdx]);
        if (++imgIdx == images.length) {
          unilog(165, "Meta: no image found");
          return;
        }
        tryImg();
      };
    },
  },

  mounted() {
    evtBus.on("showSelected", (show) => {
      unilog(1029, "Meta: showSelected:", show.name);
      this.show = show;
      this.setPoster();
    });
  },
};
</script>
