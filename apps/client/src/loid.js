// Reddit loid cookie state. The server broadcasts "loidNeeded" when reddit
// rejects the stored loid cookie and "loidVerified" once a newly pasted cookie
// has been saved and verified; hdrmsg.vue shows an input box while needed.
import { ref } from "vue";
import evtBus from "./evtBus.js";

export const loidNeeded = ref(false);

evtBus.on("loidNeeded", () => {
  loidNeeded.value = true;
});
evtBus.on("loidVerified", () => {
  loidNeeded.value = false;
});
