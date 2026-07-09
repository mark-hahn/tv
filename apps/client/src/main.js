import { createApp } from "vue";
import App from "./components/App.vue";
import { unilog, logHere } from "./log.js";

document.addEventListener(
  "click",
  (e) => {
    const t = e.target;
    const tag = t.tagName.toLowerCase();
    const id = t.id ? `#${t.id}` : "";
    const text = t.textContent?.trim().slice(0, 40) ?? "";
    unilog(892, `${tag}${id}`, text ? `"${text}"` : "");
  },
  true,
);

const app = createApp(App);
app.mount("#app");

// Log client startup.
unilog(1216, "Started client ~~~");
