package com.hahnca.tvapp;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * One episode out of a show's episodeData. tv-srvr stores an episode as a
 * record of named fields -- {aired, watched, file, res, pos, ...}, any of them
 * left out when empty.
 */
final class Episode {

  private final JSONObject record;

  private Episode(JSONObject record) {
    this.record = record;
  }

  /** The episode in this slot of a season's row, or null when the slot is empty. */
  static Episode at(JSONArray episodes, int index) {
    if (episodes == null) return null;
    Object slot = episodes.opt(index);
    return slot instanceof JSONObject ? new Episode((JSONObject) slot) : null;
  }

  /** "YYYY-MM-DD", or empty when TVDB has no air date for it. */
  String aired() {
    return text(record.opt("aired"));
  }

  boolean watched() {
    return record.optBoolean("watched", false);
  }

  /** The file name, empty when the episode has no file on disk. */
  String file() {
    return text(record.opt("file"));
  }

  boolean hasFile() {
    return !file().isEmpty();
  }

  int res() {
    return record.optInt("res", 0);
  }

  /** The resume position in ms, 0 when there is none. */
  long pos() {
    return record.optLong("pos", 0);
  }

  /**
   * Sets the watched mark in place. The resume position goes either way:
   * watched leaves nothing to resume, and unwatched starts again from the
   * beginning.
   */
  void setWatched(boolean watched) throws JSONException {
    if (watched) record.put("watched", true);
    else record.remove("watched");
    record.remove("pos");
  }

  // A text value, a JSON null reading as empty.
  private static String text(Object value) {
    return value instanceof String ? (String) value : "";
  }
}
