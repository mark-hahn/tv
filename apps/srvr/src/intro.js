// A show's intro configuration: whether its seasons carry the trim/skip data
// the player uses (tvapp trims and skips intros itself). Marking intros happens
// in the web client's own player.

import { hasConfiguredIntro as seasonsHaveIntro } from "./derived.js";

// A show is "configured" once any season carries a trim, a skip, or an explicit
// "none" — meaning it will not be opened for intro marking again. needsIntro,
// computed from the same test, follows every season-intro save at once.
export function hasConfiguredIntro(rec) {
  return seasonsHaveIntro(rec?.seasonIntros);
}

