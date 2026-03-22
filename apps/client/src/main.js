import { createApp } from "vue";
import App from "./components/App.vue";
import { initBtnTips } from "./btnTip.js";

const DEBUG_CLICKS = true;

if (DEBUG_CLICKS) {
  document.addEventListener(
    "click",
    (e) => {
      const t = e.target;
      const tag = t.tagName.toLowerCase();
      const id = t.id ? `#${t.id}` : "";
      const text = t.textContent?.trim().slice(0, 40) ?? "";
      console.log(`[click] ${tag}${id}`, text ? `"${text}"` : "");
    },
    true,
  );
}

const app = createApp(App);
app.mount("#app");
initBtnTips();
