// The show fields tv-srvr works out from a show's episodes and a few other
// fields (see derived.js) rather than storing. They sit on the in-memory
// records like any other field, so everything that reads a record -- here and
// in every client tv-srvr sends records to -- sees them, but they are left out
// whenever a record is written to tvdb.db, and anything sent to set one is
// ignored.
export const COMPUTED_FIELDS = [
  "watchedCount",
  "episodeCount",
  "seasonCount",
  "quality",
  "anyWatched",
  "notReady",
  "waitStr",
  "needsIntro",
  "watchGap",
  "watchGapSeason",
  "watchGapEpisode",
  "fileGap",
  "fileGapSeason",
  "fileGapEpisode",
  "resDrop",
  "resDropSeason",
  "resDropEpisode",
  "fileEndError",
  "fileEndErrorSeason",
  "fileEndErrorEpisode",
  "seasonWatchedThenNofile",
  "seasonWatchedThenNofileSeason",
  "seasonWatchedThenNofileEpisode",
  "stray",
  "strayCount",
  "strayFiles",
  "straySeason",
  "strayEpisode",
  "firstAired",
  "lastAired",
  "nextAired",
  "lastPlayedDate",
  "lastPlayedEpisode",
  "nextUp",
  "placements",
];
