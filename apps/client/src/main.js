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
    // A clicked button keeps focus, and a later Enter or Space would click it again.
    t.closest("button")?.blur();
  },
  true,
);

const app = createApp(App);
app.mount("#app");

// Log client startup.
unilog(1216, "Started client ~~~");
