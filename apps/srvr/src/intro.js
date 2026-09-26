// A show's intro configuration: whether its seasons carry the trim/skip data
// the player uses (tvapp trims and skips intros itself). Marking intros happens
// in the web client's own player.

import * as tvdb from "./tvdb.js";

// After a season-intro save, if the show now has a configured intro (trimPos,
// skipDur, or an explicit "none"), clear needsIntro. Called from every save path
// so the flag never lingers.
// One-directional (only clears); the background update re-sets needsIntro when a
// show becomes unconfigured again.
// A show is "configured" once any season carries a trim, a skip, or an explicit
// "none" — meaning it will not be opened for intro marking again.
export function hasConfiguredIntro(rec) {
  return (
    rec?.seasonIntros != null &&
    Object.values(rec.seasonIntros).some(
      (si) => si?.trimPos != null || si?.skipDur != null || si?.none === true,
    )
  );
}

export async function reconcileNeedsIntro(name) {
  const rec = name && tvdb.getAllTvdbSync()?.[name];
  if (!rec) return;
  if (hasConfiguredIntro(rec) && rec.needsIntro) {
    await tvdb.setTvdbFields({ name, needsIntro: false });
  }
}

